# Readability, naming and comments: empirical evidence
> Code T17 · slug readability · verified 2026-09-23 · counts: verified 3 / corrected 18 / downgraded 1 / dropped 0

Verification method: every paper abstract was re-read from OpenAlex, Semantic Scholar or the arXiv API (full abstract, not the researcher's reconstruction). Every style guide, linter page and blog post was fetched and grepped for the quoted text. Every Hacker News comment was re-read through the HN Algolia items API, and each story tree was searched to find the right comment where an ID or author was wrong. The indentation RCT PDF was downloaded and its text extracted. The web-search quota ran out partway through, so a few secondary checks used the arXiv, OpenAlex and Algolia search APIs instead.

**Second, independent pass (resumed workflow, same day).** A second verifier re-checked every finding from the researcher's original output without relying on the first pass. That included all 22 findings' sources, every practitioner-voice URL, and every source the first pass had added (Tahsin 2023, Shi 2024, Mendes 2022, Winkler 2021, Shen 2026, Feitelson TSE DOI, git-blame 2.23.0 docs, Martin's "necessary evil" and "gratuitous" quotes, mmastrac, sullyj3, andrewingram, pjc50, praptak). All of them were reproduced. The second pass made five further changes:
- **T17-F22 → CORRECTED.** The "Preprocessor in Statement" atom was removed as support. It measures C preprocessor directives placed mid-expression, not comments that tools parse.
- **T17-F19 → CORRECTED.** The researcher's Rachatasumrit URL was an OpenAlex search for the *Bavota* paper; it is now replaced by the DOI.
- **T17-F16 field evidence narrowed.** The null field results are Java-only. Mendes, Shi and Tahsin all report that earlier C/C++ field work linked atoms to bug-fix commits. Mendes 2022 is now given a DOI.
- **T17-F09 conflict added.** Google's Python guide now says to avoid TODOs that name an individual or team, which conflicts with ruff TD002 (missing-todo-author).
- **Official sources added** in T17-F06: the kernel's rule against boilerplate kernel-doc, and Google's regex and algorithm exception.

Main corrections, in brief:
- **7 of the 20 practitioner-voice items had the wrong author or comment ID,** and three more HN attributions inside findings were wrong (pjc50, sullyj3, seanalltogether). All are fixed below; no item had to be dropped.
- **Bogachenkova et al. 2022 was cited backwards.** The paper found atoms of confusion are "mostly *not* being removed" in pull requests. A second null field result (Shi et al., ESEM 2024) was added.
- **The Google C++ guide text was outdated or paraphrased.** It now says "descriptiveness should be proportional to the name's scope of visibility".
- **"Comments are always failures"** is a *Clean Code* (p. 54) sentence that Ousterhout quotes. It is not Martin's position in the 2024-25 discussion, where he calls comments a "necessary evil" and says he is hostile only to "gratuitous" comments.
- **The DeepBugs URL was wrong.** It pointed to a Lawrie search query; it now points to the DOI.
- **Ruff PLR0917 is stable,** not preview.
- **The LAPD catalogue is reachable** on the author's site, but the tool is a 2013 Eclipse prototype.
- **Alpern et al. 2024 is an arXiv preprint.** OpenAlex lists no peer-reviewed version.

## Summary

Readability, naming and comments have more empirical support than most code-quality areas, but it is uneven.

**Naming has the strongest evidence.** Three independent controlled experiments point the same way:
- Hofmeister et al. (72 professional C# developers): full words gave 19% faster defect finding than letters or abbreviations.
- Schankin et al. (88 Java developers): semantic defects found about 14% faster with descriptive compound names. The effect showed for experienced developers only.
- Lawrie et al. (over 100 programmers): full words gave the best comprehension, but often with no significant difference from abbreviations.

Two more results complete the naming picture:
- **Misleading names ("linguistic antipatterns")** measurably raise cognitive load in a small fNIRS and eye-tracking lab study.
- **"Atoms of confusion"** (tiny confusing patterns) raise misreading rates in the lab: 2.7x to 56x in a Java replication with students. Earlier C/C++ field work associated atoms with bug-fix commits. But two Java field studies found no link between atoms and review confusion or defect fixing (Bogachenkova 2022, Shi 2024). The atoms also are *not* being removed over time.

**Comments are where experts disagree most.**
- **Official guides** (PEP 8, Google, the Linux kernel) agree that comments must not restate the code, and that comments contradicting the code are worse than none.
- **Code-comment inconsistency is well measured:**
  - Wen et al. mined 1.3 billion AST changes over 1,500 systems to see which code changes leave comments stale.
  - ReCite found 869 stale function references in Linux v6.18-rc1 (ASE 2026).
  - One 2024 preprint (GPT-3.5 as detector) finds inconsistent changes about 1.5x more likely to introduce bugs.
- **Ousterhout and Martin still disagree** on how much to comment, though Martin's stated position is milder than the *Clean Code* quote usually cited.
- **A survey of 367 developers** shows they value function header comments but rarely write them. In real Python code, the header comments that do exist usually carry information beyond the signature.

**Self-admitted technical debt (TODO/FIXME/HACK) is well studied,** but the removal numbers conflict:
- Potdar and Shihab found only 26 to 63% removed in four projects.
- Maldonado et al. found the majority removed in five other projects, with median lifetimes of 18 to 172 days.
- 20 to 50% of removals are accidental (whole classes or methods dropped).
- Practitioners split between "a TODO must link an issue" and "TODOs are documentation".

**Readability metrics do not capture understandability.** None of 121 metrics did in Scalabrino et al. AI-agent "readability" commits often worsen the usual quality metrics:
- the Maintainability Index dropped in 56.1% of 403 commits (MSR 2026);
- GPT-4o refactorings reduced smells but lowered measured readability.

So a hardening pass must justify each edit by a specific rule, not by a score.

**Formatters** are backed by official tool guidance, review data (a third of reviews contain convention feedback) and one small randomized trial on indentation: 179% more time on unindented code, n=20. The main cost is git-history churn.

**The biggest behaviour risks in a readability pass** are:
- renames of public, serialized or reflected names;
- eager evaluation introduced when extracting variables;
- deleting comments that are executable or act as directives: doctests, rustdoc tests, `//go:build`, lint and type suppressions.

## Findings

### T17-F16 — Rewrite "atoms of confusion" into plain equivalents
- **Rule:** Rewrite small patterns shown experimentally to cause misreadings:
  - assignment used as a value;
  - `++`/`--` inside larger expressions;
  - nested or chained conditional operators;
  - reliance on operator precedence without parentheses;
  - implicit type conversion;
  - the comma operator;
  - omitted braces on multi-line bodies;
  - literal-encoding surprises (octal 0-prefix, mixed hex/decimal).

  Treat this as a comprehension fix, not a defect fix.
- **Grade:** A (lab comprehension). The Java field evidence is null; for C/C++ a bug-fix association is reported second-hand. · **Verdict:** CORRECTED. Bogachenkova et al. was cited backwards: atoms are "mostly not being removed". Shi et al. 2024 was added as a null field result. The 2023 prevalence preprint is now identified (Tahsin, Fuad, Satter).
- **Rationale:** Gopstein et al. showed in 73 participants that atoms cause "a significantly increased rate of misunderstanding versus equivalent code without the patterns". 15 of 19 candidate atoms were confirmed, with effect sizes from 0.63 (change of literal encoding) down to 0.22 (omitted curly braces). A Java replication with 132 students found participants "2.7 up to 56 times more likely to make mistakes" for 7 of 14 atoms, and rated 10 of 14 as more confusing or less readable. Atoms are common: one per 4.8 lines in 13 Java projects, with infix-operator-precedence atoms once per 6.4 lines (2023 preprint). The field evidence depends on the language. Three later abstracts (Mendes 2022, Tahsin 2023, Shi 2024) report that earlier C/C++ work associated atoms with bugs or bug-fix commits; that primary work was not re-read here. Java field studies found no relationship between atoms and code-review confusion, and none between atoms and defect-fixing.
- **Evidence:**
  - [Understanding misunderstandings in source code](https://doi.org/10.1145/3106237.3106264) — Gopstein, Iannacone, Yan, DeLong, Zhuang, Yeh, Cappos, ESEC/FSE 2017 — peer_reviewed — "these code patterns can lead to a significantly increased rate of misunderstanding versus equivalent code without the patterns" (73 participants; second experiment with 43) — abstract re-read via OpenAlex; confirmed.
  - [Atoms of Confusion: data](https://atomsofconfusion.com/data.html) — Gopstein et al. — dataset page — accepted atoms include Change of Literal Encoding 0.63, Preprocessor in Statement 0.54, Macro Operator Precedence 0.53, Assignment as Value 0.52, Logic as Control Flow 0.48, Post-Increment/Decrement 0.45, Type Conversion 0.42, Reversed Subscripts 0.40, Conditional Operator 0.36, Infix Operator Precedence 0.33, Comma Operator 0.30, Pre-Increment/Decrement 0.28, Implicit Predicate 0.24, Repurposed Variable 0.22, Omitted Curly Braces 0.22. Not accepted: Dead/Unreachable/Repeated 0.16, Arithmetic as Logic 0.10, Pointer Arithmetic 0.03, Constant Variables 0.00 — fetched; 15 accepted and 4 rejected confirmed.
  - [Atoms of Confusion in Java](https://arxiv.org/abs/2103.05424) — Langhout, Aniche, ICPC 2021 — peer_reviewed — "participants are 2.7 up to 56 times more likely to make mistakes in code snippets affected by 7 out of the 14 studied atoms"; subjects were 132 computer-science students ("novice developers") — arXiv abstract confirmed.
  - [Prevalence of 'Atoms of Confusion' in Open Source Java Systems](https://doi.org/10.22541/au.167570695.54470176/v1) — Tahsin, Fuad, Satter, 2023 — preprint (Authorea) — "they occur once every 4.8 lines"; "Infix Operator Precedence atom which occurs once in 6.4 lines" — OpenAlex abstract confirmed.
  - [Evaluating Atoms of Confusion in the Context of Code Reviews](https://doi.org/10.1109/icsme55016.2022.00048) — Bogachenkova, Nguyen, Ebert, Serebrenik, Castor, ICSME 2022 (emerging results) — peer_reviewed — "statistical analysis did not show any relationship between atoms of confusion and presence of confusion comments in code reviews ... atoms of confusion are mostly **not** being removed in pull requests" — CORRECTED (the researcher wrote "mostly being removed").
  - [Reevaluating the Defect Proneness of Atoms of Confusion in Java Systems](https://doi.org/10.1145/3674805.3686677) — Shi, Kazemi, Godfrey, McIntosh, ESEM 2024 — peer_reviewed — 76,610 PRs from six Java projects: "we find no relation between the existence of AoCs and defect-fixing activity ... the presence of AoCs did not affect defect proneness in open-source Java projects" — added by the verifier; Semantic Scholar abstract re-checked in the second pass. The same abstract notes that "prior work reported that AoCs impact defect proneness in C and C++ systems".
  - [Dazed and Confused: Studying the Prevalence of Atoms of Confusion in Long-Lived Java Libraries](https://doi.org/10.1109/ICSME55016.2022.00018) — Mendes, Pinheiro, Santos, Rocha, Viana, ICSME 2022 — peer_reviewed — 27 long-lived Java libraries, 11,404 occurrences: "the prevalence of ACs did not decrease over time ... in 13 libraries, the presence grew proportionally more than the size of the library" — DOI and abstract added in the second pass (the first pass cited it without a link).
  - [ESLint rules reference](https://eslint.org/docs/latest/rules/) — ESLint v10.11.0 — official_docs — no-cond-assign ("Disallow assignment operators in conditional expressions", recommended), no-nested-ternary, no-sequences ("Disallow comma operators"), no-plusplus, curly, eqeqeq, no-implicit-coercion, no-octal. no-mixed-operators was "deprecated in ESLint v8.53.0. It will be removed in v11.0.0" in favour of @stylistic — confirmed.
- **Detect:**
  - **JS/TS (ESLint):**
    - no-cond-assign, no-nested-ternary, no-sequences, no-implicit-coercion and no-octal;
    - no-plusplus `{allowForLoopAfterthoughts:true}`;
    - curly `["error","multi-line"]` and eqeqeq `["error","smart"]` (both option values confirmed);
    - @stylistic/no-mixed-operators.
  - **C/C++:** use ast-grep, e.g. `ast-grep --lang c -p 'if ($A = $B) $$$'`, and look for `++`/`--` inside larger expressions.
  - **All languages:** `rg -n '\?[^:]*\?'` for chained ternaries, plus mixed `&&`/`||` or shift/arithmetic without parentheses.
- **Tools:** ESLint core rules listed above; @stylistic/eslint-plugin; ast-grep.
- **Applies to:** C, C++, Java, JavaScript/TypeScript, C#; partly Python (walrus in conditions, chained comparisons) and Go (fewer atoms by design).
- **When not to apply / counterpoints:** The lab subjects were mostly students hand-tracing isolated snippets. Two Java field studies (reviews, defects) found no effect, and prevalence does not fall over time (Mendes et al., ICSME 2022). The reported C/C++ bug-fix association makes the rule somewhat stronger for C and C++ than for Java. Some atoms are idiomatic in their community: `x == null` in JS deliberately matches undefined (the eqeqeq "smart" option exists for this), and `i++` in for headers is idiomatic. Rewrites are cheap but not free: each touches a line for a comprehension benefit that is proven only in the lab.
- **Fix risk:** medium (precedence and implicit-conversion rewrites can change semantics if done wrong; verify with tests).

### T17-F01 — Full-word names for identifiers with more than a tiny scope
- **Rule:** Give full-word or domain-standard names to parameters, fields, module or global variables and exported functions. Avoid single letters and ad-hoc abbreviations there (including abbreviations made by deleting letters, such as `cntusr`). Keep short names for tiny scopes (loop indices, short lambdas) and for established notation. Descriptiveness should grow with scope.
- **Grade:** A · **Verdict:** CORRECTED. The Google C++ quote was not in the current guide. The current wording is "descriptiveness should be proportional to the name's scope of visibility", plus new abbreviation guidance. The claim that the ESLint id-length docs explain why exceptions exist was removed: the page shows the options but gives no reason.
- **Rationale:** Several controlled experiments agree:
  - Hofmeister et al. (72 professional C# developers): words gave "on average, 19% faster comprehension speed compared to letters and abbreviations", and there was no significant difference between letters and abbreviations.
  - Schankin et al. (88 Java developers): semantic defects found "about 14% faster" with descriptive names. The effect disappeared for syntax errors and appeared only for more experienced developers.
  - Lawrie et al. (over 100 programmers): full words gave the best comprehension, but "in many cases, there is no statistical difference between full words and abbreviations".
  - Avidan and Feitelson (9 professionals): parameter names matter more than local variable names.

  Style guides agree independently: Google C++ (scope-proportional descriptiveness, avoid project-unknown abbreviations), the Linux kernel (short locals, descriptive globals, "you should not call it cntusr()") and Go's varnamelen linter.
- **Evidence:**
  - [Shorter identifier names take longer to comprehend](https://doi.org/10.1109/SANER.2017.7884623) — Hofmeister, Siegmund, Holt, SANER 2017 — peer_reviewed — "72 professional C# developers ... words lead to, on average, 19% faster comprehension speed compared to letters and abbreviations, but we did not find a significant difference in speed between letters and abbreviations" — full OpenAlex abstract re-read; confirmed.
  - [Descriptive compound identifier names improve source code comprehension](https://doi.org/10.1145/3196321.3196332) — Schankin, Berger, Holt, Hofmeister, Riedel, Beigl, ICPC 2018 — peer_reviewed — "88 Java developers ... finding the semantic defect about 14% faster ... These effects disappeared when developers searched for a syntax error ... clear impact ... for more experienced developers but not for less experienced developers" — confirmed.
  - [What's in a Name? A Study of Identifiers](https://doi.org/10.1109/ICPC.2006.51) — Lawrie, Morrell, Feild, Binkley, ICPC 2006 — peer_reviewed — "over 100 programmers ... twelve different functions ... full word identifiers lead to the best comprehension; however, in many cases, there is no statistical difference between full words and abbreviations" — confirmed.
  - [Effects of Variable Names on Comprehension: An Empirical Study](https://doi.org/10.1109/icpc.2017.27) — Avidan, Feitelson, ICPC 2017 — peer_reviewed — "9 professional developers ... 6 methods ... parameter names are more significant for comprehension than local variables" — confirmed.
  - [Google C++ Style Guide: General Naming Rules](https://google.github.io/styleguide/cppguide.html) — Google, current — standard — "descriptiveness should be proportional to the name's scope of visibility"; "Minimize the use of abbreviations that would likely be unknown to someone outside your project (especially acronyms and initialisms). Do not abbreviate by deleting letters within a word"; "an abbreviation is probably OK if it's listed in Wikipedia"; "universally-known abbreviations are OK, such as i for a loop index" — CORRECTED quote (the researcher's "length ... proportional to the length of its scope" and "users shouldn't have to search elsewhere" are not in the current text).
  - [Google Python Style Guide §3.16](https://google.github.io/styleguide/pyguide.html) — Google — standard — allowed single-character names are "counters or iterators (e.g. i, j, k, v, et al.)", `e` for exceptions and `f` for file handles. §3.16.4 Mathematical Notation: short names "are preferred when they match established notation in a reference paper or algorithm" — confirmed.
  - [Linux kernel coding style §4 Naming](https://www.kernel.org/doc/html/latest/process/coding-style.html) — kernel community — standard — "LOCAL variable names should be short"; "descriptive names for global variables are a must"; "you should not call it cntusr()" — confirmed.
  - [golangci-lint linters](https://golangci-lint.run/docs/linters/) — varnamelen: "Checks that the length of a variable's name matches its scope." — confirmed.
  - [ESLint id-length](https://eslint.org/docs/latest/rules/id-length) — ESLint v10.11.0 — official_docs — min 2, max Infinity; options properties, exceptions, exceptionPatterns; rule is frozen — CORRECTED (the page does not state the rationale for exceptions).
- **Detect:**
  - **Linters:**
    - ESLint id-length `{min:2, properties:"never", exceptions:["i","j","k","x","y","_"]}`;
    - Go: golangci-lint varnamelen;
    - Python: ruff E741 (`l`, `O`, `I`).
  - **Manual pass:** list parameters, fields, exported symbols and module-level variables with 2 or fewer characters or a non-dictionary abbreviation (`cnt`, `mgr`, `usrLst`).
  - **When to rename:** only when the scope is wider than about 10 lines or the name crosses a function boundary.
  - **Leave alone:**
    - established abbreviations (id, url, ctx, err, db, io, or anything "listed in Wikipedia" per Google);
    - short loop indices and lambda parameters;
    - math that mirrors a cited formula.
- **Tools:** ESLint id-length (frozen), golangci-lint varnamelen, ruff E741, IDE/LSP rename.
- **Applies to:** All languages. Highest value for parameters, fields and public APIs.
- **When not to apply / counterpoints:** The case against well-known abbreviations is mixed. Lawrie found often no difference. Hofmeister found words 19% faster than abbreviations as well as letters, but the abstract does not say whether its abbreviations were conventional or ad hoc. Alpern et al. (2024 preprint) found that just asking for "longer and more detailed names" does not produce better names. Experiments used short snippets without IDE hover. Schankin's effect was absent for less experienced developers. Renaming public symbols is a breaking change (see T17-F19).
- **Fix risk:** medium.

### T17-F22 — Never delete executable or directive comments blindly
- **Rule:** Before deleting or editing any comment, check whether it is executable or semantically significant. Preserve or update these:
  - Python doctests;
  - Rust doc examples (they run as tests);
  - Go `//go:build`, `//go:generate`, `//go:embed` lines;
  - lint and type suppressions: `eslint-disable`, `noqa`, `type: ignore`, `@ts-expect-error`, `nolint`, `#[allow]`;
  - JSDoc types in checkJs projects;
  - coverage pragmas;
  - license and SPDX headers;
  - any comment a tool parses.
- **Grade:** A · **Verdict:** CORRECTED (second pass). The atoms-of-confusion "Preprocessor in Statement" result (effect 0.54) was removed as support. That atom is a C `#define` placed in the middle of an expression; it says nothing about doctests, `//go:build` or suppression comments. The rule rests on the official tool documentation below.
- **Rationale:** Several ecosystems execute or interpret comments, so a comment-cleanup pass can change builds and tests.
- **Evidence:**
  - [doctest — Test interactive Python examples](https://docs.python.org/3/library/doctest.html) — PSF, Python 3.14.7 docs — official_docs — "The doctest module searches for pieces of text that look like interactive Python sessions, and then executes those sessions to verify that they work exactly as shown." — confirmed.
  - [Rustdoc: Documentation tests](https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html) — Rust project — official_docs — "rustdoc supports executing your documentation examples as tests. This makes sure that examples within your documentation are up to date and working." — confirmed.
  - [go command: Build constraints](https://pkg.go.dev/cmd/go#hdr-Build_constraints) — Go project — official_docs — "A build constraint, also known as a build tag, is a condition under which a file should be included in the package. Build constraints are given by a line comment that begins //go:build" — confirmed.
  - [ESLint CLI](https://eslint.org/docs/latest/use/command-line-interface) and [mypy config](https://mypy.readthedocs.io/en/stable/config_file.html) — official_docs — `--report-unused-disable-directives` "Adds reported errors for unused eslint-disable and eslint-enable directives"; mypy `warn_unused_ignores` exists — confirmed (supports the counterpoint).
- **Detect:** Exclude these from any comment deletion:
  - doctests: `rg -n --pcre2 '^\s*(>>>|\.\.\.)\s'`;
  - Rust fenced doc code: `rg -n '^\s*///\s*```'`;
  - Go directives: `rg -n '//go:(build|generate|embed|linkname)|// \+build'`;
  - suppressions, pragmas and licenses: `rg -n 'eslint-disable|@ts-(ignore|expect-error|nocheck)|#\s*(noqa|type:\s*ignore|pragma)|//\s*nolint|istanbul ignore|c8 ignore|pragma: no cover|SPDX-License-Identifier|@license'`;
  - JSDoc `@type`/`@param {..}` when checkJs is on.

  After editing, run `cargo test --doc`, `pytest --doctest-modules`, `go vet` and `go build` for all tagged platforms, and the linters.
- **Tools:** ripgrep; pytest --doctest-modules / python -m doctest; cargo test --doc; go build/vet; ESLint, ruff, mypy/pyright.
- **Applies to:** Python, Rust, Go, JS/TS (checkJs), and any project with suppressions, coverage pragmas or license headers.
- **When not to apply / counterpoints:** Stale suppressions should go, but through the linters' own unused-directive checks (ESLint `--report-unused-disable-directives`, mypy `warn_unused_ignores`), not blind cleanup.
- **Fix risk:** low (the rule itself prevents a high-risk mistake).

### T17-F06 — Delete or rewrite comments that only restate the code
- **Rule:** Delete or rewrite comments that only narrate what the next line obviously does, and docstrings that just repeat the name and parameters. Prefer comments that give intent, rationale, constraints, invariants, units and non-obvious consequences.
- **Grade:** A (consensus of independent official guides; no controlled experiment) · **Verdict:** CORRECTED. The Google C++ quote was reworded to the current text. The "Feitelson 2024" survey is by Oxenhorn, Mor, Stern and Feitelson, and it also found that *written* header comments usually do carry extra information. The HN regex quote now has a source (mmastrac).
- **Rationale:**
  - PEP 8 gives `x = x + 1 # Increment x` as a useless comment.
  - Google C++ says "Do not state the obvious".
  - Google's review guide says comments should "explain why some code exists".
  - The Stack Overflow blog: "Comments that add no information have negative value".
  - Oxenhorn et al. define a signature-similarity metric for information-less documentation. On 21,140 Python files they found most functions undocumented, but existing header comments "typically do contain additional information beyond the function signature". So pure restatement is a real but not dominant pattern.
- **Evidence:**
  - [PEP 8](https://peps.python.org/pep-0008/) — PSF — standard — `x = x + 1 # Increment x` (useless) vs `x = x + 1 # Compensate for border` (useful) — confirmed.
  - [Google Engineering Practices: What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html) — Google — standard — "Usually comments are useful when they explain why some code exists, and should not be explaining what some code is doing." — confirmed verbatim.
  - [Google C++ Style Guide: Comments, Don'ts](https://google.github.io/styleguide/cppguide.html) — Google — standard — "Do not state the obvious. In particular, don't literally describe what code does, unless the behavior is nonobvious to a reader who understands C++ well. Instead, provide higher-level comments that describe why the code does what it does, or make the code self-describing." — CORRECTED wording.
  - [Best practices for writing code comments](https://stackoverflow.blog/2021/12/23/best-practices-for-writing-code-comments/) — Ellen Spertus, Stack Overflow Blog, 2021 — engineering_blog — "Rule 1: Comments should not duplicate the code"; "Comments that add no information have negative value because they: add visual clutter, take time to write and read, can become out-of-date"; "Rule 2: Good comments do not excuse unclear code." — confirmed.
  - [The Paradox of Function Header Comments](https://arxiv.org/abs/2401.07704) — Oxenhorn, Mor, Stern, Feitelson, 2024 — preprint — 367 developers; "developers may evade requirements to write documentation by using templates to generate worthless comments" (presented as a *possible* outcome); metric "based on its similarity to the function signature"; applied to 21,140 files: "when header comments are written they typically do contain additional information beyond the function signature" — CORRECTED (authors and the omitted counter-finding).
  - [eslint-plugin-jsdoc: informative-docs](https://github.com/gajus/eslint-plugin-jsdoc/blob/main/docs/rules/informative-docs.md) — gajus — official_docs — "Reports on JSDoc texts that serve only to restate their attached name", e.g. `/** The user id. */ let userId;`. Not in the recommended config — confirmed.
  - [Linux kernel coding style §8 Commenting](https://www.kernel.org/doc/html/latest/process/coding-style.html) — kernel community — standard — "Do not add boilerplate kernel-doc which simply reiterates what's obvious from the signature of the function." — added in the second pass; confirmed verbatim. This is a third independent official guide against signature-restating docs.
  - [Google Engineering Practices: Comments](https://google.github.io/eng-practices/review/reviewer/looking-for.html) — Google — standard — the same paragraph adds an exception: "regular expressions and complex algorithms often benefit greatly from comments" — added in the second pass (official backing for the counterpoint below).
- **Detect:**
  1. JS/TS: jsdoc/informative-docs.
  2. Any language (after Oxenhorn): tokenise each comment, drop stop words, split the camel/snake identifiers of the documented signature or the next statement, and flag comments almost fully covered by them.
  3. Grep for classic restatements, then review by hand: `rg -n -i '(//|#|/\*)\s*(increment|decrement|sets?|gets?|returns?|loop (over|through)|calls?|initiali[sz]e)\b'`.
  4. Before deleting a restating comment on a complex line, ask whether the code should be clearer or the comment should state the reason instead.
- **Tools:** eslint-plugin-jsdoc informative-docs; ripgrep; a custom token-overlap script.
- **Applies to:** All languages.
- **When not to apply / counterpoints:** The Linux kernel frames it differently: comments "tell WHAT your code does, not HOW", and it discourages comments inside function bodies. A "what" comment on a regex, bit twiddling or dense math is often valuable. Google's review guide says "regular expressions and complex algorithms often benefit greatly from comments", and a practitioner puts it as "Uncommented regular expressions are a code smell" (HN, mmastrac [41927783](https://news.ycombinator.com/item?id=41927783), re-confirmed). Teaching code and API reference docs follow other norms. No controlled experiment measures the cost of redundant comments.
- **Fix risk:** low.

### T17-F17 — Follow the language's naming-case conventions for new or touched code; do not mass-convert
- **Rule:** Enforce the official naming-case conventions via linters on new or touched code: PEP 8, Rust C-CASE, Go, and the JS/TS community convention. Do not mass-convert an established codebase between camelCase and snake_case.
- **Grade:** A (the conventions are official; the style-comparison evidence is mixed) · **Verdict:** VERIFIED (one nuance added: Binkley's 135 subjects were "programmers and non-programmers").
- **Rationale:** Consistency with language conventions is official guidance.
  - Rust: UpperCamelCase for type-level constructs, snake_case for value-level ones, and acronyms as one word ("use Uuid rather than UUID").
  - PEP 8 bans `l`, `O` and `I` as single-character names, and says "do not break backwards compatibility just to comply with this PEP!"
  - The camelCase vs under_score evidence conflicts. Binkley et al. found camelCase more accurate regardless of training. Sharif and Maletic (eye tracking, subjects trained mainly in underscore) found no accuracy difference and faster recognition of underscore.
  - Teams care about convention adherence: a third of reviews contain such feedback (Allamanis et al.).
- **Evidence:**
  - [Rust API Guidelines: Naming (C-CASE)](https://rust-lang.github.io/api-guidelines/naming.html) — Rust project — official_docs — "Rust tends to use UpperCamelCase for 'type-level' constructs (types and traits) and snake_case for 'value-level' constructs"; "use Uuid rather than UUID" — confirmed.
  - [PEP 8](https://peps.python.org/pep-0008/) — PSF — standard — "Never use the characters 'l' ..., 'O' ..., or 'I' ... as single character variable names"; "do not break backwards compatibility just to comply with this PEP!" — confirmed.
  - [To camelcase or under_score](https://doi.org/10.1109/ICPC.2009.5090039) — Binkley, Davis, Lawrie, Morrell, ICPC 2009 — peer_reviewed — "135 programmers and non-programmers ... camel casing leads to higher accuracy among all subjects regardless of training" — confirmed.
  - [An Eye Tracking Study on camelCase and under_score Identifier Styles](https://doi.org/10.1109/icpc.2010.41) — Sharif, Maletic, ICPC 2010 — peer_reviewed — "no difference in accuracy between the two styles, subjects recognize identifiers in the underscore style more quickly" — confirmed.
  - [Ruff rules](https://docs.astral.sh/ruff/rules/) — Astral — official_docs — N801 invalid-class-name ... N818 error-suffix-on-exception-name; E741 — confirmed stable.
- **Detect:**
  - Python: ruff N801-N818 and E741.
  - JS/TS: ESLint camelcase (frozen).
  - Rust: rustc naming lints, plus a manual acronym check (`rg -n 'struct [A-Z]*[A-Z]{3,}'`).
  - Go: golangci-lint revive (described as "Drop-in replacement of golint").
  - Scope checks to changed files.
  - Wire-format names (JSON keys, DB columns) are exempt: map them with serializer aliases, do not rename them.
- **Tools:** ruff N8xx/E741; ESLint camelcase; rustc lints; golangci-lint revive.
- **Applies to:** All languages. Enforce on new or touched code only.
- **When not to apply / counterpoints:** The style studies disagree and show small, training-driven effects. Consistency within a module beats which style is chosen. Some codebases mandate conventions such as Hungarian notation (which Linux calls "asinine"); follow the project's documented convention.
- **Fix risk:** medium.

### T17-F14 — Do not optimise a readability score; justify every edit by a named rule
- **Rule:** Every readability edit must cite a specific rule (a lint rule id or a checklist item). Use the Maintainability Index, cyclomatic or cognitive complexity and model-based readability scores only as regression tripwires. Keep AI-generated readability diffs small and reviewable.
- **Grade:** B · **Verdict:** VERIFIED. Vitale et al., marked unread by the researcher, is now confirmed from the full arXiv abstract. The Peitek 2026 reference is now identified (arXiv 2602.21833).
- **Rationale:** Readability models predict human judgments of readability, not comprehension.
  - Buse and Weimer: 120 annotators; "80 percent effective and better than a human" at predicting judgments. They also note blank lines matter more than comments for local judgments.
  - Scalabrino et al.: "none of the 121 experimented metrics is able to capture code understandability, not even ... readability and complexity".
  - Trockman et al. reanalysis: only "small but significant" correlations.

  AI evidence:
  - MSR 2026: across 403 agent readability commits, the MI fell in 56.1% and cyclomatic complexity rose in 42.7%.
  - GPT-4o refactorings were "behavior-preserving" and reduced smells "at the cost of decreased readability".
  - Personalised LLM readability assessment did worse than a feature model, and "up to a third of the evaluations are self-contradictory".
- **Evidence:**
  - [Learning a Metric for Code Readability](https://doi.org/10.1109/tse.2009.70) — Buse, Weimer, IEEE TSE (2009 online / 2010) — peer_reviewed — "120 human annotators ... 80 percent effective and better than a human, on average, at predicting readability judgments"; "comments, in and of themselves, are less important than simple blank lines" — confirmed.
  - [Automatically Assessing Code Understandability](https://doi.org/10.1109/tse.2019.2901468) — Scalabrino, Bavota, Vendome, Linares-Vásquez, Poshyvanyk, Oliveto, TSE 2019 (ASE 2017 version with 46 participants) — peer_reviewed — "444 human evaluations from 63 developers ... none of the 121 experimented metrics is able to capture code understandability" — confirmed.
  - ["Automatically assessing code understandability" reanalyzed](https://doi.org/10.1145/3196398.3196441) — Trockman, Cates, Mozina, Nguyen, Kästner, Vasilescu, MSR 2018 — peer_reviewed — "a small but significant correlation with understandability ... a small amount of discriminating power" — confirmed.
  - [Do AI Agents Really Improve Code Readability?](https://arxiv.org/abs/2603.13723) — Horikawa, Horikawa, Kashiwa, Uwano, Iida, MSR 2026 (5-page paper) — peer_reviewed — "logic complexity (42.4%) and documentation improvements (24.2%)"; "the Maintainability Index decreased in 56.1% of commits, while Cyclomatic Complexity increased in 42.7%" — confirmed.
  - [From Human to Machine Refactoring: Assessing GPT-4's Impact on Python Class Quality and Readability](https://arxiv.org/abs/2601.13139) — Midolo, Tramontana, Di Penta, 2026 — preprint — 100 ClassEval classes; "GPT-4o generally produces behavior-preserving refactorings that reduce code smells and improve quality metrics, albeit at the cost of decreased readability" — confirmed. Readability here was "measured using a state-of-the-art readability tool". That is itself a model-based score of the kind Scalabrino et al. found does not capture understandability.
  - [Personalized Code Readability Assessment: Are We There Yet?](https://arxiv.org/abs/2503.07870) — Vitale, Guglielmi, Oliveto, Scalabrino, 2025 — preprint — "achieves worse results than a state-of-the-art feature-based model"; "up to a third of the evaluations are self-contradictory" — now confirmed from the full arXiv abstract.
  - [From Restructuring to Stabilization: iterative code readability refactoring with LLMs](https://arxiv.org/abs/2602.21833) — Peitek, Hess, Apel, 2026 — preprint — GPT-5.1, 230 Java snippets, five iterations: "iterative code refactoring exhibits an initial phase of restructuring followed by stabilization" — identified and confirmed by the verifier.
  - [Code Readability in the Age of LLMs: An Industrial Case Study from Atlassian](https://arxiv.org/abs/2501.11264) — Takerngsaksiri et al., ICSME (accepted) — peer_reviewed — "the readability of our LLM-generated code is comparable to human-written code" — confirmed (note: a company evaluating its own tool, HULA).
- **Detect:**
  - **Process check:** every hunk maps to a rule id (e.g. "T17-F04 / ruff FBT001"); revert hunks without one.
  - **Tripwire:** measure before and after with `radon cc -s -a` / `radon mi` (Python) or lizard (multi-language CCN, NLOC, parameter counts). Flag any function whose complexity or LOC rose without a stated benefit.
  - **Size cap:** limit AI readability diffs per commit.
- **Tools:** radon; lizard; ESLint complexity; git diff --stat.
- **Applies to:** Any automated or AI-driven readability or refactoring pass.
- **When not to apply / counterpoints:** MI and cyclomatic complexity are themselves weak proxies. An MI drop can come from helpful docstrings or explaining variables, so treat a drop as a prompt to review, not an automatic reject. The Atlassian result is favourable but self-evaluated. Peitek et al. suggest that repeated LLM readability passes converge rather than churn (the verifier's reading of "restructuring followed by stabilization").
- **Fix risk:** low.

### T17-F05 — Flag long and same-typed parameter lists
- **Rule:** Flag functions with more than 5 parameters, and functions with two or more adjacent same-typed parameters (width/height, from/to, lat/lon, userId/orgId), prioritising public and hot APIs. Refactor with parameter objects, keyword or named arguments, or distinct wrapper types.
- **Grade:** B · **Verdict:** CORRECTED. The DeepBugs URL pointed to a Lawrie search query and is replaced by its DOI. Ruff PLR0917 is stable (added in 0.16.0), not preview.
- **Rationale:** Rice et al. evaluated 200M lines of Google code plus 10M lines of mostly open-source code. They found argument selection defects "even in large, mature projects such as OpenJDK, ASM, and the MySQL JDBC", and "the probability of an argument selection defect increases markedly when methods have more than five arguments". DeepBugs found 102 real mistakes in 150,000 JS files (68% true-positive rate); a 2021 replication reproduced its accuracy within 2%.
- **Evidence:**
  - [Detecting argument selection defects](https://doi.org/10.1145/3133928) — Rice, Aftandilian, Jaspan, Johnston, Pradel, Arroyo-Paredes (Google), OOPSLA 2017 — peer_reviewed — "200 million lines of internal code and 10 million lines of predominantly open-source external code"; high threshold: "true positive rate of 85%, reporting 459 true positives and 78 false positives"; "increases markedly when methods have more than five arguments" — full abstract confirmed.
  - [Error Prone: ArgumentSelectionDefectChecker](https://errorprone.info/bugpattern/ArgumentSelectionDefectChecker) — Google — official_docs — "If permuting the arguments of a method call means that the argument names are a better match for the parameter names than the original ordering then this might indicate that they have been accidentally swapped." Severity WARNING — confirmed.
  - [DeepBugs: a learning approach to name-based bug detection](https://doi.org/10.1145/3276517) — Pradel, Sen, OOPSLA 2018 — peer_reviewed — "150,000 JavaScript files ... accuracy (between 89% and 95%) ... reveal 102 programming mistakes (with 68% true positive rate)" — CORRECTED URL (was a Lawrie search query). Replication: [Winkler et al., ESEC/FSE 2021](https://doi.org/10.1145/3468264.3477221), "within 2% of the accuracy reported".
  - [Ruff PLR0913 too-many-arguments](https://docs.astral.sh/ruff/rules/too-many-arguments/) and [PLR0917 too-many-positional-arguments](https://docs.astral.sh/ruff/rules/too-many-positional-arguments/) — Astral — official_docs — both default to 5 and exempt `@typing.override`; PLR0917 "Added in 0.16.0" (stable) — CORRECTED.
  - [ESLint max-params](https://eslint.org/docs/latest/rules/max-params) — official_docs — "Functions that take numerous parameters can be difficult to read and write because it requires the memorization of what each parameter is, its type, and the order they should appear in." Default max 3 — confirmed.
- **Detect:**
  - Python: ruff PLR0913 and PLR0917 (both stable).
  - JS/TS: ESLint max-params `{max: 5}` (the default 3 is noisy on finished code).
  - Java: Error Prone ArgumentSelectionDefectChecker.
  - Same-typed adjacent parameters: `rg -n --pcre2 '\((\s*\w+\s*:\s*(number|string|int|str|float|i64|u32|bool)\s*,){2,}'`, then review call sites for swaps.
- **Tools:** ruff PLR0913/PLR0917; ESLint max-params; Error Prone; IDE "Change Signature".
- **Applies to:** All languages. Most valuable for public APIs.
- **When not to apply / counterpoints:** The ">5" evidence comes from one very large Java study. Tool thresholds differ with no stated evidence (ESLint 3, ruff 5). Parameter objects add indirection. Overrides must match the parent. FFI, math and conventional orders such as (x, y) can be exempt.
- **Fix risk:** medium.

### T17-F08 — Reconcile all comments of every touched function; hunt stale references
- **Rule:** When the pass touches a function, re-read and reconcile *all* its comments and its docstring, not just the diff hunks. Separately, scan for comments that reference identifiers, parameters or files that no longer exist. If code and comment disagree, establish which is wrong (tests, `git log -L`, the linked issue) before editing. Report possible bugs; never silently "fix" either side.
- **Grade:** B · **Verdict:** CORRECTED. The HN quote "Unless the comments show up in context lines of the diff…" is by u801e (item 29674080), not zerocount (29672845).
- **Rationale:**
  - PEP 8: "Comments that contradict the code are worse than no comments."
  - Wen et al. mined 1.3 billion AST-level changes over 1,500 systems to find which code changes trigger comment updates.
  - Radmanesh et al. (preprint, GPT-3.5 detector): inconsistent changes are about 1.5x more likely to be bug-introducing, and the effect is highest right after the inconsistency appears.
  - ReCite found 869 stale function references in Linux v6.18-rc1; 50 of 75 patches were accepted.
- **Evidence:**
  - [PEP 8](https://peps.python.org/pep-0008/) — PSF — standard — "Comments that contradict the code are worse than no comments." — confirmed.
  - [A Large-Scale Empirical Study on Code-Comment Inconsistencies](https://doi.org/10.1109/ICPC.2019.00019) — Wen, Nagy, Bavota, Lanza, ICPC 2019 — peer_reviewed — "mining 1.3 Billion AST-level changes from the complete history of 1,500 systems ... manually analyzed 500 commits to define a taxonomy" — confirmed.
  - [Investigating the Impact of Code Comment Inconsistency on Bug Introducing](https://arxiv.org/abs/2409.10781) — Radmanesh, Imani, Ahmed, Moshirpour, 2024 — preprint — "inconsistent changes are around 1.5 times more likely to lead to a bug-introducing commit"; "highest immediately after the inconsistency is introduced" — confirmed.
  - [We Must Have Missed This Comment (ReCite)](https://arxiv.org/abs/2608.03734) — Sun, Lyu, Ma, Kuang, Widyasari, Zhang, Ma, Lawall, Lo, accepted at ASE 2026 — preprint — "detects 869 stale references ... 178 (89.0%) provide useful repair guidance, with 85 (42.5%) directly applicable. Of our 75 submitted patches, 50 have been accepted" — confirmed.
  - [HN: Best practices for writing code comments](https://news.ycombinator.com/item?id=29674080) — u801e, 2021 — practitioner_forum — "unless the comments show up in context lines of the diff associated with a change, it's likely that reviewers will overlook the need to change them" — CORRECTED attribution and ID.
  - [rustdoc lints](https://doc.rust-lang.org/rustdoc/lints.html) — Rust project — official_docs — broken_intra_doc_links "warns by default ... detects when an intra-doc link fails to be resolved". [jsdoc check-param-names](https://github.com/gajus/eslint-plugin-jsdoc/blob/main/docs/rules/check-param-names.md) "Ensures that parameter names in JSDoc are matched by corresponding items in the function declaration" (recommended) — confirmed. [pydoclint](https://github.com/jsh9/pydoclint) checks that docstring sections "match the function signature or function implementation" — confirmed.
- **Detect:**
  1. **Doc/signature mismatch:** jsdoc check-param-names; `RUSTDOCFLAGS='-D rustdoc::broken_intra_doc_links' cargo doc`; pydoclint.
  2. **ReCite-style stale-reference scan:** extract `name()` tokens and backticked identifiers from comments, and resolve each against ctags or an LSP `workspace/symbol` query.
  3. **Whole-function review:** re-read every edited function in full, not just the hunk.
  4. **Comment age:** `git log -L :func:file` shows whether the comment predates the last logic change.
- **Tools:** eslint-plugin-jsdoc; rustdoc; pydoclint; universal-ctags/LSP; git log -L.
- **Applies to:** All languages.
- **When not to apply / counterpoints:** Ousterhout says stale comments "rarely cost me much time". The 1.5x figure is a single LLM-detected preprint. Detectors have limited precision: only 42.5% of ReCite's repairs were directly applicable.
- **Fix risk:** low.

### T17-F09 — Triage SATD markers; never blanket-delete
- **Rule:** Inventory TODO, FIXME, HACK, XXX, "workaround" and "temporary" markers. For each one:
  - delete it if resolved (verify the condition first);
  - convert it to `TODO: <issue link> - <what/why>` if still actionable;
  - rewrite it as a plain limitation note if it documents an edge case;
  - escalate FIXME/HACK markers on security or correctness paths.
- **Grade:** B · **Verdict:** CORRECTED. The removal statistics conflict: Maldonado et al. found "the majority of SATD is removed", unlike Potdar and Shihab's 26.3-63.5%. Wehaibi found SATD changes induce *fewer* future defects. HN counterpoint attributions are fixed: "marked as cancelled" is andrewingram, and pjc50 says in-place TODOs "can be left indefinitely".
- **Rationale:**
  - Potdar and Shihab (4 projects): SATD in 2.4-31% of files, only 26.3-63.5% ever removed.
  - Maldonado et al. (5 projects): most SATD is removed, mostly self-removed, with median lifetimes of about 18-172 days. Developers use SATD "to track future bugs and areas of the code that need improvements".
  - Zampetti et al.: 20-50% of removals are accidental (whole classes or methods dropped), and 8% are acknowledged in commit messages.
  - Wehaibi et al.: SATD changes are "more difficult to perform", with no clear defect trend.
  - A 2026 study found 81 of 6,540 LLM-referencing comments self-admit debt.
  - Google Python requires a TODO to carry a link, "ideally a bug reference".
- **Evidence:**
  - [An Exploratory Study on Self-Admitted Technical Debt](https://doi.org/10.1109/icsme.2014.31) — Potdar, Shihab, ICSME 2014 — peer_reviewed — Eclipse, Chromium OS, Apache httpd, ArgoUML: "exists in 2.4%-31% of the files ... only between 26.3%-63.5% of self-admitted technical debt gets removed" — confirmed.
  - [An Empirical Study on the Removal of Self-Admitted Technical Debt](https://doi.org/10.1109/icsme.2017.8) — Maldonado, Abdalkareem, Shihab, Serebrenik, ICSME 2017 — peer_reviewed — "the majority of SATD is removed and that the majority is self-removed ... SATD can last between approx. 18-172 days, on median ... developers mostly use SATD to track future bugs"; prior work saw SATD living "more than 10 years" — confirmed; the "majority removed" contrast was added.
  - [Was self-admitted technical debt removal a real removal?](https://doi.org/10.1145/3196398.3196423) — Zampetti, Serebrenik, Di Penta, MSR 2018 — peer_reviewed — "between 20% and 50% of SATD comments are accidentally removed while entire classes or methods are dropped, (ii) 8% of the SATD removal is acknowledged in commit messages" — confirmed.
  - [Examining the Impact of Self-Admitted Technical Debt on Software Quality](https://doi.org/10.1109/saner.2016.72) — Wehaibi, Shihab, Guerrouj, SANER 2016 — peer_reviewed — "no clear trend when it comes to defects ... SATD changes induce less future defects than none technical debt changes, however ... SATD changes are more difficult to perform" — confirmed; the "fewer defects" clause was added.
  - ["TODO: Fix the Mess Gemini Created": Towards Understanding GenAI-Induced SATD](https://arxiv.org/abs/2601.07786) — Al Mujahid, Imran, TechDebt 2026 — peer_reviewed — "Analyzing 6,540 LLM-referencing code comments ... we identified 81 that also self-admit technical debt" — confirmed.
  - [Google Python Style Guide §3.12 TODO Comments](https://google.github.io/styleguide/pyguide.html) — Google — standard — "a link to a resource that contains the context, ideally a bug reference"; example `# TODO: crbug.com/192795 - Investigate cpufreq optimizations.` The older `TODO(crbug...)` style is "formerly recommended, but discouraged for use in new code", and the guide says "Avoid adding TODOs that refer to an individual or team as the context" — confirmed. The last sentence was added in the second pass: it conflicts with ruff TD002 (missing-todo-author).
  - [Ruff rules](https://docs.astral.sh/ruff/rules/) — TD001-TD007 (TD003 missing-todo-link) and FIX001-FIX004 — all stable — confirmed.
  - [TODOs aren't for doing](https://sophiebits.com/2025/07/21/todos-arent-for-doing) — Sophie Alpert, 2025 — engineering_blog — against teams that require logging every TODO or auto-delete stale ones: "Don't do it!"; a TODO is "a note about 'here's an edge case that wasn't handled'" that "captures a little slice of the author's brain" — confirmed.
  - [An empirical study on self-admitted technical debt in Dockerfiles](https://doi.org/10.1007/s10664-021-10081-7) — Azuma, Matsumoto, Kamei, Kusumoto, EMSE 2022 — peer_reviewed — "about 3.0% of the comments in Dockerfile are SATD" — confirmed (supports the applies-to scope).
- **Detect:**
  1. **Markers:** `rg -n -i '\b(TODO|FIXME|HACK|XXX|KLUDGE|WORKAROUND)\b|temporary (fix|hack|workaround)'`, plus AI-debt phrases (copilot, chatgpt, claude, gemini, "generated by", "not sure why", "untested").
  2. **Linters:** ruff TD003 and FIX001-004; ESLint no-warning-comments (frozen); golangci-lint godox ("Detects usage of FIXME, TODO and other keywords inside comments"). Do not turn on ruff TD002 (author required) if the project follows Google style, which discourages naming a person or team in a TODO.
  3. **Age:** date each marker with `git blame --porcelain`.
  4. **Condition check:** confirm the referenced condition still holds before deleting a marker.
- **Tools:** ripgrep; ruff TD/FIX; ESLint no-warning-comments; golangci-lint godox; git blame.
- **Applies to:** All languages, plus Dockerfiles and config.
- **When not to apply / counterpoints:**
  - **The case for mandatory links:** Google reportedly adopted a rule that "TODO should be followed by a bug number or not be put in at all" (HN, vl), and some teams fail CI on a TODO without a Jira link (HN, inetknght).
  - **The case against:**
    - Alpert.
    - HN andrewingram: ticketed TODOs get "marked as cancelled/wontfix", but the work "is still sitting there not done".
    - HN pjc50: in-place TODOs "can be left indefinitely" and stay out of managers' metrics.
    - The Stack Overflow blog's Rule 9: "Use comments to mark incomplete implementations".
  - **Noise warning:** ESLint says no-warning-comments on a large legacy base "might get hundreds of warnings".
- **Fix risk:** low.

### T17-F19 — Make every rename or restructuring behaviour-safe
- **Rule:** Use semantic (LSP or IDE) rename, not text replace. Search the whole repo, non-code files included, for the old name as a string. Never rename exported, public or wire-format names without a deprecation alias. Confirm coverage of the refactored code before trusting a green run.
- **Grade:** B · **Verdict:** CORRECTED (second pass). The researcher's link for Rachatasumrit and Kim was an OpenAlex search for the *Bavota* paper. It is replaced by the paper's own DOI (10.1109/ICSM.2012.6405293), whose abstract contains the quoted figures. The claims themselves were accurate.
- **Rationale:**
  - Rachatasumrit and Kim: "only 22% of refactored methods and fields are tested by existing regression tests"; refactorings were 8% of atomic changes but "involved in almost half of the failed test cases".
  - Bavota et al.: across 15,008 refactorings, hierarchy-related kinds "tend to induce faults very frequently".
  - Kong et al.: improving identifier names is one of three main reasons for npm breaking changes, and about 19% of breaking changes evade regression testing.
  - IntelliJ offers separate rename options for comments and strings and for text occurrences.
- **Evidence:**
  - [An empirical investigation into the impact of refactoring on regression testing](https://doi.org/10.1109/icsm.2012.6405293) — Rachatasumrit, Kim, ICSM 2012 — peer_reviewed — JMeter, XMLSecurity, ANT; figures as quoted above — confirmed.
  - [When Does a Refactoring Induce Bugs? An Empirical Study](https://doi.org/10.1109/scam.2012.20) — Bavota, De Carluccio, De Lucia, Di Penta, Oliveto, Strollo, SCAM 2012 — peer_reviewed — "15,008 refactoring operations (of 52 different kinds) ... refactorings involving hierarchies (e.g., pull up method), tend to induce faults very frequently" — confirmed.
  - [Towards Better Comprehension of Breaking Changes in the NPM Ecosystem](https://arxiv.org/abs/2408.14431) — Kong, Liu, Bao, Lo, 2024 — preprint (no venue in OpenAlex) — 381 npm projects; "about 19% of the breaking changes cannot be detected by regression testing"; reasons: "to reduce code redundancy, to improve identifier name, and to improve API design" — confirmed.
  - [PEP 8](https://peps.python.org/pep-0008/) — "do not break backwards compatibility just to comply with this PEP!" — confirmed.
  - [IntelliJ IDEA: Rename refactorings](https://www.jetbrains.com/help/idea/rename-refactorings.html) — JetBrains — official_docs — "Rename in comments and strings", "Rename in text occurrences"; "Renaming classes or public methods could potentially impact a lot of files. Preview potential changes before you refactor." — confirmed.
- **Detect:** Before each rename:
  1. `rg -n -w '<oldName>' --hidden -g '!.git' -g '!node_modules'` across all file types, plus snake, camel and kebab variants.
  2. Check export status: `__all__`, `index.ts`, `pub`, a capitalised Go name.
  3. Check serialization annotations: serde rename, `@JsonProperty`, pydantic alias, ORM columns, GraphQL/OpenAPI.
  4. Check dynamic access: getattr, Reflect, Class.forName, `obj["name"]`, DI containers.
  5. Check coverage of the touched functions. If uncovered, add a characterization test or skip the rename.

  Then run the type-check, the tests and a build.
- **Tools:** IDE/LSP rename; ripgrep; coverage.py/c8/cargo-llvm-cov/JaCoCo; tsc/mypy/pyright/cargo check.
- **Applies to:** All languages. Critical for dynamic languages and anything with reflection or serialization.
- **When not to apply / counterpoints:** Local LSP renames are very low risk, and demanding coverage for them is overkill. Midolo et al. found GPT-4o refactorings "generally" behaviour-preserving, but on a well-tested benchmark.
- **Fix risk:** low.

### T17-F12 — One automatic formatter per language, enforced in check mode
- **Rule:** Use exactly one opinionated formatter per language (gofmt, Prettier, Black/ruff format, rustfmt, clang-format) with the committed config, enforced in check mode in CI or pre-commit. If none exists, propose adopting one as a separate, user-approved step.
- **Grade:** B · **Verdict:** CORRECTED. HN attributions are fixed: the Dropbox/Livegrep story is by ublaze; "amazing once you stick it in a precommit" is by Mockapapella; "turns a 1 line change into a several hundred line commit" is by smazga. oefrha's comment actually *supports* formatters.
- **Rationale:**
  - Allamanis et al.: "one third of reviews of changes contain feedback about coding conventions".
  - gofmt'd code is "easier to write", "easier to read", "easier to maintain" and "uncontroversial".
  - Prettier's "first requirement" is identical behaviour after formatting, and it refuses to sort imports because sorting "is potentially unsafe because of side effects".
  - Indentation RCT: participants needed "179% more time on non-indented code".
- **Evidence:**
  - [Learning Natural Coding Conventions](https://arxiv.org/abs/1402.4182) — Allamanis, Barr, Bird, Sutton, FSE 2014 — peer_reviewed — "one third of reviews of changes contain feedback about coding conventions" — confirmed.
  - [go fmt your code](https://go.dev/blog/gofmt) — Andrew Gerrand, Go blog, 23 Jan 2013 — official_docs — "easier to maintain: mechanical changes to the source don't cause unrelated changes to the file's formatting; diffs show only the real changes. uncontroversial: never have a debate about spacing or brace position ever again!" — confirmed.
  - [Prettier Rationale](https://prettier.io/docs/rationale) — official_docs — "The first requirement of Prettier is to output valid code that has the exact same behavior as before formatting." "Prettier only prints code. It does not transform it." — confirmed.
  - [Indentation in Source Code: A Randomized Control Trial ...](https://www.scitepress.org/Papers/2023/120875/120875.pdf) — Morzeck, Hanenberg, Werger, Gruhn, ICSOFT 2023 (DOI 10.5220/0012087500003538) — peer_reviewed — "20 participants (10 students and 10 professional developers) ... strong (p < .001) and large (ηp² = .832) ... 179% more time on non-indented code ... varied on average between 142% and 269%"; the authors know "only nine publications that explicitly focus on indentation", of which three found an effect and five did not — PDF text extracted; confirmed.
  - [Go Proverbs](https://go-proverbs.github.io/) — Rob Pike, Gopherfest SV 2015 — talk — "Gofmt's style is no one's favorite, yet gofmt is everyone's favorite." — confirmed.
  - HN: [Black is stable](https://news.ycombinator.com/item?id=30130315) (500 points) — Mockapapella [30130582](https://news.ycombinator.com/item?id=30130582): "makes working with other developers amazing once you stick it in a precommit"; smazga [30139180](https://news.ycombinator.com/item?id=30139180): "turns a 1 line change into a several hundred line commit (all our code has single quotes)" — CORRECTED attributions.
- **Detect:**
  - **Check mode only:** `prettier --check .`; `black --check .` or `ruff format --check`; `gofmt -l .`; `cargo fmt --check`; `clang-format --dry-run --Werror`.
  - **Find existing config:** .prettierrc, pyproject.toml, rustfmt.toml, .clang-format, .editorconfig, and CI or pre-commit enforcement.
  - **Then:** if config exists and the check fails, format in a dedicated commit (T17-F13). If no formatter exists, ask first.
- **Tools:** gofmt; Prettier; Black; ruff format; rustfmt; clang-format; pre-commit.
- **Applies to:** All languages with a mature formatter. Exclude generated and vendored code.
- **When not to apply / counterpoints:** Adoption on a long-lived repo causes large diffs: Dropbox's 2M+ LoC Black migration crashed their Livegrep blame at that commit (HN ublaze [30130679](https://news.ycombinator.com/item?id=30130679)). Some teams dislike specific choices. The RCT is small (n=20), compares indented with unindented code rather than formatter styles, and prior indentation studies are mixed. Formatters do not fix naming or structure.
- **Fix risk:** low.

### T17-F02 — Treat misleading names as defects
- **Rule:** Fix names whose implied type, cardinality, side effects or return contract contradict the code before any cosmetic rename:
  - `isX`/`hasX` returning a non-boolean;
  - `get`/`find` that mutate state or return nothing;
  - `set` that returns;
  - singular names holding collections, and the reverse;
  - Rust `as_`/`to_`/`into_` methods contradicting C-CONV.
- **Grade:** B · **Verdict:** CORRECTED. The LAPD catalogue *is* reachable at veneraarnaoudova.com/…/las/ and was retrieved; its IDs are cited below. The researcher claimed the landing page named antipattern examples; it names none. The LAPD tool is a 2013 Eclipse/Checkstyle research prototype (latest version 20130907) and should not be presented as maintained.
- **Rationale:**
  - Fakhoury et al. (fNIRS brain imaging plus eye tracking): "the presence of linguistic antipatterns in source code significantly increases the developers' cognitive load".
  - Avidan and Feitelson: 3 of 6 production methods showed no difference against single letters, "due to poor and even misleading variable names".
  - Butler et al.: flawed identifiers are associated with low quality at class and method level (an association, not causation).
  - Hermans: "Bad names ... can cause you to make assumptions about the code, leading to misconceptions."
- **Evidence:**
  - [The Effect of Poor Source Code Lexicon and Readability on Developers' Cognitive Load](https://doi.org/10.1145/3196321.3196347) — Fakhoury, Ma, Arnaoudova, Adesope, ICPC 2018 — peer_reviewed — quote above — Semantic Scholar abstract confirmed (small lab study; the sample size is not in the abstract).
  - [Effects of Variable Names on Comprehension](https://doi.org/10.1109/icpc.2017.27) — Avidan, Feitelson, ICPC 2017 — peer_reviewed — "in 3 of the methods there were no significant differences ... due to poor and even misleading variable names" — confirmed.
  - [Exploring the Influence of Identifier Names on Code Quality](https://doi.org/10.1109/csmr.2010.27) — Butler, Wermelinger, Yu, Sharp, CSMR 2010 — peer_reviewed — "flawed identifiers in Java classes were associated with source code found to be of low quality by static analysis ... the association also holds at the finer granularity level of Java methods" — confirmed.
  - [The Programmer's Brain, ch. 8 "How to get better at naming things"](https://livebook.manning.com/book/the-programmers-brain/chapter-8/) — Felienne Hermans, Manning 2021 — book (liveBook excerpt) — both quotes confirmed.
  - [LAPD linguistic antipattern catalogue](https://www.veneraarnaoudova.com/linguistic-anti-pattern-detector-lapd/las/) — Venera Arnaoudova — research catalogue — A1 "Method get does more than returning the corresponding attribute"; A2 "Method name is predicate but return type is not Boolean"; A3 "Method set returns"; A4 "Method type suggests multiple objects but name suggests single object"; B3/B4 (name suggests a return but it is void); B6; B7 "Method get does not return the corresponding attribute"; D1/D2/E1 (attribute cardinality and predicate) — CORRECTED URL and content. Background: [Arnaoudova, Di Penta, Antoniol, "Linguistic antipatterns: what they are and how developers perceive them", EMSE 2015](https://doi.org/10.1007/s10664-014-9350-8) (existence confirmed; abstract not retrievable).
  - [Rust API Guidelines: Naming (C-CONV, C-GETTER)](https://rust-lang.github.io/api-guidelines/naming.html) — as_ = free, borrowed→borrowed; to_ = expensive; into_ = variable cost, owned→owned; "With a few exceptions, the get_ prefix is not used for getters in Rust code." — confirmed.
- **Detect:** Use the LAPD IDs above as the checklist.
  - (a) Predicate-named functions or attributes that are not boolean: ast-grep TS pattern `function $N($$$): $T { $$$ }` filtered on `^(is|has|can|should)[A-Z]`; Python `def (is|has|can|should)_` plus the return annotation.
  - (b) `get`/`set` contract breaks, e.g. `rg -n 'def get_|function get[A-Z]|fn get_'`, then inspect.
  - (c) Cardinality mismatches found from the type annotations.
  - (d) Rust C-CONV prefixes.
  - (e) Names that contradict the adjacent doc.
- **Tools:** ast-grep; ripgrep; TypeScript compiler; IDE/LSP rename. The LAPD Eclipse plugin exists only as an unmaintained 2013 prototype.
- **Applies to:** All languages. Most valuable for public APIs and boolean helpers.
- **When not to apply / counterpoints:** The studies are small and lab-based (Avidan n=9). Judging "misleading" is partly subjective: Feitelson et al. found a median 6.9% chance that two developers pick the same name, although a chosen name "is usually understood by the majority of developers". Public renames are breaking changes (T17-F19).
- **Fix risk:** medium.

### T17-F15 — Extract well-named explaining variables only for genuinely hard expressions, without changing evaluation
- **Rule:** Introduce well-named explaining variables or predicate functions only for genuinely hard expressions (long or mixed `&&`/`||`, dense arithmetic). Never use meaningless names. Never turn a guarded or short-circuit operand into an eager variable.
- **Grade:** B · **Verdict:** VERIFIED (nuance: the 6 functions in the Cates experiment were mathematical, and the task was to name them).
- **Rationale:** Cates, Yunik and Feitelson (113 subjects, 58% with 3 or more years of experience) found a significant difference in only one case, "the function that was the hardest to understand to begin with". Meaningless intermediate names "appear to have caused a slight decrease in understanding". Their conclusion: "using intermediate variables is generally desirable. However, this recommendation hinges on giving them good names." Ruff PLR0916 suggests assigning boolean sub-expressions to variables.
- **Evidence:**
  - [Does Code Structure Affect Comprehension? On Using and Naming Intermediate Variables](https://arxiv.org/abs/2103.11008) — Cates, Yunik, Feitelson, ICPC 2021 — peer_reviewed — quotes above — arXiv abstract confirmed.
  - [Ruff PLR0916 too-many-boolean-expressions](https://docs.astral.sh/ruff/rules/too-many-boolean-expressions/) — Astral — official_docs — preview; default 5; "Consider assigning the result of the Boolean expression, or any of its sub-expressions, to a variable." — confirmed.
  - [A Philosophy of Software Design vs Clean Code](https://github.com/johnousterhout/aposd-vs-clean-code/blob/main/README.md) — Ousterhout and Martin, Sep 2024 to Feb 2025 — discussion — "If two pieces of code are tightly related, the solution is to bring them together." — confirmed.
- **Detect:**
  - **Linters:** ruff PLR0916 (preview); ESLint no-nested-ternary; @stylistic/no-mixed-operators.
  - **Manual:** look for 4 or more boolean operands, or mixed `&&`/`||` without parentheses.
  - **Before extracting:** if one operand is guarded by another (`x != null && x.y`, `i < len && a[i]`, `cheap() || expensive()`), extract into a predicate function or a lazy local, never an eager variable.
- **Tools:** ruff PLR0916; ESLint no-nested-ternary; @stylistic/no-mixed-operators; ast-grep.
- **Applies to:** All languages.
- **When not to apply / counterpoints:** The effect is small and appears only on the hardest code. Over-extraction causes "entanglement" (Ousterhout). Eagerly evaluating a costly operand is not free.
- **Fix risk:** medium.

### T17-F13 — Keep mechanical changes in their own commits; register them in .git-blame-ignore-revs
- **Rule:** Put formatting, mass renames, codemods and import sorting in their own commits, separate from behaviour changes. List those SHAs in `.git-blame-ignore-revs` and set `blame.ignoreRevsFile`.
- **Grade:** B · **Verdict:** CORRECTED. HN item 43869690 is by joshstrange, in the thread "Converting a Git repo from tabs to spaces (2016)". matsemann (43869764) suggested rewriting history, not "codemods pollute blame". woodrowbarlow (43869888) is confirmed for `git blame -w`.
- **Rationale:**
  - Google's review guide forbids combining major style changes with other changes.
  - Git 2.23+ (`--ignore-revs-file` first appears in the 2.23.0 docs), GitHub and GitLab 17.10+ can skip listed revisions.
  - Black's docs describe exactly this workflow.
- **Evidence:**
  - [Google Engineering Practices: What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html) — "The author of the CL should not include major style changes combined with other changes. It makes it hard to see what is being changed in the CL, makes merges and rollbacks more complex, and causes other problems." — confirmed.
  - [Introducing Black to your project](https://black.readthedocs.io/en/stable/guides/introducing_black_to_your_project.html) — Black 26.5.1 docs — official_docs — `git config blame.ignoreRevsFile .git-blame-ignore-revs`; "GitHub and GitLab (since version 17.10) both support .git-blame-ignore-revs in blame views by default" — confirmed.
  - [GitHub Docs: Ignore commits in the blame view](https://docs.github.com/en/repositories/working-with-files/using-files/viewing-and-understanding-files) — official_docs — the file "must be in the root directory of your repository"; example "# Removed semi-colons from the entire codebase" — confirmed.
  - [git-blame 2.23.0 docs](https://git-scm.com/docs/git-blame/2.23.0) — Git — official_docs — `--ignore-revs-file <file>` is present in 2.23.0 and absent in 2.22.0 — verified by the verifier.
  - HN thread [Converting a Git repo from tabs to spaces](https://news.ycombinator.com/item?id=43869236) — joshstrange [43869690](https://news.ycombinator.com/item?id=43869690): colleagues are concerned about massive changes "ruining" git blame; woodrowbarlow [43869888](https://news.ycombinator.com/item?id=43869888): "`git blame -w` ignores whitespace-only changes"; PhilipRoman [43870373](https://news.ycombinator.com/item?id=43870373): ignore-revs is "ultimately a half measure. Replace blame with log -L" — CORRECTED attributions.
- **Detect:**
  - **Per commit:** `git show --stat` and `git diff -w --ignore-blank-lines <sha>^ <sha>`. A format commit must have no non-whitespace hunks left; a logic commit must have no large whitespace-only hunks.
  - **Ignore file:** check that `.git-blame-ignore-revs` exists and lists the mechanical SHAs.
  - **Config:** `git config --get blame.ignoreRevsFile`.
- **Tools:** git diff -w; git blame --ignore-revs-file; GitHub/GitLab blame UI.
- **Applies to:** All git repositories.
- **When not to apply / counterpoints:** Outside GitHub and GitLab the ignore file needs per-developer configuration. Some teams rewrote their whole history instead, which forced everyone to re-clone (HN skrause [30130991](https://news.ycombinator.com/item?id=30130991)). Squash-merge collapses separate commits unless the mechanical change lands as its own PR.
- **Fix risk:** low.

### T17-F18 — One term per concept within a bounded context
- **Rule:** Use one term per concept within a bounded context and distinct terms for distinct concepts. Unify true synonym drift (get/fetch/retrieve/load; remove/delete/destroy) and near-identical names in one scope (data/data2/dataList, e/ex). Choose replacements by deciding which concepts the name must convey, not by making names longer.
- **Grade:** C (was B) · **Verdict:** DOWNGRADED. There is no direct evidence that unifying synonyms improves comprehension. The sources measure name *divergence* and learnability of conventions, not reader cost. Also corrected:
  - Alpern et al. is an arXiv preprint (OpenAlex lists no peer-reviewed version).
  - "How Developers Choose Names" is IEEE TSE, early access 2020 (DOI 10.1109/TSE.2020.2976920).
  - That paper also found a chosen name "is usually understood by the majority of developers".
- **Rationale:**
  - Across 334 subjects and 47 scenarios, the median probability that two developers choose the same name was 6.9%. The Alpern reproduction confirmed this and found that "just asking participants to use longer and more detailed names does not" improve names.
  - Similar names are an emerging comprehension hazard (a taxonomy only, with no impact measured).
  - NATURALIZE learned codebase conventions with 94% top-suggestion accuracy, and 14 of 18 of its consistency patches were accepted.
- **Evidence:**
  - [How Developers Choose Names](https://arxiv.org/abs/2103.07487) — Feitelson, Mizrahi, Noy, Ben Shabat, Eliyahu, Sheffer, IEEE TSE (early access 2020) — peer_reviewed — "334 subjects ... median probability was only 6.9%. At the same time, given that a specific name is chosen, it is usually understood by the majority of developers"; three-step naming model — confirmed; the understood-by-majority clause was added.
  - [Reproducing, Extending, and Analyzing Naming Experiments](https://arxiv.org/abs/2402.10022) — Alpern, Lazer, Tzachor, Hakim, Weissbuch, Feitelson, 2024 — preprint (CORRECTED from peer_reviewed) — "explicitly using the model ... leads to the creation of better names, whereas the simpler approach of just asking participants to use longer and more detailed names does not" — confirmed.
  - [Identifier Name Similarities: An Exploratory Study](https://arxiv.org/abs/2507.18081) — Wong, Abe, De Benedictis, Halim, Peruma, ESEM 2025 ERVT — peer_reviewed (emerging results) — "Even names that appear readable in isolation may lead to misunderstandings in contexts when they closely resemble other names" — confirmed; this is a taxonomy, and no impact was measured.
  - [Learning Natural Coding Conventions](https://arxiv.org/abs/1402.4182) — Allamanis et al., FSE 2014 — "94% accuracy in its top suggestions for identifier names ... 18 patches ... 14 were accepted" — confirmed.
  - [HN: A dictionary of single-letter variable names](https://news.ycombinator.com/item?id=41831538) — ZeroClickOk, 2024 — `catch (Exception e)` vs `ex` inconsistency causes "clashes in event handlers" — confirmed.
- **Detect:**
  - **Synonym clusters:** extract identifiers with universal-ctags or tree-sitter, split them into words, and count per module: {get, fetch, retrieve, load, read, obtain}, {remove, delete, destroy, erase, drop}, {create, make, build, new}, plus the domain nouns.
  - **Near-duplicates:** `rg -n --pcre2 '\b([a-zA-Z_]+?)([0-9]+|List|Arr|Obj|Data|Info|Tmp)\b'`, then compare against sibling names.
  - **Vocabulary:** align with the README or glossary.
- **Tools:** universal-ctags; tree-sitter; ripgrep; IDE/LSP rename.
- **Applies to:** All languages, within one module or bounded context.
- **When not to apply / counterpoints:** Different words can signal real differences (load from disk vs fetch over the network). Cross-module renames of public symbols are breaking changes. No experiment shows that synonym drift slows readers.
- **Fix risk:** medium.

### T17-F07 — Do not strip comments on "self-documenting code" grounds; document public contracts
- **Rule:** Every exported function, class or module whose contract is not fully expressed by its signature and types should have a concise interface comment. The contract covers preconditions, formats, units, ordering, ownership, side effects, errors, concurrency and cost. Do not generate boilerplate docs for trivial members, and document only behaviour verified in code or tests.
- **Grade:** C · **Verdict:** CORRECTED. "Comments are always failures" is a *Clean Code* (p. 54) passage that Ousterhout quotes. In the 2024-25 discussion Martin says the chapter calls comments a "necessary evil" and says "I'm not hostile to comments in general. I am very hostile to gratuitous comments." His own statement there is "I prefer long names to comments. I don't trust comments to be maintained, nor do I trust that they will be read." Guelman et al. was confirmed from the full abstract (previously seen only as a listing).
- **Rationale:** Experts genuinely disagree, and the survey data argue against stripping comments.
  - Ousterhout spends "50-80% of my development time wading through code" when comments are missing, and puts "the cost of missing comments ... easily 10-100x the cost of incorrect comments".
  - Oxenhorn et al. (367 developers): header comments are valued but rarely written.
  - Wayne: code and tests "are not nearly expressive enough to embed all useful information".
  - Pike: "Documentation is for users."
- **Evidence:**
  - [A Philosophy of Software Design vs Clean Code](https://github.com/johnousterhout/aposd-vs-clean-code) — John Ousterhout and Robert C. Martin, discussions Sep 2024 to Feb 2025 — other (public debate) — Ousterhout: "it's not unusual for me to spend 50-80% of my development time wading through code to figure out things that would be obvious if the code was properly commented"; "For me the cost of missing comments is easily 10-100x the cost of incorrect comments." Martin: "I prefer long names to comments. I don't trust comments to be maintained, nor do I trust that they will be read."; "I'm not hostile to comments in general. I am very hostile to gratuitous comments." — CORRECTED attribution of "Comments are always failures" (a Clean Code quote cited by Ousterhout).
  - [The Paradox of Function Header Comments](https://arxiv.org/abs/2401.07704) — Oxenhorn, Mor, Stern, Feitelson, 2024 — preprint — developers "appreciate the value of header comments ... but nevertheless they tend not to write such documentation"; reasons range "from the belief that code should be self-documenting to concern that documentation will not be kept up-to-date" — confirmed.
  - [The Myth of Self-Documenting Code](https://buttondown.com/hillelwayne/archive/the-myth-of-self-documenting-code/) — Hillel Wayne, 2021 — engineering_blog — "they can only encode certain classes of information"; "Code and tests are not nearly expressive enough to embed all useful information." — confirmed.
  - [Go Proverbs](https://go-proverbs.github.io/) — Rob Pike, Gopherfest SV 2015 — talk — "Documentation is for users." "Clear is better than clever." — confirmed.
  - [HN: Self-Documenting Code](https://news.ycombinator.com/item?id=41927813) — alilleybrinker, 2024 — "Over time as that team drifts, the shared knowledge will weaken, and the 'self-documenting' code will no longer be self-documenting to the new team members." — confirmed.
  - [On the Quality of AI-Generated Source Code Comments](https://arxiv.org/abs/2408.14007) — Guelman, Leal, Xavier, Valente, 2024 — preprint — Javadoc for 142 classes and 273 methods by GPT-3.5 Turbo, GPT-4o and DeepSeek-V3: "58.8% were equivalent to, and 27.7% superior to, the original comments" (two experts) — confirmed.
- **Detect:**
  - Python: ruff D100-D107 (stable).
  - Rust: `#![warn(missing_docs)]` (rustc lint, "allowed by default").
  - Go: golangci-lint revive exported checks.
  - Manual: apply Ousterhout's addSongToLibrary questions ("Is there any expected format for an author string ...?", ordering, duplicates) to each public symbol.
- **Tools:** ruff D1xx; rustc missing_docs; golangci-lint revive.
- **Applies to:** Public or exported APIs and module boundaries. Not trivial getters or private helpers.
- **When not to apply / counterpoints:** Stale comments do cause bugs (T17-F08), and mandated docs invite template noise. LLM-written docs can assert false behaviour, so an agent must only document claims it has verified.
- **Fix risk:** low.

### T17-F21 — Do not over-extract tiny functions for "readability"
- **Rule:** Do not split cohesive logic into many tiny functions whose names stand in for comments. Extract only when the new function is a meaningful, reusable abstraction with a simpler interface than its body. Consider inlining shallow one-caller helpers.
- **Grade:** C · **Verdict:** CORRECTED. Martin's "ideally 2-4 lines" is Ousterhout's reading of *Clean Code*. Martin replies that the 2-4 line functions came from the *Sparkle* applet and that the book does not set "arbitrary numerical limits". The "both agree over-decomposition is possible" claim is confirmed (Martin: "It is certainly possible to over-decompose code").
- **Rationale:** Clean Code says functions "should hardly ever be 20 lines long". Ousterhout argues over-decomposition causes "entanglement": "If two pieces of code are tightly related, the solution is to bring them together." Practitioners report the cost of hopping between functions. Wayne shows a real API call buried four methods deep in Martin's FitNesse.
- **Evidence:**
  - [A Philosophy of Software Design vs Clean Code](https://github.com/johnousterhout/aposd-vs-clean-code/blob/main/README.md) — Ousterhout and Martin, 2024-25 — quotes above — confirmed.
  - [HN: Self-Documenting Code](https://news.ycombinator.com/item?id=41928634) — johnfn, 2024 — "Don't use a bunch of tiny functions. This makes it harder for future eng to read the code" — confirmed.
  - [The Myth of Self-Documenting Code](https://buttondown.com/hillelwayne/archive/the-myth-of-self-documenting-code/) — Hillel Wayne, 2021 — "you need to dig four methods deep: run calls buildAndSendRequest which calls ResponseParser.performHttpRequest which calls RequestBuilder.send" — confirmed.
- **Detect:** Use lizard or an IDE call hierarchy to find private functions with exactly one caller and 3 or fewer statements that are not a reusable concept, and chains of 3 or more such helpers. Treat them as "consider inlining". Add no new extraction without a named rule (T17-F14).
- **Tools:** lizard; IDE call hierarchy/LSP references; ast-grep.
- **Applies to:** All languages.
- **When not to apply / counterpoints:** Small functions help testing and reuse. Both sides of the evidence are expert opinion and anecdote. Inlining is risky when helpers are overridden, mocked or referenced dynamically.
- **Fix risk:** medium.

### T17-F03 — Put units in types or names
- **Rule:** A numeric value with a unit (time, size, money, angle, rate) carries the unit in its type (Duration, timedelta, std::chrono, a money type) or, failing that, in its name (timeoutMs, retry_after_seconds). This covers config keys, CLI flags and API fields too. Never pass bare unitless literals to APIs whose unit varies by language or library.
- **Grade:** C · **Verdict:** CORRECTED. The van Asseldonk quote is fixed: the text reads "How can you tell this from the code? You can't. You just have to know by heart". The inopinatus Rails expression is in parent comment 30749956; comment 30750727 only says it came from a real bug report.
- **Rationale:** Python `time.sleep(300)` is 5 minutes, Java `Thread.sleep(300)` is 0.3 s and Haskell `threadDelay 300` is 0.3 ms. Practitioners report many real incidents, and Go has a linter for duration multiplication.
- **Evidence:**
  - [Please put units in names](https://ruuda.nl/2022/please-put-units-in-names) — Ruud van Asseldonk, 20 Mar 2022 — engineering_blog — "How can you tell this from the code? You can't. You just have to know by heart that time.sleep takes seconds, while threadDelay takes microseconds."; recommends unit names or `timedelta(seconds=300)` — CORRECTED quote.
  - [HN: Please put units in names](https://news.ycombinator.com/item?id=30749134) — 1284 points, 594 comments, 2022 — Groxx [30750026](https://news.ycombinator.com/item?id=30750026): `delaySecs * time.Second` bugs "at least several dozen times"; inopinatus [30749956](https://news.ycombinator.com/item?id=30749956) and [30750727](https://news.ycombinator.com/item?id=30750727): `(Time.now + 1.month).to_i == Time.now.to_i + 1.month.to_i #=> false`, "taken almost verbatim from the report summarizing a real and subtle bug ... written by definitely-not-novices" — confirmed.
  - [golangci-lint durationcheck](https://golangci-lint.run/docs/linters/) — "Check for two durations multiplied together." — confirmed.
  - [Linux kernel coding style §4](https://www.kernel.org/doc/html/latest/process/coding-style.html) — "Encoding the type of a function into the name (so-called Hungarian notation) is asinine - the compiler knows the types anyway" — confirmed (counterpoint).
- **Detect:**
  - **Unit-less names:** `rg -n -i --pcre2 '\b(timeout|delay|interval|ttl|duration|expir\w*|max_?age|retry_?after|backoff|period|size|limit|price|amount|angle)\b\s*[:=]\s*-?\d'`, then flag names without a unit suffix or unit type.
  - **Bare literals to unit-sensitive calls:** `rg -n 'sleep\(\s*\d|setTimeout\([^,]+,\s*\d|time\.Sleep\(\s*\d|Duration\(\s*\d'`.
  - **Go:** durationcheck.
  - **Schemas:** check config and API schemas for a documented unit on every number.
- **Tools:** ripgrep; golangci-lint durationcheck; duration types.
- **Applies to:** All languages, config, environment variables, CLI flags and wire formats.
- **When not to apply / counterpoints:** A unit type beats a suffix. The kernel rejects type-in-name encoding, although units are semantics rather than storage type. A suffix on a name already typed as a Duration is redundant.
- **Fix risk:** medium (renaming config keys or API fields is breaking; see T17-F19).

### T17-F04 — Replace behaviour-switching boolean parameters
- **Rule:** Replace boolean parameters that switch a function between different behaviours with separate functions, an enum or union, or a required keyword or named argument. At a minimum, no call site passes a bare positional `true`/`false`.
- **Grade:** C · **Verdict:** CORRECTED. seanalltogether is [42100032](https://news.ycombinator.com/item?id=42100032). The comment does not say the boolean "became a problem only after 8 years". It says he has worked with the data model "for about 8 years" and that `isFavorite` "turned into a trap" when business needs grew; it was hard to change because it was modelled in device firmware. That is a cautionary tale *for* this rule, not pushback.
- **Rationale:** Fowler: "Rather than use a flag argument, I prefer to define separate methods." Ruff: "the meaning of the boolean value is not clear to the caller and to future readers". Clippy: "Boolean parameters obscure meaning at the call site ... with no help from the type system", and many bools in a struct suggest "a state machine, which is much better implemented as an enum".
- **Evidence:**
  - [FlagArgument](https://martinfowler.com/bliki/FlagArgument.html) — Martin Fowler, 23 Jun 2011 — engineering_blog — quote above. Exception: "If there is a check-box on the screen and we are just passing its value to book then a flag argument has some justification." For tangled logic he keeps a private `hiddenBookImpl(aCustomer, isPremium)` behind two public methods — confirmed.
  - [Ruff FBT001](https://docs.astral.sh/ruff/rules/boolean-type-hint-positional-argument/) — Astral — official_docs — quote above; dunder operators, setters and `@override` are exempt; fixes are separate functions, an Enum or a keyword-only argument — confirmed; FBT001-003 stable.
  - [clippy excessive_bools.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/excessive_bools.rs) — rust-clippy — source docs — both lints are `pedantic`; config `max_fn_params_bools` / `max_struct_bools` — confirmed.
  - [HN: Booleans Are a Trap](https://news.ycombinator.com/item?id=42099897) — 27 points, 2024 — TrianguloY [42100191](https://news.ycombinator.com/item?id=42100191): "Start with the easy, and change it when you need it"; seanalltogether 42100032 as described above — CORRECTED.
- **Detect:**
  - Python: ruff FBT001/FBT002/FBT003.
  - Rust: clippy::fn_params_excessive_bools and struct_excessive_bools (pedantic; enable explicitly).
  - Other languages: `ast-grep --lang ts -p '$F($$$A, true, $$$B)'` (and false), then check whether the callee branches on that parameter.
  - Structs with 3 or more mutually exclusive bools are enum candidates.
- **Tools:** ruff FBT; clippy; ast-grep.
- **Applies to:** All languages. Weaker where arguments are labelled at the call site (Swift, keyword-only Python, Kotlin named args).
- **When not to apply / counterpoints:** Booleans passed straight from data (Fowler's checkbox), setters and overrides are fine. Splitting can duplicate logic, so keep a hidden flagged implementation. Do not pre-emptively model enums for states that may never appear.
- **Fix risk:** medium.

### T17-F11 — Name meaningful or repeated literals
- **Rule:** Name numeric and string literals that encode a domain rule, threshold or protocol value, or that repeat with the same meaning. Leave obvious literals, formula constants beside a citation, and test expectations alone.
- **Grade:** C · **Verdict:** CORRECTED. The previously unsourced HN quote is now traced to praptak, 2013 ([6290571](https://news.ycombinator.com/item?id=6290571)).
- **Rationale:** ESLint: magic numbers "should preferably be replaced by named constants". Ruff: readers "will have to infer the meaning of the value from the context". Every major linter exempts trivial values. The only comprehension data point is indirect: routing a value through a constant variable was not confusing (atom effect 0.00).
- **Evidence:**
  - [ESLint no-magic-numbers](https://eslint.org/docs/latest/rules/no-magic-numbers) — official_docs — "'Magic numbers' are numbers that occur multiple times in code without an explicit meaning. They should preferably be replaced by named constants." The rule is frozen and not in recommended — confirmed.
  - [Ruff PLR2004](https://docs.astral.sh/ruff/rules/magic-value-comparison/) — "readers will have to infer the meaning of the value from the context"; excludes 0, 1, "" and "__main__" — confirmed.
  - [Checkstyle MagicNumber](https://checkstyle.org/checks/coding/magicnumber.html) — v14.1.0 (published 2026-08-30) — "By default, -1, 0, 1, and 2 are not considered to be magic numbers"; ignoreHashCodeMethod default false — confirmed.
  - [Atoms of Confusion data](https://atomsofconfusion.com/data.html) — Constant Variables 0.00 (not accepted) — confirmed.
  - [Google Python Style Guide §3.16.4](https://google.github.io/styleguide/pyguide.html) — mathematical notation — confirmed.
  - [HN: What is a magic number, and why is it bad?](https://news.ycombinator.com/item?id=6290571) — praptak, 2013 — "A number directly used in code is not magic if it is properly commented. Granted, explaining it by making it a named constant is very often better" — sourced by the verifier.
- **Detect:**
  - Python: ruff PLR2004.
  - JS/TS: ESLint no-magic-numbers `{ignore:[-1,0,1,2], ignoreArrayIndexes:true, ignoreDefaultValues:true, enforceConst:true}`.
  - Java: Checkstyle MagicNumber.
  - Repeated-literal survey: `rg -o -n --pcre2 '(?<![\w.])\d{2,}(\.\d+)?(?![\w.])' src | cut -d: -f3 | sort | uniq -c | sort -rn | head`.
  - Exclude tests.
- **Tools:** ruff PLR2004; ESLint no-magic-numbers; Checkstyle MagicNumber; ripgrep.
- **Applies to:** All languages. Excludes tests, generated code and data tables.
- **When not to apply / counterpoints:** There are no controlled studies. Over-application yields SECONDS_PER_MINUTE = 60 noise. ESLint froze the rule and left it out of recommended.
- **Fix risk:** medium.

### T17-F20 — Workarounds and odd code carry a "why" comment with provenance
- **Rule:** Workarounds, deliberately unidiomatic code, sleeps and retries, copied code, suppressions and bug-fix guards carry a short "why" comment with a link to the upstream issue, ticket, spec or source. Never invent a rationale.
- **Grade:** C · **Verdict:** CORRECTED. The hinkley quote is item [41941026](https://news.ycombinator.com/item?id=41941026); item 41941007 is an unrelated hinkley comment about naming.
- **Rationale:** Stack Overflow rules 5-8 ask for exactly this. Practitioners report time lost rediscovering edge cases, and that linked workaround comments "give the next person permission to delete it". Google reviewers are asked to look for comments "advising against this change being made".
- **Evidence:**
  - [Best practices for writing code comments](https://stackoverflow.blog/2021/12/23/best-practices-for-writing-code-comments/) — Ellen Spertus, 2021 — "Rule 5: Explain unidiomatic code in comments. Rule 6: Provide links to the original source of copied code. Rule 7: Include links to external references ... Rule 8: Add comments when fixing bugs"; such comments are "helpful for determining whether the code is still needed and how to test it" — confirmed.
  - [HN: Self-Documenting Code](https://news.ycombinator.com/item?id=41941026) — hinkley, 2024 — "When I put a hack in place as a workaround for a bug in a dependency, I always link the ticket ... to give the next person permission to delete it if the bug has been fixed upstream" — CORRECTED ID.
  - [HN: Best practices for writing code comments](https://news.ycombinator.com/item?id=29672365) — laserlight: "If there's no comment explaining 'why not', many others (including future me) could lose time"; zerocount [29672889](https://news.ycombinator.com/item?id=29672889): "Later, when I'm almost done re-writing it, I see the edge case they were working around." — confirmed.
  - [Google Engineering Practices: What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html) — "Maybe there is a TODO that can be removed now, a comment advising against this change being made, etc." — confirmed.
- **Detect:** Find workaround-shaped code and check for an explanatory comment within about 3 lines: `rg -n --pcre2 '(sleep\(|setTimeout\(|time\.Sleep\(|retry|navigator\.userAgent|sys\.platform|process\.platform|runtime\.GOOS|#\s*noqa|eslint-disable|@ts-ignore|@ts-expect-error|#\s*type:\s*ignore|#\[allow\(|@SuppressWarnings|//\s*nolint)'`. Also check version guards and broad exception handlers. If git history does not establish the reason, flag it for the owner.
- **Tools:** ripgrep; git log -S / git blame; ESLint; ruff.
- **Applies to:** All languages.
- **When not to apply / counterpoints:** There is no quantitative evidence. A wrong "why" is worse than none (PEP 8). Links to private trackers rot.
- **Fix risk:** low.

### T17-F10 — Delete commented-out code
- **Rule:** Delete commented-out code blocks; version control keeps them. Exceptions: a disabled alternative whose comment explains why it is kept and when to restore it, and examples inside documentation.
- **Grade:** C · **Verdict:** CORRECTED. The HN source was removed: no comment by sullyj3 (or anyone) in thread 21910391 contains "analogous to cleaning up debugging statements". Item 21912834 is by alpaca128 and is about TODO visibility. The rule now rests on a single tool rationale plus reasoning.
- **Rationale:** Ruff: "Commented-out code is dead code, and is often included inadvertently. It should be removed." Commented-out code is invisible to compilers, type-checkers and tests, so it rots silently.
- **Evidence:**
  - [Ruff ERA001 commented-out-code](https://docs.astral.sh/ruff/rules/commented-out-code/) — Astral (derived from eradicate) — official_docs — quote above; known problem: "Prone to false positives when checking comments that resemble Python code, but are not actually Python code" — confirmed; stable since v0.0.145.
- **Detect:**
  - Python: ruff ERA001.
  - Other languages: `rg -n --pcre2 '^\s*(//|#)\s*([a-zA-Z_][\w.]*\s*\(.*\)\s*;?|(if|for|while|return|const|let|var|def|fn)\b.*[{:;]\s*)$'`, then review by hand.
  - Before deleting, run `git log -S'<snippet>'`.
- **Tools:** ruff ERA001; ripgrep; git log -S.
- **Applies to:** All languages.
- **When not to apply / counterpoints:** There is no empirical study. False positives on prose and pseudo-code are common. Respect explicit project policies (regulated or embedded code).
- **Fix risk:** low.

## Practitioner voice
- [u801e, HN 2021](https://news.ycombinator.com/item?id=29674080) — "unless the comments show up in context lines of the diff ... reviewers will overlook the need to change them" (CORRECTED; was attributed to zerocount 29672845).
- [laserlight, HN 2021](https://news.ycombinator.com/item?id=29672365) — rewrote "weird" code and found it failed "for some obscure reason"; without a "why not" comment others lose the same time.
- [zerocount, HN 2021](https://news.ycombinator.com/item?id=29672889) — only after nearly finishing a rewrite did he "see the edge case they were working around".
- [hinkley, HN 2024](https://news.ycombinator.com/item?id=41941026) — links the dependency ticket on workarounds "to give the next person permission to delete it if the bug has been fixed upstream" (CORRECTED ID; was 41941007).
- [alilleybrinker, HN 2024](https://news.ycombinator.com/item?id=41927813) — self-documenting code works in one team, but "as that team drifts, the shared knowledge will weaken".
- [mmastrac, HN 2024](https://news.ycombinator.com/item?id=41927783) — "Uncommented regular expressions are a code smell." (added; sources a previously unsourced quote)
- [johnfn, HN 2024](https://news.ycombinator.com/item?id=41928634) — "Don't use a bunch of tiny functions"; readers keep jumping around.
- [vl, HN 2019](https://news.ycombinator.com/item?id=21914325) — "at Google a rule was adopted that TODO should be followed by a bug number or not be put in at all" (second-hand claim).
- [sullyj3, HN 2020](https://news.ycombinator.com/item?id=21954124) — TODO comments are "primarily for the benefit of the subsequent readers"; info kept only in the tracker helps only whoever picks up the ticket (added; replaces a misattributed quote).
- [inetknght, HN 2025](https://news.ycombinator.com/item?id=44652597) — a tool "fails if it finds a TODO in a comment without a Jira link on the same line".
- [muzani, HN 2025](https://news.ycombinator.com/item?id=44649299) — "TODO: encrypt this" on EncryptedSharedPreferences revealed the data was unencrypted; TODOs record real limitations.
- [andrewingram, HN 2025](https://news.ycombinator.com/item?id=44657809) — ticketed TODOs get "marked as cancelled/wontfix", but the work is still undone, and "alongside the code is about as context-rich as you can hope for" (added; the quote was misattributed to pjc50).
- [Sophie Alpert, 2025](https://sophiebits.com/2025/07/21/todos-arent-for-doing) — against mandatory ticketing or auto-deleting stale TODOs: "Don't do it!"
- [ublaze, HN 2022](https://news.ycombinator.com/item?id=30130679) — Dropbox migrated 2M+ LoC to Black; their Livegrep "always crashed at the commit" (CORRECTED; was attributed to skrause).
- [skrause, HN 2022](https://news.ycombinator.com/item?id=30130991) — reformatted the entire repo history with Black; everyone re-cloned, but blame "still works perfectly".
- [smazga, HN 2022](https://news.ycombinator.com/item?id=30139180) — can't adopt Black at work: it "turns a 1 line change into a several hundred line commit" (CORRECTED; was attributed to oefrha 30132452).
- [Mockapapella, HN 2022](https://news.ycombinator.com/item?id=30130582) — Black "makes working with other developers amazing once you stick it in a precommit" (CORRECTED; was attributed to simonw).
- [oefrha, HN 2022](https://news.ycombinator.com/item?id=30132452) — dislikes Black's double quotes but "I don't want to debate styles anymore, ever" (the actual content of this ID).
- [joshstrange, HN 2025](https://news.ycombinator.com/item?id=43869690) — colleagues worry that massive codebase-wide changes "ruin" git blame; replies point to `git blame -w` ([woodrowbarlow](https://news.ycombinator.com/item?id=43869888)) and call ignore-revs "a half measure" ([PhilipRoman](https://news.ycombinator.com/item?id=43870373)) (CORRECTED; was attributed to matsemann).
- [Groxx, HN 2022](https://news.ycombinator.com/item?id=30750026) — has seen `delaySecs * time.Second` bugs "at least several dozen times".
- [inopinatus, HN 2022](https://news.ycombinator.com/item?id=30750727) — the Rails `1.month` arithmetic bug (expression in [30749956](https://news.ycombinator.com/item?id=30749956)) came from a real bug report on code by "definitely-not-novices".
- [jbaber, HN 2024](https://news.ycombinator.com/item?id=41836821) — "if it's present for more than a page, please tell me what you're counting" (CORRECTED ID; 41832818 is jmillikin on `ii`/`jj` loop counters).
- [ZeroClickOk, HN 2024](https://news.ycombinator.com/item?id=41831538) — `e` vs `ex` catch-variable inconsistency caused clashes when normalising a codebase.
- [TrianguloY, HN 2024](https://news.ycombinator.com/item?id=42100191) — "Start with the easy, and change it when you need it" (pushback on pre-emptive enums).
- [seanalltogether, HN 2024](https://news.ycombinator.com/item?id=42100032) — `isFavorite` became a trap when pinning grew beyond one dashboard, and was hard to change because it lived in device firmware.
- [Ousterhout vs Martin, 2024-25](https://github.com/johnousterhout/aposd-vs-clean-code) — Ousterhout: missing comments cost "10-100x" more than incorrect ones. Martin: "I prefer long names to comments", "very hostile to gratuitous comments". "Comments are always failures" is *Clean Code* p. 54, quoted by Ousterhout.
- [Hillel Wayne, 2021](https://buttondown.com/hillelwayne/archive/the-myth-of-self-documenting-code/) — code and tests "are not nearly expressive enough to embed all useful information".

## Contradictions and open questions

**Contradictions**
- **Comment purpose.** Google (review guide and C++ guide) says comments should explain why, not what. The Linux kernel says comments should "tell WHAT your code does, not HOW" and avoid comments inside function bodies. The shared ground: never narrate HOW line by line.
- **Comment value vs staleness.**
  - Ousterhout: missing comments cost "10-100x" incorrect ones, and stale comments "rarely cost me much time".
  - Martin (2024-25): prefers long names and does not trust comments to be maintained, but is "not hostile to comments in general". "Comments are always failures" is the 2008 book text, not his debate position.
  - PEP 8: contradicting comments are worse than none. Radmanesh (preprint): inconsistent changes are about 1.5x more bug-prone.
  - Oxenhorn et al.: developers value header comments but do not write them, and existing ones usually add information.
- **SATD removal rates.** Potdar and Shihab (2014, 4 projects): only 26.3-63.5% removed. Maldonado et al. (2017, 5 projects): the majority removed, mostly by the introducer.
- **SATD and defects.** Wehaibi et al.: SATD changes induce *fewer* future defects but are harder to make. SATD is a maintainability signal, not a defect predictor.
- **Abbreviations.** Lawrie 2006: often no difference between words and abbreviations. Hofmeister 2017: abbreviations no better than letters, words 19% faster. Google C++ now allows abbreviations "listed in Wikipedia" and bans deleting letters within a word.
- **Name length.** Google (scope-proportional descriptiveness) and the kernel (short locals) vs blanket linters (id-length min 2) and experiments favouring words. Alpern (preprint): asking for longer names does not make better names.
- **camelCase vs under_score.** Binkley 2009: camelCase more accurate. Sharif and Maletic 2010: no accuracy difference, underscore recognised faster. Training drives both results.
- **TODO policy.** Google (link required), with CI-enforced ticket links, vs Alpert, andrewingram, pjc50, sullyj3 and SO blog Rule 9 (TODOs as in-place documentation).
- **Readability metrics.** Buse and Weimer predict human judgments (80%). Scalabrino: none of 121 metrics captures understandability. Trockman: small but significant correlations.
- **Atoms of confusion.** Lab: 2.7-56x more mistakes (students). Field, C/C++: prior work associated atoms with bug fixes, as reported in the Mendes, Tahsin and Shi abstracts. Field, Java: no link to review confusion (Bogachenkova 2022) or to defect fixing (Shi 2024), and atoms are not being removed or reduced over time (Bogachenkova; Mendes 2022).
- **TODO attribution.** Ruff TD002 requires an author in each TODO. Google's current Python guide says "Avoid adding TODOs that refer to an individual or team as the context" and wants a bug link instead.
- **AI readability refactoring.**
  - Midolo 2026: behaviour-preserving, fewer smells, lower readability.
  - Horikawa MSR 2026: MI worse in 56.1% of commits.
  - Atlassian (self-evaluation): comparable to humans.
  - Peitek 2026: iterative passes converge.
- **Units in names vs Hungarian notation.** The kernel calls type-in-name encoding "asinine". Van Asseldonk advocates unit suffixes when types cannot carry the unit.
- **Function decomposition.** Clean Code: "hardly ever 20 lines". Ousterhout: over-decomposition causes "entanglement". Martin says the 2-4 line examples were not a limit. Cates: intermediate variables help only on the hardest code, and only when well named.

**Open questions**
- **Parameter count.** No controlled study sets a parameter-count threshold beyond Rice et al.'s single (large, Java, Google) finding. ESLint's default of 3 has no stated evidence.
- **Magic numbers.** Replacing them has no direct comprehension evidence.
- **Study realism.** Most naming and comment experiments use snippets, students or small samples (Avidan n=9, Morzeck n=20) and no IDE. Effects in large codebases with tooling are unknown.
- **Inconsistency and bugs.** The 1.5x link is one preprint with an LLM detector; replication is needed.
- **AI agents as readers.**
  - Shen et al. (arXiv 2609.26388, 22 Sep 2026, preprint under review) report that LLM code-comprehension performance "generally decreases as identifier information is removed or made misleading", with outputs steered by misleading names ("lexical superstition").
  - Abdelsalam, Peitek et al. (arXiv 2508.18547, 2025) find LLM perplexity spikes correlate with human EEG confusion signals on confusing code.
  - Together these suggest the naming and atom rules also matter for AI maintainers. Neither is peer-reviewed yet.
- **Retrofit cost-benefit.** There is no quantitative data on retrofitting formatters or repo-wide renames onto long-history projects.
- **TODO placement.** No empirical comparison exists of inline TODOs vs tracker tickets.
- **Misleading-name tooling.** Detection outside Java has no maintained tool. LAPD is a 2013 Eclipse prototype, but its catalogue (A1-F2) is usable as a manual checklist.
- **Abstract-only sources.** Several primary papers were checked at abstract level only (Hofmeister, Lawrie, Binkley, Sharif, Rice, Gopstein, the SATD papers, Fakhoury). The abstracts are now confirmed verbatim rather than reconstructed, but in-paper details (sample composition, effect sizes beyond the abstract) were not checked against full texts.

## Dropped findings
None. All 22 findings survived: 3 verified as written, 18 corrected, and 1 downgraded (T17-F18, B to C). Individual sources dropped inside findings:
- T17-F10: the "sullyj3 21912834, analogous to cleaning up debugging statements" quote. It could not be found in the thread, and 21912834 is by alpaca128 and says something else.
- T17-F22: the atoms-of-confusion "Preprocessor in Statement" data point, dropped as support in the second pass. It is real, but it is about C preprocessor lines inside expressions, not tool-parsed comments.
- No practitioner-voice URL was dropped. 7 had the wrong author or ID and were corrected by locating the real comment in the thread; the second pass re-confirmed all the corrected IDs.
