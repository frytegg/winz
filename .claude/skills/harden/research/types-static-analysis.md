# Type safety and static analysis rigour
> Code T18 · slug types-static-analysis · verified 2026-09-23 · counts: verified 6 / corrected 11 / downgraded 1 / dropped 0

## Summary

Research wave run 2026-09-23. The fact-check opened every cited source. PDFs were downloaded and their text extracted with pdftotext. HN comments were read through the hn.algolia.com items API, and GitHub comments through the GitHub API. Some quotes had come from a WebFetch summary rather than from the page itself. Those were replaced with the verbatim text, or rewritten as paraphrases. Tool versions confirmed on the live pages:
- TypeScript 6.0, released 2026-03-23, where `strict` is now true by default. 7.0 will remove the options deprecated in 6.0.
- typescript-eslint v8.70.1.
- ESLint v10.11.0.
- mypy 2.3.1.
- Clang-Tidy docs at 24.0.0git (in progress).
- OpenSSF C/C++ Compiler Options Hardening Guide dated 2026-08-20.
- Zod 4.

The researcher's list also named "Python 3.14 docs", but no finding cites them, so that entry was removed.

Grade scale used in this dossier:
- **A**: peer-reviewed empirical data, or several independent authoritative sources that directly state the rule.
- **B**: authoritative vendor docs, standards or industrial experience reports, with no controlled data on the outcome.
- **C**: design guidance and practitioner consensus only.

What the evidence says:

1. **Static types catch a real but bounded share of shipped bugs.** Two peer-reviewed studies using the same method agree:
   - Gao et al., ICSE 2017: Flow 0.30 and TypeScript 2.0 would each have caught 60 of 400 public JavaScript bugs, 15% (95% CI 11.5–18.5%).
   - Khan et al., TSE 2021: mypy would have caught 15% of corrective Python defects, 11% of all defects.

   Both call their figures lower bounds. Null handling is the class caught most often (Khan). In Gao's data, among the bugs neither checker caught, 55% were specification errors and 78% were errors implementing the specification. Comparisons between languages find very small effects (Berger et al., TOPLAS 2019, and the original authors agree). One MSR 2022 study found TypeScript apps were not less bug-prone than JavaScript apps. So hardening should target null safety and escape hatches first, and must never replace tests.

2. **How findings are delivered matters as much as how precise they are.**
   - Facebook Infer: the same analysis had a fix rate near 0% as a batch report and over 70% at diff time. The batch figure comes from only 20–30 assigned issues.
   - Google: developers ignored compiler warnings. Build-breaking checks must have no effective false positives, and code-review checks must stay below 10%.
   - Microsoft (375 respondents): 90% of developers accept a false-positive rate of up to 5%, and only 24% accept 20%.

3. **Suppressions pile up and go stale.** In 10 Python projects that use Pylint (FSE 2025), 50.8% of 1,873 suppressions suppressed nothing. Across 1,537 suppression histories, 59 broad suppressions silently hid at least 184 warnings introduced later. Every ecosystem has a tool option to detect unused suppressions:
   - ESLint reportUnusedDisableDirectives, which defaults to "warn"
   - TypeScript @ts-expect-error
   - mypy warn_unused_ignores
   - pyright reportUnnecessaryTypeIgnoreComment, which is "none" even in strict mode
   - Ruff RUF100
   - Rust #[expect]
   - golangci-lint nolintlint
   - PHPStan reportUnmatchedIgnoredErrors

4. **Tighten a finished project incrementally.** There are two approaches:
   - Location-keyed baselines or ratchets: ESLint bulk suppressions, basedpyright baseline, PHPStan baseline, golangci-lint new-from-merge-base, Notion's eslint-seatbelt.
   - Strictness scoped per file or per module: VS Code's separate strictNullChecks tsconfig, C# `#nullable`, mypy per-module config, pyright strict paths, Sorbet sigils.

   The checks you keep must fail CI. Blanket -Werror should not ship in build files that other people compile.

5. **Some fixes that look behaviour-neutral actually change behaviour:**
   - Rewriting a non-null assertion `!` as `?.` or `??` turns a crash into a silent `undefined` or default. typescript-eslint's own suggestion fixer rewrites `x!.y` to `x?.y`.
   - Deleting conditions that a type-aware rule calls "unnecessary" is unsafe when the types do not match runtime values (JSON, `any`, untyped libraries).
   - Replacing a default branch with assertNever changes how unexpected values are handled.
   - Adding runtime validation at boundaries.
   - Adding casts to silence -Wconversion.
   - Changing Python annotations that pydantic, FastAPI or dataclasses read at runtime.

6. **Type-design rules come from guides, not defect data.** Making illegal states unrepresentable, newtypes and "parse, don't validate" rest on official guides and well-known practitioner writing. They are graded C where no defect data exists.

## Findings

### T18-F01 — Treat a clean type-check as evidence against one bounded defect class, never as proof of correctness
Rule: static typing catches about 1 in 7 fixed public bugs, mostly null/undefined handling and wrong-type or wrong-attribute misuse. Hardening must not delete or weaken runtime tests or assertions because "the types now guarantee it". Spend type-hardening effort in this order: null safety first, then data shape and API misuse.

- **Grade:** A · **Verdict:** CORRECTED. Three changes:
  - The 55% and 78% figures describe the bugs neither checker detected (after resolving unknowns), not all bugs.
  - "No type system catches those" was an overclaim. The paper says specification misunderstandings are something "type systems cannot detect", and that stronger type systems than Flow and TypeScript could do better.
  - The Airbnb "38%" counterpoint lost its InfoQ attribution, because no InfoQ source could be found.
- **Rationale:** Gao et al. took 400 public JavaScript bugs and added annotations just before each fix. Flow detected 59 and TypeScript 58. After the 18 unknowns were resolved, both reached 60 (95% CI 11.5–18.5%, mean 15%). The versions were Flow 0.30 and TypeScript 2.0.

  Khan et al. repeated the method on 210 Python projects with mypy: 15% of corrective defects (11% of all defects) could have been avoided. Incorrectly handled null objects were the defect class caught most often. Both studies call their figure a lower bound, because they only looked at public bugs that had already been fixed, reviewed and tested.

  Comparisons between languages are much weaker evidence. Berger et al.'s reproduction found only 4 languages with a significant association with defects, with "exceedingly small" effect sizes, and the original authors' rebuttal agrees the effects are small. Static bug detectors in general found 27 of 594 Defects4J Java bugs (4.5%).
- **Evidence:**
  - [To Type or Not to Type: Quantifying Detectable Bugs in JavaScript](https://earlbarr.com/publications/typestudy.pdf) — Zheng Gao, Christian Bird, Earl T. Barr (ICSE), 2017 — peer_reviewed — "Of the 400 public bugs we assessed, Flow successfully detects 59 of them and TypeScript 58"; "[11.5%, 18.5%] with mean 15%"; "SpecError, with 186 bugs, accounts for 55% of the total bugs… Errors implementing specification, as a group, overwhelmingly constitute 78%" — verified in PDF text. The 55% and 78% are shares of the ts-undetectable bugs, per the Figure 6 context.
  - [An Empirical Study of Type-Related Defects in Python Projects](https://rebels.cs.uwaterloo.ca/papers/tse2021_khan.pdf) — Faizan Khan, Boqi Chen, Daniel Varró, Shane McIntosh (IEEE TSE), 2021 — peer_reviewed — "15% of the corrective defects (11% of all defects) in Python projects could likely have been avoided by using a static type checker"; "Incorrectly handled null objects are the commonly caught type-related defects"; "these results represent a lower bound" — verified in PDF text (210 projects).
  - [On the Impact of Programming Languages on Code Quality: A Reproduction Study](https://arxiv.org/abs/1901.10220) — Berger, Hollenbeck, Maj, Vitek, Vitek (TOPLAS), 2019 — peer_reviewed — "only four languages are found to have a statistically significant association with defects, and even for those the effect size is exceedingly small" — verified (abstract).
  - [Rebuttal to Berger et al., TOPLAS 2019](https://arxiv.org/abs/1911.07393) — Ray, Devanbu, Filkov, 2019 — preprint — "the effects (in a statistical sense) found in the data are small, and should be taken with caution" — verified (abstract).
  - [How Many of All Bugs Do We Find? A Study of Static Bug Detectors](https://software-lab.org/publications/ase2018_static_bug_detectors_study.pdf) — Andrew Habib, Michael Pradel (ASE), 2018 — peer_reviewed — "The three bug detectors together reveal 27 of the 594 studied bugs (4.5%)… The majority of missed bugs are domain-specific problems not covered by any existing bug pattern" — verified in PDF text. The paper covers Java, and the "majority of missed" figure comes from inspecting 20 missed bugs, of which 14 were domain-specific.
  - [This is how science happens](https://www.hillelwayne.com/post/this-is-how-science-happens/) — Hillel Wayne, 2020-03-09 — engineering_blog — "FSE simply didn't understand the data. They mistakenly counted 200k safe commits as DFCs and 100k DFCs as safe." — verified verbatim. This is a secondary account of the Ray et al. vs Berger et al. dispute.
- **Detect:** this is a prioritisation rule, so check the hardening diff itself:
  - `git diff <base>...HEAD -- '*test*' '*spec*'`, then `git diff <base> | rg '^-.*(assert|expect\(|should|raise|throw)'` to find removed assertions.
  - Reject any commit that justifies removing a runtime check with "the type system guarantees it".
  - Order the backlog: null safety (F02), then escape hatches (F13), then boundary parsing (F15).
- **Tools:** git diff, ripgrep.
- **Applies to:** languages with optional or gradual typing (TypeScript/Flow, Python, Ruby/Sorbet, PHP). By extension, stricter compiler settings in statically typed languages.
- **When not to apply / counterpoints:**
  - Bogner & Merkel (MSR 2022, 604 repos) found TypeScript apps were not less bug-prone than JavaScript apps. The mean bug-fix commit ratio was 0.206 for TS vs 0.126 for JS.
  - The widely circulated "38% of bugs at Airbnb could have been prevented by types" (HN item 19131272, Feb 2019, linking a Reddit post) could not be traced to a published method in this pass. Treat it as unverified.
  - Both detection studies used 2016-era checkers (Flow 0.30, TS 2.0, mypy of that period). Current checkers might catch more.
- **Fix risk:** low

### T18-F12 — Turn on unused-suppression detection as an ERROR and delete everything it reports
Settings per ecosystem:
- ESLint: `linterOptions.reportUnusedDisableDirectives: "error"` (or `--report-unused-disable-directives-severity error`) plus `--report-unused-inline-configs error`.
- TypeScript: use `@ts-expect-error` instead of `@ts-ignore`, so an unneeded one reports itself.
- mypy: `warn_unused_ignores`.
- pyright: `reportUnnecessaryTypeIgnoreComment`, which is off even in strict mode, so enable it explicitly.
- Ruff: RUF100.
- Rust: `#[expect]`, plus `clippy::allow_attributes`.
- golangci-lint: nolintlint with `allow-unused: false`.
- PHPStan: keep reportUnmatchedIgnoredErrors on.
- ESLint bulk suppressions: `--prune-suppressions`.

Run the checks across the full build matrix before deleting anything.

- **Grade:** A · **Verdict:** CORRECTED. Two changes:
  - The 50.8% figure was narrowed to its real scope: Pylint suppressions in 10 Python projects (1,873 suppressions at the newest commit), not suppressions in general.
  - The contradiction with the paper's statement that mypy lacks unused-suppression reporting was added. The mypy docs show that it has one.
- **Rationale:** In Hu et al.'s ten in-depth Python/Pylint projects, 921 suppressions were useful and 952 useless. The useless share was 50.8% overall, ranging from 36.5% at file level to 60.7% at block level. All ten projects had some. Six suppressions that had become useless later silently hid newly introduced warnings, for example after a base class changed. Removing a suppression that suppresses nothing does not change runtime behaviour. Every major ecosystem documents a built-in detector for them.
- **Evidence:**
  - [An Empirical Study of Suppressed Static Analysis Warnings](https://software-lab.org/publications/fse2025_suppressions.pdf) — Huimin Hu, Yingying Wang, Julia Rubin, Michael Pradel (FSE 2025 / PACMSE), 2025 — peer_reviewed — "50.8% of all suppressions do not affect any warning and hence are practically useless"; "921 useful and 952 useless… Useless suppressions range from 36.5% at the file level to 60.7% at the block level"; "six suppressions are useless at some point, but then suddenly suppress newly introduced warnings"; "Developers should be aware of this fact and remove useless suppressions from their code base" — verified in PDF text. The RQ3/RQ4 scope is 10 Pylint-using Python projects. The study covers Pylint, Checkstyle, PMD and ESLint, but the usefulness analysis is Python only.
  - [ESLint Command Line Interface Reference](https://eslint.org/docs/latest/use/command-line-interface) — ESLint v10.11.0, 2026 — official_docs — `--report-unused-disable-directives` "causes ESLint to report directive comments like `// eslint-disable-line` when no errors would have been reported on that line anyway"; the severity variant accepts off, warn or error; `--report-unused-inline-configs` exists — verified.
  - [Configure Rules — reportUnusedDisableDirectives](https://eslint.org/docs/latest/use/configure/rules) — ESLint, 2026 — official_docs — "This setting defaults to "warn"." — verified.
  - [Pyright configuration](https://raw.githubusercontent.com/microsoft/pyright/main/docs/configuration.md) — Microsoft pyright, 2026 — official_docs — reportUnnecessaryTypeIgnoreComment: "Generate or suppress diagnostics for a `# type: ignore` or `# pyright: ignore` comment that would have no effect if removed." The defaults table shows "none" in off, basic, standard and strict — verified.
  - [RUF100 unused-noqa](https://docs.astral.sh/ruff/rules/unused-noqa/) — Astral Ruff, 2026 — official_docs — "A noqa directive that no longer matches any diagnostic violations is likely included by mistake, and should be removed to avoid confusion." The rule is stable. The fix is unsafe when other nested comments share the line — verified.
  - [The mypy command line](https://mypy.readthedocs.io/en/stable/command_line.html) — mypy 2.3.1, 2026 — official_docs — `--warn-unused-ignores`: "This flag will make mypy report an error whenever your code uses a `# type: ignore` comment on a line that is not actually generating an error message." — verified.
- **Detect:**
  - `npx eslint . --report-unused-disable-directives-severity error --report-unused-inline-configs error`
  - `npx tsc --noEmit`, which reports "Unused '@ts-expect-error' directive"
  - `mypy --warn-unused-ignores .`
  - pyright with `"reportUnnecessaryTypeIgnoreComment": "error"`
  - `ruff check --select RUF100`
  - `cargo clippy -- -W clippy::allow_attributes` after converting to `#[expect]`
  - golangci-lint nolintlint with `allow-unused: false`
  - `npx eslint . --prune-suppressions`
- **Tools:** ESLint, tsc, mypy, pyright, ruff RUF100, cargo clippy, golangci-lint nolintlint, PHPStan.
- **Applies to:** all languages with inline suppressions or baselines.
- **When not to apply / counterpoints:**
  - A suppression can look unused under one configuration and still be needed under another: other Python or TS versions (the TS 3.9 notes accept `@ts-ignore` during upgrades), platform stubs, Rust cfg features, C preprocessor branches. Delete only after running the whole CI matrix.
  - Ruff marks some RUF100 fixes unsafe.
  - The empirical base is one ecosystem (Pylint).
- **Fix risk:** low

### T18-F11 — Every suppression must name the exact rule, cover the smallest scope, and give a reason
Every suppression must (1) name the exact rule or code, (2) cover the smallest possible scope (next line, not file, class or block), and (3) give a reason. These forms are violations to fix:
- `@ts-ignore` and `@ts-nocheck`. Prefer a real fix, then a tactical `as any` on the single expression, then `@ts-expect-error -- reason`.
- Bare `# type: ignore` or `# noqa`.
- `eslint-disable` with no rule list, or at file level.
- `//nolint` without a linter name.
- `NOLINT` without `(check)`.
- `#[allow]` without `reason = "…"`. Prefer `#[expect(lint, reason = "…")]`.
- `@SuppressWarnings` on a class or method where a variable-level annotation would do.

- **Grade:** A · **Verdict:** CORRECTED. The empirical figures were scoped to Pylint suppressions in 10 Python projects.
- **Rationale:** Hu et al. (FSE 2025) examined 1,537 suppression histories in their Python projects. They found 59 suppressions that unintentionally hid at least 184 warnings introduced later:
  - In one case, a file-level suppression originally suppressed 3 warnings and later hid 56 more, at least 264 lines away.
  - In 36 of the 59 cases, a different author made the later change. The average gap was 230.8 days.

  The mypy docs say that adding codes to ignores means "you won't accidentally ignore other, potentially more serious errors". Ryan Cavanaugh (TypeScript team) wrote that 95% of the people who said they "needed" `ts-ignore` could have used "a more tactical `as any`". Rust 1.81 added `#[expect]` and lint reasons. Effective Java requires the smallest possible scope and a comment explaining why each unchecked suppression is safe.
- **Evidence:**
  - [An Empirical Study of Suppressed Static Analysis Warnings](https://software-lab.org/publications/fse2025_suppressions.pdf) — Hu, Wang, Rubin, Pradel (FSE), 2025 — peer_reviewed — "Among 1,537 histories of suppressions, we identify 59 cases of such potentially unintended suppressions of at least 184 warnings"; the file-level example "initially suppresses three warnings, but later hides 56 more warnings"; "7,357 suppressions in 46 Python projects, which corresponds to a suppression in one out of six code files"; "36 out of the 59 cases… average of 230.8 days" — verified in PDF text.
  - [mypy — Error codes](https://mypy.readthedocs.io/en/stable/error_codes.html) — mypy, 2026 — official_docs — "It's possible to silence specific error codes on a line using `# type: ignore[code]`. This way you won't accidentally ignore other, potentially more serious errors." `ignore-without-code` can be enabled — verified.
  - [PGH003 blanket-type-ignore](https://docs.astral.sh/ruff/rules/blanket-type-ignore/) — Astral Ruff, 2026 — official_docs — "Suppressing all warnings can hide issues in the code"; the fix example is `# type: ignore[attr-defined]` — verified.
  - [ban-ts-comment](https://typescript-eslint.io/rules/ban-ts-comment/) — typescript-eslint, 2026 — official_docs — defaults: ts-expect-error `'allow-with-description'`, ts-ignore `true`, ts-nocheck `true`, minimumDescriptionLength `3` (10 in strict). Enabled in recommended — verified.
  - [TypeScript 3.9 release notes — ts-ignore or ts-expect-error?](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-9.html) — Microsoft, 2020 — official_docs — "if there's no error, TypeScript will report that `// @ts-expect-error` wasn't necessary". It advises picking ts-ignore if "you have a larger project and new errors have appeared in code with no clear owner" or during a TS version upgrade — verified.
  - [Comment on TypeScript issue #19139](https://github.com/microsoft/TypeScript/issues/19139#issuecomment-690530124) — Ryan Cavanaugh (TypeScript team), 2020-09-10 — practitioner_forum — "95% of people said they "needed" the feature for suppressing some particular error that they could have suppressed with a more tactical `as any`… there should be *very very very few* `ts-ignore`s in your codebase" — verified via the GitHub API.
  - [Configure Rules — disable comments with descriptions](https://eslint.org/docs/latest/use/configure/rules) — ESLint, 2026 — official_docs — "The description must come after the configuration and needs to be separated from the configuration by two or more consecutive `-` characters" — verified.
  - [eslint-plugin-eslint-comments rules](https://eslint-community.github.io/eslint-plugin-eslint-comments/rules/) — ESLint Community, 2026 — official_docs — no-unlimited-disable: "disallow `eslint-disable` comments without rule names"; require-description — verified.
  - [golangci-lint linters configuration — nolintlint](https://golangci-lint.run/docs/linters/configuration/) — golangci-lint, 2026 — official_docs — require-explanation: "Require an explanation for nolint directives"; require-specific: "Require specific linter names in nolint directives" (both default false) — verified.
  - [Clang-Tidy — Suppressing Undesired Diagnostics](https://clang.llvm.org/extra/clang-tidy/) — LLVM (docs at 24.0.0git), 2026 — official_docs — `// NOLINT(check-name1, check-name2)`; whitespace between NOLINT* and "(" is not allowed and makes the comment a plain NOLINT — verified.
  - [Announcing Rust 1.81.0](https://blog.rust-lang.org/2024/09/05/Rust-1.81.0/) — Rust Release Team, 2024 — official_docs — `#[expect(lint)]` "allows explicitly noting that a particular lint *should* occur, and warning if it doesn't"; lint attributes accept `reason = "…"` — verified.
  - [Clippy lints: allow_attributes, allow_attributes_without_reason](https://rust-lang.github.io/rust-clippy/master/index.html#allow_attributes_without_reason) — Rust Clippy, 2026 — official_docs — allow_attributes (restriction, added 1.70.0); allow_attributes_without_reason (restriction, 1.61.0) — verified.
  - [Effective Java, 3rd ed., Item 27: Eliminate unchecked warnings](https://www.informit.com/articles/article.aspx?p=2861454&seqNum=2) — Joshua Bloch (InformIT excerpt), 2018 — book — "Always use the SuppressWarnings annotation on the smallest scope possible"; "Never use SuppressWarnings on an entire class"; "Every time you use a @SuppressWarnings("unchecked") annotation, add a comment saying why it is safe to do so." — verified on the publisher's excerpt page.
- **Detect:**
  - TS/JS:
    - `rg -n '@ts-ignore|@ts-nocheck'`
    - `rg -n '@ts-expect-error\s*$'` (no reason given)
    - `rg -nP 'eslint-disable(-next-line|-line)?\s*(\*/|$)'` (no rule list)
    - Enable `@typescript-eslint/ban-ts-comment` and `@eslint-community/eslint-comments/{no-unlimited-disable,require-description}`.
  - Python:
    - `rg -nP '#\s*type:\s*ignore(?!\[)'` and `rg -nP '#\s*noqa(?!:)'`
    - ruff PGH003
    - mypy `enable_error_code = ["ignore-without-code"]`
  - Go: `rg -nP '//nolint(?!:)'`, plus nolintlint require-specific and require-explanation.
  - C/C++: `rg -nP 'NOLINT(NEXTLINE|BEGIN)?(?!\()'`.
  - Rust: `rg -n '#!?\[allow\('`, plus `clippy::allow_attributes_without_reason`.
  - Java: `rg -n -B1 '@SuppressWarnings' -g '*.java'`, then flag annotations sitting on class declarations.
- **Tools:** typescript-eslint ban-ts-comment, @eslint-community/eslint-plugin-eslint-comments, mypy ignore-without-code, ruff PGH003, golangci-lint nolintlint, clang-tidy, clippy allow_attributes_without_reason, ripgrep.
- **Applies to:** every language and analyzer that supports inline suppressions.
- **When not to apply / counterpoints:**
  - The TypeScript team says `ts-ignore` is reasonable for unowned code in large projects and during compiler upgrades.
  - TypeScript deliberately has no per-error-code suppression, because its error codes are not guaranteed stable across versions.
  - Mandatory reasons can turn into boilerplate ("-- legacy").
  - `as any` hides less than a suppression comment but still turns off checking for that value, which conflicts with F13's ratchet on `any`.
- **Fix risk:** low

### T18-F10 — Deliver hardening as small per-module changes that contain the fix, and gate each check on its measured false-positive rate
Rule: deliver hardening as small, reviewable, per-module changes that already contain the fix, not as a list of findings or a dashboard. Before making a check blocking, triage a sample of its current hits on this codebase:
- A build-breaking check must show zero effective false positives.
- An advisory, review-time check must show under 10% (cases where the developer disagrees or will not act).
- Otherwise keep the check off.

- **Grade:** A · **Verdict:** VERIFIED. Caveats were added for the Infer batch sample size and for the Google thresholds being one company's policy.
- **Rationale:** Google's published criteria say compiler checks must "produce no effective false positives", and code-review checks may include "up to 10% effective false positives". Tricorder disables an analyzer when its "Not useful" ratio goes above 10%. Google split large cleanups into per-project patches with Rosie: 57% of recipients were happy, 41% neutral and 2% negative. At its 2009 FindBugs Fixit, Google reviewed 3,954 warnings and fixed only 16% (640).

  Microsoft's survey (375 respondents): 90% of developers accept false-positive rates up to 5%, 47% up to 15%, and 24% up to 20%. The top pain point was "irrelevant checks are turned on by default". Johnson et al. interviewed 20 developers and found that false positives and warning presentation are the main barriers. At Facebook, moving Infer to diff time took the fix rate from near 0% to over 70%. The batch trial involved only 20–30 assigned issues.
- **Evidence:**
  - [Lessons from Building Static Analysis Tools at Google](https://storage.googleapis.com/gweb-research2023-media/pubtools/4365.pdf) — Sadowski, Aftandilian, Eagle, Miller-Cushon, Jaspan (CACM 61(4)), 2018 — peer_reviewed — "They reviewed a total of 3,954 such warnings… but only 16% (640) were actually fixed"; "Produce less than 10% effective false positives. Developers should feel the check is pointing out an actual issue at least 90% of the time"; "If the ratio for an analyzer goes above 10%, the Tricorder team disables the analyzer"; footnote: "initially chosen by the first author somewhat arbitrarily"; "57%… were happy… 41% were neutral. Only 2% responded negatively" — verified in PDF text.
  - [What Developers Want and Need from Program Analysis: An Empirical Study](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/07/What-Developers-Want-and-Need-from-Program-Analysis-An-Empirical-Study.pdf) — Maria Christakis, Christian Bird (ASE), 2016 — peer_reviewed — "47% of developers are willing to accept a false positive rate up to 15%, and only 24% percent of developers can handle a false positive rate as high as 20%"; pain points "(1) irrelevant checks are turned on by default, (2) bad phrasing of warnings, (3) too many false positives"; "High false positive rates lead to disuse." — verified in PDF text (375 responses from 2,000 invited Microsoft developers).
  - [Why Don't Software Developers Use Static Analysis Tools to Find Bugs?](https://research.google/pubs/why-dont-software-developers-use-static-analysis-tools-to-find-bugs/) — Johnson, Song, Murphy-Hill, Bowdidge (ICSE), 2013 — peer_reviewed — 20 developers interviewed; "false positives and the way in which the warnings are presented, among other things, are barriers to use"; recommends "an interactive mechanism to help developers fix defects" — verified (abstract only).
  - [Scaling Static Analyses at Facebook](https://6826.csail.mit.edu/2020/papers/facebook-infer-cacm.pdf) — Distefano, Fähndrich, Logozzo, O'Hearn (CACM 62(8)), 2019 — peer_reviewed — "We assigned 20–30 issues to developers, and almost none of them were acted on. We had worked hard to get the false positive rate down to what we thought was less than 20%, and yet the fix rate… was near zero"; "the fix rate rocketed to over 70%" — verified in PDF text.
- **Detect:**
  - For each candidate rule or flag, list its hits: `npx eslint . --rule '{"<rule>":"error"}' -f json`, `mypy --enable-error-code <code>`, `clang-tidy -checks=-*,<check>`.
  - Classify a random sample of hits as real problem vs. not worth changing. The sample size of about 20 is this dossier's heuristic, not a sourced figure.
  - Block only rules with zero false positives in the sample. Keep rules with at most 10% as advisory.
  - Group accepted fixes by module or package into separate commits or PRs.
- **Tools:** ESLint, mypy, pyright, clang-tidy, Error Prone, git.
- **Applies to:** all languages and analyzers. Especially relevant when an agent proposes many rule changes at once.
- **When not to apply / counterpoints:**
  - Google says its 10% cutoff was "chosen somewhat arbitrarily", and it was set for a very large organisation.
  - A solo developer or small team may accept more noise from high-severity checks. Infer's concurrency analysis kept a fix rate of about 50%, which developers valued because concurrency bugs are hard to debug.
  - Even precise detectors catch few bugs (Habib & Pradel: 4.5%).
- **Fix risk:** low

### T18-F06 — Enable curated diagnostic sets and pick aggressive checks one by one; never enable "everything" groups
Rule: enable curated, documented diagnostic sets. Pick checks from the aggressive groups one by one, each with a reason. Never enable "everything" groups wholesale.
- Rust: keep clippy's default groups (correctness, suspicious, style, complexity, perf). Choose pedantic and restriction lints individually. Never enable `clippy::restriction` as a group.
- C/C++ (GCC/Clang): `-Wall -Wextra -Wformat -Wformat=2 -Wconversion -Wsign-conversion -Wimplicit-fallthrough`, plus `-Wbidi-chars=any` on GCC 12+. Do not use `-Weverything`.
- TypeScript: adopt typescript-eslint strict rules individually (F04).

On an existing codebase, add new warnings one or a few at a time.

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - The Clippy docs say restriction "should, emphatically, not be enabled as a whole", and describe pedantic as "rather strict or have occasional false positives".
  - The Clang manual "generally don't recommend using" `-Weverything`, because it exposes experimental diagnostics and makes compiler upgrades harder.
  - The OpenSSF guide lists the recommended warning set and advises enabling "one or a few options at a time" on existing code.
  - Beller et al. (122 and 168,214 OSS projects) found that analyzer configurations barely differ from the defaults and "once introduced, never change". So a finished project probably runs with stale defaults.
- **Evidence:**
  - [Clippy documentation — lint groups](https://doc.rust-lang.org/clippy/) — Rust project, 2026 — official_docs — "The `restriction` category should, *emphatically*, not be enabled as a whole. The contained lints may lint against perfectly reasonable code, may not have an alternative suggestion, and may contradict any other lints"; pedantic: "lints which are rather strict or have occasional false positives" (default allow) — verified.
  - [Clang Compiler User's Manual](https://clang.llvm.org/docs/UsersManual.html) — LLVM Project, 2026 — official_docs — "Since `-Weverything` enables every diagnostic, we generally don't recommend using it. `-Wall` `-Wextra` are a better choice for most projects"; "updating your compiler is more difficult because you're exposed to experimental diagnostics" — verified.
  - [Compiler Options Hardening Guide for C and C++](https://best.openssf.org/Compiler-Hardening-Guides/Compiler-Options-Hardening-Guide-for-C-and-C++.html) — OpenSSF Best Practices WG, 2026-08-20 — standard — Table 1 lists -Wall, -Wextra, -Wformat, -Wformat=2, -Wconversion, -Wsign-conversion, -Wimplicit-fallthrough, -Wbidi-chars=any (GCC 12+), -Wtrampolines, -Werror; "Enable one or a few options at a time, assess their impact, resolve any problems, and repeat over time" — verified.
  - [Analyzing the State of Static Analysis: A Large-Scale Evaluation in Open Source Software](https://rebels.cs.uwaterloo.ca/papers/saner2016_beller.pdf) — Beller, Bholanath, McIntosh, Zaidman (SANER), 2016 — peer_reviewed — "projects typically do not enforce a strict policy on ASAT use. Most ASAT configurations deviate slightly from the default… most ASAT configurations, once introduced, never change" — verified in PDF text. The data is from 2016 and covers Java, JS, Ruby and Python analyzers.
- **Detect:**
  - Rust: `rg -n 'clippy::(restriction|pedantic|nursery)' -g '*.rs' -g 'Cargo.toml'`, and inspect the `[lints.clippy]` table.
  - C/C++: `rg -n -- '-Weverything|-Wall|-Wextra|-Wconversion|-Wformat=2|-Wimplicit-fallthrough' CMakeLists.txt '*.cmake' Makefile* meson.build`. Flag -Weverything, or a build missing -Wall -Wextra.
  - Staleness: `git log -1 --format=%cs -- <config files>`.
- **Tools:** cargo clippy, GCC, Clang, clang-tidy, ripgrep, git log.
- **Applies to:** Rust, C, C++. The principle carries over to any linter with an "all" or "everything" preset (pylint enable=all, ESLint all).
- **When not to apply / counterpoints:**
  - The Clang manual allows -Weverything if you address every new diagnostic as it is added, by fixing it or adding an explicit -Wno- flag.
  - Some teams find pedantic lints worthwhile overall.
  - The OpenSSF table targets security-relevant warnings, not every correctness warning.
- **Fix risk:** medium

### T18-F08 — Pin exact analyzer versions and revisit stale configs
Rule: pin exact versions of the compiler, type checker, linter and shared lint presets, using a lockfile plus exact specifiers or a toolchain file. Upgrade them only in dedicated, reviewed changes. On a finished project, compare the analyzer config with the current presets of the installed tool versions, because configs are usually written once and never revisited. Also check for options deprecated for the next major version (for example the TS 6.0 deprecations that 7.0 removes).

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Several vendors document that the same config gets stricter over time:
  - TypeScript warns that strict may add checks in future versions.
  - typescript-eslint's strict presets change outside major versions.
  - mypy's --strict list "may change over time", and its docs say to pin the version.
  - Clang says -Weverything makes compiler updates harder.
  - TypeScript's error codes are "not necessarily stable between versions" (Ryan Cavanaugh).

  Beller et al. show configs are rarely updated after they are first committed.
- **Evidence:**
  - [TSConfig Reference — strict](https://www.typescriptlang.org/tsconfig/) — Microsoft TypeScript, 2026 — official_docs — "Future versions of TypeScript may introduce additional stricter checking under this flag, so upgrades of TypeScript might result in new type errors in your program." Default `true` as of 6.0 — verified.
  - [Using mypy with an existing codebase](https://mypy.readthedocs.io/en/stable/existing_code.html) — mypy 2.3.1, 2026 — official_docs — "…pinning mypy with the rest of your dev requirements" — verified.
  - [The mypy command line](https://mypy.readthedocs.io/en/stable/command_line.html) — mypy 2.3.1, 2026 — official_docs — "the exact list of flags enabled by running --strict may change over time" — verified.
  - [Comment on TypeScript issue #19139](https://github.com/microsoft/TypeScript/issues/19139#issuecomment-690530124) — Ryan Cavanaugh (TypeScript team), 2020 — practitioner_forum — "it's *not* at all obvious that error codes are not necessarily stable between versions. C# has to do a *ton* of backcompat engineering to make sure their warnings are consistent version-to-version and we don't want to do that" — verified via the GitHub API.
  - [Announcing TypeScript 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/) — Microsoft TypeScript team, 2026-03-23 — official_docs — these options are deprecated and removed in 7.0: `--moduleResolution node`, `--baseUrl`, `--target es5`, `--module amd/umd/systemjs`, `esModuleInterop false`. `"ignoreDeprecations": "6.0"` is a temporary escape hatch that will not work in 7.0 — verified.
  - [Analyzing the State of Static Analysis](https://rebels.cs.uwaterloo.ca/papers/saner2016_beller.pdf) — Beller et al. (SANER), 2016 — peer_reviewed — "Most ASAT configurations, once committed, never change. The ASAT configurations that do change are typically only very slightly modified within the first week of their appearance" — verified in PDF text.
- **Detect:**
  - npm: `jq '.devDependencies|to_entries[]|select(.key|test("typescript|eslint|biome|oxlint"))' package.json`, and flag ^ or ~ ranges.
  - Python: `rg -n 'mypy|pyright|ruff' requirements*.txt pyproject.toml`, and flag unpinned entries.
  - Rust: check for `rust-toolchain.toml`.
  - Staleness: `git log -1 --format='%cs %s' -- tsconfig*.json eslint.config.* .eslintrc* mypy.ini pyproject.toml clippy.toml .clang-tidy`.
  - Deprecations: run `npx tsc --noEmit` and look for deprecation diagnostics or an existing `ignoreDeprecations`.
- **Tools:** jq, git log, tsc, npm/pnpm lockfiles.
- **Applies to:** all ecosystems.
- **When not to apply / counterpoints:**
  - Pinning delays new checks and security fixes, and automated version bumps add noise.
  - Cavanaugh's comment is a design rationale, not a measured result.
  - Beller's configuration data is from 2016.
- **Fix risk:** low

### T18-F05 — Python: make sure unannotated function bodies are type-checked, then tighten along mypy's documented order
Rule:
1. Make sure the bodies of unannotated functions are type-checked. mypy skips them unless `check_untyped_defs` (part of `--strict`) is on.
2. Tighten along mypy's documented order: warn_unused_configs, warn_redundant_casts, warn_unused_ignores; then strict_equality; then check_untyped_defs; then disallow_subclassing_any, disallow_untyped_decorators, disallow_any_generics; then disallow_untyped_calls, disallow_incomplete_defs, disallow_untyped_defs; and finally --strict. With pyright, move from typeCheckingMode "standard" (the default) to "strict", using per-path `strict` lists or `# pyright: strict`.
3. Pin the checker version.
4. Where annotations are read at runtime (pydantic, FastAPI, dataclasses, ORMs), treat every annotation change as a behaviour change.

- **Grade:** A · **Verdict:** CORRECTED. One counterpoint was re-sourced: the complaint that checkers disagree comes from the 2025 typing survey ("inconsistencies between type checkers"), not from an unverified "2024 survey".
- **Rationale:** Khan et al. had to annotate at least one parameter to force mypy to check a function: "Otherwise, mypy ignores every type check within the function." That is a silent blind spot in most finished Python projects. The mypy docs give the incremental order, recommend per-module config and say to pin the version. The 2025 Python typing survey (1,241 responses) shows how mainstream typing now is:
  - 86% "always" or "often" use type hints.
  - 58% use mypy.
  - The Rust-based checkers (Pyrefly, Ty, Zuban) together pass 20%.

  Pydantic states that types define validation, so annotations are not always inert at runtime.
- **Evidence:**
  - [Using mypy with an existing codebase](https://mypy.readthedocs.io/en/stable/existing_code.html) — mypy 2.3.1, 2026 — official_docs — "Pick a subset of your codebase (say, 5,000 to 50,000 lines)…"; pin mypy. The ordered list of stricter options matches the rule, and continues with no_implicit_reexport, warn_return_any, extra_checks. Per-module configuration is recommended — verified.
  - [The mypy command line](https://mypy.readthedocs.io/en/stable/command_line.html) — mypy 2.3.1, 2026 — official_docs — `--check-untyped-defs`: "it type checks the body of every function, regardless of whether it has type annotations"; --strict includes disallow-any-generics, disallow-untyped-defs, check-untyped-defs, warn-unused-ignores, warn-return-any, strict-equality, extra-checks, etc. — verified.
  - [An Empirical Study of Type-Related Defects in Python Projects](https://rebels.cs.uwaterloo.ca/papers/tse2021_khan.pdf) — Khan et al. (IEEE TSE), 2021 — peer_reviewed — "To force mypy to type check the entirety of a function, at least one type annotation has to exist in the function declaration. Otherwise, mypy ignores every type check within the function." — verified in PDF text (footnote 3).
  - [Pyright configuration](https://raw.githubusercontent.com/microsoft/pyright/main/docs/configuration.md) — Microsoft pyright, 2026 — official_docs — typeCheckingMode default "standard"; `strict` paths: "This is the same as manually adding a '# pyright: strict' comment." — verified.
  - [Python Typing Survey 2025](https://engineering.fb.com/2025/12/22/developer-tools/python-typing-survey-2025-code-quality-flexibility-typing-adoption/) — Meta / JetBrains / Python typing community, 2025-12-22 — industry_report — "1,241 responses"; "86% of respondents report that they 'always' or 'often' use type hints"; "Mypy remains the most widely used type checker, with 58%"; Rust-based checkers over 20%; pain points include third-party library support and inconsistencies between checkers — verified.
  - [Pydantic — Types](https://pydantic.dev/docs/validation/latest/concepts/types/) — Pydantic, 2026 — official_docs — "Pydantic uses types to define how validation and serialization should be performed" — verified.
- **Detect:**
  - Current settings: `rg -n 'check_untyped_defs|strict\s*=|disallow_untyped_defs' mypy.ini setup.cfg pyproject.toml` and `rg -n 'typeCheckingMode|"strict"' pyrightconfig.json pyproject.toml`.
  - Size each step: `mypy --check-untyped-defs . | tail -1`, `mypy --strict . | tail -1`, `pyright --outputjson | jq .summary`.
  - Unannotated defs: `rg -nP '^\s*(async\s+)?def \w+\((?![^)]*:)[^)]*\)\s*:' -g '*.py'`.
  - Runtime-annotation hot spots: `rg -n 'BaseModel|@dataclass|FastAPI|APIRouter|Mapped\[' -g '*.py'`.
- **Tools:** mypy, pyright, basedpyright, ripgrep, jq.
- **Applies to:** Python 3.x codebases, with or without existing annotations.
- **When not to apply / counterpoints:**
  - Typing does not enforce anything at runtime. One practitioner: "I have worked on at least three system that used mypy in strict mode yet hit runtime errors constantly" (HN, 2026).
  - Dynamic features are hard to type.
  - Checkers disagree with each other, so code that is strict-clean under mypy is not necessarily clean under pyright.
  - In legacy code, practitioners say opting in "one module at a time" is the only sensible path.
  - The Rust-based checkers were not assessed.
- **Fix risk:** medium

### T18-F02 — If null-safety checking is off or partial, turn it on first, bottom-up
Rule: turn on null-safety checking first:
- TypeScript: strictNullChecks (via strict).
- C#: `<Nullable>enable</Nullable>`.
- Java: NullAway with JSpecify `@NullMarked`.
- Python: mypy or pyright with check_untyped_defs.

Roll it out bottom-up, starting with leaf modules that import nothing unchecked. Resolve each diagnostic with a real guard, a narrowed type or a refactor. When done, remove the migration-only escapes: TS `!`, C# `null!` / `default!`, `#nullable disable`.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Null handling is the defect class type checkers catch most often (Khan 2021). NullAway at Uber shows that once checked code is null-safe, the NPEs left in production come from places the checker cannot see:
  - unchecked third-party libraries (64%)
  - deliberate suppressions (17%)
  - reflection and other code modified after checking (17%)

  VS Code migrated about 1,800 files and more than 500k lines. It used a separate strict tsconfig that started with zero files and hit about 4,500 errors. The team "tried to avoid using TypeScript's not-null assertion in our main codebase as much as possible", and warned that `any` and bad casts bypass the check. Microsoft's C# guidance prescribes a bottom-up, file-by-file rollout, then removal of the silencing initializers at the end.
- **Evidence:**
  - [Strict null checking Visual Studio Code](https://code.visualstudio.com/blogs/2019/05/23/strict-null) — Matt Bierner / VS Code team, 2019-05-23 — engineering_blog — "some 1800 TypeScript files, comprising more than half a million lines… produced some 4500 errors"; tsconfig.strictNullChecks.json "initially consisted of zero files"; "we tried to avoid using TypeScript's not-null assertion in our main codebase as much as possible"; "any types or bad casts can easily bypass strict null checking" — verified.
  - [Nullable migration strategies (C#)](https://learn.microsoft.com/en-us/dotnet/csharp/nullable-migration-strategies) — Microsoft Learn, 2026 (ms.date 2026-05-04) — official_docs — "Start with the deepest leaf types in your dependency graph, then move outward. Annotating a type causes new warnings in its callers, so working bottom-up minimizes rework."; "Remove `null!` and `default!` initializers that you added only to silence warnings during migration." — verified. The URL redirects to /advanced-topics/update-applications/.
  - [NullAway: Practical Type-Based Null Safety for Java](https://arxiv.org/abs/1907.02127) — Banerjee, Clapp, Sridharan (ESEC/FSE), 2019 — peer_reviewed — remaining NPEs "were due to unchecked third-party libraries (64%), deliberate error suppressions (17%), or reflection and other forms of post-checking code modification (17%), never due to NullAway's unsound assumptions for checked code"; build overhead 1.15X vs 2.8–5.1X — verified (abstract). The NullAway README confirms JSpecify annotations and an `OnlyNullMarked` mode.
  - [An Empirical Study of Type-Related Defects in Python Projects](https://rebels.cs.uwaterloo.ca/papers/tse2021_khan.pdf) — Khan et al., 2021 — peer_reviewed — "incorrect null handling (i.e., Optional-none) is the most commonly caught type-related defect" — verified in PDF text.
- **Detect:**
  - TS: `npx tsc --showConfig | rg 'strict|strictNullChecks'`. strict is the default from TS 6.0 but may be set explicitly to false. Count non-null assertions with `rg -n '[\w\)\]]!\.' -g '*.ts' -g '*.tsx'`, or typescript-eslint `no-non-null-assertion`.
  - C#: `rg -n '<Nullable>' -g '*.csproj'` and `rg -n '#nullable disable|null!|default!' -g '*.cs'`.
  - Java: look for the NullAway Error Prone plugin, and JSpecify `@NullMarked` / `OnlyNullMarked`.
  - Python: confirm strict_optional is not disabled and check_untyped_defs is on (F05).
- **Tools:** tsc, typescript-eslint no-non-null-assertion, Roslyn nullable analysis, NullAway, JSpecify, mypy, pyright.
- **Applies to:** TypeScript, C#, Java/Kotlin interop, Python; any language with opt-in nullability.
- **When not to apply / counterpoints:**
  - Enabling it produces a large first wave of errors (about 4,500 at VS Code), so it needs a baseline or per-file scoping (F09).
  - Libraries without annotations stay unchecked.
  - The C# doc describes two different two-phase orders, warnings first or annotations first, with different trade-offs.
- **Fix risk:** medium

### T18-F03 — TypeScript: confirm strict, then evaluate the beyond-strict flags one at a time
Rule: confirm `strict: true`. It is the implicit default from TS 6.0. Set it explicitly for older compilers and to document intent. Then evaluate the checks that strict deliberately leaves out, one at a time, sizing each by its error count before committing:
- noUncheckedIndexedAccess
- exactOptionalPropertyTypes
- noImplicitOverride
- noImplicitReturns
- noFallthroughCasesInSwitch
- noPropertyAccessFromIndexSignature

Enable a flag when its errors are few enough to fix, or are baselined, and can be fixed with real narrowing (for...of, `.at()`, explicit checks) rather than `!`.

- **Grade:** B · **Verdict:** CORRECTED. Two changes to the counterpoints:
  - The Zod/exactOptionalPropertyTypes counterpoint is outdated. zod issue #635 was closed as completed on 2025-12-31.
  - The "pessimistic, but correct… unwieldy" quote was located: it is in typescript-eslint's no-unnecessary-condition docs.
- **Rationale:** The TypeScript docs say strict turns on the "strict mode family", and that future versions may add stricter checks under it. Two flags are explicitly outside that family:
  - noUncheckedIndexedAccess "might be noisy for a lot of code, so it is not automatically enabled by the strict flag".
  - exactOptionalPropertyTypes "is **not** part of the strict family".

  TS 6.0 made strict the default because "most new projects want strict mode enabled". Practitioners call the name "strict" misleading, because it leaves these checks off.
- **Evidence:**
  - [TSConfig Reference](https://www.typescriptlang.org/tsconfig/) — Microsoft TypeScript, 2026 — official_docs — strict: "Future versions of TypeScript may introduce additional stricter checking under this flag…"; noUncheckedIndexedAccess "will add `undefined` to any un-declared field in the type" — verified.
  - [TypeScript 4.1 release notes — Checked Indexed Accesses](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-1.html) — Microsoft, 2020 — official_docs — "it might be noisy for a lot of code, so it is not automatically enabled by the `strict` flag"; recommends for-of or forEach over index loops — verified.
  - [TypeScript 4.4 release notes — exactOptionalPropertyTypes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-4.html) — Microsoft, 2021 — official_docs — "This flag is **not** part of the `strict` family and needs to be turned on explicitly"; requires strictNullChecks — verified.
  - [Announcing TypeScript 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/) — Microsoft TypeScript team, 2026-03-23 — official_docs — strict now true by default ("most new projects want strict mode enabled"); noUncheckedSideEffectImports now true by default — verified.
  - [no-unnecessary-condition — Limitations](https://typescript-eslint.io/rules/no-unnecessary-condition/) — typescript-eslint, 2026 — official_docs — "To get pessimistic, but correct, types for these cases, you can use TypeScript's `noUncheckedIndexedAccess` compiler option, though this is often unwieldy in real-world usage." — verified in the docs source.
  - [HN comment on strict naming](https://news.ycombinator.com/item?id=40257073) — quectophoton (Hacker News), 2024-05-04 — practitioner_forum — "The "strict": true setting should be called "recommended": true… it doesn't enable strict checks like noFallthroughCasesInSwitch, noImplicitOverride, noImplicitReturns, noUncheckedIndexedAccess…" — verified via the Algolia API.
- **Detect:**
  - Size each candidate flag without editing the config: `npx tsc --noEmit -p tsconfig.json --noUncheckedIndexedAccess 2>&1 | rg -c 'error TS'`. Repeat with each of the other flags.
  - Check the effective config with `npx tsc --showConfig`.
  - After enabling a flag, count new `!` in the diff: `git diff | rg '^\+.*[\w\)\]]!\.'`.
- **Tools:** tsc, typescript-eslint no-non-null-assertion.
- **Applies to:** all TypeScript projects. The strict default applies from TS 6.0.
- **When not to apply / counterpoints:**
  - The TS team calls noUncheckedIndexedAccess noisy, and typescript-eslint calls it "often unwieldy".
  - Some libraries' types used to conflict with exactOptionalPropertyTypes. zod #635 was reported in 2024 and closed 2025-12-31, so check the current library versions before assuming a conflict.
  - No study measures the extra bugs these flags catch beyond strict.
- **Fix risk:** medium

### T18-F04 — TypeScript linting: adopt recommended-type-checked first, add strict rules individually, and pin the plugin
Rule: adopt typescript-eslint `recommended-type-checked` first. It enables the no-unsafe-* family (no-unsafe-assignment, -argument, -call, -member-access, -return), which stops `any` from spreading. Adopt rules from `strict-type-checked` individually, not as a whole preset, and pin the plugin version, because the strict presets are explicitly not semver-stable. Budget CI time for typed linting at roughly one extra build.

- **Grade:** B · **Verdict:** DOWNGRADED (A→B). Every source is a single vendor's documentation plus one HN comment. No empirical data shows that the preset improves outcomes, so under this dossier's scale it is B, the same as F03.
- **Rationale:**
  - The official docs call `any` "a dangerous escape hatch", and put no-unsafe-assignment in recommended-type-checked.
  - They warn the strict configs are not stable under semver and "may change outside of major version updates".
  - They recommend the strict configs only if "a nontrivial percentage of its developers are highly proficient in TypeScript".
  - On cost, typed lint time should be "roughly the same as your build times". This is a troubleshooting target, not a measured figure.
  - A practitioner calls type-aware rules "prohibitively expensive for larger code bases".
- **Evidence:**
  - [Shared Configs](https://typescript-eslint.io/users/configs/) — typescript-eslint v8.70.1, 2026 — official_docs — strict and strict-type-checked: "This configuration is not considered 'stable' under Semantic Versioning (semver). Its enabled rules and/or their options may change outside of major version updates."; "We recommend a TypeScript project extend from plugin:@typescript-eslint/strict only if a nontrivial percentage of its developers are highly proficient in TypeScript." — verified.
  - [no-unsafe-assignment](https://typescript-eslint.io/rules/no-unsafe-assignment/) — typescript-eslint, 2026 — official_docs — "The `any` type in TypeScript is a dangerous escape hatch from the type system"; enabled in recommended-type-checked. Related rules: no-unsafe-argument, -call, -member-access, -return — verified.
  - [Typed linting performance](https://typescript-eslint.io/troubleshooting/typed-linting/performance/) — typescript-eslint, 2026 — official_docs — "if you're using type-aware linting, your lint times should be roughly the same as your build times"; avoid wide include globs — verified.
  - [HN comment on typed lint cost](https://news.ycombinator.com/item?id=41331963) — moritzwarhier (Hacker News), 2024-08-23 — practitioner_forum — "ESLint rules that require type information… are prohibitively expensive for larger code bases"; "as unknown as MyType" is not preventable by means of tsc — verified via the Algolia API.
- **Detect:**
  - Inspect eslint.config.* for `tseslint.configs.recommendedTypeChecked` / `strictTypeChecked` and `parserOptions.projectService`.
  - Size the change with `npx eslint . -f json | jq '[.[].errorCount]|add'`, before and after.
  - Confirm @typescript-eslint/* uses an exact version (no ^ or ~) in package.json.
- **Tools:** typescript-eslint, ESLint, jq.
- **Applies to:** TypeScript codebases using ESLint with typescript-eslint v8.x.
- **When not to apply / counterpoints:**
  - Typed linting can roughly double CI lint time on large monorepos.
  - Some strict rules, such as no-unnecessary-condition, give misleading results when the types are wrong (F14).
  - Oxlint and Biome coverage of type-aware rules was not assessed.
- **Fix risk:** low

### T18-F07 — Every check you keep must fail CI, but do not ship blanket -Werror in distributed build files
Rule: every check you decide to keep must fail CI, not just warn. Examples:
- ESLint `--max-warnings 0`
- rustc/clippy `-D warnings` in CI
- `clang-tidy --warnings-as-errors=<checks>`
- -Werror in a CI or developer build preset

Do not hard-code blanket -Werror into build files that downstream users or packagers compile. Use selective `-Werror=<flag>` or a CI-only toggle instead.

- **Grade:** B · **Verdict:** CORRECTED. Notion's post title and quote were fixed, because the researcher's wording came from a WebFetch summary.
- **Rationale:**
  - Google's Clang team turned checks into compiler errors, "not a warning, which the Clang team found Google developers ignored".
  - Notion built its ratchet partly because ESLint warnings "are often ignored or seen as optional suggestions".
  - A practitioner describes teams getting "used to the noisy warnings".
  - The opposite failure is broken builds. OpenSSF says: "Use the blanket form `-Werror` only during development, not in source distribution".
  - Gentoo policy disables -Werror in released packages.
  - Making -Werror the default in Linux 5.15 "caused nearly all of our CI to go red" (Nick Desaulniers, Google). It was then limited to COMPILE_TEST builds.
- **Evidence:**
  - [Lessons from Building Static Analysis Tools at Google](https://storage.googleapis.com/gweb-research2023-media/pubtools/4365.pdf) — Sadowski et al. (CACM 61(4)), 2018 — peer_reviewed — "the Clang team enabled the new diagnostic as a compiler error (not a warning, which the Clang team found Google developers ignored) to break the build, a report difficult to disregard." — verified in PDF text.
  - [How we evolve code: Notion's "ratcheting" system using custom ESLint rules](https://www.notion.com/blog/how-we-evolved-our-code-notions-ratcheting-system-using-custom-eslint-rules) — Ankit Sardesai, Jake Teton-Landis (Notion), 2025-03-03 — engineering_blog — "warnings tend to confuse developers because they're often ignored or seen as optional suggestions rather than required fixes"; CI blocks new errors not allowed by the ratchet file — verified. The title and quote were corrected.
  - [Compiler Options Hardening Guide for C and C++](https://best.openssf.org/Compiler-Hardening-Guides/Compiler-Options-Hardening-Guide-for-C-and-C++.html) — OpenSSF Best Practices WG, 2026-08-20 — standard — "Use the blanket form `-Werror` only during development, not in source distribution"; distributed blanket -Werror creates "a dependency on specific toolchain vendors and versions" — verified.
  - [Gentoo Development Guide — Common mistakes](https://devmanual.gentoo.org/ebuild-writing/common-mistakes/index.html) — Gentoo, 2026 — official_docs — "-Werror… is not recommended for releases and should always be disabled when encountered in build logs, because there are numerous cases where this breaks without purpose", for example new warnings after GCC or glibc version bumps — verified.
  - [Compromise reached as Linux kernel community protests about treating compiler warnings as errors](https://www.theregister.com/2021/09/08/compromise_linux_kernel_compiler_warnings/) — Tim Anderson, The Register, 2021-09-08 — incident_report — Torvalds: "We really should always have a clean build"; Desaulniers: "This change has caused nearly all of our CI to go red"; the compromise tied -Werror to COMPILE_TEST — verified.
- **Detect:**
  - Rules left as warnings: `npx eslint . -f json | jq '[.[].warningCount]|add'`. The count should be 0, or each such rule should be set to "off" or "error".
  - CI config: `rg -n -- '--max-warnings|-D warnings|--warnings-as-errors|-Werror' .github/ .gitlab-ci.yml Jenkinsfile`.
  - Distributed build files: `rg -n -- '-Werror(\s|"|$)' CMakeLists.txt '*.cmake' Makefile* meson.build configure.ac setup.py build.rs`.
- **Tools:** ESLint, cargo clippy, clang-tidy, GCC/Clang, CMake COMPILE_WARNING_AS_ERROR (overridable with `--compile-no-warning-as-error`), ripgrep, jq.
- **Applies to:** all languages. The -Werror distribution caveat applies to C/C++ and to any library whose build other people run.
- **When not to apply / counterpoints:**
  - Torvalds' position is that maintainers must fix warnings.
  - For apps built only by their own team, blanket -Werror in CI is fine.
  - Turning everything into an error before the baseline is clean reproduces the kernel's "CI goes red" failure, so pair this rule with a baseline (F09).
- **Fix risk:** low

### T18-F09 — Never tighten a finished codebase big-bang: baseline or scope, and let the baseline only shrink
Rule: use one of two approaches.

(a) Snapshot existing violations in a committed baseline keyed by location or rule. Examples:
- ESLint `--suppress-all` / `--suppress-rule`, which writes eslint-suppressions.json
- `basedpyright --writebaseline`
- PHPStan `--generate-baseline`
- golangci-lint `new-from-merge-base` / `new-from-rev`
- Betterer
- eslint-seatbelt per-file counts
- clang-tidy-diff.py for changed lines

(b) Scope strictness per file or per module. Examples:
- a separate strict tsconfig with an allow-list (VS Code)
- C# `#nullable enable` per file
- mypy per-module sections
- pyright `strict` paths
- Sorbet `# typed:` sigils

Either way, new and changed code must be clean, and the baseline may only shrink: prune it on every fix, and never regenerate it to absorb new errors.

- **Grade:** B · **Verdict:** CORRECTED. Notion's post title was fixed, and the small size of Infer's batch trial was noted.
- **Rationale:** Evidence on delivery says batch reports of old issues get ignored:
  - Infer's batch deployment had a fix rate near zero, though on only 20–30 issues.
  - Google's FindBugs Fixit fixed only 16% of 3,954 reviewed warnings.

  Baselines let a check start blocking new violations on day one. PHPStan warns that regenerating the baseline hides problems. The technique is documented by ESLint, basedpyright, golangci-lint, PHPStan, Sorbet and C#. Practitioners report it drove large migrations: Notion used it to remove unsafe TypeScript assertions, and VS Code used per-file scoping for strict nulls.
- **Evidence:**
  - [Bulk Suppressions](https://eslint.org/docs/latest/use/suppressions) — ESLint v10.11.0, 2026 — official_docs — "you can suppress all the existing violations at once by using the --suppress-all flag"; "You should commit this file to the repository"; unused suppressions make ESLint exit non-zero ("Consider re-running the command with `--prune-suppressions`"); "Only rules configured as 'error' are suppressed" — verified.
  - [Baseline](https://docs.basedpyright.com/latest/benefits-over-pyright/baseline/) — basedpyright, 2026 — official_docs — `./.basedpyright/baseline.json` via `--writebaseline`; "This file gets automatically updated as errors are removed over time"; matched by file, rule and column only, which "prevents errors from resurfacing when you add or remove lines" — verified.
  - [The Baseline](https://phpstan.org/user-guide/baseline) — PHPStan, 2026 — official_docs — "If some of the ignored errors do not occur in the result anymore, PHPStan will let you know and you will have to remove the pattern from the baseline file"; "it's tempting to simply re-generate the baseline to accomplish this. This has, however, the following disadvantages" — verified.
  - [golangci-lint configuration file](https://golangci-lint.run/docs/configuration/file/) — golangci-lint, 2026 — official_docs — `new`: "It's a super-useful option for integration of golangci-lint into existing large codebase"; also new-from-merge-base, new-from-rev, new-from-patch — verified.
  - [Scaling Static Analyses at Facebook](https://6826.csail.mit.edu/2020/papers/facebook-infer-cacm.pdf) — Distefano et al. (CACM 62(8)), 2019 — peer_reviewed — "We assigned 20–30 issues to developers, and almost none of them were acted on… the fix rate… was near zero"; at diff time "the fix rate rocketed to over 70%. The same program analysis, with same false positive rate"; Infer "reports only regressions: new issues introduced by a diff" — verified in PDF text.
  - [How we evolve code: Notion's "ratcheting" system using custom ESLint rules](https://www.notion.com/blog/how-we-evolved-our-code-notions-ratcheting-system-using-custom-eslint-rules) — Notion Engineering, 2025-03-03 — engineering_blog — "Each line in the ratchet file tracks how many errors are allowed for each file + lint error combo"; TSV to reduce merge conflicts; used for "eliminating unsafe type assertions in TypeScript"; open-sourced as eslint-seatbelt (github.com/justjake/eslint-seatbelt, active in 2026) — verified.
  - [Static — strictness levels](https://sorbet.org/docs/static) — Sorbet (Stripe), 2026 — official_docs — sigils `# typed: ignore/false/true/strict/strong`; at strict, "Sorbet no longer implicitly marks things as being dynamically typed" — verified.
  - [Ratchets in software development](https://qntm.org/ratchet) — qntm, 2021-11-21 — engineering_blog — too many or too few instances raise an error; "this technique does nothing to actively encourage the removal of these old "patterns". Those remaining 67 or so calls… have been kind of lingering" — verified via curl, because WebFetch returned 403.
- **Detect:**
  - Look for an existing baseline: eslint-suppressions.json, .basedpyright/baseline.json, phpstan-baseline.neon, .betterer.results, or a ratchet TSV.
  - Check its trend with `git log -p --stat -- <baseline>`. It should only shrink.
  - CI must fail on unmatched or unused baseline entries. This is the ESLint default. For PHPStan, reportUnmatchedIgnoredErrors must not be false.
  - To propose a new check: `npx eslint . --suppress-rule <rule>`, `basedpyright --writebaseline`, or `golangci-lint run --new-from-merge-base=origin/main`.
- **Tools:** ESLint bulk suppressions, basedpyright, PHPStan, golangci-lint, Betterer (active), eslint-seatbelt, clang-tidy-diff.py, type-coverage `--update-if-higher`.
- **Applies to:** any finished codebase where a new check has more than a handful of existing hits.
- **When not to apply / counterpoints:**
  - Count-based ratchets can be gamed or become opaque: "Add one, remove one was very common" (HN); "you're not entirely sure if the count goes up or down" (HN).
  - Ratchets stop violations from spreading but do not remove them (qntm).
  - Line-keyed baselines break under refactoring. basedpyright matches on column only to avoid this.
- **Fix risk:** low

### T18-F13 — Inventory type-system escape hatches and ratchet them down, deciding intended behaviour explicitly
Rule: inventory the escape hatches and ratchet them down:
- TypeScript: `any` (explicit and inferred), `as` assertions (especially `as unknown as T`, and assertions on object or array literals), non-null `!`.
- Python: `Any`, `cast()`, untyped defs.
- C#: `null!` / `default!`.
- Rust: `unwrap` / `expect` / `unsafe`.

Replace each with narrowing, a precise type or a validated parse. When removing a non-null assertion, decide the intended behaviour explicitly. Never mechanically rewrite `x!.y` as `x?.y` or `x?.y ?? fallback`: both turn a crash into a silent `undefined` or default.

- **Grade:** B · **Verdict:** CORRECTED. typescript-eslint's `no-non-null-assertion` suggestion rewrites `x!.y` to `x?.y`, with no `?? false`. The rule source confirms this. The `?.includes('baz') ?? false` form is the docs' "correct code" example, not what the suggestion produces. The rule's message calls the optional chain "safer". Both forms change runtime semantics.
- **Rationale:**
  - Bogner & Merkel (MSR 2022, 604 repos) found that less `any` correlated significantly with better code-quality and understandability metrics (Spearman rho 0.17–0.26), but not with bug proneness.
  - VS Code found that `any` and bad casts "can easily bypass strict null checking".
  - typescript-eslint documents that object-literal assertions hide missing required fields.
  - Dropbox tracked "sources of type imprecision" (explicit Any, untyped third-party imports) in coverage reports across almost 4M lines.
- **Evidence:**
  - [To Type or Not to Type? A Systematic Comparison of the Software Quality of JavaScript and TypeScript Applications on GitHub](https://arxiv.org/abs/2203.11115) — Justus Bogner, Manuel Merkel (MSR), 2022 — peer_reviewed — "reducing the usage of the `any` type in TS apps was significantly correlated with all metrics except bug proneness (Spearman's rho between 0.17 and 0.26)" — verified (abstract).
  - [no-non-null-assertion](https://typescript-eslint.io/rules/no-non-null-assertion/) — typescript-eslint, 2026 — official_docs — "Using assertions to tell the type system new information is often a sign that code is not fully type-safe." The correct-code example is `example.property?.includes('baz') ?? false`. The suggestion fixer (rule source) replaces `!.` with `?.`, with the message "Consider using the optional chain operator `?.` instead. This operator includes runtime checks, so it is safer than the compile-only non-null assertion operator." The rule is in the strict config — verified in the docs and on GitHub.
  - [consistent-type-assertions](https://typescript-eslint.io/rules/consistent-type-assertions/) — typescript-eslint, 2026 — official_docs — objectLiteralTypeAssertions: "The compiler will warn for excess properties with this syntax, but not missing *required* fields"; `assertionStyle: 'never'` — verified.
  - [no-explicit-any](https://typescript-eslint.io/rules/no-explicit-any/) — typescript-eslint, 2026 — official_docs — fixToUnknown: "Switching types to `unknown` is safer but is likely to cause additional type errors"; "When Not To Use It" covers unmigrated code, untyped packages and types that cannot yet be expressed — verified.
  - [type-coverage](https://github.com/plantain-00/type-coverage) — plantain-00 (GitHub; active, pushed 2026-07) — official_docs — "the type coverage rate = the count of identifiers whose type is not any / the total count of identifiers"; `--strict` also counts `Promise<any>`, `as` assertions and `!`; also `--at-least`, `--detail`, `--update-if-higher` — verified.
  - [Our journey to type checking 4 million lines of Python](https://dropbox.tech/application/our-journey-to-type-checking-4-million-lines-of-python) — Jukka Lehtosalo / Dropbox, 2019-09-05 — engineering_blog — "we report sources of type imprecision, such as using explicit, unchecked Any types in annotations, or importing 3rd party libraries that that don't have type annotations"; "almost 4 million lines… in about three years" — verified.
  - [HN comment: LLMs and escape hatches](https://news.ycombinator.com/item?id=47236968) — EduardoBautista (Hacker News), 2026-03-03 — practitioner_forum — "they tend to use type assertions such as `as any` and eslint disable comments. I had to add strict ESLint and TypeScript rules to keep guardrails on the coding agents." — verified via the Algolia API.
- **Detect:**
  - TS:
    - `npx type-coverage --strict --detail`: record the percentage, then gate with `--at-least` or `--update-if-higher`.
    - `rg -n '\bas any\b|as unknown as|:\s*any\b|<any>' -g '*.ts' -g '*.tsx'` and `rg -n '[\w\)\]]!\.' -g '*.ts'`.
    - Rules: no-explicit-any, no-unsafe-*, consistent-type-assertions (objectLiteralTypeAssertions: 'never'), no-non-null-assertion.
    - Do not accept the no-non-null-assertion suggestion blindly.
  - Python:
    - `mypy --any-exprs-report out/ --lineprecision-report out/`
    - `rg -n '\bcast\(|:\s*Any\b|->\s*Any\b' -g '*.py'`
    - pyright reportUnknownMemberType / reportUnnecessaryCast.
  - C#: `rg -n 'null!|default!'`.
  - Rust: `rg -n '\.unwrap\(\)|\bunsafe\b'`.
- **Tools:** type-coverage, typescript-eslint, mypy reports, pyright, ripgrep.
- **Applies to:** TypeScript, Python, C#, Rust, Kotlin (`!!`); any gradually or unsoundly typed language.
- **When not to apply / counterpoints:**
  - `any` and casts are legitimate at FFI boundaries, for untyped libraries and for generics that cannot be expressed.
  - Cavanaugh prefers `as any` to `ts-ignore`.
  - The Bogner correlation is weak and did not extend to bug proneness.
  - No study quantifies the benefit of chasing 100% type coverage.
- **Fix risk:** high

### T18-F14 — Do not delete a runtime check that a type-aware rule calls unnecessary until you have confirmed the value's origin is type-safe
Rule: this covers conditions reported as always true or false, comparisons or casts reported as unnecessary, and code reported as unreachable (typescript-eslint no-unnecessary-condition, mypy `--warn-unreachable`, pyright reportUnnecessaryComparison / reportUnnecessaryCast). Do not delete the runtime check until you have confirmed that the value's origin is really type-safe. Unsafe sources include:
- JSON, network, database and env values
- `any`
- untyped libraries
- JavaScript callers and public-API consumers

If the origin is unsafe, keep the check and fix the declared type instead: widen it, or add a boundary parse (F15).

- **Grade:** B · **Verdict:** CORRECTED, with the grade lowered from A to B. Three changes:
  - The quotes attributed to the typescript-eslint docs ("relies entirely on TypeScript's type analysis", "values originate from untyped sources", "partially-migrated codebases") were WebFetch paraphrases, not text on the page. They were replaced with the verbatim Limitations and When Not To Use It text.
  - The grade was lowered because the support is vendor documentation plus indirect evidence from Java (NullAway). No study measures harm from deleting these checks.
  - The docs' own example of a false positive (array indexing without noUncheckedIndexedAccess) was added.
- **Rationale:** TypeScript explicitly does not aim for soundness. The typescript-eslint docs say no-unnecessary-condition "is powered by TypeScript types, therefore, if the types do not match the runtime behavior, the rule may report inaccurately". They list common cases, such as `array[0]` checked against null when noUncheckedIndexedAccess is off. The TS 3.9 notes show the legitimate pattern: a library keeps runtime asserts for JavaScript callers even though its TS types forbid the bad input. NullAway's production data places the remaining null crashes at unchecked edges (third-party code, 64%).
- **Evidence:**
  - [no-unnecessary-condition](https://typescript-eslint.io/rules/no-unnecessary-condition/) — typescript-eslint, 2026 — official_docs — "This rule is powered by TypeScript types, therefore, if the types do not match the runtime behavior, the rule may report inaccurately. This can happen in several commonplace scenarios." Example: `const firstElement = array[0]; // false positive if (firstElement != null)`. When Not To Use It: "If your project is not accurately typed, such as if it's in the process of being converted to TypeScript…" The rule requires strictNullChecks and is in strict-type-checked — verified in the docs source.
  - [TypeScript Design Goals](https://github.com/microsoft/TypeScript/wiki/TypeScript-Design-Goals) — Microsoft TypeScript wiki, 2026 — official_docs — non-goal: "Apply a sound or 'provably correct' type system. Instead, strike a balance between correctness and productivity." — verified.
  - [TypeScript 3.9 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-9.html) — Microsoft, 2020 — official_docs — `doStuff(abc: string, xyz: string)` keeps `assert(typeof abc === "string")` so that "JavaScript users will get an assertion error" — verified.
  - [NullAway: Practical Type-Based Null Safety for Java](https://arxiv.org/abs/1907.02127) — Banerjee, Clapp, Sridharan (ESEC/FSE), 2019 — peer_reviewed — remaining NPEs came from "unchecked third-party libraries (64%)" — verified (abstract). This is indirect evidence, from Java.
- **Detect:**
  - List candidate deletions: `npx eslint . --rule '{"@typescript-eslint/no-unnecessary-condition":"error"}' -f json`, `mypy --warn-unreachable .`, pyright reportUnnecessaryComparison.
  - For each site, trace the variable back to where it comes from (a manual data-flow check). Keep the check if any upstream step involves `JSON.parse`, fetch or axios responses, `any`, a cast, untyped imports, unchecked indexed access, or an exported function that JavaScript or external clients can call.
  - Quick signals: `rg -n 'JSON\.parse|\.json\(\)|as any|as unknown as' <file>`.
- **Tools:** typescript-eslint no-unnecessary-condition, mypy `--warn-unreachable`, pyright reportUnnecessaryComparison, manual data-flow trace.
- **Applies to:** unsound or gradual type systems (TypeScript, Python, PHP, Ruby/Sorbet), and any library whose callers may not be type-checked.
- **When not to apply / counterpoints:**
  - Many reported conditions really are dead code, and keeping every defensive check adds noise.
  - In fully typed internal code, the rule is usually right.
  - Widening the type instead may produce more errors elsewhere.
- **Fix risk:** high

### T18-F15 — Parse, don't validate: convert untrusted data to typed values once, at each I/O boundary
Rule: convert untrusted data to typed values exactly once, at each I/O boundary. Boundaries include HTTP request and response bodies, `JSON.parse` / `fetch().json()`, env vars, config files, DB rows, queue messages and third-party SDK results.
- Use a runtime schema that returns a typed value: Zod `parse` / `safeParse`, pydantic models, serde.
- Make raw decode APIs yield `unknown`, not `any`: ts-reset in application code, or the no-unsafe-* rules.
- Ban "shotgun" validation spread through business logic.
- Carry units and meanings across interfaces explicitly.

- **Grade:** B · **Verdict:** CORRECTED. Three changes:
  - The definition of shotgun parsing that King quotes comes from the 2016 LangSec paper "The Seven Turrets of Babel". King cites it; she did not coin it.
  - The advice "Avoid denormalized, mutable…" was restored to its real wording.
  - ts-reset's documented restriction to application code, not library code, was added.
- **Rationale:** Alexis King's essay argues that validators throw away what they learned, while parsers keep it in the type. Shotgun parsing spreads checks through processing code, so failures show up after state has already been changed. Static types say nothing about data that enters at runtime. NullAway's production data and an HN practitioner's report of "mypy in strict mode yet hit runtime errors constantly" both place the remaining failures at unchecked edges.

  The Mars Climate Orbiter was lost because thruster impulse data crossing a file interface was in lbf-s instead of the specified N-s. The data was low by a factor of 4.45, and the trajectory ended up about 170 km lower than planned.
- **Evidence:**
  - [Parse, don't validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) — Alexis King, 2019-11-05 — engineering_blog — "Push the burden of proof upward as far as possible, but no further"; "Use a data structure that makes illegal states unrepresentable"; "Avoid denormalized representations of data, especially if it's mutable"; the shotgun-parsing definition is quoted from the 2016 paper "The Seven Turrets of Babel": "Shotgun parsing is a programming antipattern whereby parsing and input-validating code is mixed with and spread across processing code" — verified. King also writes: "Consider the principles in this blog post ideals to strive for, not strict requirements to meet."
  - [Mars Climate Orbiter Mishap Investigation Board Phase I Report](https://llis.nasa.gov/llis_lib/pdf/1009464main1_0641-mr.pdf) — NASA, 1999-11-10 — incident_report — "the root cause for the loss of the MCO spacecraft was the failure to use metric units in the coding of a ground software file, "Small Forces""; the data "was required to be in metric units per existing software interface documentation"; "low by a factor of 4.45 (1 pound force=4.45 Newtons)"; "approximately 170 kilometers lower than planned"; the board also lists 8 contributing causes — verified in PDF text.
  - [ts-reset](https://github.com/total-typescript/ts-reset) — Matt Pocock / Total TypeScript (repo now mattpocock/ts-reset, active in 2026), 2026 — official_docs — ".json (in fetch) and JSON.parse both return unknown". The [docs](https://www.totaltypescript.com/ts-reset) say: "`ts-reset` is designed to be used in application code, not library code. Each rule you include will make changes to the global scope." — verified.
  - [Zod](https://zod.dev/) — Colin McDonnell, 2026 — official_docs — "TypeScript-first schema validation with static type inference"; Zod 4 is current; `.parse()` throws and `.safeParse()` does not — verified.
  - [HN comment: strict mypy and runtime errors](https://news.ycombinator.com/item?id=49576884) — perrygeo (Hacker News), 2026-09-05 — practitioner_forum — "Python's type system is not sufficient to describe runtime variants, period. I have worked on at least three system that used mypy in strict mode yet hit runtime errors constantly." — verified via the Algolia API.
- **Detect:**
  - Enumerate boundaries:
    - TS: `rg -n 'JSON\.parse\(|\.json\(\)|process\.env\.|axios\.|fetch\(' -g '*.ts'`
    - Python: `rg -n 'json\.loads\(|os\.environ|requests\.|httpx\.|\.fetchone\(|\.fetchall\(' -g '*.py'`
  - For each boundary, check that the value passes through a schema parse (zod, valibot or io-ts `.parse`, pydantic `model_validate`, serde) before it is used as a typed value, and is not just cast (`as T`, `cast()`).
  - The no-unsafe-* rules flag the `any` that comes from `JSON.parse`.
  - Units: look for numeric parameters or fields with no unit in the name (timeout, delay, amount) that cross module or service boundaries.
- **Tools:** Zod, pydantic, serde, ts-reset (apps only), typescript-eslint no-unsafe-*, ripgrep.
- **Applies to:** any service or CLI that takes in external data, in any language. Most pressing in TypeScript and Python, where static types are erased or not enforced at runtime.
- **When not to apply / counterpoints:**
  - Runtime validation costs CPU, and the schema and static types can drift apart unless one is generated from the other.
  - The MCO board lists eight contributing process causes besides the root cause.
  - Parsing the whole payload can be overkill for pass-through proxies.
  - Libraries should not ship ts-reset, because it changes global types.
- **Fix risk:** high

### T18-F17 — Every branch over a closed set must be checked for exhaustiveness by the tool
Rule: every branch over a closed set (union, enum, Literal, sealed or sum type) must be checked for exhaustiveness by the tool, not absorbed by a silent default or `_` fallback.
- TypeScript: `const _exhaustive: never = x` in the default branch, or `@typescript-eslint/switch-exhaustiveness-check` with `considerDefaultExhaustiveForUnions: false` (the default). Also noFallthroughCasesInSwitch.
- Python: `typing.assert_never(x)`, mypy `--enable-error-code exhaustive-match`, or pyright reportMatchNotExhaustive.
- C/C++: `-Wimplicit-fallthrough`.

Handle values that come from outside and may be unknown at runtime in the boundary parse, not with a catch-all deep in the logic.

- **Grade:** B · **Verdict:** CORRECTED. The typescript-eslint quote had dropped its condition. The docs say a `default` hides a new union member only "if… you're using considerDefaultExhaustiveForUnions". With the default option (false), the rule still reports missing cases even when a default exists.
- **Rationale:** The TS handbook shows how assigning to `never` turns "adding a new member to the Shape union" into a compile error. mypy and pyright provide the same check for Literal, Enum and match. Minsky's Effective ML Revisited argues against catch-all `_` matches for the same reason. OpenSSF lists `-Wimplicit-fallthrough` among its recommended warnings.
- **Evidence:**
  - [TypeScript Handbook — Narrowing: exhaustiveness checking](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) — Microsoft TypeScript, 2026 — official_docs — `default: const _exhaustiveCheck: never = shape;`. After adding Triangle: "Type 'Triangle' is not assignable to type 'never'." — verified.
  - [switch-exhaustiveness-check](https://typescript-eslint.io/rules/switch-exhaustiveness-check/) — typescript-eslint, 2026 — official_docs — defaults: allowDefaultCaseForExhaustiveSwitch `true`, considerDefaultExhaustiveForUnions `false`, requireDefaultForNonUnion `false`, defaultCaseCommentPattern `/^no default$/iu`. "if a new value is added to the union type and you're using considerDefaultExhaustiveForUnions, a `default` would prevent the switch-exhaustiveness-check rule from reporting on the new case". The rule is in no preset — verified.
  - [Literal types and Enums — exhaustiveness checking](https://mypy.readthedocs.io/en/stable/literal_types.html) — mypy, 2026 — official_docs — `assert_never()` after if/elif or match; "For match statements specifically, inexhaustive matches can be caught without needing to use assert_never by using --enable-error-code exhaustive-match" — verified.
  - [Pyright configuration — reportMatchNotExhaustive](https://raw.githubusercontent.com/microsoft/pyright/main/docs/configuration.md) — Microsoft pyright, 2026 — official_docs — "Generate or suppress diagnostics for a `match` statement that does not provide cases that exhaustively match against all potential types of the target expression." Default "none"; "error" in strict — verified.
  - [Effective ML Revisited](https://blog.janestreet.com/effective-ml-revisited/) — Yaron Minsky (Jane Street), 2011-03-09 — engineering_blog — the "Code for exhaustiveness" section criticises `match m with | Exec e -> … | _ -> 0`, because newly added variants get handled silently — verified (content summary).
- **Detect:**
  - TS: enable `@typescript-eslint/switch-exhaustiveness-check` (needs type information) and confirm `considerDefaultExhaustiveForUnions` is not true. Find unchecked defaults with `rg -n -A2 'default:' -g '*.ts' | rg -v 'never|assertNever|exhaustive'`. Set noFallthroughCasesInSwitch in the TS config.
  - Python: `mypy --enable-error-code exhaustive-match`, pyright `"reportMatchNotExhaustive": "error"`, and `rg -n 'case _:' -g '*.py'` for catch-alls over Enum or Literal subjects.
  - C/C++: compile with `-Wimplicit-fallthrough`.
- **Tools:** typescript-eslint switch-exhaustiveness-check, tsc noFallthroughCasesInSwitch, mypy, pyright, GCC/Clang `-Wimplicit-fallthrough`.
- **Applies to:** TypeScript, Python 3.10+ match / Literal / Enum, Rust, Kotlin/Java sealed types, C/C++ switch.
- **When not to apply / counterpoints:**
  - Open sets, such as API enums that grow on the server or plugin IDs, need a runtime default. Put it in the boundary parse, or keep a default that logs.
  - Replacing `default: return fallback` with assertNever, which throws, changes behaviour for out-of-range runtime values.
- **Fix risk:** medium

### T18-F16 — Make illegal states unrepresentable
Rule: some types are a bag of optional fields or booleans whose valid combinations depend on a status, kind or state field. Examples: `{status; data?; error?; retryAt?}`, or isLoading / isError / isSuccess flags. Replace them with a discriminated union or sum type in which each variant carries only the fields valid in that state, so invalid combinations fail to compile. Keep the serialized or wire shape stable by mapping at the boundary.

- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:** The TypeScript handbook explains why encoding variants as optional fields fails: the type-checker cannot tell which fields are present from `kind`. It shows that discriminated unions allow narrowing without `!`. Yaron Minsky shows the connection-state refactor that removes invalid combinations. Alexis King's first practical recommendation is "Use a data structure that makes illegal states unrepresentable". These are official guides and widely cited practitioner writing. No defect-rate study was found.
- **Evidence:**
  - [TypeScript Handbook — Narrowing: discriminated unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) — Microsoft TypeScript, 2026 — official_docs — "The problem with this encoding of `Shape` is that the type-checker doesn't have any way to know whether or not `radius` or `sideLength` are present based on the `kind` property." — verified.
  - [Effective ML Revisited](https://blog.janestreet.com/effective-ml-revisited/) — Yaron Minsky (Jane Street), 2011-03-09 — engineering_blog — the "Make illegal states unrepresentable" section replaces a `connection_info` record full of options with per-state types `Connecting of connecting | Connected of connected | Disconnected of disconnected` — verified.
  - [Parse, don't validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) — Alexis King, 2019 — engineering_blog — "Use a data structure that makes illegal states unrepresentable."; "Avoid denormalized representations of data, especially if it's mutable." — verified.
- **Detect:** mainly a manual review. Candidates:
  - (a) Interfaces, classes or dataclasses with two or more optional fields plus a field named status, state, kind, type or phase: `rg -n -U 'interface \w+ \{[^}]*(status|state|kind|type)[^}]*\?:[^}]*\?:' -g '*.ts'`.
  - (b) Two or more boolean fields in one type: `rg -n -U '(is[A-Z]\w*: boolean;[^}]*){2,}' -g '*.ts'`.
  - (c) Python dataclasses or pydantic models with several `Optional[...]` fields next to a status field.

  Confirm by listing which combinations are actually valid, from the code paths that set them.
- **Tools:** ripgrep, ast-grep, manual review.
- **Applies to:** languages with sum types or discriminated unions: TypeScript, Rust, Swift, Kotlin sealed classes, Java 17+ sealed types, OCaml/F#/Haskell, Python (Literal-tagged unions checked by mypy/pyright).
- **When not to apply / counterpoints:**
  - There is no empirical evidence that it reduces defects, only practitioner consensus.
  - It is a structural refactor that touches every construction site, and it can break serialized formats, ORMs and public APIs.
  - King herself calls these "ideals to strive for, not strict requirements".
  - On a finished project, limit it to types that have caused bugs or that carry many `!` or optional checks.
- **Fix risk:** high

### T18-F18 — Give distinct domain meanings distinct types
Rule: where confusing two values is plausible and costly, give distinct domain meanings distinct types: IDs of different entities, units (ms vs s, N-s vs lbf-s), money or currency, validated vs raw strings. Use zero- or near-zero-cost wrappers: Rust tuple-struct newtypes, Python `typing.NewType`, TypeScript branded intersection types. Replace positional boolean or Option parameters with named enums or option objects.

- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:** The Rust API Guidelines say newtypes "can statically distinguish between different interpretations of an underlying type". Their Miles vs Kilometers example is "averting certain catastrophic bugs", and that phrase links to the Mars Climate Orbiter. The guidelines also say "Arguments convey meaning through types, not `bool` or `Option`" (`Widget::new(Small, Round)` vs `Widget::new(true, false)`). The Python typing spec says NewType is for avoiding "logical errors" such as confusing a UserId, at "almost zero runtime overhead". TypeScript practitioners use branded types. This finding rests on official guidelines plus practitioner consensus, with no controlled defect data.
- **Evidence:**
  - [Rust API Guidelines — Type safety (C-NEWTYPE, C-CUSTOM-TYPE)](https://rust-lang.github.io/api-guidelines/type-safety.html) — Rust Libs Team, 2026 — official_docs — heading "Newtypes provide static distinctions (C-NEWTYPE)"; "thus averting certain catastrophic bugs" (linked to Mars Climate Orbiter); "Arguments convey meaning through types, not `bool` or `Option` (C-CUSTOM-TYPE)"; `Widget::new(Small, Round)` vs `Widget::new(true, false)` — verified in the guidelines source.
  - [Typing specification — NewType](https://typing.python.org/en/latest/spec/aliases.html) — Python typing council, 2026 — official_docs — "avoid logical errors by creating simple classes" (UserId); "almost zero runtime overhead"; `isinstance`, `issubclass` and subclassing fail for NewType — verified.
  - [HN comment: branded types](https://news.ycombinator.com/item?id=39878207) — thomasrognon (Hacker News), 2024-03-30 — practitioner_forum — "For odd only numbers, you can make a "branded" type… `type OddNumber = number & { __BRAND_ODD_NUMBER: true }`", with a type guard to take in untrusted data — verified via the Algolia API.
  - [Mars Climate Orbiter Mishap Investigation Board Phase I Report](https://llis.nasa.gov/llis_lib/pdf/1009464main1_0641-mr.pdf) — NASA, 1999 — incident_report — impulse data "was delivered in lb-sec instead of the specified and expected units of Newton-sec" — verified in PDF text.
- **Detect:** manual review, helped by patterns:
  - (a) Functions with two or more parameters of the same primitive type that represent different concepts: `rg -nP '\(\s*\w+(Id|ID)\s*:\s*string\s*,\s*\w+(Id|ID)\s*:\s*string' -g '*.ts'` and `rg -nP 'def \w+\([^)]*_id: (str|int)[^)]*_id: (str|int)' -g '*.py'`.
  - (b) Positional booleans: `rg -nP '\(\s*\w+\s*:\s*boolean\s*,\s*\w+\s*:\s*boolean' -g '*.ts'`, and call sites via `rg -n '\((true|false),\s*(true|false)'`.
  - (c) Numeric names with no unit (timeout, delay, duration, amount, price) in public signatures.
- **Tools:** ripgrep, ast-grep, manual review.
- **Applies to:** Rust, Python, TypeScript, Kotlin (value classes), Haskell/OCaml/F#, C++ (strong typedef idioms). Most useful on public APIs and cross-module boundaries.
- **When not to apply / counterpoints:**
  - In TypeScript, branding is a convention, not a language feature. It needs cast-based constructors, which escape-hatch audits (F13) will flag.
  - The MCO error crossed a file interface, so newtypes inside one process would not have caught it without parsing with units at the boundary (F15).
  - Wrapping everything adds friction, and changing public signatures breaks semver for libraries.
- **Fix risk:** low

## Practitioner voice

- [HN thread on "Scaling Static Analyses at Facebook"](https://news.ycombinator.com/item?id=20540493) — story submitted by dons, 2019. In the thread, pm215 highlights the 70% diff-time vs 0% batch fix rate. seanmcdirmid: legacy code becomes "littered with annotations to suppress each historic false positive". m0zg: the main issue is false positives, "they churn out tons and tons of alerts that aren't actually bugs".
- [Normal_gaussian on ratchet files (2026)](https://news.ycombinator.com/item?id=46857352) — ran a ratchet file of all TS type issues, where "Add one, remove one was very common". Switched to per-line suppressions that encode a truncated hash of the error message and of the line's AST, plus a justification, which had an immediate ratchet effect.
- [jitl on per-file ratchets (2026)](https://news.ycombinator.com/item?id=46854973) — built a per-file ESLint ratchet, later extended to TypeScript, Terraform and Biome, and links Notion's post. "it's so handy to be able to write a new lint rule or introduce an off-the-shelf rule without needing to fix all existing violations."
- [burticlies on noisy warnings (2026)](https://news.ycombinator.com/item?id=46854439) — you cannot make a deprecated pattern an error, so "you mark it warning and fill everyone's editors with yellow lines. And then we just get used to the noisy warnings."
- [arnorhs on opaque counts (2026)](https://news.ycombinator.com/item?id=46854450) — hard-coded counts are opaque ("you're not entirely sure if the count goes up or down"). Prefers a committed file of locations, approved by a code owner.
- [qntm — Ratchets in software development (2021)](https://qntm.org/ratchet) — a text-count ratchet stops copy-paste spread but "does nothing to actively encourage the removal". The remaining ~67 calls were "kind of lingering", and the count sometimes had to be raised by hand.
- [Notion — ratcheting system (2025)](https://www.notion.com/blog/how-we-evolved-our-code-notions-ratcheting-system-using-custom-eslint-rules) — allowed-error counts per file and per rule in a TSV file, which causes fewer merge conflicts than JSON. CI blocks new violations, and pre-commit hooks lower the counts. Used to remove unsafe TS assertions. Open-sourced as eslint-seatbelt.
- [Stripe — Migrating millions of lines of code to TypeScript (2022)](https://stripe.dev/blog/migrating-to-typescript) — Andrew Lunny. Moved 3.7M+ lines from Flow to TS in one PR with a codemod. The first run produced 97,000 suppressions, cut to 37,000 (about 1 per 1,000 lines), vs about 5,000 in the Flow codebase.
- [VS Code — Strict null checking (2019)](https://code.visualstudio.com/blogs/2019/05/23/strict-null) — a separate tsconfig that started with zero files, about 4,500 errors, the non-null assertion avoided in main code, and `any` or bad casts bypass the check.
- [Dropbox — 4 million lines of Python (2019)](https://dropbox.tech/application/our-journey-to-type-checking-4-million-lines-of-python) — strictness requirements for new code raised gradually, and weekly coverage emails sent to teams. Performance (daemon, incremental mode, mypyc at about 4x) and import cycles were major obstacles.
- [The Register — Linux 5.15 -Werror (2021)](https://www.theregister.com/2021/09/08/compromise_linux_kernel_compiler_warnings/) — "nearly all of our CI to go red". -Werror was limited to COMPILE_TEST builds.
- [perrygeo on strict mypy (2026)](https://news.ycombinator.com/item?id=49576884) — "at least three system that used mypy in strict mode yet hit runtime errors constantly."
- [maleldil on AI agents and Python typing (2026)](https://news.ycombinator.com/item?id=46705598) — use pyright or mypy strict, make type errors fail CI, "forbid it from using `type: ignore`, and review every `Any` and `cast` usage".
- [EduardoBautista on LLM escape hatches (2026)](https://news.ycombinator.com/item?id=47236968) — LLM agents "tend to use type assertions such as `as any` and eslint disable comments"; he added strict ESLint and TS rules as guardrails.
- [moritzwarhier on typed-lint cost (2024)](https://news.ycombinator.com/item?id=41331963) — type-aware ESLint rules are "prohibitively expensive for larger code bases", and `as unknown as MyType` cannot be prevented by tsc alone.
- [yoyohello13 on legacy Python (2025)](https://news.ycombinator.com/item?id=44108405) — with mypy on legacy code, "the only sensible way is to "opt-in" one module at a time".
- [quectophoton on "strict" naming (2024)](https://news.ycombinator.com/item?id=40257073) — `strict` should be called "recommended" because it leaves noUncheckedIndexedAccess, noImplicitOverride, noImplicitReturns and others off. Config differences between projects lead developers to trust unchecked undefined accesses.
- [HN thread "38% of bugs at Airbnb could have been prevented by using types" (2019)](https://news.ycombinator.com/item?id=19131272) — commenters point to confounders such as testing hygiene and developer experience ("38% seems insanely high. Other estimates I've seen suggest more like 10%"). One reports that dropping static types "hasn't decreased our code-quality". The thread links a Reddit post, not a methodology.
- [Evan Hahn — @ts-ignore is almost always the worst option (2025)](https://evanhahn.com/ts-ignore-is-almost-always-the-worst-option/) — quoting Ryan Cavanaugh, prefers fixing, then `any`, then `@ts-expect-error`, then `@ts-ignore`. Suppression comments also hide unrelated mistakes on the same line, such as a typo in a function name, while `as any` still reports them.

## Contradictions and open questions

**Contradictions**

- **How many bugs types catch.** Gao et al. (JavaScript) and Khan et al. (Python) agree on about 15% of fixed public bugs. The Airbnb "38%" circulates without a traceable method. Bogner & Merkel (MSR 2022) found TS repos had a higher bug-fix commit ratio than JS repos (0.206 vs 0.126). Studies comparing languages (Ray et al. vs Berger et al.) agree only that the effects are small. Resolution for the skill: treat types as a bounded bug filter weighted towards null handling, not as a quality guarantee.
- **Warnings vs errors.** Google (Clang team), Notion and practitioners report that warnings get ignored. OpenSSF, Gentoo and the Linux 5.15 episode show that blanket -Werror in distributed build files breaks downstream builds when compilers change. Resolution: enforce in CI and developer presets, and use selective `-Werror=<flag>` in shipped build files.
- **`@ts-ignore` vs `@ts-expect-error` vs `as any`.**
  - typescript-eslint's recommended config bans `ts-ignore` and allows `ts-expect-error` with a description.
  - The TS 3.9 notes accept `ts-ignore` for unowned code in large projects and during upgrades.
  - Cavanaugh and Hahn prefer a tactical `as any`, but typescript-eslint's `no-explicit-any` and F13's ratchet penalise `as any`.
  - TypeScript refuses per-error-code suppression because codes are not guaranteed stable, the opposite of mypy's `# type: ignore[code]` guidance.
  - The skill must choose one order per ecosystem and state it.
- **Is the optional-chain rewrite safer?** typescript-eslint's no-non-null-assertion suggestion calls `?.` "safer than the compile-only non-null assertion operator". F13 treats the same rewrite as a behaviour change. Both are true: the code no longer crashes, but the failure becomes silent.
- **Beyond-strict TS flags.** The TS team keeps noUncheckedIndexedAccess and exactOptionalPropertyTypes out of strict as "noisy", and typescript-eslint calls the flag "often unwieldy". Practitioners argue they should be defaults. There is no empirical data either way.
- **Acceptable false-positive rate.** Google allows up to 10% effective false positives in review-time checks and none in build-breaking checks. Christakis & Bird found 90% of Microsoft developers accept up to 5%. Coverity targets below 20%. Infer showed that a false-positive rate estimated below 20% still gave a fix rate near 0% in batch mode, though on only 20–30 issues, and over 70% at diff time.
- **Soundness.** TypeScript rejects soundness as a design goal. NullAway is deliberately unsound in places, yet observed no production NPEs caused by that. Practitioners report strict mypy projects still failing at runtime. The remaining risk sits at unchecked boundaries and escape hatches.
- **Ratchets.** Notion and jitl report that ratchets enabled large migrations. qntm admits they do not drive removal. HN users report count-based ratchets being gamed or hard to read.
- **Paper vs tool docs on unused suppressions.** The FSE 2025 suppression study states that only Pylint offers a way to report useless suppressions, and that "Mypy, ErrorProne, or Flow, lack such a mechanism". The mypy 2.3.1 docs document `--warn-unused-ignores`, which is also part of `--strict`, and pyright, ESLint, Ruff and golangci-lint have equivalents. The paper's statement about mypy appears to be wrong. The skill should rely on the tool docs for tool capabilities and on the paper only for prevalence data.

**Open questions**

- No study was found that quantifies the extra defects caught by beyond-strict TypeScript flags, or by typescript-eslint strict-type-checked compared with recommended-type-checked.
- No empirical defect data was found for type-design practices (discriminated unions, illegal-states modelling, newtypes or branded types). F16 and F18 rest on guidance only.
- Do baselines and ratchets drive legacy violations to zero, or mostly freeze them? Only anecdotes exist: Notion positive, qntm "lingering".
- Whether AI-generated code has systematically more escape hatches (`as any`, `# type: ignore`, eslint-disable) is supported only by HN anecdotes here. Mündler et al. 2025 (arXiv 2504.09246) was not verified in this pass.
- The Rust-based Python checkers (Pyrefly, Ty, Zuban) were not assessed: their strictness modes, suppression syntax and unused-ignore detection.
- The Airbnb "38%" figure: its source, sample and classification rules are unknown, and the InfoQ citation could not be located.
- How ESLint v10 bulk suppressions behave when violations move between lines. The docs describe a count per file and rule, and the matching behaviour under refactoring was not verified.
- The empirical base on suppression staleness is one ecosystem (Pylint / Python). Staleness rates for ESLint, TS or Rust suppressions are unmeasured.
- Kotlin (allWarningsAsErrors, detekt baseline), Go beyond golangci-lint (staticcheck, go vet) and Java Error Prone rollout mechanics were not researched in depth.

## Dropped findings

None of the 18 findings was dropped. Sub-claims removed or replaced:
- **Airbnb "38%" attributed to InfoQ (F01 counterpoint):** no InfoQ article could be found. The figure is kept only as an unverified claim.
- **"Checkers disagree… a top 2024 survey complaint" (F05 counterpoint):** re-sourced to the 2025 typing survey.
- **The typescript-eslint no-unnecessary-condition quotes in F14:** these were paraphrases, not text on the page, and were replaced with the verbatim text.
- **"Python 3.14 docs" in the tool-version list:** removed, because no finding uses them.
