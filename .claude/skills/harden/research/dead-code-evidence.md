# Dead code: evidence, definitions and safe removal
> Code T06 · slug dead-code-evidence · verified 2026-09-23 · counts: verified 8 / corrected 12 / downgraded 2 / dropped 0

Verification method: two independent passes were made on 2026-09-23. The second pass resumed an interrupted run and re-checked every source. It made three kinds of change:
- Two verdicts changed: F18 became CORRECTED, and F12 became a partial DOWNGRADE.
- One wrong first-pass "correction" was reversed: the jfmengels step count.
- F01, F02, F03, F04, F09, F10, F15, F17 and F22 were tightened.

Methods:
- Every PDF was downloaded and searched as full text with `pdftotext`: Romano, Eder, Haas, SCARF, Malavolta, Piranha and the SEC order.
- Web pages were read with curl (tags stripped, then grepped) or with WebFetch.
- Stack Exchange answers came from the Stack Exchange API, and Hacker News comments from the official HN API and Algolia.
- Bibliographic data came from Crossref DOI records and arXiv.
- Tool versions were checked against their registries (npm, PyPI, crates.io, proxy.golang.org) and the GitHub API.
- SonarSource rule names were checked through the SonarCloud and next.sonarqube.com rules APIs. Only names are served anonymously; rule descriptions are not.

## Summary

**Evidence base (all re-verified on 2026-09-23):**
- Peer-reviewed empirical studies of dead or unused code:
  - Romano et al., IEEE TSE 46(1), 2020
  - Eder et al., ICSE 2012
  - Haas et al., ACM TOSEM 29(1), 2020
  - Malavolta et al., IEEE TSE 49(7):3692–3714, 2023, on JavaScript dead code (Crossref DOI record checked)
- Industrial systems that delete code at scale:
  - Meta SCARF (ESEC/FSE 2023 paper and a 2023 blog post)
  - Uber Piranha (ICSE-SEIP 2020)
  - Google Sensenmann (Google Testing Blog, 2023)
- Bloated dependencies: Soto-Valero et al. (EMSE 2021) and Latendresse et al. (ASE 2022).
- Commented-out code and AI assistants: Huang et al., "Comment Traps". It is published in PACMSE vol. 3 (FSE 2026, DOI 10.1145/3797102), so it is peer reviewed, not only a preprint.
- Added during verification: Caivano et al., EMSE 28(3), 2023, on the lifespan of dead methods (abstract read through Crossref).
- Standards and official docs: CWE-561 and CWE-14 (v4.20); SEI CERT C MSC12-C (a *recommendation*, priority P2/L3, not a rule); SemVer 2.0.0; JEP 277; the Protobuf proto3 guide; the Express middleware guide.
- Tool docs, with versions checked in the registries:
  - Go `deadcode` (golang.org/x/tools v0.50.0, 2026-09-08)
  - knip 6.38.0 (published 2026-09-23)
  - vulture 2.16 (2026-03-25)
  - ESLint 10.11.0 (2026-09-18)
  - deptry 0.25.1 (2026-03-18)
  - cargo-machete 0.9.2 (2026-04-15)
  - also: the TypeScript tsconfig reference, the rustc lint listing, .NET trimming, Android R8 keep rules and the Clang diagnostics reference
- Deprecated tool: depcheck was archived on 2025-06-16, and its maintainers point to knip.
- Incident record: SEC order 34-70694 on Knight Capital.
- Practitioner threads: Hacker News, Software Engineering Stack Exchange and Stack Overflow.

**Main conclusions (corrected where needed):**

1. **"Unused" is not "unnecessary".**
   - Eder et al. reviewed 27 unused-but-maintained methods. Only 9 (33%) were confirmed unnecessary; another 4 (15%) had already been deleted or moved. The authors therefore treat about 48% as unnecessary. The sample is small, and the study covers a single system.
   - Haas et al. looked at the 76 classes UCDetector flagged as dead inside their own recommendation set. Only 24 (32%) were judged unnecessary by developers.
2. **Static dead-code reports are candidates, not verdicts.** False positives come from:
   - reflection, dependency injection, serialization, and plugin or system-border interfaces
   - names built from strings, and factory registration
   - generated or uncommitted artefacts
   - build configurations
   - code reached only by tests or rare scheduled jobs

   Meta needed more than 300 dynamic-usage pattern detectors.
3. **Unreachable code is first a bug signal.**
   - CERT MSC12-C says it is "typically the result of a coding error".
   - Apple's 2014 "goto fail" bug made signature verification unreachable. Clang's `-Wunreachable-code` is still not part of `-Wall` (current Clang docs).
   - Deleting the unreachable code may lock the bug in. This last point is an inference, not a measured result.
4. **Dormant code rots.** Knight Capital lost $460M when three things combined:
   - dead code left on a server, which had not been retested since 2005
   - a flag given a new meaning
   - a manual deployment that missed one of eight servers, with no second reviewer

   Kept code must be tested or deleted. Wire and persisted identifiers must never be reused.
5. **Safe removal is staged and reversible.** Confirm the candidate, then quarantine or deprecate it, wait, and delete in small single-purpose commits. Re-run the analyzers after each pass, because deletion cascades. A public API needs a deprecation window (SemVer, JEP 277).
6. **Harm is real but moderate and depends on context.**
   - Romano et al. (students): dead code significantly worsened comprehension *effectiveness* of unfamiliar code. It did not significantly change comprehension *effort*, or the modifiability of familiar code.
   - Eder et al. (one industrial system): only 7.6% of changes touched unused code, and 3.6% of maintenance was wasted.
   - So prioritise dead code in frequently changed areas that newcomers read.
7. **Commented-out code is common and hurts AI assistants.**
   - 84.62% of 6,403 Python repositories contain it.
   - Defective commented-out code in the context raised defect counts in GitHub Copilot and Cursor (GPT-4o and Claude 3.5 Sonnet) by up to 58.17% relative to a control. Instructions to ignore it cut defects by at most 21.84%.
8. **For an agent with no production telemetry, a three-tier policy is defensible.** Tier A (compiler-proven) is auto-fixed. Tier B (tool plus independent confirmation) is fixed in reviewed commits. Tier C (needs runtime evidence, public API, flags, unknown purpose) is reported only. This tiering is a synthesis of the evidence, not a published standard (see T06-F21).

## Findings

### T06-F01 — Sort each candidate by evidence class before acting; "the tool says unused" never means "unnecessary"
- **Grade:** A (for the core principle) · **Verdict:** CORRECTED. Three fixes:
  - The Eder figure was presented as "only a third unnecessary". The paper counts 33% confirmed plus 15% already gone, and uses 48%.
  - The five-class scheme is flagged as the researcher's own synthesis.
  - Vulture's 100%-confidence findings can no longer be treated as class 1 wholesale. Vulture assigns 100% only to unused function arguments and to unreachable code. Arguments go through F16 (signature constraints), and unreachable code through F02 (bug signal).
- **Rule:** Put every candidate into one of five classes, each with its own bar for removal:
  1. Compiler-provable: unreachable statement, unused local, unused import, unused private member, dead store.
  2. Statically unreferenced but externally visible: exported symbol, public method, file, dependency.
  3. Reachable but not exercised at runtime.
  4. Obsolete by intent: retired flag, finished migration, superseded API version.
  5. Commented-out code.
- **Rationale:** The literature uses "dead code" for different things with very different risks.
  - CWE-561 covers only code that "can never be executed".
  - Romano et al. merge unused and unreachable code.
  - Eder et al. measured runtime-unused code. Among 27 unused methods that had been maintained, 33% were confirmed unnecessary and 15% had already been deleted or moved. The authors conclude "nearly every second case" was unnecessary or gone. Eder also notes that runtime-unused code includes "error handling routines such as exception handlers", and that developers found real bugs while asking why a method was unused.
  - Haas et al. treat unused code as an *upper* bound on unnecessary code, and code developers deleted as a *lower* bound.
  - The five-class taxonomy is a practical synthesis of these definitions; no single source defines it.
- **Evidence:**
  - [A Multi-Study Investigation Into Dead Code](https://www.cs.wm.edu/~denys/pubs/TSE'18-DeadCode.pdf) — Romano, Vendome, Scanniello, Poshyvanyk, IEEE TSE 46(1), 2020 (DOI 10.1109/TSE.2018.2842781) — peer_reviewed — "dead code is unnecessary source code, because it is unused and/or unreachable (i.e., never executed)"; kinds: "classes, methods, variables (local and global), parameters, and statements" — verified in full text (§1, §2.1). Wake's definition (unused variables, parameters, fields, methods or classes) is also cited there.
  - [How Much Does Unused Code Matter for Maintenance?](https://teamscale.com/publications/2012-how-much-does-unused-code-matter-for-maintenance.pdf) — Eder, Junker, Jürgens, Hauptmann, Vaas, Prommer, ICSE 2012 (DOI 10.1109/ICSE.2012.6227109) — peer_reviewed — "in 9 of 27 (33%) cases, the unused code was indeed unnecessary. In another 4 cases (15%) the code in question was no longer existent"; "Domain and development knowledge is necessary to decide whether a method is unnecessary" — verified in full text. Author order corrected.
  - [Is Static Analysis Able to Identify Unnecessary Source Code?](https://www.se.cs.uni-saarland.de/publications/docs/HNR+19.pdf) — Haas, Niedermayr, Roehm, Apel, ACM TOSEM 29(1), 2020 (DOI 10.1145/3368267) — peer_reviewed — "deleted code represents a lower bound for unnecessary code … unused code represents an upper bound for unnecessary code because used code is necessary and not every unused piece of code is unnecessary" — verified (§7.2).
  - [CWE-561: Dead Code](https://cwe.mitre.org/data/definitions/561.html) — MITRE, CWE v4.20 — standard — "The product contains dead code, which can never be executed."; CanFollow CWE-570 and CWE-571 — verified.
- **Detect:** Record the class of every tool finding in the report.
  - Class 1: `tsc --noUnusedLocals --noUnusedParameters` with `allowUnreachableCode: false`; ESLint `no-unused-vars` and `no-unreachable`; the rustc `dead_code`, `unused_variables` and `unreachable_code` lints; clang `-Wunreachable-code`; vulture's unreachable-code findings (100%). Vulture's other 100% findings are unused arguments; send those to F16, not to auto-fix.
  - Class 2: knip (files, exports, dependencies); vulture findings at 60–90%; Go `deadcode`; deptry DEP002; cargo-machete.
  - Class 3: runtime data only.
  - Class 4: flag-service state, migration records, VCS history.
  - Class 5: comment-pattern search (F14).
- **Tools:** tsc, ESLint, rustc lints, clang, vulture, knip, Go deadcode, deptry, cargo-machete.
- **Applies to:** All languages. This triage comes before every other rule in this topic.
- **When not to apply / counterpoints:** The classes blur. Provably unreachable code may be a bug to fix, not delete (F02). Runtime-unused code may be seasonal, or may be exception handling (F09, and Eder). Definitions conflict: Wake counts unused parameters and fields as dead code, while CWE-561 counts only code that can never execute.
- **Fix risk:** low (the triage itself changes no code)

### T06-F04 — Never delete on one static tool's report, or on the agent's own reading; confirm each candidate independently
- **Grade:** A · **Verdict:** CORRECTED. Four fixes:
  - The Haas precision was measured inside the authors' recommendation set (241 classes). It is not a general precision figure for UCDetector.
  - The Lacuna precision needed its recall trade-off and its benchmark (39 TodoMVC apps).
  - The DCE-LLM claim was changed from "about 30 points worse in F1" to the abstract's own wording, "surpassing GPT-4o by 30%". The unit is unspecified, and the result is on a benchmark only.
  - The researcher's advice to auto-apply vulture findings at `--min-confidence 100` was removed. That level covers unused arguments and unreachable code, both of which need review (F16, F02).
- **Rationale:**
  - Measured precision of dead-code detectors is modest. Among the 241 files recommended by Haas's approach, UCDetector flagged 76 classes as dead. Developers judged 52 of those necessary: 32% precision.
  - In JavaScript (Lacuna, 39 TodoMVC apps), the best-balanced combination (Dynamic + TAJS) reached 82.5% precision with 97.2% recall. The highest-precision combination reached 88.1% precision, but only 54.3% recall.
  - Vulture calls its sub-100% confidences "very rough" estimates.
  - The Go team states that a "dead" report does not mean the code is safe to delete.
  - DCE-LLM (NAACL 2025) reports that a fine-tuned pipeline beat GPT-4o by about 30% on the authors' benchmark. This is weak, indirect evidence that a general-purpose model's own judgement is not a substitute for deterministic tools.
- **Evidence:**
  - [Is Static Analysis Able to Identify Unnecessary Source Code?](https://www.se.cs.uni-saarland.de/publications/docs/HNR+19.pdf) — Haas et al., TOSEM, 2020 — peer_reviewed — "UCDetector … reported in total 76 dead classes, of which 24 were classified as unnecessary by developers, while 52 were actually necessary"; "dead code detection tools have a low precision as only 32% of files deemed unreachable were indeed unnecessary" — verified (§6.3). The sample is the recommended files from 5 systems.
  - [JavaScript Dead Code Identification, Elimination, and Empirical Assessment](http://www.ivanomalavolta.com/files/papers/TSE_2023.pdf) — Malavolta, Nirghin, Scoccia, Romano, Lombardi, Scanniello, Lago, IEEE TSE 49(7):3692–3714, 2023 (DOI 10.1109/TSE.2023.3267848, Crossref-confirmed) — peer_reviewed — "average F-score = 87.9% … precision = 82.5% … recall = 97.2%"; the other combination reached "higher precision (88.1%) … recall … was only 54.3%"; a lazy-loading fallback exists for "incorrectly-removed functions" — verified (§2.2.7).
  - [deadcode command](https://pkg.go.dev/golang.org/x/tools/cmd/deadcode) — Go team, x/tools v0.50.0 (2026-09-08) — official_docs — "just because a function is reported as dead does not mean it is unconditionally safe to delete it. For example, a dead function may be referenced by another dead function, and a dead method may be required to satisfy an interface that is never called. Some judgement is required." — verified in doc.go source.
  - [Vulture README](https://github.com/jendrikseipp/vulture) — Jendrik Seipp, v2.16 (PyPI 2026-03-25) — official_docs — "Values below 100% are *very rough* estimates"; arguments and unreachable code 100%, imports 90%, attributes/classes/functions/methods/properties/variables 60%; "Use `--min-confidence 100` to only report code that is guaranteed to be unused within the analyzed files." — verified in the raw README.
  - [DCE-LLM: Dead Code Elimination with Large Language Models](https://arxiv.org/abs/2506.11076) — Chen, Li, Wu, Liu, NAACL 2025 — peer_reviewed (conference) — "over 94% F1 scores for unused and unreachable code, significantly surpassing GPT-4o by 30%" — verified in the abstract only; a benchmark setting on an older model. **Weak support for the "agent's own judgement" sub-claim.**
- **Detect:** For each candidate, log four things:
  1. the tool and rule that flagged it
  2. its confidence
  3. one independent confirmation: a second analyzer, the whole-repo search (F06) or runtime data
  4. the result of the F05 checklist

  Auto-apply only compiler- or linter-proven class-1 items (unused locals, imports, private members), and only after tests pass. Vulture's 100% findings are unused arguments and unreachable code. They are "guaranteed to be unused within the analyzed files", but removing them can still break a signature (F16) or hide a bug (F02), so review them.
- **Tools:** `vulture --min-confidence`, knip, `deadcode -whylive`, ripgrep, test suite.
- **Applies to:** All languages. Most critical in dynamic languages (Python, JS/TS, Ruby, PHP) and in DI- or reflection-based frameworks (Spring, .NET, Angular, Django).
- **When not to apply / counterpoints:** Tools also *miss* things. In Haas's data, 29% of confirmed-unnecessary files were still reachable, so no dead-code detector could flag them. For compiler-proven trivia (unused locals), the compiler's proof is confirmation enough.
- **Fix risk:** medium

### T06-F05 — Run a dynamic-reference checklist before deleting any symbol, file or class that looks unused
- **Grade:** A · **Verdict:** CORRECTED. The Android quote was not verbatim and has been replaced. "Go RTA … not assembly" was removed from the counterpoints: the Go doc names only `//go:linkname`.
- **Rationale:** These mechanisms are the documented main causes of false positives.
  - Haas et al.: DI frameworks, reflection, serialized DTOs used outside the analyzed code, and system-border interfaces. "Most incorrect classifications are caused by missing dynamic or external dependency information."
  - Meta's SCARF lists string concatenation for table names, reflection, automated factory registration, uncommitted compilation artefacts, and table names stored in a database. It runs more than 300 pattern detectors.
  - The official .NET trimming and Android R8 docs show that members reached only through reflection get removed unless they are annotated or kept.
- **Evidence:**
  - [Is Static Analysis Able to Identify Unnecessary Source Code? §6.5](https://www.se.cs.uni-saarland.de/publications/docs/HNR+19.pdf) — Haas et al., 2020 — peer_reviewed — "use of dependency injection frameworks …", "use of reflection for invocations", "data transfer classes that are serialized and mainly used outside of the (analyzed) Java code (e.g., in a JS UI)", "interfaces at the system border (e.g., extension points for plugins or provided services)" — verified.
  - [Dead Code Removal at Meta §3.2.1](https://users.encs.concordia.ca/~pcr/paper/Shackleton2023FSE-industry-preprint.pdf) — Shackleton, Gill, Cohn-Gordon, Nagappan, Rigby, Nakad, Abreu, Papagiannis, Petre, Megreli, Riggs, Saindon, ESEC/FSE 2023 — peer_reviewed — the hazard list quoted above; "There are over three hundred of these pattern detectors in the largest instance of SCARF" — verified. The paper also advises *designing* systems to prevent dynamic references, for example mandating an ORM or a type-safe URI builder.
  - [Automating dead code cleanup](https://engineering.fb.com/2023/10/24/data-infrastructure/automating-dead-code-cleanup/) — Shackleton, Pincombe, Cohn-Gordon, Engineering at Meta, 2023-10-24 — engineering_blog — "SCARF must be capable of introspecting any and all types of dynamic usage in addition to the static dependency graph"; "Template hooks for dynamically rendering pages in the Instagram Django backend" — verified.
  - [Prepare .NET libraries for trimming](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/prepare-libraries-for-trimming) — Microsoft Learn (ms.date 2025-11-20, updated 2026-01-08) — official_docs — "Without DynamicDependency, trimming might remove Helper from MyAssembly or remove MyAssembly completely if it's not referenced elsewhere" — verified.
  - [Add keep rules](https://developer.android.com/topic/performance/app-optimization/add-keep-rules) — Android Developers (updated 2026-06-29) — official_docs — **corrected quote:** "The Jetpack Navigation library uses reflection using the `NavArgsLazy` delegate to call a static `fromBundle` method on generated `NavArgs` classes", kept by a conditional `-if … -keepclassmembers` rule. Also: "One common use case for conditional keep rules is to handle reflection" — verified.
  - [Vulture README](https://github.com/jendrikseipp/vulture) — Seipp, 2026 — official_docs — "Due to Python's dynamic nature, static code analyzers like Vulture are likely to miss some dead code. Also, code that is only called implicitly may be reported as unused." — verified.
- **Detect:** Run language-specific searches, then check framework manifests.
  - Python: `getattr(`, `setattr(`, `importlib.import_module`, `__import__(`, `globals()[`, `entry_points`, route/receiver/task/fixture/click decorators.
  - JS/TS: `eval(`, `new Function(`, non-literal `import(`/`require(`, computed calls `obj[name](`.
  - Java/Kotlin: `Class.forName`, `getDeclaredMethod`, `getMethod(`, `newInstance(`, `@Autowired`, `@Inject`, `@Bean`, `@Component`, `@Scheduled`, `@EventListener`, `@JsonProperty`, `@SerializedName`, `@Entity`, `ServiceLoader`.
  - C#: `Activator.CreateInstance`, `Type.GetType(`, `GetMethod(`, `DynamicDependency`, `JsonPropertyName`.
  - Go: `reflect.`, `//go:linkname`, `plugin.Open`.
  - Manifests: routes, DI modules, plugin registries, pyproject entry points and scripts, package.json `bin`/`exports`, cron and serverless definitions, the Android manifest, R8/ProGuard keep files.
- **Tools:** ripgrep, ast-grep, R8 keep rules, the .NET trim analyzer (IL2026/IL2070), vulture whitelist.
- **Applies to:** All languages. Especially Java/Kotlin (Spring, Android), C#/.NET, Python (Django, Flask, FastAPI, Celery, pytest), JS/TS (Angular DI, file-based routing, decorators), Go (reflect, linkname), and any plugin architecture.
- **When not to apply / counterpoints:** Some ecosystems make references explicit.
  - Jeroen Engels argues that purity in Elm makes cascading removal safe.
  - Go's `deadcode` "can soundly analyze dynamic calls though func values, interface methods, and reflection", but does not understand `//go:linkname`.
  - Go `deadcode` only uses `main` packages as roots. A library-only module has no roots unless `-test` is used.
- **Fix risk:** high

### T06-F07 — Do not delete exported or public API of a published library, SDK or service contract because nothing in the repo uses it; deprecate it first and remove it only in a major release
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Callers outside the repository are invisible to any in-repo analysis. Standards and tools agree:
  - SemVer requires a MAJOR bump for backward-incompatible API changes, and asks for at least one minor release carrying the deprecation.
  - JEP 277 adds `forRemoval` ("terminal deprecation"), whose warnings are not suppressed by `@SuppressWarnings("deprecation")`.
  - CERT exempts unused functions of exported libraries.
  - rustc `dead_code` reports only unexported items.
  - Knip does not report unused exports of entry files by default.
- **Evidence:**
  - [Semantic Versioning 2.0.0](https://semver.org/) — Tom Preston-Werner, semver.org — standard — item 8: "Major version X (X.y.z | X > 0) MUST be incremented if any backward incompatible changes are introduced to the public API."; FAQ: "Before you completely remove the functionality in a new major release there should be at least one minor release that contains the deprecation so that users can smoothly transition to the new API." — verified verbatim.
  - [JEP 277: Enhanced Deprecation](https://openjdk.org/jeps/277) — OpenJDK, delivered in Java SE 9 (2017) — standard — `forRemoval=true` = terminal deprecation; removal warnings require `@SuppressWarnings("removal")`; the `jdeprscan` tool — verified.
  - [MSC12-C, exception MSC12-EX3](https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/miscellaneous-msc/msc12-c) — SEI CERT C (2016 edition, web version) — standard (recommendation) — "Unused functions and variables that are part of an exported library do not violate this guideline." — verified verbatim.
  - [rustc lint listing: dead_code](https://doc.rust-lang.org/rustc/lints/listing/warn-by-default.html) — The Rust Project — official_docs — "The `dead_code` lint detects unused, unexported items." — verified.
  - [Knip configuration: includeEntryExports](https://knip.dev/reference/configuration) — Lars Kappert / Knip 6.38.0 — official_docs — "By default, Knip does not report unused exports in entry files. When a repository (or workspace) is self-contained or private, you may want to include entry files when reporting unused exports." — verified.
  - [deadcode, -test flag](https://pkg.go.dev/golang.org/x/tools/cmd/deadcode) — Go team — official_docs — "public API functions reported as dead with -test indicate possible gaps in your test coverage" — verified.
- **Detect:**
  1. Decide whether the project is published or consumed externally. Look at package.json `name` without `private: true`, `main`/`exports`/`bin`, pyproject publishing configuration, Cargo `[lib]`, Maven/Gradle publication, NuGet metadata, OpenAPI/proto/GraphQL schemas and public API routes.
  2. If it is, route unused public items to "deprecate", not "delete".
  3. Use the language's deprecation marker: JSDoc `@deprecated`; Python `warnings.warn(DeprecationWarning)` or `@deprecated`; Java `@Deprecated(since=…, forRemoval=true)`; Rust `#[deprecated(since, note)]`; C# `[Obsolete]`.
- **Tools:** knip `includeEntryExports`, jdeprscan, language deprecation attributes, ripgrep.
- **Applies to:** Libraries, SDKs, shared internal packages, monorepo workspaces consumed by other workspaces, HTTP/gRPC/GraphQL APIs, CLI flags, config-file schemas.
- **When not to apply / counterpoints:** For a private, self-contained application, deprecation windows are overhead; knip itself suggests `includeEntryExports` there. Inside a single monorepo where every caller can be changed atomically, the window can be zero. This point is reasoning, not sourced.
- **Fix risk:** high

### T06-F02 — Treat unreachable code as a possible defect before treating it as clutter
- **Grade:** A · **Verdict:** CORRECTED. Three fixes:
  - The CERT MSC12-EX1 quote was not verbatim (the source has no "defensive code" wording), and MSC12-C is flagged as a recommendation, not a rule.
  - GCC was removed from the detection list: the current GCC manual documents no `-Wunreachable-code`.
  - "Deleting would have hidden the vulnerability" is now marked as inference.
- **Rule:** For each unreachable block, find out whether it was meant to run: an early return or goto, an always-true or always-false condition, a duplicated statement, a wrong enum or constant. If it was meant to run, restore reachability, add a test and report a bug. Delete it only when the intent is shown to be obsolete. Keep resilience branches, such as a `default` over an enum.
- **Rationale:**
  - CERT says code that has no effect or is never executed "is typically the result of a coding error". The CERT statement is an expert assertion, not a measured rate.
  - Apple's 2014 "goto fail" bug was a duplicated `goto` that made the signature check unreachable. Langley: "the signature verification will never fail".
  - Clang's `-Wunreachable-code` was not in `-Wall` in 2014. The current Clang diagnostics reference confirms it is still not in `-Wall` or `-Wmost`.
  - Eder et al. report developers finding bugs (a business function not hooked into the UI) while investigating why code was unused.
  - CERT's own compliant solution: "Remediation of dead code requires the programmer to determine why the code is never executed and then to resolve the situation appropriately". CERT lists CVE-2014-1266 (goto fail) as a violation of MSC12-C.
  - The rustc docs: "Dead code may signal a mistake or unfinished code."
  - Removing the unreachable check instead of fixing it would have silenced the only symptom. This is the researcher's inference, not something a source states.
- **Evidence:**
  - [MSC12-C. Detect and remove code that has no effect or is never executed](https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/miscellaneous-msc/msc12-c) — SEI CERT C Coding Standard (2016 edition, web) — standard (recommendation; Severity Low, Likelihood Unlikely, P2, L3) — "Code that has no effect or is never executed (that is, dead or unreachable code) is typically the result of a coding error and can cause unexpected behavior." **Corrected** MSC12-EX1: "In some situations, seemingly dead code may make software resilient. An example is the default label in a switch statement whose controlling expression has an enumerated type and that specifies labels for all enumerations of the type"; "the default label is appropriate and necessary" — verified verbatim via curl.
  - [Apple's SSL/TLS bug](https://www.imperialviolet.org/2014/02/22/applebug.html) — Adam Langley, 2014-02-22 — engineering_blog — "If I compile with -Wall (enable all warnings), neither GCC 4.8.2 or Clang 3.3 from Xcode make a peep about the dead code." "Clang does have -Wunreachable-code to warn about this, but it's not in -Wall." — verified.
  - [Clang Diagnostics Reference](https://clang.llvm.org/docs/DiagnosticsReference.html) — LLVM — official_docs — `-Wall` controls `-Wmost`, `-Wparentheses`, `-Wswitch` and others; neither `-Wall` nor `-Wmost` includes `-Wunreachable-code` — verified 2026-09-23 (added by fact-checker).
  - [CWE-561](https://cwe.mitre.org/data/definitions/561.html) — MITRE, v4.20 — standard — CanFollow CWE-570 (Expression is Always False) and CWE-571 (Expression is Always True) — verified.
  - [TSConfig: allowUnreachableCode](https://www.typescriptlang.org/tsconfig/#allowUnreachableCode) — Microsoft/TypeScript (since 1.8) — official_docs — "`false` raises compiler errors about unreachable code"; applies only to code "provably unreachable due to the use of JavaScript syntax"; "This does not affect errors on the basis of code which *appears* to be unreachable due to type analysis." — verified.
- **Detect:**
  - Enable diagnostics: clang `-Wunreachable-code` (or `-Wunreachable-code-aggressive`); `tsc` with `allowUnreachableCode: false`; ESLint `no-unreachable`; rustc `unreachable_code`; vulture's unreachable-code findings (100% confidence). GCC's manual documents no equivalent option, so do not rely on GCC for this.
  - Search for constant guards, e.g. `if (false|true|0|1)`, `if False:`, `while (false)`.
  - Search for duplicated control-transfer lines, e.g. two consecutive identical `goto x;`.
  - For each hit, run `git log -L` to see when reachability was lost.
- **Tools:** clang, tsc, ESLint, rustc, vulture, ripgrep, `git log -L`.
- **Applies to:** All languages. Highest priority in security, auth, validation, money and error-handling code.
- **When not to apply / counterpoints:**
  - Intentional unreachable-looking code: resilience defaults (MSC12-EX1), exhaustiveness guards (`assertNever`, `unreachable!()`), constant-gated debug branches.
  - `#ifdef`-disabled code is exempt under MSC12-EX3.
  - TypeScript and similar checks are syntactic only.
- **Fix risk:** high

### T06-F12 — Never reuse a removed identifier (protobuf field number or name, flag, enum value, column, event name, error code, route); reserve it or tombstone it
- **Grade:** A for serialized-schema fields (protobuf), B for the other identifier kinds · **Verdict:** DOWNGRADED (partial). The sources are real and say what is claimed. But official-doc support covers only protobuf field numbers and names. Extending the rule to flags rests on a single incident (Knight). Extending it to enum values, DB columns, event names, error codes and routes is an analogy that no source states.
- **Rationale:** Reusing a retired identifier silently reconnects old producers, consumers or dormant code to a new meaning.
  - Protobuf's guide says a deleted field number *must* be reserved, and lists the consequences of reuse. Names can be reserved too; reusing a name is "generally safe, except when using TextProto or JSON encodings".
  - Knight Capital's loss was triggered by giving an old flag a new meaning that dormant code still honoured.
- **Evidence:**
  - [Language Guide (proto 3): Deleting Fields / Reserved](https://protobuf.dev/programming-guides/proto3/) — Google Protocol Buffers — official_docs — "you **must** reserve the deleted field number"; the consequences listed include "Leaked PII/SPII" and "Data corruption" — verified.
  - [In the Matter of Knight Capital Americas LLC, Release No. 34-70694](https://www.sec.gov/files/litigation/admin/2013/34-70694.pdf) — U.S. SEC, 2013-10-16 — incident_report — "The new RLP code also repurposed a flag that was formerly used to activate the Power Peg code. Knight intended to delete the Power Peg code so that when this flag was set to 'yes,' the new RLP functionality--rather than Power Peg--would be engaged." (¶13) — verified in full text.
  - [Knightmare: A DevOps Cautionary Tale](https://dougseven.com/2014/04/17/knightmare-a-devops-cautionary-tale/) — Doug Seven, 2014-04-17 — engineering_blog (secondary) — "The code that was updated repurposed an old flag that was used to activate the Power Peg functionality"; "why code that had been dead for 8-years was still present in the code base is a mystery" — verified. Note: the SEC dates Power Peg's retirement to 2003 and the incident to 2012.
- **Detect:** For every removed field or identifier, check that the schema has a reservation (`reserved` in `.proto`) or a tombstone comment. Before introducing a "new" name or number, run `git log -S'<name>' --all` to see whether it existed before. In review, flag diffs where an enum or flag keeps its name or number but changes meaning.
- **Tools:** `git log -S`, protobuf `reserved`, schema linters, code review.
- **Applies to:** Serialized schemas (protobuf, Thrift, Avro, JSON contracts), feature flags, enums persisted in databases, error codes, message and event types, DB columns.
- **When not to apply / counterpoints:** Inside one process, with no persisted or wire format and no stale deployments, reuse is confusing but not dangerous. Reservations add minor clutter to the schema.
- **Fix risk:** low

### T06-F15 — Enable compiler and linter checks for unused locals, imports and dead stores, and fix them only after a side-effect check
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:**
  - Keep the call and drop only the binding when the initializer does work.
  - Keep side-effect imports.
  - Keep RAII, drop and dispose guards, and fields whose type matters.
  - Never "clean up" writes that zero secrets; use a primitive the compiler is guaranteed not to elide.
- **Rationale:** These are the lowest-risk, compiler-provable cases, and the official docs name the traps. Rust warns that removing fields used only for their side effects changes behaviour. CWE-14 documents that clearing a secret looks like a dead store, which optimizers remove.
- **Evidence:**
  - [TSConfig: noUnusedLocals](https://www.typescriptlang.org/tsconfig/#noUnusedLocals) — Microsoft/TypeScript (since 2.0) — official_docs — "Report errors on unused local variables." — verified.
  - [no-unused-vars](https://eslint.org/docs/latest/rules/no-unused-vars) — ESLint v10.11.0 — official_docs — "This rule is aimed at eliminating unused variables, functions, and function parameters"; a variable "is *not* considered to be used if it is only ever declared … or assigned to"; `caughtErrors` default `"all"` — verified.
  - [rustc lint listing: dead_code, Limitations](https://doc.rust-lang.org/rustc/lints/listing/warn-by-default.html) — The Rust Project — official_docs — "Removing fields that are only used for side-effects and never read will result in behavioral changes … If a field's value performs an action when it is dropped. If a field's type does not implement an auto trait (e.g. Send, Sync, Unpin)." — verified.
  - [CWE-14: Compiler Removal of Code to Clear Buffers](https://cwe.mitre.org/data/definitions/14.html) — MITRE, v4.20 — standard — "Sensitive memory is cleared according to the source code, but compiler optimizations leave the memory untouched when it is not read from again, aka 'dead store removal.'" — verified.
  - [Safe dead code removal in a pure functional language](https://jfmengels.net/safe-dead-code-removal/) — Jeroen Engels, 2021-01-28 — engineering_blog — on an unused `const userInfo = formatUserInfo(user)` in JavaScript: "the only thing we'd be able to do safely is remove the assignment … We can't remove the call to formatUserInfo(user) because we don't know what it does." — verified (added in the second pass; direct support for "keep the call, drop the binding").
  - SonarSource rules S1481 "Unused local variables should be removed", S1854 "Unused assignments should be removed", S1128 "Unnecessary imports should be removed", S1068 "Unused "private" fields should be removed", S1144 "Unused "private" methods should be removed" — SonarSource — official_docs — rule names verified via the [SonarCloud rules API](https://sonarcloud.io/api/rules/search?rule_key=java:S1854&organization=sonarsource). next.sonarqube.com was down (503). Rule descriptions were not retrievable anonymously.
- **Detect:**
  - Run: `tsc --noEmit --noUnusedLocals`; ESLint `no-unused-vars: error`; `cargo build` / `cargo clippy`; `vulture --min-confidence 90` (imports) and `100` (arguments, unreachable code); the Go compiler already rejects unused imports and locals; Sonar S1481/S1854/S1128/S1068/S1144.
  - Side-effect check for each hit:
    - Is the initializer a call?
    - Is it a bare import (`import './polyfill'`, `import 'reflect-metadata'`)?
    - Is it a guard or lock binding (`let _guard = m.lock()`, `using`/`with`)?
    - Is it zeroing of key material? If so, use `explicit_bzero`, `SecureZeroMemory` or the `zeroize` crate.
- **Tools:** tsc, ESLint, rustc/clippy, vulture, go build, SonarQube.
- **Applies to:** All languages. The zeroization caveat mainly concerns C/C++/Rust and any code that handles secrets.
- **When not to apply / counterpoints:**
  - Python "unused" imports may be deliberate re-exports (`__init__.py`, `__all__`) or registration side effects.
  - ESLint offers `ignoreRestSiblings` and `varsIgnorePattern` for intentional cases.
  - Underscore-prefixed names are the documented opt-out.
- **Fix risk:** low

### T06-F16 — Remove unused parameters only from private or internal functions; for fixed-signature functions, mark the parameter unused instead
- **Grade:** A · **Verdict:** VERIFIED. The fact-checker added the Express docs as a source for the arity counterpoint.
- **Rule:** Do not remove a parameter from overrides, interface implementations, callbacks, framework hooks or public API. For fixed-signature functions, use the language convention (leading `_`, or a discard) instead.
- **Rationale:** Official lint defaults encode this.
  - ESLint's default `args: "after-used"` ignores unused parameters that come before the last used one.
  - TypeScript and Rust exempt names starting with an underscore.
  - Removing a parameter changes the signature: callers break, and positional arguments shift silently in dynamic languages.
  - Express identifies error-handling middleware by its four-argument signature.
- **Evidence:**
  - [no-unused-vars, args option](https://eslint.org/docs/latest/rules/no-unused-vars) — ESLint v10.11.0 — official_docs — default `"after-used"`: "unused positional arguments that occur before the last used argument will not be checked"; `argsIgnorePattern`, e.g. names beginning with an underscore — verified.
  - [TSConfig: noUnusedParameters](https://www.typescriptlang.org/tsconfig/#noUnusedParameters) — Microsoft/TypeScript — official_docs — "Parameters declaration with names starting with an underscore (_) are exempt from the unused parameter checking." — verified.
  - [rustc lint listing: dead_code](https://doc.rust-lang.org/rustc/lints/listing/warn-by-default.html) — The Rust Project — official_docs — "To silence the warning for individual items, prefix the name with an underscore such as `_foo`." — verified.
  - SonarSource `java:S1172` "Unused method parameters should be removed" — rule name verified via the SonarCloud rules API only.
  - [Using middleware](https://expressjs.com/en/guide/using-middleware.html) — Express — official_docs — "Error-handling middleware always takes four arguments. You must provide four arguments to identify it as an error-handling middleware function. Even if you don't need to use the next object, you must specify it to maintain the signature." — verified (added by fact-checker).
- **Detect:** Run `tsc --noUnusedParameters`; ESLint `no-unused-vars` (`args: "after-used"`, or `"all"` for review); Sonar S1172; rustc `unused_variables`. For each hit, check whether the function is:
  - exported or public
  - an override or interface implementation
  - passed as a callback (non-call references)
  - a framework hook (Express handlers, Django views, pytest fixtures, React props)

  If any of these applies, rename the parameter to `_param` instead of removing it.
- **Tools:** tsc, ESLint, SonarQube S1172, rustc, ripgrep.
- **Applies to:** All languages. Especially JS/TS callbacks, Express middleware (arity-sensitive), Java/C# interface implementations and Python framework hooks.
- **When not to apply / counterpoints:** Some teams prefer `args: "all"`, because an unused parameter can be a bug (it should have been used), which is the same signal as F02.
- **Fix risk:** medium

### T06-F18 — For JavaScript/TypeScript, use knip (not the archived depcheck); fix configuration gaps instead of adding ignores; auto-fix only on a clean tree, one fix type at a time
- **Grade:** A · **Verdict:** CORRECTED. The first pass accepted a paraphrase as the quotation. The page at /guides/handling-issues is now titled "Resolve reported issues", and its exact wording is quoted below.
- **Rationale:**
  - Knip's own docs say surprising results are usually real findings or configuration gaps. Causes of false "unused file" reports include dynamic import specifiers, missing or incomplete plugins, missing generated files, and auto-import features.
  - Knip ships 150+ plugins.
  - The docs warn against silencing results, and ask users to rely on version control when auto-fixing.
  - depcheck's own maintainers archived it and recommend knip.
- **Evidence:**
  - [Knip: Resolve reported issues](https://knip.dev/guides/handling-issues) — Knip docs (knip 6.38.0, npm 2026-09-23) — official_docs — **corrected quote:** "When Knip reports something you didn't expect, it's telling the truth about its module graph: it couldn't reach that code from an entry file. So a surprising result is usually a real finding or a configuration gap, not a false positive to silence." Also verbatim: "Hiding a result is not the same as resolving it"; "Reach for ignore* options only as a last resort". Common causes of unused files: "Missing generated files", "Dynamic import specifiers", "Missing plugin", "Incomplete plugin" — verified by curl on 2026-09-23.
  - [Knip home](https://knip.dev/) — official_docs — "Knip comes with 150+ plugins for tools and frameworks like Astro, Cypress, ESLint, Jest, GitHub Actions, Next.js, Nx, Remix, Storybook, Svelte, Vite, Vitest, Webpack and many, many more." The docs navigation lists "Plugins (187)" — verified.
  - [Knip auto-fix](https://knip.dev/features/auto-fix) — official_docs — "Use a VCS (version control system) like Git to review and undo changes as necessary."; fix types `dependencies`, `exports`, `types`, `files`, `catalog`; `--allow-remove-files` is required to delete files — verified.
  - [depcheck README](https://github.com/depcheck/depcheck) — depcheck maintainers — official_docs — "Depcheck is no longer actively maintained"; "We strongly recommend switching to knip"; repository archived 2025-06-16; last npm release 1.4.7 (2023-10-17) — verified.
- **Detect:**
  1. `pnpm dlx knip` (review).
  2. Fix `entry`/`project` patterns and plugins until the results are credible.
  3. `knip --production`.
  4. Commit one fix type at a time: dependencies, then exports, then types. Remove files last, with `--allow-remove-files`, after a manual review.
  5. Run `tsc --noEmit`, ESLint, the tests and the build.
  6. Audit the configured `ignore*` entries.
- **Tools:** knip 6.x, tsc, ESLint, pnpm.
- **Applies to:** JS/TS repos and monorepos (npm/pnpm/yarn/bun workspaces).
- **When not to apply / counterpoints:** In a library, removing the `export` keyword from symbols used by external consumers breaks them (F07). Custom loaders or string-built dynamic imports still need F05.
- **Fix risk:** medium

### T06-F19 — Analyse every shipped build configuration; delete only what is dead in all of them
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:** Configurations include OS/architecture, build tags, cfg features, `#ifdef` macros, target frameworks and dev/prod switches.
- **Rationale:** Reachability depends on configuration.
  - Go `deadcode` is valid for a single GOOS/GOARCH/tags configuration, and recommends intersecting the results of several runs.
  - CERT exempts `#ifdef`-disabled code.
  - .NET recommends a separate trimming test app per target framework when behaviour differs, for example through `#if NET7_0`.
  - cargo-machete's `--with-metadata` uses `--all-features` for more accurate dependencies per build type.
- **Evidence:**
  - [deadcode](https://pkg.go.dev/golang.org/x/tools/cmd/deadcode) — Go team — official_docs — "The analysis is valid only for a single GOOS/GOARCH/-tags configuration, so a function reported as dead may be live in a different configuration. Consider running the tool once for each configuration of interest … to compute the intersection of results across all runs." — verified.
  - [MSC12-EX3](https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/miscellaneous-msc/msc12-c) — SEI CERT C — standard — "code that is never executed because it is #ifdef ed out does not violate this guideline, on the grounds that it could be subsequently used in another application, or built on a different platform." — verified.
  - [Prepare .NET libraries for trimming](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/prepare-libraries-for-trimming) — Microsoft Learn — official_docs — "If the library has different behavior depending on the target framework, create a trimming test app for each of the target frameworks that support trimming. For example, if the library uses conditional compilation such as `#if NET7_0`" — verified.
  - [cargo-machete README](https://github.com/bnjbvr/cargo-machete) — Benjamin Bouvier, v0.9.2 (crates.io 2026-04-15) — official_docs — `--with-metadata` "will call `cargo metadata --all-features` to find final dependency names, more accurate dependencies per build type, etc. ⚠ This may modify the `Cargo.lock` files" — verified.
- **Detect:** List the configurations by searching for `//go:build`, `#if`/`#ifdef`, `#[cfg(`, `cfg!(`, `process.env.NODE_ENV`, `import.meta.env`, `__DEV__`, `sys.platform`, `RuntimeInformation.IsOSPlatform`. Then run the analyzer once per configuration (`GOOS=… deadcode -tags=…`, `cargo check` per feature set, `tsc -p` per tsconfig, `dotnet build` per TFM). Keep only the intersection of the dead sets.
- **Tools:** deadcode, `cargo check --all-features`, cargo-hack (feature powerset; not verified here), `tsc -p`, `dotnet build` per TFM, ripgrep.
- **Applies to:** Cross-platform code; Go, Rust, C/C++ and C#; JS/TS with environment branches (SSR vs client, dev vs prod, mobile platforms).
- **When not to apply / counterpoints:** Configurations nobody builds any more are themselves dead-code candidates. HN user meindnoch names obsolete platform checks as dead code that static analysis misses.
- **Fix risk:** medium

### T06-F03 — Prioritise removal where it pays off (frequently changed code that newcomers read); do not justify risky deletions by "dead code is harmful" alone
- **Grade:** B · **Verdict:** CORRECTED. Three fixes:
  - The Romano null result on comprehension *effort* (F16) was added.
  - The "changed dead code without knowing" observation is now quantified from the full text (14 modifications, 10 of them failed).
  - Ranking by churn is marked as an inference from Eder.
- **Rationale:**
  - Romano et al. (83 students in 4 experiments, plus 6 interviewed professionals):
    - Dead code significantly worsened comprehension *effectiveness and efficiency* on unfamiliar code (F17), and dead methods were more harmful than dead classes (F18).
    - It did **not** significantly affect comprehension *effort* (F16) or the modifiability of familiar code (F19).
    - In the modification tasks, participants in the dead-code groups modified existing dead code 14 times, and "in 10 cases out of 14 … they were not able to produce correct solutions" (F21, "Developers unconsciously modify dead code").
  - Meta's survey: 30% of engineers who found the codebase hard to work in cited dead code.
  - Eder et al., over two years on one Munich Re system: 25% of methods were never used, yet only 7.6% of modifications touched them, and about 3.6% of all maintenance was needless. The authors call unused code "not a severe problem … of the examined system". They expect more waste in teams with higher turnover.
  - Malavolta et al. (30 mobile web apps): removing JS dead code improved loading time and cut bytes transferred.
  - Ranking by churn is inferred from Eder's finding that changes concentrate on used code. No source tests it directly.
- **Evidence:**
  - [A Multi-Study Investigation Into Dead Code](https://www.cs.wm.edu/~denys/pubs/TSE'18-DeadCode.pdf) — Romano et al., TSE 2020 — peer_reviewed — "dead code significantly worsens comprehension of unfamiliar code"; "dead methods are more harmful than dead classes"; "some participants wasted time modifying existing dead code while implementing a change request and it seems that they were not aware of changing dead code"; findings table F16–F21 — verified in full text.
  - [How Much Does Unused Code Matter for Maintenance?](https://teamscale.com/publications/2012-how-much-does-unused-code-matter-for-maintenance.pdf) — Eder et al., ICSE 2012 — peer_reviewed — "25% of all method genealogies were never used during the complete period"; "Only 7.6% of the system's changes affect methods that have never been executed"; "unused code is not a severe problem in the maintenance of the examined system. But nearly 50% of the maintenance actions that were performed on the unused parts of the system affected methods that were unnecessary" — verified.
  - [Dead Code Removal at Meta](https://users.encs.concordia.ca/~pcr/paper/Shackleton2023FSE-industry-preprint.pdf) — Shackleton et al., ESEC/FSE 2023 — peer_reviewed — "of engineers who said, 'I find it challenging to work in the codebase', 30% of them cited dead code as the reason." — verified.
  - [JavaScript Dead Code Identification, Elimination, and Empirical Assessment](http://www.ivanomalavolta.com/files/papers/TSE_2023.pdf) — Malavolta et al., TSE 49(7), 2023 — peer_reviewed — "the removal of JavaScript dead code has a positive impact on the loading time of mobile web apps, while significantly reducing the number of bytes transferred over the network" (30 apps); energy "slight positive", CPU/memory "mixed" — verified.
- **Detect:** Rank files by churn with `git log --since=12.months --format= --name-only | sort | uniq -c | sort -rn`. Join the ranking with dead-code tool output and handle high-churn files first. For web front-ends, compare bundle size before and after.
- **Tools:** git log, knip, vulture, deadcode, bundle analyzers.
- **Applies to:** All codebases. The performance benefit applies to shipped JS bundles.
- **When not to apply / counterpoints:** Romano's participants were students and the samples were small. Eder studied a single system with long-tenured experts. Removal in stable, rarely read modules has low benefit and non-zero risk.
- **Fix risk:** low

### T06-F06 — For every symbol that looks unused, search the whole repository as text, including non-code files and string fragments
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:** Non-code files include config, SQL, templates, scripts, CI, docs and fixtures. If external consumers exist and cannot be searched, mark the symbol "external consumers unknown" and do not delete it.
- **Rationale:** Semantic analyzers cannot see references in strings, templates, configs or other repositories. Meta built a dedicated textual detector (BigGrep over all repositories) into SCARF. Practitioners report that grep catches mentions in comments, docs and scripts.
- **Evidence:**
  - [Dead Code Removal at Meta §3.2.2 BigGrep](https://users.encs.concordia.ca/~pcr/paper/Shackleton2023FSE-industry-preprint.pdf) — Shackleton et al., 2023 — peer_reviewed — "We implemented a specific detector based on textual references: we perform a code search through all repositories for all symbols and data assets that may be deprecated." — verified.
  - [Answer by piwi (score 42)](https://softwareengineering.stackexchange.com/a/343657) — Software Engineering SE, 2017 — practitioner_forum — "I also tend to grep for the function/class name in the code, which can give some additional benefits that a code analyzer might not, like if the name is mentioned in a comment or in a documentation file, or a script" — verified via the Stack Exchange API.
  - [Is Static Analysis Able to Identify Unnecessary Source Code? §7.1](https://www.se.cs.uni-saarland.de/publications/docs/HNR+19.pdf) — Haas et al., 2020 — peer_reviewed — "compute cross-language dependencies and to take non-code files into account, such as configuration files specifying dependencies" — verified.
- **Detect:**
  - `rg -n -w --hidden -g '!.git' -g '!node_modules' '<Symbol>'`.
  - Repeat case-insensitively, and for the snake_case, kebab-case and camelCase variants.
  - Search for string-building prefixes: concatenation, f-strings and template literals that start with the symbol's prefix.
  - For HTTP handlers, search route strings and client code.
  - Any hit outside the definition and its own tests blocks deletion until explained.
- **Tools:** ripgrep, git grep, organisation-wide code search.
- **Applies to:** All languages. Essential for routes, CLI commands, event names, config keys, env vars, SQL tables and columns, i18n keys, CSS classes and flag names.
- **When not to apply / counterpoints:** Text search gives false "alive" hits (comments, changelogs, similar names). Fully data-computed names are still missed, so F05 and runtime evidence remain necessary.
- **Fix risk:** low

### T06-F08 — Code whose only callers are tests, stories, fixtures or benchmarks is dead production code; delete its dedicated tests with it
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:** Detect such code by analysing without tests and then with tests, and comparing. Never count "covered by a test" as proof that code is live.
- **Rationale:**
  - Google's Sensenmann explicitly refuses test runs as a liveness signal, and makes each test share the fate of the library it tests.
  - Knip's default mode counts tests and stories as users; production mode excludes them.
  - A Romano interviewee acknowledged that tests can exercise dead methods.
  - Piranha deletes a flag's obsolete tests together with the flag.
- **Evidence:**
  - [Sensenmann: Code Deletion at Scale](https://testing.googleblog.com/2023/04/sensenmann-code-deletion-at-scale.html) — Phil Norman, Google Testing Blog, 2023-04-28 — engineering_blog — "we cannot use test runs as a 'liveness' signal: if we did, we'd consider lib2_test to be alive, which would keep lib2 around forever." "What we really want is for each test to share the fate of the library it is testing." — verified. The post also reports more than 1,000 deletion changelists per week and "nearly 5% of all C++ at Google" deleted.
  - [Knip production mode](https://knip.dev/features/production-mode) — Knip docs — official_docs — "The default mode for Knip is comprehensive and targets all project code, including configuration files, test files, Storybook stories, and so on."; production entries are marked with `!`; `--strict` implies `--production` — verified.
  - [A Multi-Study Investigation Into Dead Code, Theme 3, I4](https://www.cs.wm.edu/~denys/pubs/TSE'18-DeadCode.pdf) — Romano et al., 2020 — peer_reviewed — "it can happen that a test case exercises a method that is currently not used, that is dead." — verified.
  - [Piranha: Reducing Feature Flag Debt at Uber](https://manu.sridharan.net/files/ICSE20-SEIP-Piranha.pdf) — Ramanathan, Clapp, Barik, Sridharan, ICSE-SEIP 2020 (DOI 10.1145/3377813.3381350) — peer_reviewed — "all unreachable code artifacts due to this refactoring should also be removed. Obsolete tests related to the flag should also be deleted." — verified.
- **Detect:** Compare the two analyses in each ecosystem:
  - JS/TS: `knip --production`.
  - Go: `deadcode ./...` vs `deadcode -test ./...`.
  - Python: vulture over `src/` alone vs over `src/` plus `tests/`.
  - Java/C#: IDE unused-declaration inspection with test sources excluded.

  Then delete the tests whose only targets are the removed symbols, in the same commit.
- **Tools:** `knip --production`, `deadcode -test`, vulture, IDE inspections.
- **Applies to:** All projects with test suites.
- **When not to apply / counterpoints:**
  - Test-support code (builders, fakes) legitimately lives only for tests.
  - Romano's interviewees *tolerate* test-exercised dead code, because an accidental revival is lower risk.
  - Public library API exercised only by tests may be used externally (F07).
- **Fix risk:** low

### T06-F09 — Deleting reachable-but-suspected-unused code requires runtime evidence over a window that covers every business cycle; without telemetry, report instead of deleting
- **Grade:** B · **Verdict:** CORRECTED. "Both excluded batch jobs" is true of Eder only. "Tombstones have been adopted at several companies" rested on one HN commenter. The description of the technique is another reader's paraphrase, not a statement from the talk. The talk content itself is unverified (only its metadata). A verified Stack Exchange description of the logging technique and a leap-day counterpoint were added.
- **Rationale:**
  - Long observation windows are standard in the studies. Eder observed usage for 2 years (19 versions). Haas profiled for 6–16 months, "covering also critical time spans such as year closing or inventory time".
  - Eder also excluded tests and batch-job code, because they are systematically unused in production. The researcher said "both" studies did this; the second-pass check found no batch-job exclusion in the Haas text.
  - Google's Sensenmann deletes on the basis of binary-run logs (its example: a binary "last used over a year ago"). Meta's SCARF also uses runtime usage.
  - Runtime signals can be falsely "alive" (backup infrastructure, crawlers, an engineer's test queries). That blocks removal, which is safe.
  - Runtime-unused is also not the same as unnecessary: Eder found that unused code includes exception handlers.
- **Evidence:**
  - [Is Static Analysis Able to Identify Unnecessary Source Code? §5](https://www.se.cs.uni-saarland.de/publications/docs/HNR+19.pdf) — Haas et al., 2020 — peer_reviewed — "we recorded usage over a period of 6–16 months, covering also critical time spans such as year closing or inventory time"; "Running a profiler may reveal code that is not used in production, but it is often time-consuming to obtain representative data in this way" — verified.
  - [How Much Does Unused Code Matter for Maintenance?](https://teamscale.com/publications/2012-how-much-does-unused-code-matter-for-maintenance.pdf) — Eder et al., 2012 — peer_reviewed — "There are typically large parts of a system's code that are systematically unused in production such as unit tests or code related to batch jobs … it is important to exclude such code"; "we gathered usage data of 19 different program versions" over two years; unused code includes "error handling routines such as exception handlers" — verified.
  - [Sensenmann](https://testing.googleblog.com/2023/04/sensenmann-code-deletion-at-scale.html) — Google Testing Blog, 2023 — engineering_blog — "a log entry is written when a program runs … we get a liveness signal for every binary used in Google. If a program hasn't been used for a long time, we try sending a deletion changelist."; exceptions: "some programs run only in places we can't get a log signal from." — verified.
  - [Dead Code Removal at Meta §3.2.1, §4.2.3](https://users.encs.concordia.ca/~pcr/paper/Shackleton2023FSE-industry-preprint.pdf) — Shackleton et al., 2023 — peer_reviewed — "we identified a piece of backup infrastructure causing runtime usage to be logged and thus preventing automated deprecation"; "perhaps an engineer issued some test queries to a database themselves"; "unclear external traffic such as web crawlers" — verified.
  - [Answer by 9000 (score 29)](https://softwareengineering.stackexchange.com/a/343663) — Software Engineering SE, 2017 — practitioner_forum — log every invocation of the allegedly dead code with "a reasonable stack trace"; test "crossing a midnight, a turn of a quarter, a turn of a year"; run in production "for a few weeks"; make sure "once-a-month ETL cron jobs" run; "Anything that was logged is not actually dead. The transitive closure of the call graph … is also potentially not dead" — verified via the API (added as the primary description of the technique).
  - [David Schnepper's Ignite talk, "Isn't That Code Dead?" — Velocity Santa Clara 2014](https://www.youtube.com/watch?v=29UXzfQWOhQ) — O'Reilly (YouTube) — talk — **only the title and publisher were verified** (oEmbed). HN user philbo (38081756) says he introduced the talk's technique at three companies. The "dated tombstone in the logs" description comes from another reader's paraphrase (Tade0, 38081908), which philbo did not confirm. **Anecdotal.**
  - [Scavenger](https://github.com/naver/scavenger) — NAVER — official_docs — runtime dead-code analysis for JVM languages (derived from codekvast), plus a Python agent in beta. The agent "regularly send[s] the invocations of the host application to collectors" — verified (README).
- **Detect:**
  - Tombstone pattern: at the top of each suspect function, log a unique marker, the date and a stack trace. Deploy, then query the logs after the window.
  - Alternatives: per-route counts in HTTP access logs (3–12 months or more), a JVM agent (Scavenger), coverage collected in a production-like environment, scheduler history for cron and batch entry points.
  - Before deleting, list the cycle events the window covered: month, quarter and year ends, DST changes, leap day, DR drills.
- **Tools:** tombstone logging, access logs, NAVER Scavenger, profilers or production coverage, scheduler history.
- **Applies to:** Long-lived services and apps with production traffic; entry points (routes, jobs, CLI commands, message handlers, business-logic branches).
- **When not to apply / counterpoints:**
  - HN user kccqzy: profiling is "inherently probabilistic", and "only static analysis will do". charcircuit replies that 6 months of samples on 10k machines is strong evidence.
  - HN user teddyh on tombstones: "Great way to remove code handling leap days."
  - Absence of runtime use never proves that emergency or DR paths are unneeded.
  - A finished project handed to an agent usually has no such telemetry, so this class is report-only (F21).
- **Fix risk:** medium

### T06-F10 — Remove dead code in small, single-purpose, reversible steps; stage non-trivial removals; re-run the analyzers because deletion cascades
- **Grade:** B · **Verdict:** CORRECTED. Four fixes:
  - Sensenmann does not "rely on reviewers rolling back". Its docs reassure reviewers that deletions can be rolled back, and it stresses change descriptions that give enough background.
  - The first pass wrongly "corrected" the jfmengels cascade to seven steps. The article has eight: step 1 is implicit, and "Step 2" to "Step 8" are headed in the text. The researcher's "eight-step" was right, and the evidence line below is restored.
  - The Piranha counterpoint was misquoted. The body says about 66% of diffs were processed and landed within a week, and about 40% within a day or two, "to avoid possible merge conflicts". The abstract says "75% of the generated diffs are processed within a week". The paper does not measure conflicts in older diffs.
  - The Knip "cascade" sentence was a paraphrase and has been replaced by the verbatim text.
- **Rule:** One category, feature or flag per commit, with the evidence in the commit message (tool, rule id, searches, runtime window). For anything beyond class 1: deprecate or disable first (log and return early), then wait, then delete. Fix the cascade top-down.
- **Rationale:**
  - SCARF limits deletion speed so that mistakes surface slowly. It uses a notification or approval window, then a quarantine (for code, the removal commit), then a second waiting period with easy revert.
  - Sensenmann emphasises change descriptions concise enough to read but with "enough background for all reviewers to be able to make a judgement".
  - Knip prescribes an order (unused files, then unresolved imports, then exports, then dependencies), because removing files creates new unused exports and dependencies.
  - Haas lists deactivation (log a message and return at the entry point) as an intermediate strategy.
- **Evidence:**
  - [Dead Code Removal at Meta §4.2.1, §5](https://users.encs.concordia.ca/~pcr/paper/Shackleton2023FSE-industry-preprint.pdf) — Shackleton et al., 2023 — peer_reviewed — "even if SCARF incorrectly marks assets as deprecated, it will do so at a limited speed"; "For code, quarantine means landing a commit to remove the code … a further waiting period is initiated to allow time for any errors caused by this stage to be detected and reported. In this case, engineers can revert the quarantine" — verified.
  - [Automating dead code cleanup](https://engineering.fb.com/2023/10/24/data-infrastructure/automating-dead-code-cleanup/) — Engineering at Meta, 2023 — engineering_blog — "SCARF has automatically deleted more than 100 million lines of code in over 370,000 change requests" (the paper says "over 104 million lines") — verified.
  - [Sensenmann](https://testing.googleblog.com/2023/04/sensenmann-code-deletion-at-scale.html) — Google, 2023 — engineering_blog — change descriptions "must be concise, but must provide enough background for all reviewers to be able to make a judgement"; "some need reassurance that in a source control system, deletions can be rolled back" — verified.
  - [Knip: Resolve reported issues](https://knip.dev/guides/handling-issues) — Knip docs — official_docs — "Work the types top-down. Findings come in chains, so reducing unused files also reduces unused exports and dependencies: Unused files, Unresolved imports, Unused exports, Unused dependencies". The researcher's sentence "Dependencies in unused files cascade …" does not appear; the quote above replaces it — verified verbatim. The auto-fix page adds that after fixing, "Knip may then find more unused code. Rinse and repeat!"
  - [Knip auto-fix](https://knip.dev/features/auto-fix) — official_docs — "Use a VCS … to review and undo changes as necessary"; `--allow-remove-files` — verified.
  - [Is Static Analysis Able to Identify Unnecessary Source Code? §7.2](https://www.se.cs.uni-saarland.de/publications/docs/HNR+19.pdf) — Haas et al. — peer_reviewed — "deletion of the code from the code base, movement of the code to a special package …, deactivation of the code (i.e., making code unexecutable without deleting it, e.g., by adding a (log) message and returning immediately at the entry point …)" — verified.
  - [Safe dead code removal in a pure functional language](https://jfmengels.net/safe-dead-code-removal/) — Jeroen Engels, 2021-01-28 — engineering_blog — an eight-step cascade, in order:
    1. an unused variable binding
    2. the function it called, now unused
    3. an unused exposed function
    4. that function's definition
    5. a custom-type variant that is never constructed
    6. an import left unused
    7. a module file never imported
    8. an unused package dependency

    Also: "Every elm-review fix proposal requires an approval from the user before it gets committed to the file system." — verified.
- **Detect:**
  - Each removal commit touches one category, has a green build, type-check, lint and tests, and carries the evidence in its message.
  - After each commit, re-run knip, vulture or deadcode until nothing new appears.
  - Keep a removal log (symbol, evidence class, commit SHA).
- **Tools:** git, knip, vulture, deadcode, CI.
- **Applies to:** All projects. The staging and waiting steps matter most for services with production traffic and for published libraries.
- **When not to apply / counterpoints:** Staging is overkill for compiler-proven class-1 items. Long waits risk the cleanup never finishing. Piranha's reviewers processed about 40% of diffs within a day or two to avoid merge conflicts.
- **Fix risk:** low

### T06-F11 — Find stale feature flags and remove each one completely, after confirming it is fully rolled out, unchanged for a set period, and not a kill switch
- **Grade:** B · **Verdict:** CORRECTED. The tool status was updated: Uber's per-language Piranha (Java, Swift, ObjC) was superseded in May 2022 by Polyglot Piranha, and the legacy versions survive only as a git tag. Piranha's own "$465M" figure for Knight was flagged against the SEC's $460M.
- **Rule:** Remove the flag check, the losing branch, code that becomes unreachable as a result, flag-specific tests, and the flag definition and config. Keep the retained branch's behaviour exactly as it is.
- **Rationale:**
  - Piranha generated cleanup diffs for 1,381 flags (17% of all flags). 65% of them landed without changes, and more than 85% compiled and passed tests.
  - Its authors warn that a completely rolled-out flag may still not be stale (kill switches, debug and monitoring flags). Their pipeline's heuristic treats flags unmodified for a configurable period (e.g. 8 weeks) as stale.
  - Hodgson (martinfowler.com) treats toggles as inventory with a carrying cost, and recommends removal tasks, expiry dates, "time bombs" and caps.
- **Evidence:**
  - [Piranha: Reducing Feature Flag Debt at Uber](https://manu.sridharan.net/files/ICSE20-SEIP-Piranha.pdf) — Ramanathan, Clapp, Barik, Sridharan, ICSE-SEIP 2020 — peer_reviewed — "generated code cleanup diffs for 1381 flags (17% of total flags), (b) 65% of the diffs landed without any changes, (c) over 85% of the generated diffs compile and pass tests successfully"; "certain flags are used as kill switches … even when flags are completely rolled out, they may not necessarily be stale"; "unmodified in the flag management system for more than a specific period (e.g., 8 weeks)" — verified (deployment Dec 2017–May 2019).
  - [uber/piranha README](https://github.com/uber/piranha) — Uber — official_docs — "PolyglotPiranha (as of May 2022) is a common refactoring tool to support multiple languages and feature flag APIs"; legacy implementations are available only via a tag; "We only support languages that are used at Uber" — verified (added by fact-checker).
  - [Feature Toggles (aka Feature Flags)](https://martinfowler.com/articles/feature-toggles.html) — Pete Hodgson, martinfowler.com, completed 2016-02-08, last revised 2017-10-09 — engineering_blog — "Savvy teams view the Feature Toggles in their codebase as inventory which comes with a carrying cost and seek to keep that inventory as low as possible."; "time bombs which will fail a test (or even refuse to start an application!) if a feature flag is still around after its expiration date"; a limit on the number of flags — verified.
  - [SEC Release 34-70694](https://www.sec.gov/files/litigation/admin/2013/34-70694.pdf) — U.S. SEC, 2013 — incident_report — "orders sent with the repurposed flag to the eighth server triggered the defective Power Peg code still present on that server"; "Knight realized a $460 million loss" — verified.
- **Detect:**
  - List flag call sites: `isEnabled(`, `isFeatureEnabled(`, `getFlag(`, `variation(`, `useFlag(`, `useFeature(`, `featureFlags.`, `process.env.(FEATURE|FF|ENABLE)_`.
  - Join them with the flag-service state (rollout %, last modified).
  - Mark as stale anything at 0% or 100% and unchanged for N weeks. Exclude kill switches, circuit breakers and ops or permission toggles.
  - Look for flags read in only one place, or compared with a hard-coded constant.
  - Automation: Polyglot Piranha (only for languages and flag APIs it supports).
  - After removal, grep configs, tests, dashboards and docs for the flag name.
- **Tools:** Polyglot Piranha, ripgrep, flag-management export, test suite.
- **Applies to:** Any codebase with feature flags or toggles, config switches or env-var gates.
- **When not to apply / counterpoints:**
  - HN user ori_b: in critical systems, keeping the old path switchable "for a couple of release cycles" has "saved my team's bacon".
  - Removing the wrong branch inverts behaviour.
  - Flags may be copied elsewhere for their side effects (HN user ozten), so each needs a full search.
  - Without access to the flag service, an agent cannot confirm rollout state, so this is Tier C.
- **Fix risk:** medium

### T06-F13 — Kept-but-uncalled code must be tested or removed; never leave callable, untested dormant code on a production path
- **Grade:** B · **Verdict:** VERIFIED. The fact-checker added Caivano et al. (EMSE 2023), which weakens the "keep it for later" rationale.
- **Rule:** Anyone who changes shared logic that dormant code depends on must re-test it or delete it.
- **Rationale:**
  - The SEC found that Knight stopped using Power Peg in 2003 but left it "present and callable". In 2005 Knight moved the cumulative-quantity function without retesting Power Peg, and it had no protocol for testing unused code after accessing it.
  - Caivano et al. found that dead methods "are rarely revived", "survive for a long time", and that most are "stillborn". That undercuts "just in case" retention.
  - Practitioners summarise the fix as "if you liked it, then put a test on it".
- **Evidence:**
  - [SEC Release 34-70694, ¶¶13–14, 26, 41](https://www.sec.gov/files/litigation/admin/2013/34-70694.pdf) — U.S. SEC, 2013 — incident_report — "Despite the lack of use, the Power Peg functionality remained present and callable"; "Knight did not retest the Power Peg code after moving the cumulative quantity function"; "Knight also did not have a written protocol concerning the accessing of unused code on its production servers, such as a protocol requiring the testing of any such code after it had been accessed"; "4 million executions in 154 stocks for more than 397 million shares in approximately 45 minutes" — verified.
  - [On the spread and evolution of dead methods in Java desktop applications: an exploratory study](https://doi.org/10.1007/s10664-023-10303-0) — Caivano, Cassieri, Romano, Scanniello, Empirical Software Engineering 28(3), 2023 (CC-BY) — peer_reviewed — 23 open-source Java desktop apps, 1,587 commits: "dead methods generally survive for a long time before being 'buried' or 'revived'"; "dead methods are rarely revived"; "most dead methods are stillborn" — verified from the abstract via Crossref (added by fact-checker; full text not read).
  - [HN comment by dekhn](https://news.ycombinator.com/item?id=35757803) — Hacker News, 2023-04-29 — practitioner_forum — "Google's response to Chesterton's Fence is: 'if you liked it, then put a test on it'" — verified via the Algolia API.
  - [Answer by Adrian McCarthy](https://softwareengineering.stackexchange.com/a/343767) — Software Engineering SE, 2017 (score 7) — practitioner_forum — "code is not an asset, it's a liability. Unless you can explain why it's important and point to its tests, the 'safer' alternative might very well be to delete it. If you're still not sure, then at least make sure to add tests to exercise the zombie code." — verified.
- **Detect:** Cross the coverage report with the static dead-code report. Items that are statically unreferenced (or reached only through a disabled flag) *and* have 0% coverage are "dormant untested": add a test or remove them. Search comments near definitions for keep-markers: `unused|not used|legacy|deprecated|keep for|may need|todo: remove|dead`.
- **Tools:** coverage (c8/istanbul, coverage.py, JaCoCo, `go test -cover`, cargo llvm-cov), vulture, knip, ripgrep.
- **Applies to:** All production codebases. Critical in trading, payments, safety and infrastructure code.
- **When not to apply / counterpoints:**
  - Writing tests for code nobody wants is waste; deletion is usually the better answer.
  - Knight had multiple causes: a manual deploy that missed one of 8 servers, no second technician, and BNET Reject emails that were not acted on. Dormant code was necessary for the failure but not sufficient.
- **Fix risk:** low

### T06-F14 — Delete commented-out code blocks; keep only prose that explains why an obvious alternative must not be used; clear commented-out code before an AI agent generates nearby code
- **Grade:** B · **Verdict:** CORRECTED. Four fixes:
  - Comment Traps is peer reviewed (PACMSE vol. 3, FSE 2026), not only a preprint.
  - The study's models and metrics were stated precisely.
  - The CERT "contradiction" was overstated: MSC12-EX2 permits temporarily removing code that may be needed later, but its cross-reference MSC04-C advises `#if 0` or a compiled `if` block rather than `/* */` comments.
  - The Sonar source was switched to the SonarCloud API, because next.sonarqube.com returned 503.
- **Rationale:**
  - Commented-out (CO) code is widespread: 84.62% of 6,403 Python repositories and 13.09% of Python files contain it, and 21.19% of CO comment lines had CodeQL-detectable defects.
  - In controlled generation with GitHub Copilot and Cursor (GPT-4o and Claude 3.5 Sonnet), defective CO code in the context raised the defect count by up to 58.17% relative to a no-CO control, in the worst configuration.
  - Telling the tools to ignore it reduced defects by 4.93–21.84% depending on the configuration.
  - Romano's interviewees comment code out as a note of removal, which creates a new smell.
  - SonarSource ships S125 in multiple languages.
  - Practitioners allow one exception: a note explaining why an obvious approach fails.
- **Evidence:**
  - [Comment Traps: How Defective Commented-out Code Augment Defects in AI-Assisted Code Generation](https://arxiv.org/html/2512.20334) — Yuan Huang, Yukang Zhou, Xiangping Chen, Zibin Zheng, PACMSE vol. 3 (FSE 2026), DOI 10.1145/3797102; arXiv v1 2025-12-23, v2 2026-02-18 — peer_reviewed — "We found that 84.62% of repositories and 13.09% of Python files contained CO code, with 21.19% of those CO code having detectable defects"; "reaching up to 58.17 percent"; "the reduction in defects does not exceed 21.84 percent". Tables 2, 3 and 6 were checked: 21.19% is at comment-line granularity; 58.17% is the relative increase (Claude 3.5 via Copilot, CO code three lines below) — verified in full HTML text.
  - [A Multi-Study Investigation Into Dead Code, Theme 4.c / F14](https://www.cs.wm.edu/~denys/pubs/TSE'18-DeadCode.pdf) — Romano et al., 2020 — peer_reviewed — "Commenting out dead code causes the introduction of new smells (i.e., commented out code [3])"; I6: "To satisfy delivery times, we just comment code that's supposed to be dead." — verified.
  - SonarSource S125 "Sections of code should not be commented out" (java, python, csharpsquid, javascript) — SonarSource — official_docs — rule names verified via the [SonarCloud rules API](https://sonarcloud.io/api/rules/search?rule_key=java:S125&organization=sonarsource) (tag `unused`, type CODE_SMELL); the description was not retrievable.
  - [Checking in of "commented out" code](https://stackoverflow.com/questions/758279) — Stack Overflow, 2009 (question closed as opinion-based) — practitioner_forum — Rex M (score 132): "Commenting is not a valid archival strategy". His later edit adds: "I don't think it's necessarily a good idea to ban commented code". Dissent from [Loren Pechtel (score 28)](https://stackoverflow.com/a/758645): keep "// This approach doesn't work" when the obvious approach has a subtle flaw, because "the repository wouldn't warn anyone in the future not to go down that road." — verified via the API.
  - [MSC12-EX2](https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/miscellaneous-msc/msc12-c) and [MSC04-C](https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/miscellaneous-msc/msc04-c) — SEI CERT C — standard — "It is permissible to temporarily remove code that may be needed later. (See MSC04-C …)"; MSC04-C: "this approach is not recommended for commenting out code … Instead of using /* and */ to comment out blocks of code, use conditional compilation (for example, #if, #ifdef, or #ifndef)" — verified verbatim.
- **Detect:**
  - SonarQube/SonarLint S125 for each language.
  - Heuristic: comment lines (`//`, `#`, `--`) that begin with a keyword (`if`, `for`, `return`, `import`, `def`, `class`, `function`, `const`, `let`, `var`, `await`, `print`, `console.`) and end in `;`, `:`, `{`, `)` or `(`. Also block comments containing `;` or braces.
  - Review every hit manually. Keep license headers, docstring examples and prose explanations.
- **Tools:** SonarQube/SonarLint S125, ripgrep.
- **Applies to:** All languages. For AI-assisted projects, the benefit applies directly to the quality of the agent's context.
- **When not to apply / counterpoints:**
  - CERT tolerates temporarily disabled code in C, but via `#if 0` or a compiled `if` block, not comments.
  - Docstring and API-doc examples are documentation, not dead code.
  - Comment Traps covers only Python and 2024-era models (GPT-4o, Claude 3.5 Sonnet), and measures AI output, not human maintainers.
- **Fix risk:** low

### T06-F17 — Detect unused declared dependencies with an ecosystem tool, then check each one for non-import usage before removing it
- **Grade:** B · **Verdict:** CORRECTED. Latendresse's abstract speaks of *installed* dependencies in 100 JavaScript projects, not "declared" ones. Whether that includes transitive dependencies is not stated in the abstract; the full text was not read. depcheck's archive date was added (GitHub banner: "archived by the owner on Jun 16, 2025"; last npm release 1.4.7, 2023-10-17). Two further additions:
  - Soto-Valero's merge figure is "18/21 *answered* pull requests".
  - cargo-machete warns that `--with-metadata` "may modify the Cargo.lock files".
- **Rule:** Non-import usage includes CLI binaries used in scripts, plugins or presets referenced from config files, drivers loaded by name or URL, build-script-generated code, renamed packages, peer dependencies and type-only packages. Remove, reinstall from a clean lockfile, build and test. Also check for runtime dependencies declared as dev dependencies, and the reverse.
- **Rationale:**
  - Soto-Valero et al.: 75.1% of 723,444 Maven dependency relationships (9,639 artifacts) were bloated. Developers merged 18 of 21 answered PRs, removing 131 dependencies.
  - Latendresse et al. (100 npm projects): fewer than 1% of *installed* dependencies ship to production; 59% of installed dependencies configured as runtime are not used in production; 28.2% of those configured as development *are* used in production. Most security alerts target dependencies that never reach production.
  - Tool docs list typical false positives: build.rs-generated code and renamed crates.
- **Evidence:**
  - [A comprehensive study of bloated dependencies in the Maven ecosystem](https://arxiv.org/abs/2001.07808) — Soto-Valero, Harrand, Monperrus, Baudry, Empirical Software Engineering, 2021 (DOI 10.1007/s10664-020-09914-8) — peer_reviewed — "Our key result is that 75.1% of the analyzed dependency relationships are bloated"; "18/21 answered pull requests were accepted and merged by developers, removing 131 dependencies in total" — verified (abstract via the arXiv API).
  - [Not All Dependencies are Equal: An Empirical Study on Production Dependencies in NPM](https://arxiv.org/abs/2207.14711) — Latendresse, Mujahid, Costa, Shihab, ASE 2022 — peer_reviewed — "less than 1% of the installed dependencies are released to production"; "59% of the installed dependencies configured as runtime dependencies are not used in production, and 28.2% of the dependencies configured as development dependencies are used in production"; "most security alerts target dependencies not used in production" — verified (abstract).
  - [depcheck README](https://github.com/depcheck/depcheck) — depcheck maintainers — official_docs — "Depcheck is no longer actively maintained"; "We strongly recommend switching to knip"; archived 2025-06-16 — verified.
  - [cargo-machete README](https://github.com/bnjbvr/cargo-machete) — Benjamin Bouvier, v0.9.2 — official_docs — `prost` "Used in code generated by build.rs output, which cargo-machete cannot check"; renamed crates "trigger false positives" without `--with-metadata` — verified.
  - [deptry rules and violations](https://deptry.com/rules-violations/) — deptry 0.25.1 (PyPI 2026-03-18) — official_docs — DEP002: "Development dependencies are not considered for this rule"; DEP004: "Dependencies specified as development ones that should be included as regular dependencies" — verified.
- **Detect:**
  - JS/TS: knip (dependencies, devDependencies, unlisted, binaries).
  - Python: `deptry .` (DEP001–DEP004).
  - Rust: `cargo machete` (optionally `--with-metadata`) or cargo-udeps.
  - Java/Maven: DepClean or `mvn dependency:analyze`.
  - For each candidate, grep for the package name across config files (lint/babel/postcss/jest/vite configs, Dockerfile, CI, Makefile, package scripts, DB URLs, `INSTALLED_APPS`).
  - Then do a clean install (`pnpm install --frozen-lockfile`, etc.) and run the full test suite.
- **Tools:** knip, deptry, cargo-machete, cargo-udeps, DepClean, `mvn dependency:analyze`.
- **Applies to:** All package-managed projects.
- **When not to apply / counterpoints:** Some "unused" dependencies are deliberate pins for security fixes (overrides/resolutions) or peer requirements. Latendresse implies that removing dev-only packages buys less security than alert counts suggest.
- **Fix risk:** medium

### T06-F22 — Record confirmed false positives in checked-in allowlists or config with a reason; prefer fixing the tool configuration; prune stale entries
- **Grade:** B · **Verdict:** CORRECTED. Two fixes:
  - Microsoft calls `[DynamicDependency]` a "last resort"; the preferred .NET annotations are `[DynamicallyAccessedMembers]` and `[RequiresUnreferencedCode]`.
  - The vulture rationale merged two separate reasons. Whitelists beat `noqa` because `noqa` "add[s] visual noise". Whitelists beat `--ignore-names`/`--ignore-decorators` because they are syntax-checked and can be checked for continued existence.
- **Rule:** Use a checked-in allowlist or config (vulture `whitelist.py`, knip config, cargo-machete `ignored`, R8 keep rules, .NET trimming annotations), not scattered inline suppressions. Review the allowlist on each pass.
- **Rationale:**
  - Mature deletion systems keep an explicit exception mechanism; Sensenmann uses a blocklist.
  - Vulture recommends whitelists over `noqa` comments, which "add visual noise to the code". It recommends them over `--ignore-names`/`--ignore-decorators` because whitelists "are automatically checked for syntactic correctness" and let you "check that all whitelisted code actually still exists".
  - Knip treats ignores as a last resort, after fixing entry and project configuration.
  - Annotations make dynamic use visible to every future analysis. In .NET, `DynamicDependency` is the last resort among them.
- **Evidence:**
  - [Vulture README: Handling false positives](https://github.com/jendrikseipp/vulture) — Jendrik Seipp — official_docs — "The recommended option is to add used code that is reported as unused to a Python module and add it to the list of scanned paths"; "we recommend using whitelists instead of `noqa` comments, since `noqa` comments add visual noise"; whitelists let you "check that all whitelisted code actually still exists in your project" — verified.
  - [Sensenmann](https://testing.googleblog.com/2023/04/sensenmann-code-deletion-at-scale.html) — Google, 2023 — engineering_blog — "it's important to have a blocklisting system so that exceptions can be marked, and we can avoid bothering people with spurious changelists." — verified.
  - [Knip: Handling issues](https://knip.dev/guides/handling-issues) — official_docs — "Reach for ignore* options only as a last resort" — verified.
  - [cargo-machete README](https://github.com/bnjbvr/cargo-machete) — official_docs — `[package.metadata.cargo-machete] ignored = ["prost"]` with an explanatory comment — verified.
  - [Prepare .NET libraries for trimming](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/prepare-libraries-for-trimming) — Microsoft Learn — official_docs — "Use `[DynamicDependency]` attribute only as a last resort when the other approaches aren't viable. It is preferable to express the reflection behavior using `[RequiresUnreferencedCode]` or `[DynamicallyAccessedMembers]`." — verified (added by fact-checker).
- **Detect:**
  - Look for an allowlist per tool: `whitelist.py` or `[tool.vulture]`, knip `ignore*`, cargo-machete metadata, `proguard-rules.pro`, .NET trimming attributes.
  - Count inline suppressions (`noqa: F401`, `eslint-disable … no-unused`, `#[allow(dead_code)]`, `@SuppressWarnings("unused")`, `NOSONAR`).
  - Move the justified suppressions into allowlists, with reasons.
  - Run vulture on the whitelist to find stale entries.
- **Tools:** `vulture --make-whitelist`, knip config, cargo-machete metadata, R8 keep rules, .NET `DynamicallyAccessedMembers`/`RequiresUnreferencedCode` (and `DynamicDependency` as a last resort).
- **Applies to:** Projects that run dead-code tools repeatedly.
- **When not to apply / counterpoints:** An inline suppression is more discoverable and survives file moves; some teams prefer it for single local cases. Allowlists rot too, so they need periodic review.
- **Fix risk:** low

### T06-F20 — Before deleting a non-trivial unit, reconstruct why it exists (Chesterton's fence) with version-control archaeology
- **Grade:** C · **Verdict:** VERIFIED
- **Rule:** Find the commit and ticket that introduced the unit and the change that made it unreferenced. Frame the removal as "feature X was retired in <commit>; Y only served X".
- **Rationale:**
  - Haas et al.: "the necessity of a piece of code cannot be deduced from the code alone".
  - In Eder's study, maintainers did not know why a method was unused in 48% of cases.
  - A highly voted practitioner answer finds that tying code to a retired feature is the strongest argument for deletion.
  - Git's pickaxe (`-S`) and line-log (`-L`) make this archaeology cheap.
- **Evidence:**
  - [Answer by Cort Ammon (score 86)](https://softwareengineering.stackexchange.com/a/343662) — Software Engineering SE, 2017 — practitioner_forum — "It's a lot easier to argue 'X is no longer a feature of our product, and code segment Y was designed to support feature X' than it is to say 'I don't see any purpose for code segment Y.'"; quotes Chesterton's Fence — verified via the API.
  - [Is Static Analysis Able to Identify Unnecessary Source Code? §7.2](https://www.se.cs.uni-saarland.de/publications/docs/HNR+19.pdf) — Haas et al. — peer_reviewed — "Unnecessary code is difficult to identify as the necessity of a piece of code cannot be deduced from the code alone" — verified.
  - [How Much Does Unused Code Matter for Maintenance?](https://teamscale.com/publications/2012-how-much-does-unused-code-matter-for-maintenance.pdf) — Eder et al. — peer_reviewed — "In 48% of our findings for maintenance of unused code, the developers did not know why the method was not used." — verified.
  - [git-log documentation](https://git-scm.com/docs/git-log) — Git project — official_docs — `-S<string>`: "Look for differences that change the number of occurrences of the specified <string> (i.e. addition/deletion) in a file"; `-L:<funcname>:<file>`: "Trace the evolution of the line range given by … the function name regex <funcname>, within the <file>" — verified.
- **Detect:**
  - `git log -S'<symbol>' --oneline --all` shows when the symbol was introduced and when its last caller disappeared.
  - `git log -L :<func>:<file>` gives the function's history.
  - `git blame -w -C` on former call sites shows the removed caller.
  - Put the commit that made it dead, and the originating feature, in the removal message.
  - If no retired feature can be named, report the item as "purpose unknown", unless it is class-1 dead code.
- **Tools:** `git log -S/-G/-L`, git blame, issue tracker.
- **Applies to:** Any unit larger than a local variable or import, especially in inherited code.
- **When not to apply / counterpoints:** Archaeology costs time. Google's culture, as HN user dekhn describes it, inverts the burden: no test and no runtime use means delete, and whoever needs the code adds a test. The step is unnecessary for class-1 items.
- **Fix risk:** low

### T06-F21 — Put every candidate in a risk tier and act only within that tier (A auto-fix; B reviewed commits after confirmation; C report only)
- **Grade:** C (was B) · **Verdict:** DOWNGRADED. The three-tier scheme is the researcher's synthesis. The sources show that professionals make risk- and cost-based removal decisions, and that deletion carries asymmetric blame. No source defines or evaluates this tiering.
- **Rule:**
  - Tier A, auto-fix: compiler- or linter-proven dead code, once F02 has cleared unreachable code.
  - Tier B, fix in reviewed commits after F04/F05/F06 confirmation: internal functions, exports, files, dependencies, stale tests.
  - Tier C, report only: anything needing runtime evidence, public API, feature flags, weakly tested high-consequence paths, or code of unknown purpose.
- **Rationale:**
  - Romano's interviewees (n=6) remove dead code when removal is low-risk and low-cost, ignore it when high-risk, and postpone it when high-cost.
  - Haas observed that developers "get little acknowledgment for deleting code but get into big trouble when deleted code is still necessary".
  - The top Stack Exchange answer judges deletion "simply not worth it" without trustworthy tests. Others call unexplained code a liability, and Knight shows that retention can be the riskier choice.
  - The tiering reconciles these views but is not itself validated.
- **Evidence:**
  - [A Multi-Study Investigation Into Dead Code (F10–F12)](https://www.cs.wm.edu/~denys/pubs/TSE'18-DeadCode.pdf) — Romano et al., 2020 — peer_reviewed — "When a developer identifies dead code, its removal is: 1) performed if this operation is low-risk and low-cost; 2) ignored if it is high-risk; 3) postponed if it is high-cost." — verified.
  - [Is Static Analysis Able to Identify Unnecessary Source Code? §7.2](https://www.se.cs.uni-saarland.de/publications/docs/HNR+19.pdf) — Haas et al. — peer_reviewed — quote above — verified. It is framed as a hypothesis ("we hypothesize").
  - [Answer by Philipp (score 109)](https://softwareengineering.stackexchange.com/a/343648) — Software Engineering SE, 2017 — practitioner_forum — "lots of code either has no unit tests or when they are there can not be trusted … So I would consider the risk/reward and come to the conclusion that it is simply not worth it" — verified.
  - [SEC Release 34-70694, ¶41](https://www.sec.gov/files/litigation/admin/2013/34-70694.pdf) — U.S. SEC, 2013 — incident_report — "in 2003, Knight elected to leave the Power Peg code on SMARS's production servers" — verified.
- **Detect:**
  - Add a tier column to the removal report.
  - Tier A requires a compiler or linter diagnostic id.
  - Tier B requires two independent confirmations plus a green build and tests.
  - Tier C items list the missing evidence, for example "needs 12-month route logs covering fiscal year-end", "public export of published package", "flag state unknown".
  - Use coverage of the affected files to decide between B and C.
- **Tools:** coverage tools, linters and compilers, knip/vulture/deadcode, report template.
- **Applies to:** Any automated or agent-driven cleanup of a finished project, especially without production telemetry or the original authors.
- **When not to apply / counterpoints:** Excess conservatism lets dead code pile up. Google and Meta automate deletions that would fall in Tier B or C, backed by runtime data and review. A human owner with context can safely promote items out of Tier C.
- **Fix risk:** low

## Practitioner voice

All items below were opened through the Hacker News Algolia API, the Stack Exchange API, or directly, and say what is claimed.

- [taspeotis, HN 35757814](https://news.ycombinator.com/item?id=35757814) — Time-window liveness fails for seasonal code: "Good luck explaining to the accountants that you deleted their end-of-year reconciliation reports because they didn't run them every 6mo."
- [ninjanomnom, HN 35757462](https://news.ycombinator.com/item?id=35757462) — Code that triggers only on a yearly holiday, disaster alerts or leap years would be "very problematic if removed". Truly unreachable code "shouldn't exist in the first place".
- [dekhn, HN 35757803](https://news.ycombinator.com/item?id=35757803) — "Google's response to Chesterton's Fence is: 'if you liked it, then put a test on it'". He refused rollbacks for untested code broken by his numpy upgrades, and accepted his own unused code being auto-deleted.
- [kgeist, HN 35758572](https://news.ycombinator.com/item?id=35758572) — On an inherited 14-year-old monolith, they downloaded 3 months of access logs to find endpoints with zero or low use. The next step was a dependency graph to find code reachable only from dead endpoints.
- [kccqzy, HN 35758083](https://news.ycombinator.com/item?id=35758083) — Dissent: "Profiling is inherently probabilistic … Only static analysis will do." [charcircuit, HN 35758213](https://news.ycombinator.com/item?id=35758213) replies that 6 months of samples from 10k machines is strong evidence.
- [meindnoch, HN 35760848](https://news.ycombinator.com/item?id=35760848) — "A lot of dead code doesn't look dead to static analysis. E.g. gated by long-forgotten feature flags, or platform checks that are no longer relevant." [GeneralMayhem, HN 35761105](https://news.ycombinator.com/item?id=35761105) adds flags only ever set to one value, codepaths unexercised for months, and databases unaccessed for years.
- [philbo, HN 38081756](https://news.ycombinator.com/item?id=38081756) — Has introduced the technique from Schnepper's Velocity talk at three companies, and it "worked well in all three places". The tombstone description in the thread is a reader's paraphrase ([Tade0, 38081908](https://news.ycombinator.com/item?id=38081908)), and [teddyh, 38159439](https://news.ycombinator.com/item?id=38159439) objects: "Great way to remove code handling leap days."
- [ori_b, HN 11716216](https://news.ycombinator.com/item?id=11716216) — Pushback on prompt flag removal: in critical systems, keeping the ability to flip back "for a couple of release cycles" has "saved my team's bacon".
- [ozten, HN 11716435](https://news.ycombinator.com/item?id=11716435) — Another developer may copy a flag elsewhere "to get some desired side-effect", so grep and think through every use before removing a flag.
- [alblue, HN 11717817](https://news.ycombinator.com/item?id=11717817) — A macro with the feature name and a future date, with one date for warnings and another for errors: "Works like a charm."
- [9000, SE 343663](https://softwareengineering.stackexchange.com/a/343663) — Log every invocation of the allegedly dead code with a stack trace. Make the *test suites* cover midnight, quarter and year boundaries. Run in production "for a few weeks", making sure periodic jobs such as "once-a-month ETL cron jobs" run in that period. Anything logged, and its call-graph closure, is not dead.
- [Philipp, SE 343648](https://softwareengineering.stackexchange.com/a/343648) — Top answer (109): without trustworthy tests, the reward is small and the incident risk is yours; "it is simply not worth it".
- [Adrian McCarthy, SE 343767](https://softwareengineering.stackexchange.com/a/343767) — Dissent: "code is not an asset, it's a liability". If you cannot explain it and point to its tests, deleting may be safer; otherwise add tests to the zombie code.
- [Loren Pechtel, SO 758645](https://stackoverflow.com/a/758645) — One legitimate kind of commented-out code is a note that the obvious approach does not work, because the repository alone won't warn future developers.
- [Microsoft Inside Track: "scream test"](https://www.microsoft.com/insidetrack/blog/microsoft-uses-a-scream-test-to-silence-its-unused-servers/) — David Hirning, dated 2025-11-20. For *infrastructure*, not code: they turned off suspected-unused servers and waited for complaints. About 15% of machines turned out unnecessary. The 15–20% lower compute cost is credited to a broader "better understanding of our business needs". Now on a six-month review cycle.
- [Doug Seven: Knightmare](https://dougseven.com/2014/04/17/knightmare-a-devops-cautionary-tale/) — "why code that had been dead for 8-years was still present in the code base is a mystery". An old flag was repurposed and a deployment missed one of eight servers. The SEC dates Power Peg's retirement to 2003, about 9 years before the incident.

## Contradictions and open questions

**Contradictions:**

- **How harmful dead code is.**
  - Romano et al. find dead code significantly worsens comprehension effectiveness and efficiency on unfamiliar code. They find no significant effect on comprehension effort, or on the modifiability of familiar code.
  - Eder et al. find only 7.6% of changes touch unused code and 3.6% of maintenance is wasted; "not a severe problem" in one expert-maintained system.
  - Meta's survey: 30% of engineers who struggle with the codebase blame dead code.
- **Commented-out code.** SonarSource S125, the Stack Overflow top answer, Romano's interviews and Comment Traps (FSE 2026) all push deletion. CERT MSC12-EX2 tolerates temporarily disabled code, but its cross-reference MSC04-C prefers `#if 0` or a compiled `if` block to comments. Rex M himself softens: he does not advocate banning commented code, and a minority answer keeps "this approach doesn't work" notes.
- **Static vs runtime evidence.** Some practitioners (kccqzy) trust only static analysis. Google, Meta, Eder and Haas all rely on runtime usage. Haas notes that profiling data is slow to obtain, and Eder shows that runtime-unused code includes exception handlers.
- **Tests as a liveness signal.** Romano's interviewees treat test execution as evidence that code is alive, and tolerate test-exercised dead code. Google's Sensenmann refuses test runs as a liveness signal and makes tests share the fate of the code they test.
- **Delete vs keep when uncertain.** The top SE answer and Romano's interviewees skip high-risk removals. McCarthy, Google engineers and the Knight order treat dormant code as the risk. Caivano et al. (dead methods rarely revived) weaken the "keep for later" case.
- **Flag removal timing.** Piranha's staleness heuristic (a configurable period, e.g. 8 weeks) and Hodgson's expiry dates and time bombs push prompt removal. ori_b argues for keeping the old path switchable for a couple of release cycles in critical systems.
- **Defensive "unreachable" code.** CERT MSC12-EX1 keeps an enum-exhaustive `default` as resilience code, while unreachable-code linters may flag such branches.
- **Is dead-code analysis "reliable"?** Haas et al. classify dead-code (unreachability) analysis as "analytical static necessity analysis which can reliably discriminate between necessary and unnecessary code", and advise using it "whenever possible". In their own sample, however, UCDetector's dead-class warnings were right only 32% of the time.
  - The two statements are reconciled if "reliable" holds only for *sound* analyses of closed code: compiler-proven unused locals, or unreachability within one function.
  - It fails once dynamic or external references exist (DI, reflection, tests-only references, which UCDetector counts as dead).
  - This is the basis for the class-1 versus class-2 split in F01.

**Open questions:**

- Two directly relevant recent papers were located but not read.
  - Romano, Toriello, Cassieri, Francese, Scanniello, "A Folklore Confirmation on the Removal of Dead Code", EASE 2024 (DOI 10.1145/3661167.3661188), and a companion "A Confirmation Study on the Removal of Dead Code from Java Desktop Applications", SEAA 2024 (DOI 10.1109/SEAA64295.2024.00041). Crossref returned no abstract, and the ACM pages were blocked.
  - Caivano et al. (ESEM 2021, DOI 10.1145/3475716.3475773) was extended into EMSE 2023; only that version's abstract was verified.

  Their findings on whether *removal* measurably helps remain unverified here.
- There is no replicated controlled experiment with professional developers on the harm of dead code (Romano: 83 students and 6 interviewees; Eder: one system).
- No empirical basis exists for the length of a runtime observation window beyond what individual studies used: Eder 2 years, Haas 6–16 months, Sensenmann's example of a binary unused for over a year, and practitioners citing 3–6 months.
- No authoritative source was found on detecting unused configuration keys or environment variables.
- SonarSource rule *descriptions* (S125, S1172, S1854 and others) could not be read. Only the names, tags and types were verified via the SonarCloud API. next.sonarqube.com returned 503, and the RSPEC repository was not publicly reachable.
- The Comment Traps result covers Python only and 2024-era models (GPT-4o, Claude 3.5 Sonnet), and has not been replicated.
- DCE-LLM's gain over GPT-4o is a single benchmark result. Its real-world precision is unknown, and the "30%" unit is not stated.
- How much Tier-C evidence can be replaced by other signals (e.g. git history showing a feature was removed), for an agent without telemetry or the original authors, has not been studied.
- The researcher's web-search budget, and the fact-checker's, ran out, so Reddit and Lobsters threads were not searched.

## Dropped findings

None. All 22 findings survived. Twelve were corrected, and two were downgraded: F21 fully, and F12 partially (see the verdict lines above). No cited source failed to resolve. A few sub-claims inside surviving findings were removed or reworded:
- "about 30 points worse in F1" (DCE-LLM)
- "Go RTA … not assembly"
- "both studies excluded batch jobs"
- "auto-apply vulture 100%"
- the paraphrased Knip quotes
