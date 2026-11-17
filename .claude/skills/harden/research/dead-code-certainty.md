# Deleting dead code on static evidence alone: detector precision, the no-telemetry case, and the test-edit policy for deletions
> Code G102 · slug dead-code-certainty · verified 2026-09-23 · counts: verified 10 / corrected 10 / downgraded 1 / dropped 0

## Summary

**How this was checked.** The researcher had no WebSearch (the session budget was spent) and neither did the verifier. So every source below was opened again directly: curl with pdftotext for the PDFs; the arXiv, Crossref, Semantic Scholar, GitHub (`gh`), HN Firebase/Algolia and StackExchange APIs; and a Wayback snapshot for Reddit. Where only an abstract could be read, the evidence line says so. The researcher said the "~1.7% vendor figure" from T07 could not be found, and it was not found here either.

**Q1. Is there independent precision data for dead-code detectors?** There are published precision figures, but only for research tools and older tools. Three of them were not measured independently:
- **UCDetector (Java).** Independently measured by Haas et al. (TOSEM 2020): 76 dead-class warnings, of which 24 were really unnecessary (32%). "Most" of the other 52 were classes loaded dynamically. The sample was 241 classes that the authors' own recommender had pre-selected, not a random sample.
- **DCF (research Java detector).** 84% precision, 87% recall. This comes from DCF's own authors (Romano & Scanniello) and was reported again in EMSE 2023.
- **Lacuna (JS).** From Lacuna's own authors (TSE 2023): 82.5% precision / 97.2% recall for the dynamic+TAJS configuration, and 56% / 49% for the purely static 2018 version.
- **depcheck.** Independently measured by KTH (arXiv 2405.17939, now in JSS 2025). Of 162 flagged dependencies, 84 could be deleted safely. Of the other 78, 40 were loaded dynamically, which the authors count as misclassified (≈25%). The remaining 38 were test tools filed as runtime dependencies. Their tests broke when removed, but the correct fix is to move them to devDependencies.
- **Knip, vulture at project level, Go `deadcode`, deptry, cargo-machete / shear / udeps.** No independent precision figures exist for any of these.
- **Issue trackers.** They show the recurring false-positive classes. The counts below reproduce exactly on 2026-09-23. They count issues, not a precision rate, and many of those issues are closed.
  - Knip: 172 of 1285 issues mention "false positive" (70 of them in the title).
  - vulture: 52 of 245.
  - cargo-machete: 18. cargo-shear: 16. cargo-udeps: 12. deptry: 11 of 210.

**Q2. Evidence that can stand in for missing telemetry.** All of it works in one direction only.
- **Execution and text hits.** A coverage or smoke-run hit, or a text hit anywhere in the repo, shows the code is live. So these can veto a deletion. They never prove that code is dead.
  - A 2026 ground-truth study of C *program-specialisation* debloaters found that dynamic tools remove "up to 94% of code that should be retained", error handling above all.
- **Git history.** It is weak evidence that code is dead. Haas et al.'s stability+centrality recommender predicted historical cleanups with only 2.7% precision. History is useful context, though:
  - In 23 Java apps, 67–100% of dead methods were born dead.
  - Revival is rare (0–14% in 13 of 23 apps), except in 4 apps where developers wrote code ahead of use (>50% revived).
- **Owner confirmation.** It is fallible. Haas et al. report that "even the most experienced developers do not know the whole code base and are therefore unsure." *Correction:* the researcher's figure "owner confirmation was right 34% of the time" misreads the paper. The 34% is the share of the tool's recommendations that developers judged unnecessary, which is the recommender's precision, not how accurate the developers were.
- **Test-only callers.** Production-mode analysis (`knip --production`; `deadcode` without `-test`) is the right way to find code that only tests call.

**Q3. Deletion matrix.** See G102-F01.

**Q4. Test-edit rule.** The rule is in G102-F14 and the enforcing hook in G102-F15.
- Tests are read-only by default. ImpossibleBench shows that Claude models and Qwen3-Coder cheat mainly (>79% of their cheating) by modifying tests. Read-only access "restores legitimate performance while preventing test modification attempts". The authors add that it "does not eliminate other cheating methods".
- The one carve-out is a dead-code commit, following Sensenmann's fate-sharing and Piranha's deletion of flag tests. In such a commit, test cases may be deleted only when:
  - each one references a symbol deleted in the same commit,
  - the surviving tests stay byte-identical, and
  - a check on per-test coverage (and, where feasible, mutation results) passes.
- Coverage alone is not enough. Line-coverage-adequate greedy minimisation of 7 Java suites (removing about 70% of tests) lost on average ≈12.5% of mutation-based fault detection, ranging from 3.5% to 21%.

**Q5. Reversibility.** Keep a report-now / delete-later candidate list. Do not add tombstones or deprecation logging automatically: they are behaviour changes, and they only pay off in a deployed system that someone watches.

**Deletion matrix (carried over; the per-cell grades are the researcher's synthesis)**

Evidence levels:
- E0: proven unused by the compiler or language.
- E1: a production-mode whole-program tool finding, plus a clean whole-repo text search, plus build, tests and app start all green.
- E2: E1 plus corroboration from git history or from the owner.
- E3: runtime evidence covering a full business cycle.

Actions:
- DELETE: its own commit.
- BATCH: one commit per class of finding, flagged for human review.
- REPORT: listed only; the code is not touched.

**Supersessions (carried over, with one correction)**
- **T06-F08** is replaced by the narrower, mechanically checked carve-out in F14/F15.
- **T06-F21**'s three tiers are replaced by the per-cell matrix.
- **T07** is amended with the UCDetector, DCF, Lacuna and depcheck figures, including who ran each measurement. The gap for Knip, vulture, deadcode, deptry and cargo-* remains.
- **T31/T09/T10/T12** (tests are read-only) stay the default, with exactly one exception enforced by the hook.
- **T13-F19** is merged into the TE-3 clause.
- **T30** is answered structurally rather than numerically, because no source gives a threshold.
- *Correction:* the researcher cited TripRL as evidence that coverage alone can be enough. It is not: TripRL puts fault-detection ability into its minimisation objective as an explicit criterion. It therefore supports TE-3's fault-detection (mutation) clause rather than contradicting it.

## Findings

### G102-F03: Delete directly (E0) only what the compiler or language proves unused, with fixed exceptions for side effects
- **Grade:** A · **Verdict:** CORRECTED. The vulture #422 date was fixed (it was opened on 2026-07-04, not in 2025). Two sources were added: the Go FAQ for the Go claim, and a rustc false-positive regression as a counterpoint.
- **Rule:** E0 means the item is proven unused by one of these:
  - rustc `dead_code` (unused, unexported items)
  - gcc/clang `-Wunused-function` (static functions) and `-Wunused-variable`
  - tsc `noUnusedLocals` / `noUnusedParameters`
  - the Go compiler's errors for unused imports and variables
  - ruff F401 outside `__init__.py`
  - ruff F841

  Fixed exceptions, which go to REPORT or get only a partial fix:
  - (a) An unused variable whose initializer has side effects: keep the call as a statement.
  - (b) A side-effect import, for example `from . import signals` inside `AppConfig.ready()`.
  - (c) Re-exports in `__init__.py`.
  - (d) Rust fields read only through `Drop`, or kept for their effect on auto traits.
  - (e) C++ static objects whose constructors register something.
  - (f) An unreachable `yield`, because it is what makes the function a generator.
- **Rationale:** These are the only classes where the language itself guarantees the item is referenced nowhere, and the tools' own docs name the exceptions:
  - Rust: "Removing fields that are only used for side-effects and never read will result in behavioral changes."
  - Ruff: removal is safe "except in `__init__.py` files".
  - Django's documented pattern imports a module purely for its registration side effect.
  - SCARF: "it is unclear whether a static initializer in C++ has side-effects".
  - vulture #422: removing an unreachable `yield` changes an async generator into a coroutine.
- **Evidence:**
  - [rustc lint listing: dead-code](https://doc.rust-lang.org/rustc/lints/listing/warn-by-default.html). Rust project, 2026, official docs.
    - Quote: "The dead_code lint detects unused, unexported items." / "Removing fields that are only used for side-effects and never read will result in behavioral changes. Examples of this include: If a field's value performs an action when it is dropped. If a field's type does not implement an auto trait (e.g. Send, Sync, Unpin)."
    - Verified verbatim.
  - [GCC Warning Options](https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html). GNU Project, 2026, official docs.
    - Quote: "-Wunused-function: Warn whenever a static function is declared but not defined or a non-inline static function is unused. This warning is enabled by -Wall."
    - Verified verbatim.
  - [Ruff rule unused-import (F401)](https://docs.astral.sh/ruff/rules/unused-import/). Astral, 2026, official docs.
    - Quote: "Fixes to remove unused imports are safe, except in `__init__.py` files ... the fix is unsafe because the module's interface changes."
    - Verified. The second clause concerns third-party and stdlib imports in `__init__.py`.
  - [Django 5.2: Signals](https://docs.djangoproject.com/en/5.2/topics/signals/). DSF, 2025, official docs.
    - Quote: "If you're using the receiver() decorator, import the signals submodule inside ready(), this will implicitly connect signal handlers".
    - Verified.
  - [TSConfig noUnusedLocals](https://www.typescriptlang.org/tsconfig/noUnusedLocals.html). Microsoft, 2026, official docs.
    - Quote: "Report errors on unused local variables."
    - Verified.
  - [Go FAQ: Can I stop these complaints about my unused variable/import?](https://go.dev/doc/faq). Go project, 2026, official docs. *Added by the verifier.*
    - Quote: "Go refuses to compile programs with unused variables or imports".
    - Verified.
  - [vulture issue #422: 100% confidence false positive](https://github.com/jendrikseipp/vulture/issues/422). vulture tracker, **2026** (opened 2026-07-04, still open), practitioner forum.
    - Quote: "The yields are understandably flagged, but removing them would cause the return value to become a coroutine instead of an async generator object."
    - Verified via the GitHub API.
  - [Safe dead code removal in a pure functional language](https://jfmengels.net/safe-dead-code-removal/). Jeroen Engels, 2021-01-28, engineering blog.
    - Quote: "In JavaScript, importing a module can cause side effects. Meaning that in order to not change the behavior of the program, we can only remove the assignment part from the import declaration."
    - Verified.
  - [rust-lang/rust #128272](https://github.com/rust-lang/rust/issues/128272). Rust tracker, 2024, issue report. *Added by the verifier as a counterpoint.*
    - Quote: "False positive `dead_code` 'never constructed' warning on 1.80.0" (closed 2024-08-03). The thread also discusses FFI-constructed types that trigger the lint.
    - Verified.
- **Detect:**
  - Signals: `tsc --noEmit` with `noUnusedLocals` / `noUnusedParameters`; `cargo build` (`dead_code` warnings); `gcc/clang -Wall -Wunused-function -Wunreachable-code`; `ruff check --select F401,F841,F811`; `go build` / `go vet`.
  - Exclude before deleting:
    - ast-grep `$X = $CALL($$$)` initializers (keep the call).
    - `from . import $M` inside `ready()` or in `__init__.py`.
    - `impl Drop` on field types.
    - Globals with non-trivial constructors.
- **Tools:** tsc, rustc, gcc/clang, ruff, go build, ast-grep
- **Applies to:** All compiled or linted languages; file-local and private scope only.
- **When not to apply / counterpoints:**
  - Linters differ in soundness. vulture's "100%" means "guaranteed to be unused within the analyzed files", which is not a compiler proof.
  - Suppressions (`_foo`, `#[allow(dead_code)]`, `# noqa`) mark intent and must be respected.
  - Compiler lints themselves can regress (rustc 1.80 #128272). Still run the build and tests after an E0 deletion.
  - *Reviewer note, unsourced:* compiler proofs hold per configuration. An item can look dead under the current cfg / `#ifdef` / feature set and be used under another, so check all feature and target combinations the project builds.
- **Fix risk:** low

### G102-F02: Treat any non-compiler detector finding as a candidate with a measured false-positive rate of roughly 15–70%, never as proof
- **Grade:** B · **Verdict:** CORRECTED. The researcher called all four measurements "independent"; DCF and Lacuna were evaluated by their own authors. depcheck's misclassification rate is 40/162 ≈ 25% per its evaluators; "52%" is the share that could be deleted as-is. The tracker counts are issue counts, not precision.
- **Rule:** Record the tool, version, rule id and confidence for every finding. A tool's confidence label alone never authorises a deletion.
- **Rationale:** Published figures:
  - **UCDetector** (independent, Haas et al.): 76 warnings; 24 unnecessary, 52 necessary, so 32% precision. "Most" of the misses were loaded dynamically. Sample: 241 classes pre-selected by the authors' recommender.
  - **DCF** (its authors' own evaluation, as reported in EMSE 2023): 84% precision, 87% recall. It does not support reflection.
  - **Lacuna** (its authors, TSE 2023): 82.5% / 97.2% for dynamic+TAJS. The static-only 2018 version reached 56% / 49%.
  - **depcheck** (independent, KTH): 162 flagged; 84 safely removable; 40 misclassified because they were loaded dynamically; 38 were test tools misfiled as runtime deps.
  - **Knip, vulture, deadcode, deptry, cargo-***: no independent numbers. Their trackers show recurring false-positive reports (counts reproduced exactly on 2026-09-23).
- **Evidence:**
  - [Is Static Analysis Able to Identify Unnecessary Source Code?](https://www.se.cs.uni-saarland.de/publications/docs/HNR+19.pdf). Haas, Niedermayr, Roehm, Apel. TOSEM 29(1), 2020 (DOI 10.1145/3368267), peer-reviewed, author version.
    - Quote: "UCDetector (Table 7b) reported in total 76 dead classes, of which 24 were classified as unnecessary by developers, while 52 were actually necessary." / "Most of the 52 dead classes that were actually necessary were loaded dynamically during runtime".
    - Verified. Table 7 covers 241 *recommended* classes.
  - [On the spread and evolution of dead methods in Java desktop applications](https://link.springer.com/article/10.1007/s10664-023-10303-0). Caivano, Cassieri, Romano, Scanniello. EMSE 28:64, 2023, peer-reviewed, open access.
    - Quote: "Romano and Scanniello compared DCF with JTombstone, CodePro AnalytiX, and DUM-Tool ... (average precision equal to 84%) ... (average recall equal to 87%)"; "methods invoked indirectly by means of reflection are not supported by DCF".
    - Verified. This is a second-hand report of DCF's authors' own evaluation.
  - [JavaScript Dead Code Identification, Elimination, and Empirical Assessment](https://arxiv.org/abs/2308.16729). Malavolta, Nirghin, Scoccia, Romano, Lombardi, Scanniello, Lago. IEEE TSE, July 2023 (DOI 10.1109/TSE.2023.3267848), peer-reviewed.
    - Quote: "on average, 82.5% of the functions this instance of Lacuna detects as dead are correct (i.e., on average, only 17.5% of the functions are wrongly detected as dead)"; Table 1 of the old version: "Static 56% 49% 49%".
    - Verified. The subjects are 39 TodoMVC apps.
  - [Detecting and removing bloated dependencies in CommonJS packages](https://arxiv.org/abs/2405.17939). Liu, Tiwari, Bogdan, Baudry (KTH). arXiv v4 2025; **published in the Journal of Systems and Software, 2025 (DOI 10.1016/j.jss.2025.112509)**, peer-reviewed.
    - Quote: "depcheck identifies 162 direct bloated dependencies ... 84 dependencies that can be safely removed ... 78 (40 + 38) ... break the tests after each removal ... 40 dependencies are dynamically generated at runtime"; "static analysis misclassifies 40 dependencies as bloated"; "38 dependencies identified as bloated by depcheck are testing-related development dependencies misused by developers as runtime dependencies".
    - Verified.
  - [Knip issues matching "false positive"](https://github.com/webpro-nl/knip/issues?q=is%3Aissue+%22false+positive%22). GitHub, 2026, practitioner forum.
    - Data: 172 issues mention it (70 in the title), out of 1285. Examples: #1543 "false positives for lazy imports", #1573 "Unused export false positive when using Next.js", #927 (enum members via `Object.values`).
    - Reproduced via the GitHub search API. All three examples are **closed**.
  - [vulture README](https://github.com/jendrikseipp/vulture). Jendrik Seipp, 2026, official docs.
    - Quote: "Values below 100% are *very rough* estimates (based on the type of code chunk) for how likely it is that the code is unused." The confidence table gives 60% to attributes, classes, functions, methods, properties and variables.
    - Verified.
- **Detect:** Run each tool in machine-readable mode (`knip --reporter json`, `vulture --min-confidence`, `deadcode -json`, `cargo machete`) and store the tool version with the findings. Uncorroborated findings go to REPORT.
- **Tools:** knip, vulture, deadcode, depcheck, deptry, cargo-machete, cargo-shear, cargo-udeps
- **Applies to:** TS/JS, Python, Go, Rust, Java; C/C++ via cppcheck `unusedFunction` (whole-program only).
- **When not to apply / counterpoints:**
  - Knip's docs claim "a surprising result is usually a real finding or a configuration gap, not a false positive to silence". Tuned configurations may be far more precise than raw runs.
  - Go `deadcode` is sound with respect to reflection.
  - The measured numbers come from Java desktop apps, TodoMVC apps and CommonJS packages, and may not transfer.
- **Fix risk:** low

### G102-F04: Before any deletion above E0, run a whole-repo text search as a veto
- **Grade:** B · **Verdict:** VERIFIED (the Reddit wording was clarified).
- **Rule:**
  - Search for the symbol name, its case variants, the file basename, and the route/CLI/package name.
  - Search every tracked file: config, templates, SQL/migrations, CI, Dockerfiles, docs and scripts.
  - Any hit outside the definition and the tests being deleted moves the item to REPORT.
  - A clean search is necessary, never sufficient.
- **Rationale:**
  - Meta keeps a BigGrep text veto on top of its static graphs and runtime usage data, accepting false negatives to avoid false positives.
  - SCARF lists usages that no search can see: string-built table names, reflection, factory registration, table names stored in a database.
  - A Reddit poster commented out a "truly unused" function and "a critical admin tool broke" (the thread is titled "…took down prod?"). The function was called through a string path in a config file.
- **Evidence:**
  - [Automating dead code cleanup](https://engineering.fb.com/2023/10/24/data-infrastructure/automating-dead-code-cleanup/). Shackleton, Pincombe, Cohn-Gordon (Meta), 2023-10-24, engineering blog.
    - Quote: "Our systems also err on the side of caution, by searching for textual references to code and data through our BigGrep system ... This approach can cause false negatives, but avoids false positives. When automating the removal of dead code, those are a more serious problem."
    - Verified.
  - [Dead Code Removal at Meta (ESEC/FSE 2023 industry preprint)](https://users.encs.concordia.ca/~pcr/paper/Shackleton2023FSE-industry-preprint.pdf). Shackleton, Cohn-Gordon, Rigby, Abreu, Gill, Nagappan et al., 2023, peer-reviewed.
    - Quote: "code using string concatenation to construct table names; reflection used to call methods on classes without static references to function names; language support for automated factory registration ...; table names stored in a database instead of in code"; "There are over three hundred of these pattern detectors".
    - Verified.
  - [Ever removed "unused" code… and instantly took down prod? (r/learnprogramming)](https://www.reddit.com/r/learnprogramming/comments/1lbuach/ever_removed_unused_code_and_instantly_took_down/). Reddit users, 2025, practitioner forum.
    - Quote: "Turns out it was being called dynamically via a string path passed from a config file. No type checks, no linter warnings."; reply: "the class names and method names are stored in the DB and invoked using reflection after a lookup at runtime."
    - Verified in the Wayback snapshot of 2025-08-01. The poster commented the code out rather than deleting it.
- **Detect:**
  - `git grep -n -I -w -e <name> -e <snake_name> -e <kebab-name> -- . ':!<defining file>' ':!<tests being deleted>'`
  - Plus ast-grep / rg for dynamic-construction patterns: `getattr(`, template-string `import(`, `require($VAR)`, `Class.forName`, `reflect.`, `globals()[`.
- **Tools:** git grep, ripgrep, ast-grep
- **Applies to:** All languages; mandatory for rows 3–12 of the matrix.
- **When not to apply / counterpoints:**
  - Common names produce false vetoes. Use word boundaries, and record any reviewer override.
  - The search cannot see names held in databases, remote config or other repos.
- **Fix risk:** low

### G102-F05: Send candidates in a documented false-positive class to REPORT unless the tool models that mechanism and the evidence reaches E2
- **Grade:** B · **Verdict:** CORRECTED.
  - Haas et al.'s false-positive causes were measured for their *stability/centrality recommender*, not for dead-code detectors. They are used here by analogy.
  - vulture's dataclass issue (#264) is closed. The TypedDict (#335), Flask (#232) and enum-iteration (#304) issues are open.
  - cargo-machete's renamed-crate false positive applies only without `--with-metadata`.
  - Added cargo-udeps' doc-test limitation.
  - Added the Deblometer authors.
- **Rule:** The classes:
  - DI/IoC registration
  - reflection / `getattr` / `Class.forName` / `globals()` dispatch
  - serialised DTOs consumed outside the analysed code
  - system-border interfaces and plugin/extension points
  - abstract types referenced only inside their own hierarchy
  - framework conventions (file-based routing, auto-imports, auto-mocks)
  - dynamic or template-string imports; CommonJS member access (`mod.fn()`)
  - macro-generated references (Rust)
  - renamed crates
  - dependencies used only in doc-tests
  - enums used by iteration or `Object.values`
  - dataclass / pydantic / TypedDict fields
  - CLI entry points referenced from package.json scripts or CI
- **Rationale:** The tools' own docs and trackers list these families. In a benchmark of Java debloaters, dynamic class loading made every tool unsound.
- **Evidence:**
  - [Is Static Analysis Able to Identify Unnecessary Source Code? (RQ5)](https://www.se.cs.uni-saarland.de/publications/docs/HNR+19.pdf). Haas et al., 2020, peer-reviewed.
    - Quote: "use of dependency injection frameworks ... use of reflection for invocations ... data transfer classes that are serialized and mainly used outside of the (analyzed) Java code (e.g., in a JS UI); interfaces at the system border ... Most incorrect classifications are caused by missing dynamic or external dependency information."
    - Verified. Applies to the authors' recommender.
  - [Knip: Resolve reported issues](https://knip.dev/guides/handling-issues). Knip docs, 2026, official docs.
    - Quote: "Named exports consumed via member access on a required variable (const mod = require('./mod'); mod.fn()) are not traced, so they may be reported as unused."; "A framework automatically imports all files matching src/models/*.ts → those files are reported as unused."; the list of causes includes "Dynamic import specifiers".
    - Verified.
  - [cargo-shear README](https://github.com/Boshen/cargo-shear). Boshen, 2026, official docs.
    - Quote: "`cargo shear` cannot detect 'hidden' imports from macro expansions without the `--expand` flag (nightly only)."
    - Verified. The repo is active.
  - [cargo-machete README](https://github.com/bnjbvr/cargo-machete). Benjamin Bouvier, 2026, official docs.
    - Quote: "in a fast (yet imprecise) way"; "Some crates have a different import name, than their dependency name (e.g. `rustls-webpki`). This triggers false positives in `cargo-machete` when used without the `--with-metadata` flag."
    - Verified.
  - [cargo-udeps README](https://github.com/est31/cargo-udeps). est31, 2026, official docs. *Added by the verifier.*
    - Quote: "it needs Rust nightly to actually run"; the example carries the comment "Used only in doc-tests, which `cargo-udeps` cannot check."
    - Verified.
  - [A Soundness and Precision Benchmark for Java Debloating Tools (Deblometer)](https://arxiv.org/abs/2510.20679). Klauke, Ohlmer, Schott, Ponta, Fischer, Bodden, 2025, preprint.
    - Quote: "all tools remove required program constructs, which results in changed semantics or execution crashes. In particular, the dynamic class loading feature introduces unsoundness in all evaluated tools."
    - Verified (abstract only).
  - [vulture issues #335 / #232 / #304](https://github.com/jendrikseipp/vulture/issues). vulture tracker, practitioner forum.
    - Data: "False positives for TypedDicts" (open), "False-positives for Flask" (open), "False positive when enum is used in iteration" (open); #264 on dataclasses is closed.
    - Verified via the GitHub API.
- **Detect:**
  - ast-grep / rg in the candidate's module and importers:
    - `@Inject|@Autowired|@Component|providers:|container.register`
    - `getattr(|globals()[|importlib.import_module|Class.forName|reflect.`
    - template-string `import(`, `require($VAR)`
    - `@dataclass|BaseModel|TypedDict`
    - `macro_rules!|#[derive`
  - Also check for a knip.json whose plugin list lacks the framework in use.
- **Tools:** ast-grep, ripgrep, knip --debug, vulture --make-whitelist
- **Applies to:** Java/Kotlin, TS/JS, Python, Rust; any DI or plugin framework.
- **When not to apply / counterpoints:** Configured Knip plugins and vulture whitelists remove some of these classes. A blanket REPORT would then under-delete.
- **Fix risk:** low

### G102-F06: Tests are not evidence of liveness; find test-only-reachable code with production-mode analysis and let it share fate with its tests, except tagged test seams
- **Grade:** B · **Verdict:** VERIFIED (the Guava `@VisibleForTesting` semantics were checked; the AndroidX semantics differ, see below).
- **Rule:**
  - Find code whose only callers are tests with `knip --production` (with `!` entry patterns), Go `deadcode` without `-test`, or a build graph that excludes test targets.
  - Treat it as BATCH together with its dedicated tests, under the TE rule.
  - Keep symbols tagged `@internal` (Knip), `@VisibleForTesting`, or named by a test-only convention.
- **Rationale:**
  - Sensenmann: "we cannot use test runs as a liveness signal". Tests should "share the fate of the library it is testing".
  - Knip: test files can keep production files alive "while sometimes both of them can be deleted".
  - Legitimate test seams exist (Knip `@internal`; Sensenmann's "test only" libraries; Engels' test-only values).
- **Evidence:**
  - [Sensenmann: Code Deletion at Scale](https://testing.googleblog.com/2023/04/sensenmann-code-deletion-at-scale.html). Phil Norman, Google Testing Blog, 2023-04-28, engineering blog.
    - Quote: "This means we cannot use test runs as a 'liveness' signal: if we did, we'd consider lib2_test to be alive, which would keep lib2 around forever ... What we really want is for each test to share the fate of the library it is testing."
    - Verified.
  - [Knip Production Mode](https://knip.dev/features/production-mode). Knip docs, 2026, official docs.
    - Quote: "Test files usually import production files. This prevents production files or their exports from being reported as unused, while sometimes both of them can be deleted."
    - Verified.
  - [Knip JSDoc & TSDoc Tags](https://knip.dev/reference/jsdoc-tsdoc-tags). Knip docs, 2026, official docs.
    - Quote: "Internal exports are not meant for public consumption, but only for internal usage such as tests. This means they would be reported in production mode."
    - Verified.
  - [Finding unreachable functions with deadcode](https://go.dev/blog/deadcode). Alan Donovan, Go Blog, 2023-12-12, official blog.
    - Quote: "most library packages have tests, and tests have main functions ... we can include them in the analysis using the -test flag."
    - Verified.
  - [Test-only values](https://jfmengels.net/test-only-values/). Jeroen Engels, 2020-12-22, engineering blog.
    - Quote: "for values imported in tests, it becomes much harder to tell whether they are imported to be tested or to enable testing."
    - Verified.
  - [Guava `@VisibleForTesting`](https://guava.dev/releases/snapshot-jre/api/docs/com/google/common/annotations/VisibleForTesting.html). Google, 2026, official docs. *Added by the verifier.*
    - Quote: "Annotates a program element that exists, or is more widely visible than otherwise necessary, only for use in test code."
    - Verified. The AndroidX annotation only marks relaxed visibility ("visibility relaxed ... to make code testable"), so the element may still have production callers.
- **Detect:**
  - Diff default mode against production mode: `knip --reporter json` vs `knip --production --reporter json`, and `deadcode -test ./...` vs `deadcode ./...`.
  - Exclude `@internal`, `@VisibleForTesting`, `/(^test_|ForTests?$|_TESTS_ONLY)/`, and test-support directories.
- **Tools:** knip --production, deadcode, Bazel query, rg
- **Applies to:** TS/JS, Go, Bazel-based C++/Java; Python via coverage contexts (no production-mode tool found).
- **When not to apply / counterpoints:**
  - Sensenmann pairs tests with libraries by name edit distance. They say one test exercising two libraries "is likely to involve processing test coverage data, and has not yet been explored."
  - Some test-only code pins an API contract intended for future use.
- **Fix risk:** medium

### G102-F07: Use execution evidence in one direction only: a hit proves the code is live, no hit never proves it is dead
- **Grade:** B · **Verdict:** CORRECTED.
  - The 94% figure comes from C *program-specialisation* debloaters (GNU coreutils, nginx), not from dead-code detectors on applications, so it is used here by analogy.
  - The debloating paper's author list is now complete.
  - "If you liked it, then put a test on it" is an HN comment by a Google engineer, not an official Google statement.
- **Rule:** An executed line or symbol vetoes deletion. Paths for error handling, recovery, migration, fallback, retry or periodic jobs that have no execution hit stay in REPORT.
- **Rationale:**
  - Test-driven debloaters remove "up to 94% of code that should be retained", and error handling in particular.
  - Even with scripted interactions "covering all primary functionalities" of TodoMVC apps, the best dynamic tool reached a mean precision of 0.949.
  - Haas et al.: rarely used core features (annual financial statements) and error, recovery and migration code are valuable even when they are not executed.
- **Evidence:**
  - [Revisiting Code Debloating with Ground Truth-based Evaluation](https://arxiv.org/abs/2604.17717). Bilal, Ali, Kumar, Zaffar, Shaon, Gehani, Rahaman, 2026 (arXiv v2, 2026-04-21), preprint.
    - Quote: "dynamic analysis-based debloaters (Blade, Chisel, Cov, Razor) can inadvertently remove up to 94% of code that should be retained"; "essential error logging and handling functions are frequently removed since they are very difficult to exercise with test cases. In multi-threaded programs, we found these debloaters often remove critical thread synchronization primitives".
    - Verified in the PDF.
  - [JavaScript Dead Code Identification, Elimination, and Empirical Assessment](https://arxiv.org/abs/2308.16729). Malavolta et al., IEEE TSE 2023, peer-reviewed.
    - Quote: "UFFRemover (I) is the tool with the highest precision (mean=0.949). This result is expected since the interaction scripts we developed ... are covering all primary functionalities of the analysed TodoMVC web apps".
    - Verified.
  - [Is Static Analysis Able to Identify Unnecessary Source Code?](https://www.se.cs.uni-saarland.de/publications/docs/HNR+19.pdf). Haas et al., 2020, peer-reviewed.
    - Quote: "even core features may be used only rarely (for example, annual financial statement functionality in business applications ...)"; "error handling, recovery, or migration code is considered as useful even if it is not (regularly) executed."
    - Verified.
  - [HN comment by kortilla on the Sensenmann thread](https://news.ycombinator.com/item?id=35759063). Hacker News, 2023-04-30, practitioner forum.
    - Quote: "This is how you end up deleting stuff only called in rare but critical cases: - during outage - at end of year - during audits".
    - Verified.
- **Detect:**
  - Collect coverage with per-test contexts (coverage.py `dynamic_context = test_function`; `go test -coverprofile`; c8/istanbul) for the unit, integration and smoke suites.
  - A candidate with at least one covered line is LIVE.
  - Uncovered candidates matching `catch|except|rescue|recover|fallback|retry|migrat|rollback|cron|schedule|yearly|monthly` go to REPORT.
- **Tools:** coverage.py, pytest-cov --cov-context=test, go test -coverprofile, c8/istanbul, Playwright/Cypress smoke runs
- **Applies to:** All languages.
- **When not to apply / counterpoints:**
  - A Google engineer on HN summarises Google's stance as "if you liked it, then put a test on it". That argues for adding tests, not for deleting code that coverage misses.
  - Coverage tools can themselves miss calls made through interfaces or dynamic loading (SE answer 371676).
- **Fix risk:** low

### G102-F08: Use git history as context and as a veto, never as proof that code is dead
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:**
  - (a) Code that became dead recently or on an active branch goes to REPORT, since it may be work in progress.
  - (b) If the last caller was removed in an explicit removal commit (found with `git log -S`) and the code has stayed dead since, raise it from E1 to E2.
  - (c) "Not touched in a long time" is never on its own a reason to delete.
- **Rationale:**
  - Stability predicts deletion poorly. Haas et al.'s stability+centrality recommender reached 2.7% average precision against historical cleanups, and stable code includes "core concepts".
  - In 23 Java apps, most dead methods were born dead and revival is rare, except in 4 apps where developers wrote code ahead of use.
- **Evidence:**
  - [On the spread and evolution of dead methods in Java desktop applications](https://link.springer.com/article/10.1007/s10664-023-10303-0). Caivano et al., EMSE 28:64, 2023 (extends ESEM 2021), peer-reviewed.
    - Quote: "on 13 software applications (out of 23), the %RevivedDeadMethods values are quite small, ranging from 0% (seven cases) to 14.286%. Only in four cases ... higher than 50%"; "The %DeadBornMethods values range in between 66.667% and 100%"; "high median (96.296%) ... %DeadBornMethods"; "developers consciously introduced some dead methods to use them in the subsequent commits".
    - Verified.
  - [Is Static Analysis Able to Identify Unnecessary Source Code?](https://www.se.cs.uni-saarland.de/publications/docs/HNR+19.pdf). Haas et al., 2020, peer-reviewed.
    - Quote: "not all stable code is likely to be unnecessary: core concepts and features are also not modified frequently but are highly relevant"; "our approach has a rather low average precision of 2.7% for identifying code that is to be deleted".
    - Verified.
  - [git-diff documentation](https://git-scm.com/docs/git-diff). Git project, 2026, official docs.
    - Quote: "-S<string> Look for differences that change the number of occurrences of the specified <string> (i.e. addition/deletion) in a file."
    - Verified.
- **Detect:**
  - `git log -S'<symbol>' --format='%h %ad %s' --date=short`
  - `git rev-list --count <orphaning-commit>..HEAD`
  - whether the orphaning commit's message matches `/remove|delete|drop|deprecat|cleanup/`
  - `git log -1 --format=%ad -- <file>` (context only)
- **Tools:** git log -S, git rev-list, git blame
- **Applies to:** All languages under version control.
- **When not to apply / counterpoints:**
  - The revival data comes from small OSS Java desktop apps and one research group.
  - Squash merges hide when a symbol became dead.
  - No source gives a threshold for N commits.
- **Fix risk:** low

### G102-F10: Never delete a library's unused public API on static evidence; in an application, un-export first, then delete once the compiler proves the symbol unused
- **Grade:** B · **Verdict:** VERIFIED (a nuance about Knip's fix scope was added).
- **Rule:**
  - **Libraries** (package.json `exports`/`main`, Rust `pub` in a lib crate, exported Go identifiers of an importable package, public Python names): REPORT. Remove only by deprecating first, then in a major release.
  - **Applications:**
    1. Run `knip --fix-type exports`, which removes the `export` keyword.
    2. Let the compiler prove the now-local symbol unused.
    3. Delete it in a separate commit.
- **Rationale:**
  - SemVer requires a major version bump for incompatible public-API changes and asks for at least one minor release carrying the deprecation.
  - Go `deadcode` "can't start from a library package". Run on a module, it reports public API as unreachable (golang/go#66073, still open).
  - Knip does not report unused exports of entry files by default.
- **Evidence:**
  - [Semantic Versioning 2.0.0](https://semver.org/). Tom Preston-Werner, 2013, standard.
    - Quote: "Major version X (X.y.z | X > 0) MUST be incremented if any backward incompatible changes are introduced to the public API."; FAQ: "there should be at least one minor release that contains the deprecation".
    - Verified.
  - [golang/go#66073](https://github.com/golang/go/issues/66073). Opened by mvdan, 2024-03-02, open, issue tracker.
    - Quote: "When I run it on a public Go module, such as https://github.com/mvdan/sh, I see a lot of output that doesn't seem right to me" … "interp/api.go:332:6: unreachable func: CallHandler".
    - Verified.
  - [Knip Auto-fix](https://knip.dev/features/auto-fix). Knip docs, 2026, official docs.
    - Quote: "Remove export keyword for unused exports, re-exports, and exported types"; "Use a VCS (version control system) like Git to review and undo changes as necessary."
    - Verified. The same fix list also includes "Remove unused enum and namespace members", which deletes declarations outright.
  - [SE answer 371690](https://softwareengineering.stackexchange.com/questions/371671/code-coverage-highlights-unused-methods-what-should-i-do). Software Engineering StackExchange, 2018-05-28, practitioner forum.
    - Quote: "If the methods are public and unneeded, removing them will be a breaking change and if the library follows semantic versioning, this is only allowed in a new major version."
    - Verified via the SE API.
- **Detect:**
  - Library detection: package.json `exports`/`main`/`types`; `[lib]` in Cargo.toml; published on PyPI, npm or crates.io.
  - For apps: `knip --fix-type exports`, then `tsc --noEmit` or `cargo build`, then delete what the compiler now flags.
- **Tools:** knip --fix-type exports, tsc, rustc, cargo-semver-checks (the repo exists and is active; its behaviour was not tested here)
- **Applies to:** TS/JS, Rust, Go, Python packages.
- **When not to apply / counterpoints:**
  - Private monorepos where every consumer is analysed together (Knip workspaces) can treat internal packages like application code.
  - Un-exporting breaks deep-path or dynamic importers.
- **Fix risk:** medium

### G102-F11: Delete unused files only as a reviewed BATCH, after configuration hints are resolved, generated files exist, the grep is clean and build/tests/app start are green
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:**
  - Never delete files on a first, unconfigured run.
  - Keep `--allow-remove-files` as an explicit opt-in.
  - Files in directories that a framework loads by convention (routes/pages, migrations, models, fixtures, `__mocks__`) go to REPORT.
- **Rationale:** Knip defines unused files as project files minus the entry and resolved files. It lists missing generated files, dynamic imports, unsupported script arguments, missing or incomplete plugins, and auto-mocks/auto-imports as common causes of false "unused" files. Getting unused files right "trickles down" into the other issue types.
- **Evidence:**
  - [Knip: Resolve reported issues](https://knip.dev/guides/handling-issues). Knip docs, 2026, official docs.
    - Quote: "unused files = project files - (entry files + resolved files)"; "Common causes for unused files include: Missing generated files Dynamic import specifiers Unsupported arguments in scripts Unsupported file formats Missing plugin Incomplete plugin ... Auto-mocking or auto-imports".
    - Verified.
  - [Knip Auto-fix](https://knip.dev/features/auto-fix). Knip docs, 2026, official docs.
    - Quote: "Add --allow-remove-files to allow Knip to remove unused files".
    - Verified.
- **Detect:**
  - Run `knip --files --reporter json` once `knip` shows no configuration hints, after a generate/build step.
  - Per file: `git grep -n -e <basename> -e <relative-path>`, and check the path against the convention globs.
- **Tools:** knip, git grep, framework build
- **Applies to:** TS/JS applications; the same idea applies to Python modules and Go files.
- **When not to apply / counterpoints:** Knip's author says surprising reports are usually configuration gaps, so a well-configured run might justify DELETE. No independent measurement of Knip's file-level precision was found.
- **Fix risk:** medium

### G102-F12: Remove unused dependencies only as a separate commit per ecosystem, after a precise tool mode, a name+import grep and a clean install/build/test/start
- **Grade:** B · **Verdict:** CORRECTED.
  - The depcheck study is now peer-reviewed (JSS 2025).
  - The Maven study was published in EMSE 2021; the arXiv version is from 2020.
  - The trace-based tool only "potentially misclassifies" the 20 CLI dependencies; this was not confirmed.
  - The cargo-udeps nightly requirement and doc-test blind spot were added.
  - cargo-machete's `--with-metadata` mitigation was added.
- **Rule:**
  - Prefer the precise modes: `knip --production --strict`; `cargo +nightly udeps` (it compiles) or `cargo shear --expand`, over regex-based cargo-machete; `deptry` for runtime dependencies.
  - Dependencies referenced from config or plugin strings, CLI binaries, peer dependencies, dynamically loaded dependencies and doc-test-only dependencies go to REPORT.
  - Misfiled test dependencies are *moved* to dev dependencies, not deleted.
- **Rationale:**
  - depcheck: 84 of 162 were safely removable; 40 were misclassified because of dynamic loading; 38 were test tools misfiled as runtime dependencies.
  - cargo-machete calls itself "imprecise".
  - Maintainers do accept evidence-backed removals: 18 of 21 answered DepClean PRs were merged.
- **Evidence:**
  - [Detecting and removing bloated dependencies in CommonJS packages](https://arxiv.org/abs/2405.17939). Liu, Tiwari, Bogdan, Baudry. JSS 2025 (DOI 10.1016/j.jss.2025.112509), peer-reviewed.
    - Quote: "Among these, 20 dependencies are related to command-line tasks, which are not exercised during testing and may present misclassification under DepPrune's methodology"; "84 dependencies that can be safely removed without affecting functionality".
    - Verified.
  - [A Comprehensive Study of Bloated Dependencies in the Maven Ecosystem](https://arxiv.org/abs/2001.07808). Soto-Valero, Harrand, Monperrus, Baudry. EMSE 2021 (arXiv 2020), peer-reviewed.
    - Quote: "18/21 answered pull requests were accepted and merged by developers, removing 131 dependencies in total."
    - Verified (abstract).
  - [cargo-machete README](https://github.com/bnjbvr/cargo-machete). Benjamin Bouvier, 2026, official docs.
    - Quote: "in a fast (yet imprecise) way"; "If there are too many false positives, consider using the `--with-metadata` CLI flag".
    - Verified.
  - [cargo-udeps README](https://github.com/est31/cargo-udeps). est31, 2026, official docs.
    - Quote: "it needs Rust nightly to actually run"; "Used only in doc-tests, which `cargo-udeps` cannot check."
    - Verified.
  - [deptry Rules & Violations (DEP002)](https://deptry.com/rules-violations/). osprey-oss/deptry, 2026, official docs.
    - Quote: "Dependencies that are required in a project, but are not used within the codebase. Note Development dependencies are not considered for this rule".
    - Verified.
- **Detect:**
  - Run `knip --dependencies --production --strict`, `cargo +nightly udeps` or `cargo shear --expand`, and `deptry .`.
  - Per candidate: `git grep -n -e '<pkg-name>' -e '<import-name>' -- '*.json' '*.y*ml' '*.toml' '*.cfg' '*.js' '*.cjs' '*.mjs' '.github/**' 'Dockerfile*' 'Makefile'`.
  - Then a frozen-lockfile install, build, test and app start.
- **Tools:** knip, depcheck, deptry, cargo-udeps, cargo-shear, cargo-machete, pnpm/npm/pip/cargo
- **Applies to:** npm/pnpm, PyPI and Cargo ecosystems.
- **When not to apply / counterpoints:** Removing a direct dependency can change how transitive dependencies resolve and what the lockfile contains. That is why this stays a separate commit that is easy to revert.
- **Fix risk:** medium

### G102-F13: Stale feature flags: REPORT unless the live value is known; never repurpose an old flag
- **Grade:** B · **Verdict:** VERIFIED (Fowler article dated to its first publication in 2016, last revised 2017-10-09).
- **Rule:**
  - Without the deployed value (remote config, env, database), REPORT the flag and describe both branches.
  - Delete a branch only when the flag is a compile-time or in-repo constant with no override path. Remove the dead branch, the flag declaration and the pinned test variants together in one BATCH commit.
- **Rationale:**
  - Piranha needs the flag, its treatment behaviour and its owner as input: static code alone does not say which branch is live. With that input, 65% of its diffs landed without changes, and over 85% compiled and passed tests. Each diff was still reviewed by the flag owner.
  - Knight Capital's callable dead code plus a repurposed flag caused the 2012 incident.
- **Evidence:**
  - [Piranha: Reducing Feature Flag Debt at Uber](https://manu.sridharan.net/files/ICSE20-SEIP-Piranha.pdf). Ramanathan, Clapp, Barik, Sridharan. ICSE-SEIP 2020, peer-reviewed.
    - Quote: "Piranha takes as input: the stale flag under consideration, the treatment behavior, and the owner of the flag"; "generated code cleanup diffs for 1381 flags (17% of total flags), (b) 65% of the diffs landed without any changes, (c) over 85% of the generated diffs compile and pass tests successfully"; "Obsolete tests related to the flag should also be deleted."
    - Verified.
  - [SEC Release No. 34-70694 (Knight Capital)](https://www.sec.gov/files/litigation/admin/2013/34-70694.pdf). U.S. SEC, 2013, incident report.
    - Quote: "Despite the lack of use, the Power Peg functionality remained present and callable at the time of the RLP deployment. The new RLP code also repurposed a flag that was formerly used to activate the Power Peg code."
    - Verified. The trigger was also a deployment miss: one of eight servers did not get the new code.
  - [Feature Toggles (aka Feature Flags)](https://martinfowler.com/articles/feature-toggles.html). Pete Hodgson (martinfowler.com), 2016 (revised 2017), engineering blog.
    - Quote: "Savvy teams view the Feature Toggles in their codebase as inventory which comes with a carrying cost and seek to keep that inventory as low as possible."; teams use "expiration dates" and "time bombs".
    - Verified.
- **Detect:**
  - Find flag reads: rg `isEnabled\(|getFlag\(|featureFlags\.|process\.env\.FEATURE_`, or ast-grep patterns.
  - Per flag: locate every override source, run `git log -S<flag>`, and find tests pinning either value.
  - polyglot-piranha can do the rewrite once the value is known.
- **Tools:** polyglot-piranha, ast-grep, rg, git log -S
- **Applies to:** Any project with flags, experiments or kill switches.
- **When not to apply / counterpoints:** Permanent operational kill switches look stale but are live safety controls. REPORT them, never delete them.
- **Fix risk:** high

### G102-F18: Make every deletion easy to reverse and keep a report-now, delete-later list; do not add tombstones or scream tests automatically
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:**
  - (a) One deletion class per commit, rate-limited.
  - (b) A candidate list in the report: class, E-level, tool output, grep result, git evidence, and why the item was not deleted.
  - (c) Tombstones, deprecation logging and scream tests only as an opt-in for deployed, watched services.
- **Rationale:**
  - Industrial deleters rely on reversibility and granularity. SCARF's "quarantine" for code is the deletion commit itself, followed by a waiting period during which it can be reverted. SCARF rate-limits patches.
  - Tombstones only work in production. Deprecation warnings "rarely lead to migration".
- **Evidence:**
  - [Dead Code Removal at Meta](https://users.encs.concordia.ca/~pcr/paper/Shackleton2023FSE-industry-preprint.pdf). Shackleton et al., 2023, peer-reviewed.
    - Quote: "For code, quarantine means landing a commit to remove the code. This quarantine is performed transactionally ... Once quarantine has been completed, a further waiting period is initiated ... engineers can revert the quarantine"; "CodemodService also ensures that no single Config generates too many patches, through a rate-limit system."
    - Verified.
  - [scheb/tombstone README](https://github.com/scheb/tombstone). Christian Scheb, 2026 (PHP library, active), official docs.
    - Quote: "They are executable markers in your code, that you can place where you suspect dead code. Then, you collect tombstone invocations on production."
    - Verified.
  - [Software Engineering at Google, Ch. 15 Deprecation](https://abseil.io/resources/swe-book/html/ch15.html). Hyrum Wright (ed. Tom Manshreck), O'Reilly 2020 / abseil.io, book (free online edition).
    - Quote: "Deprecation warnings can help prevent new uses, but rarely lead to migration of existing systems."; "Logging and runtime sampling in production help discover issues with dynamic dependencies."
    - Verified.
  - [Is Static Analysis Able to Identify Unnecessary Source Code? (Discussion)](https://www.se.cs.uni-saarland.de/publications/docs/HNR+19.pdf). Haas et al., 2020, peer-reviewed.
    - Quote: "deletion of the code from the code base, movement of the code to a special package ... deactivation of the code (i.e., making code unexecutable without deleting it, e.g., by adding a (log) message and returning immediately at the entry point".
    - Verified.
- **Detect:** Run `git log --stat` on the hardening branch. Check that every commit reverts cleanly (`git revert --no-commit`, then build and test). The report must list every candidate that was reported but not deleted.
- **Tools:** git revert, git log --stat
- **Applies to:** All projects; the tombstone opt-in only for deployed services.
- **When not to apply / counterpoints:** "Roll backs are usually very easy" (HN 35758917). That holds in monorepos with fast CI and owners, less so for unowned finished projects.
- **Fix risk:** low

### G102-F20: Run dead-code removal on finished projects, because it has measured benefits, but never trade the matrix's safety conditions for volume
- **Grade:** B · **Verdict:** CORRECTED. The benefits are verified. The priority order (compiler-proven items, then dependencies, then files, then app exports) is the researcher's synthesis, not a finding of any source. The EASE and SEAA papers come from the same group as DCF and the EMSE study.
- **Rule:** Removing dead code is worth doing. A suggested (unsourced) order: compiler-proven items, unused dependencies, whole unused files, application exports.
- **Rationale:**
  - Removing dead methods from 23 Java apps improved internal-structure metrics and reduced compile time and binary size.
  - Eder et al. (reported second-hand): 25% of methods went unused for two years, and 48% of the modifications to them were unnecessary. That was only 3.6% of all maintenance effort.
  - At Meta, 30% of engineers who find the codebase hard to work in cite dead code.
  - Sensenmann has deleted nearly 5% of Google's C++.
- **Evidence:**
  - [A Folklore Confirmation on the Removal of Dead Code (EASE 2024)](https://doi.org/10.1145/3661167.3661188). Romano, Toriello, Cassieri, Francese, Scanniello, 2024, peer-reviewed.
    - Quote: "after removing dead methods, the internal structure of source code significantly improves, while the time to compile source code significantly diminishes as well as the space to store executable code."
    - Verified (abstract via Semantic Scholar; metadata via Crossref).
  - [A Confirmation Study on the Removal of Dead Code from Java Desktop Applications (SEAA 2024)](https://doi.org/10.1109/SEAA64295.2024.00041). Same authors, 2024, peer-reviewed.
    - Quote: "the more dead methods are removed, the greater the improvement to the internal structure of source code and the less space to store executable code."
    - Verified (abstract).
  - [Is Static Analysis Able to Identify Unnecessary Source Code? (Related work)](https://www.se.cs.uni-saarland.de/publications/docs/HNR+19.pdf). Haas et al. reporting Eder et al., 2020, peer-reviewed.
    - Quote: "25% of all methods have been never used over two years ... 48% of the modifications on unused code were unnecessary ... (3.6%)".
    - Verified. Second-hand; the primary paper was not read.
  - [Dead Code Removal at Meta](https://users.encs.concordia.ca/~pcr/paper/Shackleton2023FSE-industry-preprint.pdf). Shackleton et al., 2023, peer-reviewed.
    - Quote: "of engineers who said, 'I find it challenging to work in the codebase', 30% of them cited dead code as the reason."
    - Verified.
  - [Sensenmann: Code Deletion at Scale](https://testing.googleblog.com/2023/04/sensenmann-code-deletion-at-scale.html). Phil Norman, 2023, engineering blog.
    - Quote: "has so far deleted nearly 5% of all C++ at Google".
    - Verified.
- **Detect:** Record lines, files and dependencies removed per class, plus build time and artifact size before and after.
- **Tools:** cloc/tokei, build timers, bundle-size tools
- **Applies to:** All projects.
- **When not to apply / counterpoints:** The benefit of each individual deletion is modest (Eder: 3.6% of maintenance effort). That argues for rejecting any deletion whose risk is not low.
- **Fix risk:** low

### G102-F21: Calibrate trust per tool from its documented soundness
- **Grade:** B · **Verdict:** CORRECTED.
  - cppcheck: `unusedFunction` is invalid only when **multiple threads (`-j`) are used without a Cppcheck build dir**. It is not invalid merely because there is no build dir.
  - vulture's 100% means "guaranteed to be unused within the analyzed files".
- **Rule:**
  - **Go `deadcode`** (main packages, run without `-test`): sound for reflection and interface calls, except for assembly and `go:linkname`. Use it for BATCH after the grep veto. On library-only packages, REPORT.
  - **vulture:** only 100%-confidence items (arguments, unreachable code) come near E0, with the `yield` exception. 60% items are REPORT unless they reach E2.
  - **Knip:** E1 only after hints and plugins are resolved.
  - **cppcheck `unusedFunction`:** needs whole-program analysis.
  - **cargo-machete:** candidates only; confirm with cargo-udeps or cargo-shear.
- **Rationale:** The tools' docs state these limits. An HN user's vulture run on a Flask app produced 192 findings at 60% confidence, "almost entirely false positives".
- **Evidence:**
  - [Finding unreachable functions with deadcode](https://go.dev/blog/deadcode). Alan Donovan, Go Blog, 2023-12-12, official blog.
    - Quote: "In this respect, the tool is sound. In other words, if it reports a function as dead code, it means the function cannot be called even through these dynamic mechanisms."; "Its analysis is not aware of functions called exclusively from assembly code, or of the aliasing of functions that arises from the go:linkname directive."
    - Verified.
  - [vulture README](https://github.com/jendrikseipp/vulture). Jendrik Seipp, 2026, official docs.
    - Quote: "Due to Python's dynamic nature, static code analyzers like Vulture are likely to miss some dead code. Also, code that is only called implicitly may be reported as unused."; "Use `--min-confidence 100` to only report code that is guaranteed to be unused within the analyzed files."
    - Verified.
  - [Cppcheck manual (v2.21.0)](https://cppcheck.sourceforge.io/manual.pdf). Cppcheck team, 2026, official docs.
    - Quote: "Whole program analysis does not work when multiple threads are used unless you use a Cppcheck build dir. For instance, the unusedFunction warnings require whole program analysis."
    - Verified in the PDF text.
  - [HN: Vulture: Find Dead Python Code (comment by caymanjim)](https://news.ycombinator.com/item?id=27059063). Hacker News, 2021-05-06, practitioner forum.
    - Quote: "Vulture reported 192 incidences of unused methods/classes/variables/functions, all at '60% confidence' ... this is almost entirely false positives".
    - Verified.
- **Detect:** Map each finding to a trust tier:
  - deadcode on package main → E1
  - deadcode on a library → REPORT
  - vulture at 100% → E0 candidate (with the exceptions)
  - vulture below 100% → REPORT
  - knip with unresolved hints → REPORT
  - cppcheck `unusedFunction` run with `-j` and no `--cppcheck-build-dir` → REPORT
  - cargo-machete alone → REPORT
- **Tools:** deadcode -whylive, vulture --min-confidence 100, knip, cppcheck, cargo-udeps, cargo-shear
- **Applies to:** Go, Python, TS/JS, C/C++, Rust.
- **When not to apply / counterpoints:** Tool behaviour changes between versions, so revisit the tiers on each tool upgrade. These are the 2026 docs.
- **Fix risk:** low

### G102-F01: Deletion matrix for finished projects without production telemetry
- **Grade:** C · **Verdict:** CORRECTED. The rationale's numbers and characterisations were fixed:
  - Lacuna's 82.5% is a dynamic+static configuration, not a static detector.
  - depcheck's own evaluators count 40 of 162 as misclassified (≈25%); "52%" is only the share that could be deleted as-is.
  - Sensenmann *sends deletion changelists for review*; it does not delete automatically.
  - SCARF's no-human-review path still posts a patch and auto-commits "after a suitable waiting period".
  - The debloating study's author list is now complete, and its context (C program specialisation) is stated.
- **Rule:** Classify each candidate by evidence level (E0–E3) and by action (DELETE / BATCH / REPORT). Grades per cell:
  1. Unreachable statements at E0: DELETE [A]. Generator `yield`s and side-effecting conditions go to REPORT.
  2. Unused locals, parameters and private or file-local symbols at E0: DELETE [A]. Keep side-effecting initializers and signature-required parameters.
  3. Module-level members in dynamic languages flagged only by a tool, at E1: BATCH [C]. If the symbol is in a known false-positive class: REPORT [B].
  4. Unused app exports at E1: un-export them, then delete at E0 [B].
  5. Unused library public API: REPORT; deprecate, then remove in a major release [A].
  6. Unused files at E1, after config hints are fixed: BATCH [B]. Convention-loaded paths: REPORT [B].
  7. Unused dependencies at E1 plus a clean install/build/test/start: BATCH, separate commit [B]. Dependencies used by config, plugins or the CLI: REPORT.
  8. Untagged test-only-reachable code: BATCH with its tests under TE-2/TE-3 [B]. Tagged test-only: KEEP.
  9. Reachable but suspected unused, without E3: REPORT [B].
  10. Stale flags without the deployed value: REPORT [B]. A compile-time constant flag: BATCH [B].
  11. Config keys, env vars, and names used through the DB, routes or strings: REPORT [C].
  12. Any known false-positive class: REPORT unless the tool models it and the evidence reaches E2 [B].
- **Rationale:** The rows reflect three measured limits:
  - (i) Detector precision outside compiler-proven classes. Measured false-positive rates run from about 16% (DCF, self-evaluated) to 68% (UCDetector, independent). The static-only Lacuna of 2018 was at 44%, and depcheck at about 25% misclassified.
  - (ii) 29% of the classes developers confirmed unnecessary were still reachable, so a static detector could not have found them.
  - (iii) Dynamic evidence over-removes.

  Industrial systems pair graph evidence with runtime logs. SCARF auto-commits only for "a hand-curated set of kinds of symbols ... known to not leverage some of the dynamic features (such as reflection)", and sends everything else to review.
- **Evidence:**
  - [Is Static Analysis Able to Identify Unnecessary Source Code?](https://www.se.cs.uni-saarland.de/publications/docs/HNR+19.pdf). Haas, Niedermayr, Roehm, Apel, TOSEM 2020, peer-reviewed.
    - Quote: "29% of the files recommended as unnecessary by our approach were still reachable and therefore could not by detected by a dead code detector. Hence, our approach adds value beyond dead code detection. Furthermore, dead code detection tools have a low precision as only 32% of files deemed unreachable were indeed unnecessary."
    - Verified verbatim.
  - [Dead Code Removal at Meta](https://users.encs.concordia.ca/~pcr/paper/Shackleton2023FSE-industry-preprint.pdf). Shackleton et al. (Meta), ESEC/FSE 2023 industry, peer-reviewed.
    - Quote: "we still generate a patch for review to allow developers to provide feedback, but we allow the CI to commit the changes automatically after a suitable waiting period ... derived from a hand-curated set of kinds of symbols, and symbols pertaining to specific frameworks ... which are known to not leverage some of the dynamic features (such as reflection)".
    - Verified.
  - [Sensenmann: Code Deletion at Scale](https://testing.googleblog.com/2023/04/sensenmann-code-deletion-at-scale.html). Phil Norman, Google Testing Blog, 2023, engineering blog.
    - Quote: "The only real way to know if programs are useful is to check whether they're being run, so for internal binaries ... a log entry is written when a program runs"; its goal is to "send code review requests ('changelists') to delete it".
    - Verified.
  - [Revisiting Code Debloating with Ground Truth-based Evaluation](https://arxiv.org/abs/2604.17717). Bilal, Ali, Kumar, Zaffar, Shaon, Gehani, Rahaman, 2026, preprint.
    - Quote: "dynamic analysis-based debloaters (Blade, Chisel, Cov, Razor) can inadvertently remove up to 94% of code that should be retained".
    - Verified. The context is 11 C programs (GNU coreutils, SIR, nginx) with feature-specialisation ground truth.
- **Detect:**
  - Per candidate, record: class (row 1–12), E-level, tool and rule id, grep result, git result.
  - A CI check fails any deletion commit that contains a candidate whose (class, E-level) cell is REPORT.
- **Tools:** tsc --noUnusedLocals, rustc dead_code, gcc -Wunused-function, ruff F401/F841, knip --production, deadcode, vulture, cargo-udeps, cargo-shear, deptry, git log -S, rg/git grep
- **Applies to:** Finished projects in any language with no production telemetry and possibly no reachable author.
- **When not to apply / counterpoints:**
  - This is a synthesis. No study validates the matrix end to end, and no source gives a numeric certainty threshold.
  - Monorepos with runtime logs (Sensenmann, SCARF) justify far more aggressive deletion.
  - "Delete. Commit. Forget." (SE 371672): its author later added "IDEs are fallible ... Bring in an expert unless you're absolutely sure."
- **Fix risk:** low

### G102-F09: Owner confirmation raises a candidate one evidence level but never replaces the grep veto or the false-positive-class check
- **Grade:** C (down from B) · **Verdict:** CORRECTED. The researcher said "developers judged only 34% of the recommendations unnecessary", which shows the *recommender's* precision, not developer fallibility. That misreading was removed. The evidence that owners are fallible is Haas et al.'s qualitative discussion. On Jenkins: the paper says all developers "except from Jenkins" found at least one recommendation worth deleting. It does not say the Jenkins team "deleted nothing".
- **Rule:**
  - When no owner is reachable, reachable-but-suspected code stays in REPORT.
  - Present candidates to owners in grouped chunks, with the evidence attached.
- **Rationale:**
  - Haas et al.: "even the most experienced developers do not know the whole code base and are therefore unsure", and "the opinion of developers might deviate from reality". They recommend discussing with several team members and combining human judgement with tool support.
  - Sensenmann treats human exceptions as a blocklist within its pipeline.
- **Evidence:**
  - [Is Static Analysis Able to Identify Unnecessary Source Code?](https://www.se.cs.uni-saarland.de/publications/docs/HNR+19.pdf). Haas et al., 2020, peer-reviewed.
    - Quote: "Our study showed that even the most experienced developers do not know the whole code base and are therefore unsure. In such cases, it is better to discuss with several team members whether the code is still relevant."; "the opinion of developers might deviate from reality or developers lack knowledge about a piece of code and its necessity. Hence, we suggest to use a combination of human judgment and tool support".
    - Verified.
  - [Sensenmann: Code Deletion at Scale](https://testing.googleblog.com/2023/04/sensenmann-code-deletion-at-scale.html). Google Testing Blog, 2023, engineering blog.
    - Quote: "it's important to have a blocklisting system so that exceptions can be marked, and we can avoid bothering people with spurious changelists."
    - Verified.
- **Detect:** Each candidate carries a field `owner-confirmed: yes | no | unreachable`. Rows 9–12 without E3 stay REPORT even when confirmed, unless the owner supplies runtime evidence.
- **Tools:** CODEOWNERS, git shortlog -sn -- <path>
- **Applies to:** All projects; especially inherited ones.
- **When not to apply / counterpoints:**
  - In small projects the author may be the only oracle available.
  - A "scream test" is an alternative (HN 35760030: pages were made to always error, and nobody complained), but it is a behaviour change.
- **Fix risk:** low

### G102-F14: Test-edit rule for deletions: tests are read-only by default, with one mechanically checked carve-out for dead-code commits
- **Grade:** C · **Verdict:** CORRECTED.
  - ImpossibleBench: read-only access prevents test *modification* but "does not eliminate other cheating methods".
  - Hora & Robbes' 23% vs 13% measures how often agents touch tests, not cheating.
  - TripRL was misread. It keeps fault detection by including fault-detection ability in its objective, which supports TE-3 rather than contradicting it.
  - Noemmer & Haas' 12.5% is line-coverage-*adequate* greedy minimisation that removed about 70% of tests. Deleting a handful of tests would plausibly cost less.
- **Rule:**
  - **TE-1.** No test file may be deleted or renamed. No test case may be deleted or skipped. No assertion may be added, removed or changed. No skip/xfail/only markers may be added.
  - **TE-2.** In a `refactor(dead-code):` commit that deletes production symbols, a test case may be deleted only if it references at least one production symbol deleted in that commit. Import lines referring only to deleted symbols may also be removed. Everything else stays byte-identical.
  - **TE-3.** Every surviving production line that a deleted test covered must stay covered, checked with per-test contexts. Where mutation testing is available, no mutant in those lines may go from killed to survived. If either check fails, keep the test and demote the deletion to REPORT.
  - **TE-4.** Tagged test seams are never "dead because only tests call them".
- **Rationale:**
  - The read-only default is backed by ImpossibleBench. EvilGenie saw explicit reward hacking by Codex and Claude Code.
  - A carve-out is needed. Without it, code reachable only from tests could never be removed, which is jsnell's point on HN. Sensenmann's fate-sharing and Piranha's third dimension ("Delete tests related to feature flags") both delete tests together with the code.
  - Coverage alone is not enough, per Noemmer & Haas.
- **Evidence:**
  - [ImpossibleBench](https://arxiv.org/abs/2510.20270). Zhong, Raghunathan (CMU), Carlini (Anthropic), 2025, preprint.
    - Quote: "Claude models and Qwen3-Coder, however, cheat primarily (> 79%) through modifying test cases"; "Read-only access provides a middle ground: it restores legitimate performance while preventing test modification attempts. This approach is particularly effective against models like Opus-4.1 ... but it does not eliminate other cheating methods".
    - Verified in the PDF. The setting is deliberately "impossible" tasks.
  - [EvilGenie: A Reward Hacking Benchmark](https://arxiv.org/abs/2511.21654). Gabor, Lynch, Rosenfeld, 2025 (v2 2026), preprint.
    - Quote: "We observe explicit reward hacking by both Codex and Claude Code, and misaligned behavior by all three agents."
    - Verified (abstract).
  - [Are Coding Agents Generating Over-Mocked Tests?](https://arxiv.org/abs/2602.00409). Hora, Robbes, 2026, preprint.
    - Quote: "23% of commits made by coding agents add/change test files, compared with 13% by non-agents".
    - Verified (abstract). This is test *activity*, not cheating, so it is weak support.
  - [Sensenmann: Code Deletion at Scale](https://testing.googleblog.com/2023/04/sensenmann-code-deletion-at-scale.html). Google Testing Blog, 2023, engineering blog.
    - Quote: "Being able to identify cases like the LZW example, with one test and two libraries, is likely to involve processing test coverage data, and has not yet been explored."
    - Verified.
  - [Piranha: Reducing Feature Flag Debt at Uber](https://manu.sridharan.net/files/ICSE20-SEIP-Piranha.pdf). Ramanathan et al., 2020, peer-reviewed.
    - Quote: "(3) Delete tests related to feature flags."; "sometimes it is unclear whether the test can be discarded in its entirety because the functionality is removed, or specific state changes within the body of the test needs to be removed".
    - Verified.
  - [An Evaluation of Test Suite Minimization Techniques](https://teamscale.com/hubfs/26978363/Publications/2020-test-suite-minimization-swqd.pdf). Noemmer, Haas. SWQD 2020, LNBIP (DOI 10.1007/978-3-030-35510-4_4), peer-reviewed.
    - Quote: "the size and execution time of all the test suites can be reduced by over 70% on average. However, there is a substantial loss in fault detection capability of, on average, around 12.5%".
    - Verified. The average of Table 2 (line-coverage-adequate greedy, 7 Java projects) is 12.5%, with a range of 3.5–21%.
  - [HN comment by jsnell](https://news.ycombinator.com/item?id=35757992). Hacker News, 2023-04-29, practitioner forum.
    - Quote: "You'll end up keeping dead code just because it has tests, and delete code that's still used in prod just because it happened to be untested."
    - Verified.
- **Detect:** See F15. For manual review: `git diff --cached --name-status --diff-filter=DMR -- <test globs>`. Any output outside a `refactor(dead-code):` commit is a violation.
- **Tools:** git diff, ast-grep/tree-sitter, coverage.py contexts, Stryker/mutmut/cargo-mutants/PIT
- **Applies to:** All languages; agent-driven hardening runs in particular.
- **When not to apply / counterpoints:**
  - [TripRL (arXiv 2408.13517; TOSEM 2025)](https://arxiv.org/abs/2408.13517) keeps "the original statement coverage and fault detection ability", but only because fault-detection ability is one of its minimisation criteria. So it is not evidence that coverage alone suffices.
  - Mutation testing can be too slow for large suites.
  - No source evaluates this exact guard.
- **Fix risk:** medium

### G102-F15: Enforce the test-edit rule with a diff guard, run as a pre-commit hook and again in CI
- **Grade:** C · **Verdict:** VERIFIED. Every tool behaviour cited is documented; the guard as a whole is a synthesis.
- **Rule:** The guard runs these steps:
  1. Classify changed paths with the project's test globs. For inline Rust `#[cfg(test)]` modules, use AST detection.
  2. If a test path has status D, R or M and the commit message lacks `refactor(dead-code):`, reject.
  3. Build DeletedSyms from the pre-image and post-image of changed production files, using tree-sitter or ast-grep.
  4. For each test file:
     - every removed test case must reference a name in DeletedSyms;
     - every surviving test case must be byte-identical;
     - every removed import specifier must be in DeletedSyms;
     - the count of assertion nodes in surviving tests must not change.
  5. Coverage check: run the suite on the baseline with per-test contexts and record L, the set of surviving production lines covered by any deleted test. On the candidate commit, every line in L must still be covered.
  6. Optional mutation check on the files containing L. Pass those files explicitly to the tool.
- **Rationale:**
  - git's `--diff-filter` selects paths by status.
  - coverage.py dynamic contexts answer "what test ran this line?".
  - Stryker's incremental mode reuses a Killed result only if "the culprit test still exists, and it didn't change". So deleting a test that killed a mutant forces that mutant to be re-run.
  - cargo-mutants' in-diff mode ignores diffs that only touch tests. That is why step 6 passes the production files explicitly.
- **Evidence:**
  - [Coverage.py 7.16.1: Measurement contexts](https://coverage.readthedocs.io/en/latest/contexts.html). Ned Batchelder, 2026, official docs.
    - Quote: "They are most commonly used to answer the question 'what test ran this line?'"; "Set it to test_function to start a new dynamic context for every test function"; "The pytest plugin pytest-cov has a --cov-context option".
    - Verified.
  - [StrykerJS Incremental mode](https://stryker-mutator.io/docs/stryker-js/incremental/). Stryker Mutator, 2026, official docs.
    - Quote: "Reuse is possible when: A mutant was 'Killed'; the culprit test still exists, and it didn't change."
    - Verified.
  - [cargo-mutants: Testing code changed in a diff](https://mutants.rs/in-diff.html). cargo-mutants docs, 2026, official docs.
    - Quote: "a diff that only deletes or changes test code won't cause any mutants to run, even though it may have a very material effect on test coverage."
    - Verified.
  - [git-diff documentation](https://git-scm.com/docs/git-diff). Git project, 2026, official docs.
    - Quote: "--diff-filter=[(A|C|D|M|R|T|U|X|B)...[*]] Select only files that are Added (A), Copied (C), Deleted (D), Modified (M), Renamed (R)...".
    - Verified.
- **Detect:**
  - `git diff --cached --name-status -M --diff-filter=DMR`
  - `git show :path` and `git show HEAD:path` for the after and before versions
  - `ast-grep scan --json`
  - `pytest --cov --cov-context=test`, then `coverage json --show-contexts`
  - `npx stryker run --incremental`, `cargo mutants --file <f>`, `mutmut run --paths-to-mutate <f>`
- **Tools:** git, ast-grep, tree-sitter, coverage.py, pytest-cov, c8, StrykerJS, mutmut, cargo-mutants, PIT
- **Applies to:** Repositories where an agent runs the hardening skill; CI for human contributors too.
- **When not to apply / counterpoints:**
  - Table-driven Go tests, parametrised pytest and snapshot files do not map to one AST node per test case. Treat each row or snapshot as a case, or fall back to REPORT.
  - Per-test line attribution for JS, Go and Rust was not verified.
- **Fix risk:** low

### G102-F17: Config keys, env vars and names used through routes, databases or strings: static absence of reads is never enough; REPORT with the grep evidence
- **Grade:** C · **Verdict:** VERIFIED
- **Rule:** Never delete env var entries from `.env.example`, manifests or CI just because no `process.env.X` or `os.environ['X']` read exists in the code.
- **Rationale:**
  - No empirical study of unused config keys exists.
  - Libraries read environment variables implicitly: requests reads CA bundle and proxy variables; AWS SDKs check environment variables, including `AWS_PROFILE`.
  - SCARF lists "table names stored in a database instead of in code" among the usages static analysis misses.
- **Evidence:**
  - [Requests: Advanced Usage](https://requests.readthedocs.io/en/latest/user/advanced/). requests docs, 2026, official docs.
    - Quote: "This list of trusted CAs can also be specified through the REQUESTS_CA_BUNDLE environment variable. If REQUESTS_CA_BUNDLE is not set, CURL_CA_BUNDLE will be used as fallback."; proxies come from "standard environment variables http_proxy, https_proxy, no_proxy, and all_proxy".
    - Verified.
  - [AWS SDKs and Tools settings reference](https://docs.aws.amazon.com/sdkref/latest/guide/settings-reference.html). AWS, 2026, official docs.
    - Quote: "The environment variable is checked. If it's set, that value is used to configure the client."; "The AWS_PROFILE environment variable ... can be used to specify which profile that the SDK loads."
    - Verified.
  - [Dead Code Removal at Meta](https://users.encs.concordia.ca/~pcr/paper/Shackleton2023FSE-industry-preprint.pdf). Shackleton et al., 2023, peer-reviewed.
    - Quote: "table names stored in a database instead of in code".
    - Verified.
- **Detect:** Collect env var names from `.env.example`, compose files, k8s manifests and CI env blocks. Grep each one across the repo. Report the ones with no hits; never auto-delete.
- **Tools:** rg, git grep, dotenv files, helm/kubectl templates
- **Applies to:** All deployed projects.
- **When not to apply / counterpoints:** Truly orphaned keys do add confusion. Removing them is reasonable when an owner with deployment access confirms it, in a separate commit.
- **Fix risk:** high

### G102-F19: An LLM's judgement that code "looks unused" is not evidence at any level
- **Grade:** C (down from B) · **Verdict:** DOWNGRADED. The sources are real and quoted correctly, but they support the rule only indirectly:
  - DCE-LLM shows that the best LLM detector was trained on tool labels, which is not the same as showing that LLM judgement is wrong on real projects.
  - The Skylos preprint has a declared conflict of interest.
  - No study measures LLM or agent dead-code deletion at project level.
- **Rule:** Only compiler results, tool output, grep results, execution data, git history and owner statements count as evidence. Block the agent failure mode of deleting a failing test or feature.
- **Rationale:**
  - DCE-LLM (NAACL 2025) uses Vulture and IntelliJ output as gold labels. It works on online-judge snippets and truncates input to CodeBERT's 512 tokens, so it operates at line level. It therefore inherits the tools' blind spots.
  - The Skylos preprint reports zero labelled false positives only because its policy abstains on risky deletions.
  - The HN comments describe agents deleting tests or features.
- **Evidence:**
  - [DCE-LLM: Dead Code Elimination with Large Language Models](https://aclanthology.org/2025.naacl-long.501.pdf). Chen, Li, Wu, Liu (SJTU), NAACL 2025, peer-reviewed.
    - Quote: "we treat the unused code identified by these tools as gold-standard labels for our dataset"; "this work focus on line-level dead code elimination instead of method-level"; "DCE-LLM achieves over 94% F1 scores for unused and unreachable code".
    - Verified in the PDF.
  - [Evidence Calibrated Dead Code Detection for Python Framework Patterns](https://www.researchsquare.com/article/rs-9609115/v1). Aaron Oh, Research Square, posted 2026-05-27, preprint.
    - Quote: "classifies symbols as likely dead, alive, or uncertain ... the final reporting policy abstains when a standalone deletion would be risky. Under open label action scoring, the final variant has zero labeled false positives across five suites".
    - Verified. The declared competing interest reads: "The author is the creator of Skylos".
  - [HN comment by wongarsu on "Lessons from interviews on deploying AI Agents in production"](https://news.ycombinator.com/item?id=45809242). Hacker News, 2025-11-04, practitioner forum.
    - Quote: "In coding agents that would be 'the test keeps failing and I can't fix it - let's delete the test' or 'I can't fix this bug, let's delete the feature'".
    - Verified.
- **Detect:** Every deletion in the skill's commit links to an evidence record (tool output, grep result, E-level). A rationale that is only prose ("appears unused") is rejected.
- **Tools:** the F15 hook, a report schema
- **Applies to:** Agent-executed hardening runs.
- **When not to apply / counterpoints:** LLMs are useful for triaging tool output, for example explaining likely reflective use or grouping candidates, as long as the decision rests on non-LLM evidence.
- **Fix risk:** low

### G102-F16: When a non-public symbol that tests import is renamed, the only permitted test-file edits are identifier substitutions
- **Grade:** D · **Verdict:** VERIFIED. The sources are real and quoted correctly; the guard itself is unvalidated.
- **Rule:**
  - For each changed hunk in a test file, take the pre-image, substitute the old identifier with the new one, and compare it to the post-image. They must be equal.
  - Prefer LSP renames (tsserver, rust-analyzer, pyright).
  - Tag imported internals as test-only seams.
- **Rationale:** Renames legitimately touch tests, but they must not become a channel for changing assertions. That channel is exactly the cheating mode ImpossibleBench documents. Knip documents `@internal` for internals that are tested.
- **Evidence:**
  - [Knip JSDoc & TSDoc Tags](https://knip.dev/reference/jsdoc-tsdoc-tags). Knip docs, 2026, official docs.
    - Quote: "In general it's not recommended to expose and test implementation details, but exceptions are possible. Those should not be reported as false positives, so when using production mode you'll need to help Knip out by tagging them as @internal."
    - Verified.
  - [ImpossibleBench](https://arxiv.org/abs/2510.20270). Zhong, Raghunathan, Carlini, 2025, preprint.
    - Quote: "Modify Test Cases: The model directly modifies tests despite being explicitly instructed not to."
    - Verified.
- **Detect:** Run `git diff -U0 --word-diff=porcelain` on each modified test file and check that every changed word pair is (old_name, new_name). Alternatively, compare tree-sitter token streams after substitution.
- **Tools:** git diff --word-diff, tree-sitter, tsserver/rust-analyzer/pyright rename
- **Applies to:** All languages; renames of private or internal symbols.
- **When not to apply / counterpoints:** Some renames legitimately change string literals, such as error messages or snapshot names. Send those to human review.
- **Fix risk:** low

## Practitioner voice
All items were re-opened on 2026-09-23: HN via the Firebase API, SE via the StackExchange API, Reddit via a Wayback snapshot.
- [kortilla on Sensenmann](https://news.ycombinator.com/item?id=35759063): deleting code that was not hit recently removes code used only in rare but critical cases (outages, year-end, audits, one special customer). "3 months is an eye blink in the business and govt world."
- [jsnell on Sensenmann](https://news.ycombinator.com/item?id=35757992): using tests as the liveness signal is backwards. "You'll end up keeping dead code just because it has tests, and delete code that's still used in prod just because it happened to be untested."
- [dekhn on Sensenmann](https://news.ycombinator.com/item?id=35757803): an engineer who updated Google's internal numpy says Google's answer to Chesterton's Fence is "if you liked it, then put a test on it". He "shed a tear" when his unused code was auto-deleted, but agrees HEAD should contain only what is necessary.
- [kgeist on Sensenmann](https://news.ycombinator.com/item?id=35760030): his team inherited a 14-year-old internal monolith and mined 3 months of access logs for unused endpoints. An earlier scream test made pages always error, and nobody complained. A human stays in the loop, and git makes the change revertible.
- [opportune on Sensenmann](https://news.ycombinator.com/item?id=35768205): build or test breakage from a deletion is known before commit, and anything that slips through is easy to roll back. A true deletion needs "a ton of justified hoops".
- [compiler-guy on Sensenmann](https://news.ycombinator.com/item?id=35758917): "Roll backs are usually very easy."
- [caymanjim on vulture](https://news.ycombinator.com/item?id=27059063): on a lint-clean, well-tested Flask app, vulture gave 192 findings at 60% confidence, "almost entirely false positives". People build giant whitelists for Flask and Django.
- [richardxia on vulture](https://news.ycombinator.com/item?id=27059218): generate a whitelist from main and run vulture on the feature branch, so only newly introduced dead code is flagged.
- [Reddit r/learnprogramming: "Ever removed 'unused' code… and instantly took down prod?"](https://www.reddit.com/r/learnprogramming/comments/1lbuach/ever_removed_unused_code_and_instantly_took_down/): commenting out a "truly unused" legacy function broke a critical admin tool. It was called through a string path in a config file, with "no type checks, no linter warnings". Another developer describes class and method names stored in a database and invoked through reflection. (Read via Wayback, 2025-08-01.)
- [SE 371671: Code coverage highlights unused methods](https://softwareengineering.stackexchange.com/questions/371671/code-coverage-highlights-unused-methods-what-should-i-do):
  - The accepted "Delete. Commit. Forget." answer later added "IDEs are fallible ... Bring in an expert unless you're absolutely sure."
  - Other answers: removing public library methods is a SemVer-major change; coverage tools can miss interface calls and dynamic loading; do a textual search and ask colleagues first.
- [SE 347692: marking reflection-invoked methods](https://softwareengineering.stackexchange.com/questions/347692/best-practice-to-mark-a-method-that-is-called-via-reflection): answers suggest `[UsedImplicitly]`, or `@SuppressWarnings("unused")` plus a comment, and unit tests that exercise the reflective call so that renaming or deleting it breaks the build.
- [wongarsu on AI agents in production](https://news.ycombinator.com/item?id=45809242): agents under pressure do "let's delete the test" or "let's delete the feature", and proxy success metrics hide the failure.
- [lemming on agent behaviour](https://news.ycombinator.com/item?id=45145334): wants the agent stopped as soon as it says "let me try another approach", because "right after that ... tests get deleted".
- [vulture #422](https://github.com/jendrikseipp/vulture/issues/422): a "100% confidence" finding on an unreachable `yield` is wrong to delete, because removing it turns an async generator into a coroutine.
- [golang/go#66073](https://github.com/golang/go/issues/66073): Go `deadcode` run on a public library module lists its exported API as unreachable. The maintainer asks for a "library" mode that treats exposed APIs as roots.
- [SEC order on Knight Capital](https://www.sec.gov/files/litigation/admin/2013/34-70694.pdf): Power Peg code, disused since 2003, stayed callable. The new code repurposed its flag, and the one server missed by the deploy ran the old code. The result was 4 million executions in about 45 minutes.
- [Meta: Automating dead code cleanup](https://engineering.fb.com/2023/10/24/data-infrastructure/automating-dead-code-cleanup/): Meta admits that misunderstood dynamic references sometimes lead to incorrect deletions that "can make it to production". It therefore keeps a BigGrep text veto that accepts false negatives to avoid false positives.

## Contradictions and open questions

**Contradictions**
- **Read-only tests vs deleting the tests of dead code.**
  - For read-only: T09, T10, T12, T31, and ImpossibleBench. Read-only access stops test *modification*, though "it does not eliminate other cheating methods".
  - For deleting tests with the code: Sensenmann's fate-sharing and Piranha's third cleanup dimension.
  - Resolution: read-only by default, plus the narrow, mechanically checked carve-out in F14/F15. No source evaluates that carve-out.
- **How much fault detection test reduction costs.**
  - Noemmer & Haas: about 12.5% loss (3.5–21%) with line-coverage-adequate greedy minimisation.
  - TripRL: no loss, but only because fault-detection ability is one of its minimisation criteria.
  - So the two are consistent. Coverage alone loses fault detection; fault-detection-aware reduction keeps it. That supports TE-3's mutation clause. *(The researcher's framing of this as a contradiction was corrected.)*
- **Knip's docs vs its tracker.** The docs say a surprising result is "usually a real finding or a configuration gap". The tracker has 172 issues mentioning false positives. Many of them are closed (fixed by plugin or resolver updates), so the count is not a precision measure. Independent measurements of comparable static JS tools are low: depcheck ≈25% misclassified (only 52% could be deleted as-is); the static-only 2018 Lacuna reached 56% precision.
- **Static vs dynamic evidence.** Static debloaters over-retain and dynamic ones over-remove (2026 study, C programs). Lacuna's best configuration combines both. For preserving behaviour, false removals cost more than false retentions.
- **"Delete. Commit. Forget." vs caution.** On one side: git as the safety net (the SE accepted answer, HN "roll backs are usually very easy", Meta's auto-landed deletions). On the other: rare-but-critical paths (HN kortilla; Haas' annual-statement example; Meta admits wrong deletions reached production).
- **Revival is bimodal.** Dead methods are "rarely revived" (0–14% in 13 of 23 apps), but in 4 of 23 apps more than 50% were revived because developers wrote them ahead of use.
- **Test-only code.** Sensenmann, Knip production mode and Engels treat code used only by tests as removable. Knip's `@internal`, Guava's `@VisibleForTesting` and Engels' test-only values treat some of it as legitimate seams. Structure alone cannot tell the two apart.
- **The precision numbers are not comparable.**
  - UCDetector's 32%: independent, but on classes pre-selected by a recommender.
  - DCF's 84% and Lacuna's 82.5%: measured by the tools' own authors on their own gold standards.
  - depcheck: independent, 91 CommonJS packages.
  - None is a random-sample precision on real projects.

**Open questions**
- No independent precision or recall figures exist, as of 2026-09, for Knip, whole-project vulture, Go `deadcode`, deptry, cargo-shear, cargo-machete or cargo-udeps.
- No source gives a quantitative certainty threshold for deleting without runtime evidence (T30).
- No study evaluates the TE-2/TE-3 test-deletion guard or the F16 rename guard: neither their false-block rate nor their cost.
- Per-test line attribution for Vitest/Jest (c8/istanbul), Go and Rust was not verified.
- No empirical study of unused config keys or env vars was found. Matrix row 11 rests on documented implicit consumers and anecdotes.
- No 2025–2026 study measures the correctness of LLM or agent dead-code deletion on real projects.
- The figures from Eder et al. (ICSM 2012) were read only second-hand, in Haas et al.
- No source sets the number of commits or the amount of time that should pass before git history counts as corroboration.
- *Added by the verifier:* compiler "proofs" hold per build configuration (cfg, `#ifdef`, Cargo features, targets), and compiler lints can themselves regress (rustc 1.80 #128272). How to run E0 checks across all configurations is unsourced.

## Dropped findings
None. All 21 findings had real, openable sources that support at least a narrowed version of the claim. The main misstatements were fixed in place:
- the "owner right 34% of the time" misreading (F09)
- depcheck's precision framing (F01, F02)
- "independent" DCF and Lacuna numbers (F02)
- the TripRL misreading (F14)
- the cppcheck condition (F21)
- the vulture #422 date (F03)
