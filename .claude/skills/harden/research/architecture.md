# Architecture-level hardening: boundaries, cycles, coupling
> Code T26 · slug architecture · verified 2026-09-23 · counts: verified 5 / corrected 13 / downgraded 1 / dropped 0

**How this was verified** (second, independent pass on 2026-09-23, merged with the first pass)

**Standards and official docs.** Each was fetched raw and searched as text for every quoted passage:
- C++ Core Guidelines, raw Markdown dated Jun 14, 2026.
- Go spec (go1.27, May 26, 2026) and the Go 1.4 release notes.
- MDN "JavaScript modules", from the mdn/content source.
- Node.js v26.10.0 `modules.md`.
- Python 3.14.7 FAQ and the `typing` docs.
- Google Python Style Guide.
- Microsoft .NET DI guidelines (ms.date 2026-01-14).
- TypeScript 3.8 release notes.
- Tool docs:
  - dependency-cruiser: `rules-reference.md`, `cli.md` and the JSON schema;
  - eslint-plugin-import rule docs;
  - import-linter configure, layers, forbidden and acyclic_siblings pages;
  - ArchUnit User Guide 1.5.0;
  - PMD 7.27.0 design rules and the `GodClassRule.java` source;
  - madge README and `bin/cli.js`;
  - pydeps and cargo-modules READMEs;
  - cpp-dependencies and Code Maat READMEs;
  - the pylint R0401 page, Ruff, clang-tidy, Nx and Arcan docs.

**Full text, downloaded and searched with `pdftotext`:**
- Sas et al. 2021, Anquetil & Laval 2011, SmellBench v2, Larsen & Moghaddam 2026 and Slater 2025, all from arXiv.
- Laval et al. JOT 2012, from HAL hal-00692569; jot.fm refused connections.
- Oyetoyan et al. 2015, from HAL hal-01203525.
- Martin 1994, from a university mirror.
- Al-Mutawa et al. 2014, the author preprint via the Wayback Machine.
- Olbrich et al. 2010, the camera-ready via the Wayback Machine.
- Mo et al. 2015 (Hotspot Patterns), the DTIC copy via the Wayback Machine.
- Kazman et al. 2015 and Xiao et al. 2016, Cai's Drexel copies via the Wayback Machine.
- Zimmermann & Nagappan 2008 and Kim et al. 2014, from Zimmermann's site.
- Premraj & Herzig 2011, from Saarland.
- Bavota et al. 2012, the author copy.
- D'Ambros et al. 2009, the USI author PDF.

**Abstract only**, read via Semantic Scholar, Crossref or arXiv: Ivers et al. 2022, Li et al. 2014, Mo et al. 2016 (DL), MacCormack et al. 2006, Le et al. 2021, Li et al. 2022 and Esposito et al. The OpenAlex free budget was exhausted in this pass, so the first pass's "OpenAlex abstract" notes were superseded by full text where possible.

**Forums.** Every Hacker News item was re-read through the HN Algolia API, which returns author, date and parent story.

**Blogs.** Shopify, DoltHub, GitHub, Twilio Segment, Fowler, Nygard and Cockburn were fetched and each quote searched.

**Tool versions and maintenance**, checked against the npm, PyPI and crates.io registries and the authenticated GitHub API:

| Tool | Version checked | Status |
|---|---|---|
| dependency-cruiser | 18.4.0 (2026-09-20) | |
| madge | 8.0.0 (2024-08-05) | no release since; repo last pushed 2026-01 |
| eslint-plugin-import | 2.32.0 (2025-06-20) | |
| import-linter | 2.15 (2026-09-04) | |
| pylint | 4.0.9 (released 2026-09-23; the researcher cited 4.0.8) | |
| pydeps | 3.0.8 | |
| tach | 0.35.1 | repo now `tach-org/tach` |
| cargo-modules | 0.27.0 (2026-08-03) | |
| PMD | 7.27.0 (2026-08-28) | |
| ArchUnit | 1.5.0 (2026-08-04) | |
| Code Maat | v1.0.4 (2023-02-20) | repo last pushed 2025-07; superseded by the commercial CodeScene |
| cpp-dependencies | 1.1 (2016-11-26) | stale |
| deptrac | | active |
| Arcan and DV8 | | commercial |

**Web search.** The WebSearch budget was exhausted, so every source was reached by direct fetch or API.

**Grade legend.**
- **A:** formal standards, official language or runtime documentation, or peer-reviewed empirical studies that directly establish the claim.
- **B:** a synthesis over A-level sources, or peer-reviewed work that supports the claim only partly or indirectly.
- **C:** practitioner consensus, single anecdotes or engineering retrospectives, pilots and preprints.

## Summary

What the evidence supports for an agent running a post-completion pass:

**1. Find and fence; don't restructure.**
- Detect module cycles, layering violations, god components, hubs and global mutable state with ecosystem-native tools.
- Encode the architecture the code already has as rules that run in CI or pre-commit.
- Record today's violations as a baseline and fail only on new ones. The baseline should only ever shrink.
- Write down the rest in an ADR (Architecture Decision Record).
- Restructure only when all three hold:
  - the problem sits in a change or bug hotspot;
  - the fix is local;
  - tests cover the affected paths.

**2. Cycles are the best-supported target, but not all cycles are equal.**
- **Official guidance:**
  - C++ Core Guidelines SF.9 ("Flag all cycles") and MDN ("You should usually avoid cyclic imports") say to avoid cycles.
  - The Go spec makes package cycles illegal.
  - The Node.js docs and the Python FAQ do **not** say "avoid". They describe the runtime hazards ("Careful planning is required"; circular imports "are fine" in the `import module` form). *Corrected: the researcher listed them as "avoid" sources.*
- **Empirical harm:**
  - Oyetoyan et al. 2015 (full text) found that classes near cycles are more change-prone.
  - Mo et al. 2015 (full text) found the **Cross-Module Cycle** pattern was one of the two biggest contributors to file error- and change-proneness, across 9 OSS Java projects and 1 commercial project.
- **Large SCCs are common.** In four mature Java programs, the largest strongly connected component (SCC) held 23% to 62% of packages: ArgoUML 48%, JEdit 62%, Choco 26%, AntLR 23%.
- **Some cycles are harmless at runtime:**
  - Type-only cycles are erased at runtime.
  - Package-to-own-subpackage cycles are often intended.
  - But package location alone does not separate harmful from harmless cycles.
- **Breaking a cycle can change behaviour**, because it changes module initialization order.

**3. Most architecture metrics are weak or disputed as refactoring triggers.**
- **Martin's metrics.** Martin attaches his own caveat to the instability/abstractness metrics: "a metric is not a god".
- **Eclipse.** Cohesion and coupling metrics failed to track a real restructuring of Eclipse.
- **God Classes.** Size-normalised God Classes were not more change- or defect-prone. That is class level, in three Java OSS systems, and assumes equal functionality per line of code.
- **Network metrics.** They beat code metrics at Microsoft. The replication agreed under the same setup, but found no advantage in forward-release and cross-project settings.
- **Structure plus change history** has better support. The top 5 architectural debts held 8-25% of error-prone files but 20-61% of maintenance effort (one group, 7 OSS projects, its own tooling). But the "structure+history patterns beat structure-only ones" claim in Mo et al. 2015's abstract is only partly borne out by its own tables: a structure-only pattern (Cross-Module Cycle) was among the top two contributors.

**4. The AI-specific data is a warning for an agent-run skill, but it is thin.**
- **SmellBench** (preprint, one Python project):
  - 63.1% of 65 hard-tier, tool-flagged smells were false positives.
  - The most aggressive agent introduced 140 new smells.
  - The full test suite showed no deviations. The authors read this as preserved correctness; our inference is that tests did not catch the architectural regressions.
- **Larsen & Moghaddam** (accepted at SEAA 2026): AI adoption left raw smell counts unchanged while code grew. The density "improvement" is a denominator effect.
- **Slater pilot:** the "80%" is 4/5 runs of Llama 3 8B. GPT-5.1 had 0/5 and Claude 4.5 Sonnet 1/5 (minor).
- **Static tools miss dynamic loading.** Shopify: "running code, more than any metric, will always be the best indicator of real progress".

## Findings

### T26-F01 — Detect cycles with an ecosystem-native tool, at file and folder/package level, and gate them in CI so the cycle count and largest-SCC size never grow; triage existing cycles, don't auto-fix them
- **Grade:** A · **Verdict:** CORRECTED. What changed:
  - The Node docs were removed from the "say to avoid" list. They say cycles need "careful planning"; they do not say avoid them.
  - Laval's SCC figures were completed with the two lower ratios (26%, 23%).
  - Added Sas et al.'s Java-versus-C/C++ nuance.
  - Added Mo et al. 2015 (full text) as further empirical support.
  - Oyetoyan 2015 is now verified from the full text (HAL).
  - Tool caveats: dependency-cruiser's folder scope does not support `viaOnly`, and madge has had no release since 2024.
- **Rationale:**
  - **Official guidance.** C++ Core Guidelines SF.9 and MDN say to avoid cycles. The Go spec makes them illegal. Node documents that a module in a `require` cycle may be returned unfinished.
  - **Change-proneness.** Cycles are associated with higher change-proneness of nearby classes (Oyetoyan 2015, Java).
  - **Error-proneness.** Files in cycles that cross module boundaries showed some of the largest increases in bug and change frequency (Mo 2015).
  - **Accumulation.** Mature Java programs carry large SCCs.
  - **Practitioners.** Most industrial interviewees consider cyclic dependencies detrimental. One cycle blocked extracting a microservice.
  - **Code review.** Cyclic dependency is among the three most frequent erosion symptoms in OpenStack reviews.
- **Evidence:**
  - [C++ Core Guidelines, SF.9](https://raw.githubusercontent.com/isocpp/CppCoreGuidelines/master/CppCoreGuidelines.md) — Stroustrup & Sutter (eds.), isocpp, dated Jun 14, 2026 — standard — "Cycles complicate comprehension and slow down compilation." "Eliminate cycles; don't just break them with `#include` guards." Enforcement: "Flag all cycles." — verified verbatim in the raw file.
  - [JavaScript modules — Cyclic imports](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) — MDN, 2026 — official docs — "You should usually avoid cyclic imports in your project, because they make your code more error-prone." Example: "ReferenceError: Cannot access 'a' before initialization". — verified.
  - [The Go Programming Language Specification](https://go.dev/ref/spec) — The Go Authors, go1.27 (May 26, 2026) — standard — "It is illegal for a package to import itself, directly or indirectly" — verified.
  - [Modules: CommonJS modules — Cycles](https://nodejs.org/api/modules.html) — Node.js v26.10.0 — official docs — "When there are circular require() calls, a module might not have finished executing when it is returned." "Careful planning is required to allow cyclic module dependencies to work correctly within an application." — verified. It describes the hazard; it does not say "avoid".
  - [Circular dependencies and change-proneness: An empirical study](https://hal.science/hal-01203525) — Oyetoyan, Falleri, Dietrich, Ježek, SANER 2015 (DOI 10.1109/SANER.2015.7081834) — peer-reviewed — "the presence of cycles can have a significant impact on the change proneness of the classes near these cycles" — verified in the HAL abstract and full text. Java, Qualitas Corpus.
  - [Hotspot Patterns: The Formal Definition and Automatic Detection of Architecture Smells](https://doi.org/10.1109/wicsa.2015.12) — Mo, Cai, Kazman, Xiao, WICSA 2015 — peer-reviewed — "the greatest impact in terms of average increase of the measures is attributable to Unstable Interface and Cross-Module Cycle". Cross-Module Cycle: "If there is a dependency cycle and not all the files belong to the same closest module". Bug-frequency increase for files in such cycles: +75% to +490% across 9 OSS Java projects, +117% in the commercial one. — full text verified (DTIC copy); added by the verifier. It is correlational.
  - [Efficient Retrieval and Ranking of Undesired Package Cycles in Large Software Systems](https://inria.hal.science/hal-00692569) — Laval, Falleri, Vismara, Ducasse, JOT 11(1), 2012 (DOI 10.5381/jot.2012.11.1.a4) — peer-reviewed — Table 1, largest SCC (packages in SCC / all packages): ArgoUML 0.28.1 38/79 (48%), JEdit 4.3.1 18/29 (62%), Choco 2.1.0 38/147 (26%), AntLR 3.2 7/31 (23%). It cites Melton & Tempero 2007: "in a lot of programs, classes are involved in huge cyclic dependencies" — full text verified. The researcher had reported only the two highest ratios.
  - [The perception of Architectural Smells in industrial practice](https://arxiv.org/abs/2110.06750) — Sas, Pigazzini, Avgeriou, Arcelli Fontana, IEEE Software 2021 (accepted; arXiv preprint) — peer-reviewed — "most participants considered CD as detrimental for maintainability, reliability, and testability". "a cycle prevented the creation of a microservice out of a subset of packages". But "participants working with Java perceived it as less detrimental than other smell types like GC". — full text verified. 21 interviewees at 3 European companies, working in C, C++ and Java.
  - [Symptoms of Architecture Erosion in Code Reviews: A Study of Two OpenStack Projects](https://arxiv.org/abs/2201.01184) — Li, Soliman, Liang, Avgeriou, ICSA 2022 — peer-reviewed — 502 erosion comments among 21,274 checked. "the most frequently identified erosion symptoms are architectural violation, duplicate functionality, and cyclic dependency" — verified in the abstract. The projects are Nova and Neutron, which are Python.
  - [dependency-cruiser rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) — Sander Verweij, v18.4.0 — official docs — verified:
    - `circular` matches "module dependencies that end up where you started".
    - At folder scope, `main/index.js -> utl/helper.js -> main/utl.js` "is no circular dependency on module level, but there _is_ one between the `main` and `utl` folders".
    - Only the `moreUnstable`, `circular` and `path`/`pathNot` attributes work at folder scope; `via` does not.
  - [eslint-plugin-import no-cycle](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-cycle.md) — import-js, v2.32.0 — official docs — "This rule is comparatively computationally expensive." — verified.
- **Detect:**
  - **JS/TS:**
    - `npx depcruise --init` generates a config that includes `no-circular` ("flags all circular dependencies"). Run it with `npx depcruise src --config .dependency-cruiser.js`.
    - Add a second rule with `scope: 'folder'` and `to: {circular: true}`. `viaOnly` cannot be combined with folder scope.
    - Quick check: `npx madge --circular --extensions ts,tsx --ts-config tsconfig.json src/`. All three flags were verified in madge's `bin/cli.js`.
    - `import/no-cycle` works but is slow on large repos.
  - **Python:**
    - `pylint --disable=all --enable=cyclic-import <pkg>` (R0401). "Lint the whole package in one run" is a practical tip; the pylint docs don't state it.
    - `pydeps <pkg> --show-cycles`.
    - As a CI contract: import-linter `acyclic_siblings` with `ancestors = <pkg>`, run with `lint-imports`.
  - **Rust:** `cargo modules dependencies --acyclic` "return[s] an error for any cycles it found".
  - **Go:** package cycles are compile errors.
  - **C/C++:** `cpp-dependencies --stats .` and `--graph-cycles <out>`. The tool's last release was in 2016.
  - **Java:** ArchUnit `slices().matching("com.myapp.(*)..").should().beFreeOfCycles()`. The default `cycles.maxNumberToDetect` is 100.
  - **C#:** ArchUnitNET.
  - **Every language:** record the cycle count and the largest-SCC size before and after any change.
- **Tools:**
  - JS/TS: dependency-cruiser 18.4.0, madge 8.0.0 (no release since Aug 2024), eslint-plugin-import 2.32.0.
  - Python: pylint 4.0.9, pydeps 3.0.8, import-linter 2.15, tach 0.35.1.
  - Rust: cargo-modules 0.27.0.
  - C/C++: cpp-dependencies 1.1 (stale).
  - JVM and .NET: ArchUnit 1.5.0, ArchUnitNET.
- **Applies to:** any multi-module codebase in JS/TS, Python, Java/Kotlin, C#, C/C++ or Rust. In Go, only cross-service or runtime cycles.
- **When not to apply / counterpoints:**
  - The empirical harm evidence is mostly Java (Oyetoyan, Mo, Laval), plus C/C++ interview data.
  - Oyetoyan, Cruzes & Conradi 2013 (JSS, DOI 10.1016/j.jss.2013.07.039) exists, but is closed access with an elided abstract. Its defect-level result is unverified.
  - MDN concedes that "cycles are often inevitable" and "Cyclic imports don't always fail".
  - Anquetil & Laval found a real Eclipse restructuring did not reduce package cycles. Gating new cycles is better supported than hunting old ones.
  - Java practitioners rated cycles as less harmful than God Components.
- **Fix risk:** low, for the gate itself.

### T26-F04 — Treat every edit to an import edge inside a cycle, and every move of module-level code, as a potential behaviour change: record import-time side effects first, then import each touched module in a fresh process and run all entry points plus the full suite
- **Grade:** A · **Verdict:** VERIFIED. Note: the Python FAQ passage is quoted inside the FAQ as "Gordon McMillan says".
- **Rationale:** the official runtime docs describe how cycles and import order change behaviour.
  - Node returns "an unfinished copy" of the exports object in a `require` cycle.
  - ES modules throw a ReferenceError when a binding is used synchronously before initialization.
  - Python fails on a top-level `from module import name` inside a cycle, and global assignments run at import time.
  - C++ global initialization is not totally ordered.
- **Evidence:**
  - [Modules: CommonJS modules — Cycles](https://nodejs.org/api/modules.html) — Node.js v26.10.0 — official docs — "a module might not have finished executing when it is returned". "an **unfinished copy** of the `a.js` exports object is returned to the `b.js` module". "Careful planning is required to allow cyclic module dependencies to work correctly within an application." — verified.
  - [Programming FAQ — How can I have modules that mutually import each other?](https://docs.python.org/3/faq/programming.html) — PSF, Python 3.14.7 — official docs — "Circular imports are fine where both modules use the 'import <module>' form of import. They fail when the 2nd module wants to grab a name out of the first ('from module import name') and the import is at the top level." — verified.
  - [Google Python Style Guide §2.5 Mutable Global State](https://google.github.io/styleguide/pyguide.html) — Google — official style guide — global state "Has the potential to change module behavior during the import, because assignments to global variables are done when the module is first imported." — verified.
  - [C++ Core Guidelines I.2](https://raw.githubusercontent.com/isocpp/CppCoreGuidelines/master/CppCoreGuidelines.md) — isocpp, 2026 — standard — "**Warning**: The initialization of global objects is not totally ordered." — verified.
  - [MDN JavaScript modules — Cyclic imports](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) — MDN — official docs — "Cyclic imports don't always fail. ... only if the variable remains uninitialized at that time will a ReferenceError be thrown." — verified.
- **Detect:**
  - **Python:**
    - Import every module on its own in a fresh interpreter, using `pkgutil.walk_packages` plus `subprocess.run([sys.executable, "-c", "import " + name], check=True)`. Note that `walk_packages` itself imports the packages it walks.
    - Find module-level calls with `rg -n "^[A-Za-z_][\w.]*\(" --type py`, and registration decorators.
  - **Node:** build, then import each built entry file in a fresh `node -e`.
  - **C++:** clang-tidy `cppcoreguidelines-avoid-non-const-global-variables` lists the globals whose initialization order matters.
  - **All:** diff startup logs and smoke-run each CLI or server entry point before and after the change.
- **Tools:** python/pkgutil, `node -e`, clang-tidy, ripgrep, the project test suite.
- **Applies to:** JS/TS (CommonJS and ESM), Python, C/C++, and any language whose modules run code at load time.
- **When not to apply / counterpoints:**
  - The risk is smaller in languages with ordered or lazy initialization (Java class loading, Go package init order), but not zero.
  - Standalone imports raise false alarms for modules that legitimately need app bootstrapping (plugin registries, framework autoload). Whitelist those rather than skip the check.
  - The commands are illustrative and were not executed during verification.
- **Fix risk:** high

### T26-F12 — Flag mutable global state and static singletons; convert them to explicit dependencies only where they cause testability, concurrency or multi-instance problems; keep true constants, function-local lazy statics and the standard streams/loggers
- **Grade:** A · **Verdict:** CORRECTED. What changed:
  - The rationale conflated two meanings of "singleton".
  - Microsoft's .NET guidance **recommends** DI-registered singleton *services* as the replacement for global state: "Avoid creating global state by designing apps to use singleton services instead." Its list of "drawbacks of singletons" is about choosing the singleton **lifetime** in a DI container. It is not about the GoF static singleton, which is what C++ Core Guidelines I.3 targets.
- **Rationale:** the official guidance of four ecosystems agrees that static or global mutable state hides dependencies.
  - **C++ Core Guidelines:** non-const globals "hide dependencies", and static singletons are "complicated global objects in disguise".
  - **Google Python guide:** "Avoid mutable global state" (example: two simultaneous DB connections).
  - **Microsoft .NET:**
    - Avoid stateful static classes, static access to services and the service locator.
    - Use container-managed lifetimes instead.
    - Validate scopes so that singletons don't capture scoped services.
- **Evidence:**
  - [C++ Core Guidelines I.2 and I.3](https://raw.githubusercontent.com/isocpp/CppCoreGuidelines/master/CppCoreGuidelines.md) — isocpp, 2026 — standard — all verified:
    - I.2: "Non-`const` global variables hide dependencies and make the dependencies subject to unpredictable changes." Enforcement: "Report all non-`const` variables declared at namespace scope". It also says "The rule is 'avoid', not 'don't use.'" (with `cin`, `cout`, `cerr` as exceptions), and "A global object is often better than a singleton."
    - I.3: "Singletons are basically complicated global objects in disguise." The function-local `static` `myX()` idiom is the stated exception.
  - [clang-tidy cppcoreguidelines-avoid-non-const-global-variables](https://clang.llvm.org/extra/clang-tidy/checks/cppcoreguidelines/avoid-non-const-global-variables.html) — LLVM — official docs — "Finds non-const global variables as described in I.2 of C++ Core Guidelines." Options AllowInternalLinkage, AllowThreadLocal and IgnoreMacros, all default false — verified.
  - [Google Python Style Guide §2.5](https://google.github.io/styleguide/pyguide.html) — Google — official style guide — "if global state is used to manage a database connection, then connecting to two different databases at the same time ... becomes difficult." Decision: "Avoid mutable global state." — verified.
  - [Dependency injection guidelines](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/guidelines) — Microsoft Learn, ms.date 2026-01-14 — official docs — all verified; the nuance was added by the verifier:
    - "Avoid stateful, static classes and members. Avoid creating global state by designing apps to use singleton services instead."
    - "Avoid static access to services."
    - "Enable scope validation to make sure the app doesn't have singletons that capture scoped services."
    - "DI is an alternative to static/global object access patterns."
    - "Only use singleton lifetime for services with their own state that is expensive to create or globally shared."
    - It lists "Considerations and drawbacks of singletons": thread safety, coupling, testing, memory, fault tolerance, configuration reloading, scope leakage.
  - [Ruff PLW0603 global-statement](https://docs.astral.sh/ruff/rules/global-statement/) — Astral — official docs — "Pylint discourages the use of global variables as global mutable state is a common source of bugs and confusing behavior." — verified.
  - [eslint-plugin-import no-mutable-exports](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-mutable-exports.md) — import-js — official docs — "Forbids the use of mutable exports with `var` or `let`." — verified.
- **Detect:**
  - **C++:** `clang-tidy -checks='cppcoreguidelines-avoid-non-const-global-variables'`. I.3 heuristics: classes named `*Singleton*`, and public static functions returning a reference to a function-local static of their own type.
  - **Python:** `ruff check --select PLW0603` or pylint W0603. Also module-level mutable containers, via `rg -n "^[a-z_]+\s*[:=]\s*(\[|\{|dict\(|list\(|set\()" --type py`.
  - **TS/JS:** `import/no-mutable-exports`, and `rg -n "^export let |^let " src`.
  - **.NET:** `GetService<`, `GetRequiredService<` and `BuildServiceProvider(` outside the composition root. Enable ValidateScopes.
- **Tools:** clang-tidy, Ruff, pylint, eslint-plugin-import, .NET ValidateScopes, ripgrep.
- **Applies to:** all languages. Most valuable in services with concurrency, multi-tenancy or tests needing isolation.
- **When not to apply / counterpoints:**
  - The guidelines themselves allow exceptions.
  - Small CLIs and scripts gain little.
  - In .NET, a DI-registered singleton is the *recommended* fix, not the smell.
  - Changing a service's lifetime (singleton to scoped or transient) changes caching, pooling and identity.
- **Fix risk:** medium

### T26-F10 — Rank architectural issues by structure × history: spend refactoring effort only where a structural problem overlaps with high change frequency, bug-fix frequency or co-change coupling; document everything else
- **Grade:** B · **Verdict:** CORRECTED. What changed:
  - Kazman et al.'s ROI was modelled on the *predicted* after-state, not measured.
  - The concentration numbers come from one research group using its own tooling.
  - Mo 2015 (now read in full): the abstract claims structure-history patterns "contribute more". But the paper's own tables show that the two largest contributors were Unstable Interface (structure+history) and **Cross-Module Cycle (structure only)**. Implicit Cross-module Dependency (structure+history) had small and inconsistent effects. So "structure+history always beats structure" is not supported; "use both" is.
  - Code Maat's last release was in 2023, and DV8 is commercial.
- **Rationale:**
  - **Debt is concentrated.** Across 7 large OSS projects, the top 5 architectural debts covered 8-25% of error-prone files but 20-61% of maintenance effort.
  - **Overlapping patterns compound.** Files involved in more hotspot patterns are more error- and change-prone.
  - **Decay predicts issues.** Architectural decay metrics predict future issue- and change-proneness across 10 OSS systems.
- **Evidence:**
  - [Identifying and quantifying architectural debt](https://doi.org/10.1145/2884781.2884822) — Xiao, Cai, Kazman, Mo, Feng, ICSE 2016 — peer-reviewed — "The top 5 architectural debts, covering a small portion (8% to 25%) of each project's error-prone files, capture a significant portion (20% to 61%) of each project's maintenance effort." — verified in the abstract (Semantic Scholar) and in the full text (Cai's copy). 7 OSS projects.
  - [Hotspot Patterns](https://doi.org/10.1109/wicsa.2015.12) — Mo, Cai, Kazman, Xiao, WICSA 2015 — peer-reviewed — full text verified:
    - Abstract: "these structure-history integrated patterns contribute more to error- and change-proneness than other hotspot patterns, and 2) the more hotspot patterns a file is involved in, the more error- and change-prone it is."
    - Body: "the greatest impact ... is attributable to Unstable Interface and Cross-Module Cycle".
    - Scope: 9 OSS projects plus 1 commercial project.
  - [A Case Study in Locating the Architectural Roots of Technical Debt](https://doi.org/10.1109/icse.2015.146) — Kazman, Cai, Mo, Feng, Xiao, Haziyev, Fedak, Shapochka, ICSE 2015 — peer-reviewed — "defective files seldom exist alone. They are usually architecturally connected". "we built economic models of the before and (predicted) after states, which gave the organization confidence that doing the refactorings made business sense" — full text verified. The ROI was predicted.
  - [Architectural Decay as Predictor of Issue- and Change-Proneness](https://arxiv.org/abs/2102.09835) — Le, Karthik, Laser, Medvidovic, ICSA 2021 — peer-reviewed — "information regarding current architectural decay in these systems can be used to build models that accurately predict future issue-proneness and change-proneness" — verified in the abstract; the venue was confirmed via Semantic Scholar.
  - [Code Maat README](https://github.com/adamtornhill/code-maat) — Adam Tornhill — official docs — verified:
    - Input: `git log --all --numstat --date=short --pretty=format:'--%h--%ad--%aN' --no-renames --after=YYYY-MM-DD`, parsed with `-c git2`.
    - Defaults: min-revs 5, min-shared-revs 5, min-coupling 30, max-changeset-size 30.
    - v1.0.4 (2023). The README says the analyses "have evolved into CodeScene".
- **Detect:**
  - **Churn:** `git log --since=12.months --no-merges --format= --name-only | grep -v "^$" | sort | uniq -c | sort -rn | head -40`.
  - **Bug-fix hotspots:** the same command with `-i --grep="fix\|bug"`.
  - **Co-change:** Code Maat `-a coupling`.
  - **Intersect** with the F01, F05, F08 and F09 outputs.
- **Tools:** git, Code Maat. DV8 is commercial and optional.
- **Applies to:** repositories with meaningful history. The "≥100 commits over several months" cut-off is an unsourced heuristic.
- **When not to apply / counterpoints:**
  - A freshly finished, agent-generated project with a few big commits has churn that reflects build order, not maintenance pain. Fall back to documenting.
  - There is no independent replication of the concentration numbers.
- **Fix risk:** low

### T26-F16 — When an AI agent performs architectural smell repair: classify each detected smell as true/false positive with justification before editing; require that raw counts of every smell type and rule violation do not increase anywhere; never accept "tests still pass" as proof of architectural improvement
- **Grade:** B · **Verdict:** CORRECTED. What changed:
  - Larsen & Moghaddam is an accepted manuscript at SEAA 2026 (Springer LNCS), not an unreviewed preprint.
  - Esposito et al. was published in *Software Quality Journal* (2025, DOI 10.1007/s11219-025-09730-7); it is no longer only a preprint.
  - "Tests do not detect architectural regressions" is our inference from SmellBench. The authors themselves read "no test deviations" as confirming functional correctness.
  - SmellBench's authors note that selecting only hard-tier smells may amplify the false-positive rate.
- **Rationale:**
  - **SmellBench** (65 hard-tier smells from PyExamine on scikit-learn, expert-validated):
    - 63.1% were false positives.
    - The best agent resolved 47.7%.
    - The most aggressive agent resolved 31 smells but introduced 140 (net −109), "driven by module consolidations".
    - The full test suite showed no deviations for any agent.
  - **Larsen & Moghaddam** (151 Java repositories): raw smell counts were unchanged (+1.1%, p = 0.82) while LOC grew +12.8%.
- **Evidence:**
  - [SmellBench: Evaluating LLM Agents on Architectural Code Smell Repair](https://arxiv.org/abs/2605.07001) — Dinu, Mihăescu, Rebedea, arXiv v2 (May 2026) — preprint — full text verified:
    - "Expert validation reveals that 63.1% of detected smells are false positives, while the best agent achieves a 47.7% resolution rate".
    - "GPT 5.3 Codex Spark resolves the most smells (31) but introduces 140 new ones (net -109), driven by module consolidations that create new dependency violations. Gemini 3.1 Pro and Claude Opus 4.6 introduce only 3 each while resolving 19 and 18 (net +16 and +15)."
    - "No test deviations from the original codebase were observed for any agent configuration, confirming that all refactorings preserve functional correctness."
    - Threats section: "the hard-tier selection may amplify" the false-positive rate, and there is possible memorisation of scikit-learn.
  - [Mining Architectural Quality Under Agentic AI Adoption: A Causal Study of Java Repositories](https://arxiv.org/abs/2606.13298) — Larsen & Moghaddam, accepted at SEAA 2026 — peer-reviewed (accepted manuscript) — full text verified:
    - "Total smell counts are essentially unchanged (+1.1%, p = 0.82) while lines of code grow +12.8% (p = 0.003); the resulting 6.7% ASD decline (p = 0.004) is therefore a denominator effect rather than an architectural improvement."
    - Unstable Dependency rose +5.8% (raw p = 0.032), but not significantly after Holm correction.
    - The study used Arcan's trial edition.
  - [On the correlation between architectural smells and static analysis warnings](https://doi.org/10.1007/s11219-025-09730-7) — Esposito, Robredo, Arcelli Fontana, Lenarduzzi, *Software Quality Journal* 2025 (arXiv 2406.17354) — peer-reviewed — 103 Java projects, 72 MLOC. "a moderate correlation between warnings and smells"; "33.79% of warnings are 'non-co-occurring' with any of the smells" — verified in the abstract. The publication status was corrected.
- **Detect:**
  - **Before editing,** save the tool outputs: `npx depcruise src --output-type json > before.json` or `lint-imports > before.txt`, PyExamine or Arcan reports, and counts per rule and smell type.
  - **After editing,** regenerate them and diff the raw counts per type.
  - **Reject** the change if any count rises, even when the targeted smell is gone.
  - **Record** the per-smell true/false-positive verdicts in the PR or ADR.
- **Tools:** dependency-cruiser JSON, import-linter, PyExamine (open source), Arcan (commercial), diff.
- **Applies to:** any skill run by an LLM agent that edits module structure.
- **When not to apply / counterpoints:**
  - SmellBench is one Python project with one detector.
  - Larsen & Moghaddam is Java only and uses an observational difference-in-differences design.
  - Conservative agents did achieve net improvements (+15, +16). This is a guardrail, not a ban.
- **Fix risk:** low

### T26-F19 — Verify every architectural change with before/after raw counts (cycles, largest SCC, violations per contract, top-hub fan-in/fan-out, smells per type); never rely on density (per KLOC) or a single composite score; report composite modularity metrics only if tooling is available, never as a gate
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - **Density misleads.** Density metrics improve simply because code grows: a 6.7% smell-density decline was a pure LOC effect.
  - **Simple counts work.** SCC count and largest-SCC size are simple, reproducible indicators used in a restructuring study.
  - **Composite metrics are costly.** Metrics such as Decoupling Level, and the DSM analysis used for Mozilla's redesign, do discriminate, but they need specialised tooling.
- **Evidence:**
  - [Mining Architectural Quality Under Agentic AI Adoption](https://arxiv.org/abs/2606.13298) — Larsen & Moghaddam, SEAA 2026 — peer-reviewed (accepted manuscript) — "Density-normalized outcomes can mislead when treatment affects system size: raw counts and explicit decomposition are required" — verified.
  - [Legacy Software Restructuring: Analyzing a Concrete Case](https://arxiv.org/abs/1210.7138) — Anquetil & Laval, CSMR 2011 — peer-reviewed — "We computed the number and size of Strongly Connected Components (SCC) in the system as an indicator of the presence and importance of cyclic dependencies". "we also monitored the size (in number of vertices) of the largest SCC" — full text verified. Table V: the largest Eclipse Java-package SCC grew from 16 to 66 packages between versions 2.0.1 and 3.1.
  - [Decoupling Level: a new metric for architectural maintenance complexity](https://doi.org/10.1145/2884781.2884825) — Mo, Cai, Kazman, Xiao, Feng, ICSE 2016 — peer-reviewed — "We measured the DL for 108 open source projects and 21 industrial projects ... the larger the DL, the better the architecture ... the more likely bugs and changes can be localized and separated" — verified in the abstract (Semantic Scholar).
  - [Exploring the Structure of Complex Software Designs](https://doi.org/10.1287/mnsc.1060.0552) — MacCormack, Rusnak, Baldwin, Management Science 2006 — peer-reviewed — "the redesign of Mozilla resulted in an architecture that was significantly more modular than that of its predecessor and, indeed, than that of Linux" — verified in the abstract (Crossref). The authors call the results "exploratory".
- **Detect:** save the before and after outputs.
  - **dependency-cruiser:** JSON violations grouped by `rule.name` with jq. The `rule` field was verified in the output schema.
  - **madge:** the `--circular` line count.
  - **import-linter:** the `lint-imports` contract results.
  - **ArchUnit:** the violation-store sizes.

  Put the table in the PR or ADR. Any increase in any row blocks the change.
- **Tools:** dependency-cruiser, madge, jq, import-linter, ArchUnit. DV8 or DSM tools are commercial and optional.
- **Applies to:** every architectural edit in the hardening pass.
- **When not to apply / counterpoints:**
  - Raw counts can be gamed: merging modules removes cycles but creates god components. Always report the size and fan-out rows together with the cycle rows.
  - DL and propagation cost have little open tooling.
- **Fix risk:** low

### T26-F02 — Triage cycles before acting on them: exclude type-only cycles; rank cross-layer/top-level cycles above package-subpackage cycles; rank hot files above cold ones; pick the lowest-weight edge as the cut candidate — but never declare a cycle "safe" by its location
- **Grade:** B · **Verdict:** CORRECTED. What changed:
  - madge's TypeScript key is `detectiveOptions.ts.skipTypeImports`; the `es6` key is for ES6/Flow.
  - Laval's "weight 3, 7 times lower" is a worked example from the paper's Fig. 3, not empirical data.
  - Added import-linter's built-in per-edge import counts.
  - Added Mo 2015's Cross-Module Cycle result, which supports ranking cross-module cycles higher.
  - Added the Python docs' own caveat on `TYPE_CHECKING`: such imports are harmless only "as long as you don't later examine" the annotations at runtime.
- **Rationale:**
  - **Type-only imports have no runtime effect.** TypeScript `import type` and Python `if TYPE_CHECKING:` imports are skipped at runtime, so cycles made only of them cannot cause initialization bugs. The Python exception is code that introspects annotations at runtime.
  - **Most package cycles are local.** In Java package graphs, most circular dependencies are "package local" (Al-Mutawa 2014).
  - **Some subpackage cycles are intended.** Laval et al. argue this and rank cycles by edge weight.
  - **Cross-module cycles cost most.** Mo 2015 found that cycles crossing module boundaries were among the costliest patterns.
  - **Location is not a safety test.** Oyetoyan et al. 2015 found location in the package tree does not reliably separate harmful from harmless cycles, so use it for priority only.
- **Evidence:**
  - [TypeScript 3.8 release notes: Type-Only Imports and Export](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-8.html) — Microsoft TypeScript team, 2020 — official docs — "`import type` only imports declarations to be used for type annotations and declarations. It always gets fully erased, so there's no remnant of it at runtime." — verified.
  - [typing.TYPE_CHECKING](https://docs.python.org/3/library/typing.html) — PSF, Python 3.14 — official docs — "A special constant that is assumed to be True by static type checkers. It's False at runtime." Guarding an import "prevents the module from actually being imported at runtime; annotations aren't eagerly evaluated (see PEP 649) so using undefined symbols in annotations is harmless—as long as you don't later examine them." — verified; the caveat was added.
  - [dependency-cruiser rules reference: viaOnly](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) — Sander Verweij — official docs — "log an error for all circular dependencies which consist of only non-`type-only` dependencies" with `viaOnly: { dependencyTypesNot: ['type-only'] }` — verified.
  - [import-linter configuration](https://import-linter.readthedocs.io/en/stable/get_started/configure/) — David Seddon, v2.15 — official docs — `exclude_type_checking_imports`: "Whether to exclude imports made in type checking guards." — verified.
  - [import-linter acyclic_siblings](https://import-linter.readthedocs.io/en/stable/contract_types/acyclic_siblings/) — David Seddon, v2.15 — official docs — sample output: "It could be made acyclic by removing 1 dependency: - .alpha -> .beta (3 imports)" — verified. This gives per-edge weights directly.
  - [madge README — ignoring type imports](https://github.com/pahen/madge) — pahen — official docs — TypeScript: `"detectiveOptions": {"ts": {"skipTypeImports": true}}` — verified.
  - [On the Shape of Circular Dependencies in Java Programs](https://doi.org/10.1109/aswec.2014.15) — Al-Mutawa, Dietrich, Marsland, McCartin, ASWEC 2014 — peer-reviewed — "in package dependency graphs, most circular dependencies are 'package local': they are confined to branches of the package containment tree where they form around parent packages" — verified in the author preprint (Wayback copy of Dietrich's page). Qualitas Corpus, Java.
  - [Efficient Retrieval and Ranking of Undesired Package Cycles](https://inria.hal.science/hal-00692569) — Laval et al., JOT 2012 — peer-reviewed — "a package such as ui.internal can be in cyclic dependency with ui without serious consequences". "The cycle between core and ui has a dependency with a weight equal to 3, which is 7 times lower than the other dependencies in the example. This cycle is undesired" — full text verified. This is a worked example.
  - [Hotspot Patterns](https://doi.org/10.1109/wicsa.2015.12) — Mo et al., WICSA 2015 — peer-reviewed — Cross-Module Cycle (a cycle whose files are not all in the same closest module) was among the two patterns with "the greatest impact" on bug and change measures — full text verified.
  - [Circular dependencies and change-proneness](https://hal.science/hal-01203525) — Oyetoyan et al., SANER 2015 — peer-reviewed — "neither subtype knowledge nor the location of the cycle within the package containment tree are suitable criteria to distinguish between critical and harmless cycles" — verified in HAL.
- **Detect:**
  - **TS, dependency-cruiser:** `to: {circular: true, viaOnly: {dependencyTypesNot: ['type-only']}}`, at module scope only.
  - **TS, madge:** `.madgerc` with `detectiveOptions.ts.skipTypeImports=true`.
  - **Python:** import-linter `exclude_type_checking_imports=true`. But first grep for runtime annotation introspection (`get_type_hints`, pydantic or FastAPI models, `dataclasses` with string annotations resolved at runtime). If it is present, treat those TYPE_CHECKING edges as runtime edges.
  - **Compare** the cycle list with and without type-only edges.
  - **Cut candidates:** `acyclic_siblings` prints the minimal edge set with import counts. For dependency-cruiser, count the imports behind each edge from the `err-long` or JSON output.
  - **Churn:** `git log --since=12.months --format= --name-only | sort | uniq -c | sort -rn | head -50`.
- **Tools:** dependency-cruiser, madge, import-linter, git.
- **Applies to:** especially TS/JS and Python. Package-hierarchy heuristics apply to Java, Python and TS folder trees.
- **When not to apply / counterpoints:**
  - Oyetoyan et al. contradict the "package-local cycles are harmless" heuristic.
  - Excluding type-only edges hides design-level coupling.
  - Churn ranking means little in a new project.
- **Fix risk:** low

### T26-F17 — Prefer language- or build-enforced boundaries over lint-only conventions (Go `internal/` and compiler-forbidden cycles, Rust visibility, Maven/Gradle modules or JPMS, TS workspace packages with `exports`); in Python, which has no native enforcement, use import-linter or tach
- **Grade:** B (was A) · **Verdict:** DOWNGRADED
  - The Go docs establish that the *mechanism* exists; that part is A-level.
  - The claim that enforced boundaries work *better* rests on one observational case (Eclipse plugins) and an HN comment. The Eclipse authors themselves offer alternative explanations: there are "much less plugins (than Java packages)", and plugins may be the "real" modules the engineers designed.
  - cargo-modules checks cycles and orphans; Rust visibility itself is enforced by the compiler.
  - The JPMS and `package.json` `exports` suggestions are unsourced in this dossier.
- **Rationale:**
  - Compiler- or build-enforced rules cannot be silently bypassed.
  - In the Eclipse case, platform-enforced plugin boundaries had no cycles while unenforced Java packages decayed, with the confounds noted above.
- **Evidence:**
  - [Go 1.4 Release Notes — Internal packages](https://go.dev/doc/go1.4) — The Go Authors, 2014 — official docs — verified:
    - Internal packages "may not be imported by packages outside the source subtree in which they reside".
    - "a package `.../a/b/c/internal/d/e/f` can be imported only by code in the directory tree rooted at `.../a/b/c`".
    - "from 1.5 and onward it will be enforced for any repository."
  - [The Go Programming Language Specification](https://go.dev/ref/spec) — go1.27, May 26, 2026 — standard — "It is illegal for a package to import itself, directly or indirectly" — verified.
  - [cargo-modules README](https://github.com/regexident/cargo-modules) — regexident, 0.27.0 — official docs — `--acyclic`: "search for cycles in the directed graph and return an error for any cycles it found". `orphans --deny`: "Returns a failure code if one or more orphans are found" — verified.
  - [Legacy Software Restructuring](https://arxiv.org/abs/1210.7138) — Anquetil & Laval, CSMR 2011 — peer-reviewed — "Eclipse also prohibit defining cyclic dependencies this way. So the tool itself forced the engineers to pay attention to this issue." and "there are much less plugins (than Java packages) which greatly simplifies the task of checking for cyclic dependencies" — full text verified; a single observational case.
  - [HN comment (bognition) on "Modular monolith and microservices: Modularity is what matters"](https://news.ycombinator.com/item?id=45877606) — Hacker News, 2025-11-10 — practitioner forum — "In Java with multi maven modules you can setup maven to forbid imports of specific module types allowing you to make modules as private/public. In Python you can't do any of this." — verified.
- **Detect:**
  - **Go:** `go list -f "{{.ImportPath}}" ./... | grep -v /internal/`. For each exported package, ask whether anything outside the module needs it.
  - **Rust:** `cargo modules structure` and `cargo modules orphans --deny`.
  - **TS monorepo:** check each `package.json` has `exports`, and that nothing deep-imports another package's `src` (`rg -n "from ['\"]@[^/]+/[^/]+/src/"`).
  - **Java:** only *recommend* submodule splits.
- **Tools:** go list, cargo-modules, ripgrep, Maven/Gradle, import-linter or tach.
- **Applies to:** Go, Rust, Java/Kotlin and TS monorepos natively; Python and single-package JS via linters.
- **When not to apply / counterpoints:**
  - Moving a package under `internal/` or tightening `exports` breaks external consumers. Do it only for application code or with a major version bump.
  - Go's strictness has vocal critics (DoltHub 2025).
  - Splitting into build modules is a restructure (F15).
- **Fix risk:** medium

### T26-F06 — When introducing architecture rules into a finished codebase, use baseline-and-ratchet: record current violations in a checked-in baseline, fail only on new ones, make the baseline shrink-only, and ban blanket suppressions
- **Grade:** B · **Verdict:** VERIFIED. Added:
  - dependency-cruiser's `--baseline-mode shrink-only`, and the ≥18.3.0 requirement for `--baseline`;
  - import-linter's `unmatched_ignore_imports_alerting`, which defaults to `error`.
- **Rationale:**
  - **Why the mechanism exists.** Tool authors built it because grown projects start with too many violations to fix at once.
  - **Baselines can outlive their purpose.** Shopify shows todo files can persist for years.
  - **Escape hatches get abused.** Practitioners running agents report it.
- **Evidence:**
  - [ArchUnit User Guide 1.5.0 — Freezing Arch Rules](https://www.archunit.org/userguide/html/000_Index.html) — TNG — official docs — verified:
    - "When rules are introduced in grown projects, there are often hundreds or even thousands of violations, way too many to fix immediately."
    - Violations are recorded "to a ViolationStore. Consecutive runs will then only report new violations and ignore known violations."
    - "If violations are fixed, FreezingArchRule will automatically reduce the known stored violations".
  - [dependency-cruiser CLI — --baseline / --ignore-known](https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md) — Sander Verweij, v18.4.0 — official docs — verified:
    - "When you first deploy dependency-cruiser in a large code base chances are it will detect quite some violations".
    - The baseline summary looks like `new : 1 / same : 18 / stale : 8`.
    - "`--baseline` implies `--no-ignore-known` and `--no-cache`".
    - "shrink-only": "makes --baseline only _remove_ existing violations, and not add any new ones".
    - "As of 18.3.0 `--baseline` is the recommended way".
  - [A Packwerk Retrospective](https://shopify.engineering/a-packwerk-retrospective) — Gannon McGibbon & Chris Salzberg, Shopify Engineering, Feb 7, 2024 — engineering blog — "we were likely the first Packwerk user to completely work through an entire package todo file, years after its initial release". "the rate at which Packwerk was identifying problems to its users vastly outpaced their capacity to actually fix them (or interest in doing so)" — verified.
  - [HN comment (cadamsdotcom)](https://news.ycombinator.com/item?id=48525444) — Hacker News, 2026-06-14 — practitioner forum — "Resist its attempts to add a `# noqa: imports` escape hatch, because future agents will gleefully abuse that and you'll be back to human in the loop (ask me how I know!)" — verified.
  - [import-linter contract types — shared options](https://import-linter.readthedocs.io/en/stable/contract_types/) — David Seddon — official docs — `unmatched_ignore_imports_alerting`: "error: Error if there are any unmatched expressions (default)" — verified.
- **Detect:**
  - **dependency-cruiser:** `npx depcruise src --baseline`, then `--baseline-mode shrink-only`. In CI, run `npx depcruise src --ignore-known`; the "⚠ N known violations ignored" line is the debt counter.
  - **ArchUnit:** `FreezingArchRule.freeze(rule)`, with the violation store committed.
  - **import-linter:** list existing violations in `ignore_imports` and keep the default `error` alerting.
  - **Suppressions:** count them (`rg -c "eslint-disable[^\n]*(no-cycle|boundaries)|noqa|lint-imports|ArchIgnore"`) and fail if the count grows.
- **Tools:** dependency-cruiser ≥18.3, ArchUnit FreezingArchRule, import-linter, ripgrep.
- **Applies to:** any finished codebase where new architecture rules would otherwise fail on day one.
- **When not to apply / counterpoints:**
  - Baselines make debt invisible; Shopify's lasted years.
  - For a small AI-built project with a handful of violations, fixing directly may beat baselining.
- **Fix risk:** low

### T26-F15 — In a post-completion pass, document and fence by default; restructure only when the issue is in a structure+history hotspot, the change is local, tests cover it before and after, and cycle/violation counts strictly drop
- **Grade:** B · **Verdict:** CORRECTED. What changed:
  - "Kazman/Xiao show targeted refactoring can pay back strongly" overstated a *predicted* ROI.
  - The DoltHub remark that restructuring "introduces entirely new cycles" is a general observation by the author, not a result of the 64-commit PR.
  - Bavota et al. study class-level refactorings (e.g., pull up method) in three Java systems. That is indirect evidence for architecture-scale changes.
  - The "~10 files" escalation threshold is unsourced.
- **Rationale:** architecture-scale refactoring is costly and risky.
  - Microsoft engineers "perceive that refactoring involves substantial cost and risks".
  - Across 15,008 refactorings, hierarchy-changing ones "tend to induce faults very frequently".
  - Large-scale refactorings each require "considerable effort".
  - A real Eclipse restructuring did not reduce cycles.
  - Practitioners cite the lack of a regression suite as a reason not to refactor.
  - Fowler argues for incremental over big-bang replacement.
  - ADRs keep future maintainers, agents included, from "blindly" accepting or changing decisions.
- **Evidence:**
  - [An Empirical Study of Refactoring Challenges and Benefits at Microsoft](https://doi.org/10.1109/tse.2014.2318734) — Kim, Zimmermann, Nagappan, IEEE TSE 2014 — peer-reviewed — "developers perceive that refactoring involves substantial cost and risks". "the top 5% of preferentially refactored modules experience higher reduction in the number of inter-module dependencies and several complexity measures but increase size more than the bottom 95%" — full text verified (author copy).
  - [When Does a Refactoring Induce Bugs? An Empirical Study](https://doi.org/10.1109/scam.2012.20) — Bavota, De Carluccio, De Lucia, Di Penta, Oliveto, Strollo, SCAM 2012 — peer-reviewed — "15,008 refactoring operations (of 52 different kinds)". "refactorings involving hierarchies (e.g., pull up method), tend to induce faults very frequently" — full text verified (author copy). The systems are Apache Ant, Xerces and ArgoUML.
  - [Industry experiences with large-scale refactoring](https://doi.org/10.1145/3540250.3558954) — Ivers, Nord, Ozkaya, Seifried, Timperley, Kessentini, ESEC/FSE 2022 — peer-reviewed — "Our results from 107 industry developers demonstrate that projects commonly go through multiple large-scale refactorings, each of which requires considerable effort." — verified in the abstract (Semantic Scholar).
  - [Strangler Fig](https://martinfowler.com/bliki/StranglerFigApplication.html) — Martin Fowler, 22 August 2024 — engineering blog — "Replacements seem easy to specify, but often it's hard to figure out the details of existing behavior." "The alternative that my colleagues and I prefer, is to do a gradual process of modernization." — verified. The subject is legacy replacement, so this is indirect support.
  - [Documenting Architecture Decisions](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions) — Michael Nygard, Nov 15, 2011 — engineering blog — "Blindly accept the decision." / "Blindly change it." "All consequences should be listed here, not just the 'positive' ones." Records live in `doc/arch/adr-NNN.md` — verified.
  - [The perception of Architectural Smells in industrial practice](https://arxiv.org/abs/2110.06750) — Sas et al., 2021 — peer-reviewed — "One interesting reason mentioned for not refactoring AS is the absence of a comprehensive regression test suite." — verified.
  - [Go import cycles: three strategies](https://www.dolthub.com/blog/2025-03-14-go-import-cycle-strategies/) — Zach Musgrave, DoltHub, Mar 14, 2025 — engineering blog — the package restructure "[took] 64 commits and 24,000 lines across 467 files" (go-mysql-server PR 1525). Separately and generally: "much of the time, attempting such a surgical move introduces entirely new cycles, and the process must begin again." — verified; the attribution was corrected.
- **Detect:** a checklist per candidate.
  1. Is it in the F10 intersection?
  2. What does the `git diff --stat` of a spike branch touch? Escalate to a human if the fix moves any exported or public API or is non-local. The "~10 files" figure is a heuristic.
  3. Do tests cover the paths, before and after?
  4. Do the F01/F05 tools show a strict decrease with zero new violations?

  If any answer is no, write an ADR instead: `docs/adr/NNNN-<topic>.md` with Context, Decision, Status and Consequences, linked to the baseline.
- **Tools:** git, coverage tools, dependency-cruiser, import-linter, ArchUnit, ADR Markdown.
- **Applies to:** any "finished and working" project entering a hardening pass.
- **When not to apply / counterpoints:**
  - Targeted architectural refactoring *can* pay off. Kazman's ROI model persuaded an industrial organisation, though it was predicted, and Windows 7's refactored modules shed inter-module dependencies. This rule sets the burden of proof; it is not a ban.
  - In a small, new codebase, a local restructure is cheap.
  - No empirical comparison of package-by-feature with package-by-layer was found.
- **Fix risk:** low

### T26-F08 — Flag god classes/components with published thresholds (PMD GodClass: WMC ≥ 47, ATFD > 5, TCC < 1/3; component LOC far above peers; fan-out above ~10), but treat hits as review candidates; split only if the unit is also a change/bug hotspot and covered by tests
- **Grade:** B · **Verdict:** CORRECTED. What changed:
  - The rationale conflated class-level God Classes (Olbrich) with architecture-level God Components (Sas et al.).
  - Olbrich's result holds "under the assumption that God and Brain Classes contain on average as much functionality per line of code as other classes".
  - The fan-out figure of 10 is eslint-plugin-import's default, not an empirical threshold.
- **Rationale:**
  - **Standardised detection.** PMD's GodClass rule encodes Lanza & Marinescu (2006, p. 80).
  - **God Classes, class level.** In 7-10 years of three Java OSS systems, God and Brain Classes changed more and had more defects in absolute terms. Normalised for size, they changed less and had fewer defects.
  - **God Components, component level.** Industrial practitioners rank God Components among the most important smells.
- **Evidence:**
  - [PMD GodClassRule.java](https://raw.githubusercontent.com/pmd/pmd/main/pmd-java/src/main/java/net/sourceforge/pmd/lang/java/rule/design/GodClassRule.java) — PMD 7.27.0 (2026-08-28) — official source — `WMC_VERY_HIGH = 47`; `FEW_ATFD_THRESHOLD = 5` ("Few means between 2 and 5"); `TCC_THRESHOLD = 1.0 / 3.0` ("One third is a low value"); the rule fires on `wmc >= WMC_VERY_HIGH && atfd > FEW_ATFD_THRESHOLD && tcc < TCC_THRESHOLD`. It cites Lanza, *Object-Oriented Metrics in Practice*, page 80 — verified.
  - [PMD Java design rules](https://docs.pmd-code.org/latest/pmd_rules_java_design.html) — PMD 7.27.0 — official docs — verified defaults:
    - CouplingBetweenObjects `threshold` 20;
    - ExcessiveImports `minimum` 30;
    - CyclomaticComplexity `methodReportLevel` 10 and `classReportLevel` 80.
  - [Are all code smells harmful? A study of God Classes and Brain Classes in the evolution of three open source systems](https://doi.org/10.1109/icsm.2010.5609564) — Olbrich, Cruzes, Sjøberg, ICSM 2010 — peer-reviewed — "when we normalized the measured effects with respect to size, then God and Brain Classes were less subject to change and had fewer defects than other classes. Hence, under the assumption that God and Brain Classes contain on average as much functionality per line of code as other classes, the presence of God and Brain Classes is not necessarily harmful; in fact, such classes may be an efficient way of organizing code." — full text verified (camera-ready via Wayback). The systems are Log4j, Lucene and Xerces.
  - [Arcan docs — Architectural smells](https://docs.arcan.tech/latest/architectural_smells/) — Arcan (commercial) — vendor docs — God Component "occurs when an architectural component is excessively large in terms of LOC (Lines Of Code)"; threshold `Max(LinesOfCode_System, LinesOfCode_Benchmark)` — verified.
  - [The perception of Architectural Smells in industrial practice](https://arxiv.org/abs/2110.06750) — Sas et al., 2021 — peer-reviewed — "GC and CD are perceived as the most important ones, HL is considered 'manageable', and UD is considered detrimental but not critical". Here GC means God **Component**. Two architects "saw no added technical value in splitting a GC". — verified.
  - [eslint-plugin-import max-dependencies](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/max-dependencies.md) — import-js — official docs — "Forbid modules to have too many dependencies". "**Default is 10** if the rule is enabled and no `max` is specified." Supports `ignoreTypeImports` — verified.
- **Detect:**
  - **Java:** `pmd check -d src/main/java -R category/java/design.xml/GodClass -f text`, plus CouplingBetweenObjects and ExcessiveImports.
  - **TS/JS:** `'import/max-dependencies': ['warn', {max: 10, ignoreTypeImports: true}]`.
  - **Any language:** find the largest files, then join them with churn and bug-fix counts from `git log`. Propose a split only for files high on both. A "top decile" cut-off is a heuristic.
- **Tools:** PMD 7.27.0, eslint-plugin-import, git, wc. Arcan is optional.
- **Applies to:** OO codebases, and module- or package-level god components in any language.
- **When not to apply / counterpoints:**
  - Olbrich et al. contradict treating size-driven God Classes as harmful per LOC. Sas et al.'s practitioners rank God *Components* among the worst smells. These are different granularities, so don't cite one to justify the other.
  - Splitting creates new cross-module dependencies. SmellBench's most aggressive agent introduced 140 smells through module consolidations.
  - The thresholds are calibrated on Java.
- **Fix risk:** high

### T26-F11 — Use dependency-graph centrality (highest fan-in modules) to decide where extra tests, review and broader regression runs are needed, not as a reason to restructure
- **Grade:** B · **Verdict:** VERIFIED. The finding's rationale was accurate; only the researcher's summary line ("not in replications") overstated the conflict.
- **Rationale:**
  - **Microsoft.** Network measures identified defect-prone Windows Server 2003 *binaries* better than complexity metrics.
  - **Replication.** A replication on three OSS Java systems agreed under random sampling, but found no advantage in forward-release and cross-project settings.
  - **Use.** Treat centrality as a cheap signal for where to look.
- **Evidence:**
  - [Predicting defects using network analysis on dependency graphs](https://doi.org/10.1145/1368088.1368161) — Zimmermann & Nagappan, ICSE 2008 — peer-reviewed — "the recall for models built from network measures is by 10% points higher than for models built from complexity metrics. In addition, network measures could identify 60% of the binaries that the Windows developers considered as critical--twice as many as identified by complexity metrics." — full text verified (author copy).
  - [Network Versus Code Metrics to Predict Defects: A Replication Study](https://doi.org/10.1109/esem.2011.30) — Premraj & Herzig, ESEM 2011 — peer-reviewed — "Our results are in agreement with the original study ... when using a similar experimental setup as them (random sampling). However ... forward-release and cross-project prediction -- we found network metrics to offer no vantage over code metrics." "we used only 8 code metrics compared to approximately 58 network metrics" — full text verified. The systems are JRuby, ArgoUML and Eclipse.
- **Detect:**
  - **JS/TS:** fan-in ranking from `npx madge --json src` plus jq.
  - **Python:** `pydeps --show-deps`, or grimp.
  - **For the top 10 fan-in modules:** confirm direct test coverage exists, and mark them "run full suite on change".
- **Tools:** madge, jq, pydeps, coverage tools (c8, coverage.py, JaCoCo).
- **Applies to:** medium to large codebases.
- **When not to apply / counterpoints:**
  - The original unit was Windows *binaries*, so extrapolating to source modules in small projects is untested.
  - The replication undercuts the advantage in realistic settings.
- **Fix risk:** low

### T26-F03 — Break worthwhile cycles with the smallest local move (move a function, extract a lower module, merge two tightly coupled modules, or add an interface in the lower module); never hide a cycle with late binding (global function-pointer hooks, service locator, dynamic `import()`) just to silence tools
- **Grade:** B · **Verdict:** CORRECTED. What changed:
  - Microsoft says "Avoid using the service locator pattern" because it mixes Inversion of Control strategies. It does not list it under its "anti-patterns", so the attribution was fixed.
  - The Python FAQ explicitly endorses moving an import into a function, and pylint's own R0401 example still flags such a function-level import. A deferred import is therefore a legitimate runtime mitigation that keeps the cycle visible to pylint; it is not "hiding".
  - The DoltHub "introduces entirely new cycles" remark is general, not about the 64-commit PR.
- **Rationale:**
  - **Local techniques.** MDN and Arcan list the same local techniques.
  - **Restructuring is costly.** One Go restructure took 64 commits, 24,000 lines and 467 files, and the author warns that such moves often introduce new cycles.
  - **Late binding fails at runtime.** Global function-pointer hooks lead to nil-pointer panics.
  - **Tool authors warn.** eslint-plugin-import calls dynamic-cycle allowances unsafe.
  - **Microsoft** says to avoid the service locator.
- **Evidence:**
  - [MDN JavaScript modules — Cyclic imports](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) — MDN — official docs — "Some common cycle-elimination techniques are: Merge the two modules into one. Move the shared code into a third module. Move some code from one module to the other." — verified.
  - [Arcan docs — Refactoring best practices](https://docs.arcan.tech/latest/refactoring/) — Arcan (commercial) — vendor docs — "The main goal when refactoring a cycle is to break one or more dependencies." Move function, Extract unit, Create interface, Merge units — verified.
  - [Go import cycles: three strategies for dealing with them, and a plea for a fourth](https://www.dolthub.com/blog/2025-03-14-go-import-cycle-strategies/) — Zach Musgrave, DoltHub, Mar 14, 2025 — engineering blog — verified; attribution corrected:
    - "64 commits and 24,000 lines across 467 files".
    - Stated generally: "much of the time, attempting such a surgical move introduces entirely new cycles, and the process must begin again".
    - On the global function-pointer hack: "panic: runtime error: invalid memory address or nil pointer dereference".
    - The author prefers "The Good" option: narrow interfaces.
  - [eslint-plugin-import no-cycle](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-cycle.md) — import-js, v2.32.0 — official docs — "Cyclic dependency are **always** a dangerous anti-pattern ... Please be extra careful about using this option." — verified.
  - [Dependency injection guidelines](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/guidelines) — Microsoft Learn, ms.date 2026-01-14 — official docs — "Avoid using the service locator pattern. ... Another service locator variation to avoid is injecting a factory that resolves dependencies at runtime. Both of these practices mix Inversion of Control strategies." — verified.
  - [Python Programming FAQ](https://docs.python.org/3/faq/programming.html) — PSF — official docs — "if the second module is only used in one function, then the import can easily be moved into that function". "Only move imports into a local scope, such as inside a function definition, if it's necessary to solve a problem such as avoiding a circular import" — verified; counterpoint.
  - [pylint cyclic-import / R0401](https://pylint.readthedocs.io/en/stable/user_guide/messages/refactor/cyclic-import.html) — pylint — official docs — the "Problematic code" example puts `from .bad2 import count_to_two` inside `count_to_three()` and still flags `# [cyclic-import]` — verified.
- **Detect:**
  - **Python:** find function-level imports with `rg -n "^\s+(from \S+ )?import " --type py`.
  - **JS/TS:** find dynamic imports with `rg -n "import\(" src`.
  - **Go:** find hooks with `rg -n "^var \w+ func\(" --type go`.
  - **.NET:** look for `GetService<` or `BuildServiceProvider(` outside the composition root.
  - Keep `allowUnsafeDynamicCyclicDependency` false.
  - After a fix, re-run F01. The cycle count must drop, and no new cycle may appear.
- **Tools:** ripgrep, dependency-cruiser, madge, eslint-plugin-import, pylint.
- **Applies to:** all languages with module import graphs.
- **When not to apply / counterpoints:**
  - Accept a documented deferred import in Python, but still count it as a cycle.
  - Merging modules can create a god module (F08).
  - The DoltHub author thinks Go's ban "costs far more than it's worth". That is a dissent about language design.
  - There is no controlled comparison of techniques.
- **Fix risk:** medium

### T26-F13 — Check the configuration boundary: everything that varies between deploys lives outside the code and no secrets are in the repo (the "could we open-source it now?" litmus test); accept env vars or a typed config file
- **Grade:** B · **Verdict:** CORRECTED. What changed:
  - 12factor.net is a web manifesto (Adam Wiggins / Heroku, 2011), not a "book".
  - The Google style guide is about mutable global state in general, not configuration, so it is indirect support.
  - The sub-rule "read config in one place and validate it at startup" has **no external source** in this dossier. It is common practice, kept as an unsourced recommendation.
  - The revision repository's last push was 2025-08, so the revision is slow-moving.
- **Rationale:**
  - **The core rule.** Twelve-Factor defines config as what varies between deploys and gives the open-source litmus test. It warns that named environment groups cause "a combinatorial explosion of config".
  - **Under revision.** The manifesto is being revised in an open repository.
  - **Pushback.** Practitioners object to env vars as the *only* mechanism.
- **Evidence:**
  - [The Twelve-Factor App — III. Config](https://12factor.net/config) — Adam Wiggins / Heroku, 2011 — industry manifesto (web) — "An app's config is everything that is likely to vary between deploys". "A litmus test for whether an app has all config correctly factored out of the code is whether the codebase could be made open source at any moment, without compromising any credentials." "a combinatorial explosion of config which makes managing deploys of the app very brittle." — verified.
  - [twelve-factor/twelve-factor](https://github.com/twelve-factor/twelve-factor) — Twelve-Factor maintainers — other — "the updated version of the twelve-factor manifesto, which will ultimately replace the one hosted at 12factor.net" — verified. The repo was last pushed 2025-08-21.
  - [HN comment (vilunov) on "The Twelve-Factor App (2011)"](https://news.ycombinator.com/item?id=37858141) — Hacker News, 2023-10-12 — practitioner forum — "it forces you to store secrets in envs, which could be less secure, and to abandon structured file configs, which may enjoy type safety, IDE autocomplete and automatic parsing" — verified. Reply by twic ([37863684](https://news.ycombinator.com/item?id=37863684)): a config file is "easier to give structure to, doesn't get implicitly passed down to subprocesses" — verified.
  - [Google Python Style Guide §2.5](https://google.github.io/styleguide/pyguide.html) — Google — official style guide — global state that manages a DB connection makes "connecting to two different databases at the same time" difficult — verified; indirect support for configuration.
- **Detect:**
  - **Scattered reads:** `rg -n "process\.env\.|os\.environ|os\.getenv|std::getenv|System\.getenv|Environment\.GetEnvironmentVariable" src | cut -d: -f1 | sort | uniq -c | sort -rn`.
  - **Hard-coded values:** grep for hard-coded hosts and credentials.
  - **Git hygiene:** check that `.env` files are gitignored, and run a secret scanner over the history.
- **Tools:** ripgrep, a secret scanner, zod or pydantic-settings for validation.
- **Applies to:** deployable services and apps. Libraries should take configuration as parameters.
- **When not to apply / counterpoints:**
  - Env vars versus files is a live dispute.
  - Local-dev defaults are fine if they are overridable and not secrets.
  - Centralising config can move read time (import time versus startup) and change test behaviour.
- **Fix risk:** medium

### T26-F05 — Turn the boundaries the code already has into executable rules (fitness functions) in CI and pre-commit; derive them from the current structure, README or ADRs, and do not invent a new target architecture during hardening
- **Grade:** B · **Verdict:** CORRECTED. What changed:
  - **Slater pilot.** It has a single named author (Tyler Slater). Its "80%" is 4/5 runs of Llama 3 8B; GPT-5.1 had 0/5 and Claude 4.5 Sonnet 1/5 (a minor `time` import).
  - **Thoughtworks blip.** It is dated Nov 2017 and May 2018, and is not on the current radar.
  - **Eclipse evidence.** "Plugins had no cycles *because* the platform forbade them" is only one of three explanations Anquetil & Laval give; the others are far fewer plugins, and plugins being the "real" modules. Recorded as observational with confounds.
- **Rationale:**
  - **Eclipse.** Enforced plugin boundaries showed no SCCs while ordinary Java packages grew more and larger SCCs every release (confounded, as above).
  - **Code review.** It removes most of the erosion it spots, but "a few symptoms still remain and are ignored".
  - **Agents.** Practitioners using agents report architecture lint in pre-commit is what keeps violations out.
  - **Strength.** Evidence of effectiveness is observational and anecdotal.
- **Evidence:**
  - [Legacy Software Restructuring: Analyzing a Concrete Case](https://arxiv.org/abs/1210.7138) — Anquetil & Laval, CSMR 2011 (arXiv 2012) — peer-reviewed — full text verified:
    - "with each new version, the number of SCC in the system increases".
    - "We don't give results for Eclipse plugins because we found no SCC ... Eclipse also prohibit defining cyclic dependencies this way. So the tool itself forced the engineers to pay attention to this issue."
    - The alternative explanations are also in the text.
  - [Technology Radar: Architectural fitness function](https://www.thoughtworks.com/radar/techniques/architectural-fitness-function) — Thoughtworks, Nov 2017 and May 2018, both Trial — industry report — "a fitness function is used to summarize how close a given design solution is to achieving the set aims" — verified. The page says it is not on the current edition.
  - [import-linter Layers contract](https://import-linter.readthedocs.io/en/stable/contract_types/layers/) — David Seddon, v2.15 (PyPI 2026-09-04) — official docs — "Layers contracts enforce a 'layered architecture', where higher layers may depend on lower layers, but not the other way around." — verified.
  - [ArchUnit User Guide 1.5.0](https://www.archunit.org/userguide/html/000_Index.html) — TNG — official docs — `layeredArchitecture().consideringAllDependencies()...whereLayer("Service").mayOnlyBeAccessedByLayers("Controller")` and `onionArchitecture()` — verified.
  - [Symptoms of Architecture Erosion in Code Reviews](https://arxiv.org/abs/2201.01184) — Li et al., ICSA 2022 — peer-reviewed — "most code reviews that identify erosion symptoms have a positive impact on removing erosion symptoms, but a few symptoms still remain and are ignored by developers" — verified.
  - [Quantitative Analysis of Technical Debt and Pattern Violation in Large Language Model Architectures](https://arxiv.org/abs/2512.04273) — Tyler Slater, arXiv Dec 2025, under review at JSS — preprint (pilot) — "Llama 3 demonstrated an 80% Architectural Violation Rate". The full text gives "(n = 4/5)" and "N = 5 runs each". — verified; author and sample corrected.
  - [HN comment (cadamsdotcom) on "Software Architecture Guide (2019)"](https://news.ycombinator.com/item?id=48525444) — Hacker News, 2026-06-14 — practitioner forum — "lint your architecture in a pre-commit check. ... Start by having your agent install some import-linter rules." — verified.
  - [Nx: Enforce module boundaries](https://nx.dev/docs/features/enforce-module-boundaries) — Nx — official docs — `@nx/enforce-module-boundaries` with `{ "sourceTag": "scope:admin", "onlyDependOnLibsWithTags": ["scope:shared", "scope:admin"] }` — verified.
- **Detect:**
  - **Python:** `[tool.importlinter]` with a `layers` contract and a `forbidden` contract. External packages need `include_external_packages = true`. Run `lint-imports`. Alternatives: `tach check`, or Ruff TID251.
  - **TS/JS:** a dependency-cruiser `forbidden` rule from `^src/domain` to infra, adapter or framework paths. In Nx monorepos, `@nx/enforce-module-boundaries`.
  - **Java:** ArchUnit. **C#:** ArchUnitNET. **PHP:** deptrac.
  - Wire the check into CI and pre-commit.
- **Tools:** import-linter 2.15, tach 0.35.1, Ruff TID251, dependency-cruiser 18.4.0, Nx, ArchUnit 1.5.0, ArchUnitNET, deptrac.
- **Applies to:** any codebase with an intended layering or feature split, especially when agents will keep editing it.
- **When not to apply / counterpoints:**
  - There is no controlled study that fitness functions reduce defects.
  - Rules derived from folder names can encode the wrong architecture. Shopify found packages grouped "based strongly on semantic clues that in many cases have little relation to how the code actually runs".
  - The LLM pilot does not show that frontier agents break layering.
  - Rules that are too strict drive suppressions (F06).
- **Fix risk:** low

### T26-F07 — Do not declare a boundary "clean" on static analysis alone: boot or import each package on its own and run its tests in isolation; inventory the dynamic dependency mechanisms static graphs miss (reflection/string loading, DI registration, autoload/plugin registries, dynamic `import()`/`require(var)`, framework conventions)
- **Grade:** C · **Verdict:** CORRECTED. The researcher attributed HN 41366572 to "eithed". The author is **tpetry**, replying to eithed. The comment argues *for* static analysis over runtime detection ("would fail with bundling"), so it does not support "static and runtime checks complement each other". It was moved to counterpoints.
- **Rationale:**
  - **Static checks miss autoloading.** Shopify found packages with zero Packwerk violations that crashed with name errors. Packwerk is blind to constants loaded outside Zeitwerk autoload directories.
  - **Isolated tests find more.** Running each package's tests in isolation surfaced still more issues.
- **Evidence:**
  - [A Packwerk Retrospective](https://shopify.engineering/a-packwerk-retrospective) — McGibbon & Salzberg, Shopify Engineering, Feb 7, 2024 — engineering blog — all verified:
    - "Constants loaded using mechanisms like `require`, `autoload` or `ActiveSupport::Autoload` are untracked and invisible to the tool. As a result, a package that is well-defined according to Packwerk (has no violations left to resolve) may actually crash with name errors when its code is executed."
    - "we went a step further and created a CI step to run tests for the package's code in isolation. This surfaced yet more issues that neither Packwerk's static analysis nor boot had encountered."
    - "running code, more than any metric, will always be the best indicator of real progress".
  - [dependency-cruiser --init default rules](https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md) — Sander Verweij — official docs — `not-to-unresolvable`: "flags dependencies that can't be resolved" — verified.
- **Detect:**
  - **Inventory dynamic-dependency sites:**
    - Python: `importlib.import_module(` and `__import__(`.
    - JS/TS: `require(` or `import(` with non-literal arguments.
    - Java: `Class.forName(`.
    - DI registrations: `AddSingleton`, `AddScoped`, `@Injectable`, `register(`.
  - **Run each package's tests alone**, for example `pytest tests/<pkg>` or `npx vitest run src/<feature>`.
  - **Run the F04 standalone-import check.**
- **Tools:** ripgrep, pytest, vitest or jest, dependency-cruiser (`not-to-unresolvable`).
- **Applies to:** frameworks with autoloading, DI or plugin systems (Rails, Spring, NestJS, .NET, Django), and any code with dynamic imports.
- **When not to apply / counterpoints:**
  - The strongest evidence is one Rails/Zeitwerk retrospective.
  - A practitioner warns that *runtime* boundary mechanisms are fragile: "The runtime detection of code files is really weird and would fail with bundling" ([tpetry, HN 41366572](https://news.ycombinator.com/item?id=41366572)). Use running code to *verify*, and static rules to *enforce*.
  - Per-package isolated runs can be expensive.
- **Fix risk:** low

### T26-F09 — Compute Martin's package metrics (Ca, Ce, I = Ce/(Ca+Ce)) and hub measures; report Stable-Dependencies-Principle violations and extreme fan-in+fan-out hubs (especially catch-all `shared/`, `utils/`, `common/`) as review prompts only; never optimise toward "distance from the main sequence"
- **Grade:** C · **Verdict:** VERIFIED. Notes:
  - The Martin PDF is a university mirror (linux.ime.usp.br), © Robert C. Martin 1994.
  - The contradictions section below corrects an overstatement about SmellBench's Unstable Dependency results.
- **Rationale:**
  - **Cheap and tool-supported.** The metrics are easy to compute and several tools implement them.
  - **The author's caveat.** Martin warns "a metric is not a god".
  - **A negative result.** An industrial restructuring study found coupling and cohesion metrics "did not behave as expected".
  - **Practitioners.** They call Unstable Dependency "detrimental but not critical" and hard to see without tooling.
  - **SmellBench.** Unstable Dependency hits were predominantly genuine (6/14 true positive, 6/14 partially valid).
- **Evidence:**
  - [OO Design Quality Metrics: An Analysis of Dependencies](https://linux.ime.usp.br/~joaomm/mac499/arquivos/referencias/oodmetrics.pdf) — Robert C. Martin, Oct 28, 1994 — other (essay) — full text verified:
    - "I : Instability : (Ce ÷ (Ca+Ce))".
    - "in my experience only about half the categories in a project can have such ideal characteristics".
    - "a metric is not a god; it is merely a measurement against an arbitrary standard."
    - "I would deeply regret it if anybody suddenly decided that all their designs must unconditionally be conformant to 'The Martin Metrics'."
  - [dependency-cruiser rules reference: moreUnstable](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) — Sander Verweij — official docs — "stable dependencies principle: 'depend in the direction of stability'"; the Instability formula; works at `scope: 'folder'` — verified.
  - [Legacy Software Restructuring](https://arxiv.org/abs/1210.7138) — Anquetil & Laval — peer-reviewed — "the cohesion and coupling metrics used in the experiment did not behave as expected and would probably not have helped the maintainers reach there goal" — verified.
  - [SmellBench](https://arxiv.org/abs/2605.07001) — Dinu et al., 2026 — preprint — "Potential Redundant Abstractions are entirely false positives (25/25), while Unstable Dependencies are predominantly genuine issues (6/14 True Positive, 6/14 Partially Valid)." — verified.
  - [Arcan docs — Hub-Like and Unstable Dependency](https://docs.arcan.tech/latest/architectural_smells/) — Arcan (commercial) — vendor docs — `TotalDeps(x) = FanIn(x) + FanOut(x)` with threshold `Max(Threshold_System, Threshold_Benchmark)`, benchmarked on 100+ Qualitas Corpus systems. Unstable Dependency when `Instability(x) > Instability(y) + delta` — verified.
  - [HN comment (hannofcart) on "How to effectively write quality code with AI"](https://news.ycombinator.com/item?id=46920000) — Hacker News, 2026-02-07 — practitioner forum — "8. Modularisation enforcement (dependency-cruiser) 9. Custom script to ensure shared/util directories are not over stuffed" — verified.
- **Detect:**
  - **SDP rule:** dependency-cruiser `{name:'sdp', severity:'warn', scope:'folder', from:{}, to:{moreUnstable:true}}`.
  - **Fan-in and fan-out:** `npx madge --json src`, then jq.
  - **Catch-all folders:** `git ls-files | grep -E "/(utils?|common|shared|helpers?)/" | cut -d/ -f1-3 | sort | uniq -c | sort -rn`.
- **Tools:** dependency-cruiser, madge, jq, git. Arcan is optional.
- **Applies to:** codebases with 10 or more modules; that threshold is a heuristic.
- **When not to apply / counterpoints:**
  - The main sequence and the SDP are unvalidated heuristics from 1994.
  - Larsen & Moghaddam saw a suggestive but not significant rise in Unstable Dependency under AI adoption.
  - Hubs such as loggers or core types modules are often legitimate.
- **Fix risk:** medium

### T26-F14 — Use ports-and-adapters as a check, not a post-hoc rewrite: verify domain/core code does not import infrastructure, framework, UI or database modules, and that business rules are not in controllers/UI handlers; do not add new port interfaces for single-implementation dependencies with no test-double need
- **Grade:** C · **Verdict:** CORRECTED
  - HN 41564867 ("we had to move DBs in both...") is by **yuppiepuppie**, not phamilton.
  - The claim "it is precisely the domain-to-infrastructure boundary LLMs violate" overgeneralised a 15-run pilot. Only Llama 3 8B violated it often (4/5).
- **Rationale:**
  - **Cockburn's intent.** He wants the application "developed and tested in isolation from its eventual run-time devices and databases". The failure he targets is business logic leaking into the UI.
  - **Cost of speculative ports.** Practitioners report indirection that "ossifies" implementations, database swaps that needed rewrites anyway, and "where tf" navigation pain.
- **Evidence:**
  - [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/) — Alistair Cockburn, HaT Technical Report 2005.02 (2005-09-04) — other (practitioner pattern) — verified:
    - Intent: "Allow an application to equally be driven by users, programs, automated test or batch scripts, and to be developed and tested in isolation from its eventual run-time devices and databases."
    - Motivation: "One of the great bugaboos of software applications over the years has been infiltration of business logic into the user interface code."
  - [HN thread "Master Hexagonal Architecture in Rust"](https://news.ycombinator.com/item?id=41518698) — Hacker News, Sept 2024 — practitioner forum — all verified via Algolia:
    - jiggawatts ([41574134](https://news.ycombinator.com/item?id=41574134)): "You also won't replace your database engine or queue either. If you do for some reason, it'll be a partial rewrite of you[r] app no matter what."
    - Avi-D-coder ([41565596](https://news.ycombinator.com/item?id=41565596)): "Every layer of indirection ossifies the underlying concrete implementations."
    - seanhunter ([41570921](https://news.ycombinator.com/item?id=41570921)): the "where tf" problem.
    - yuppiepuppie ([41564867](https://news.ycombinator.com/item?id=41564867)): "we had to move DBs in both. We ended up rewriting most of the application".
  - [Quantitative Analysis of Technical Debt and Pattern Violation in LLM Architectures](https://arxiv.org/abs/2512.04273) — Tyler Slater, 2025 — preprint (pilot) — Llama 3 8B, 80% violation rate (n = 4/5), "bypassing interface adapters to create illegal circular dependencies between Domain and Infrastructure layers" — verified.
  - [ArchUnit User Guide 1.5.0 — onionArchitecture()](https://www.archunit.org/userguide/html/000_Index.html) — TNG — official docs — "In an 'Onion Architecture' (also known as 'Hexagonal Architecture' or 'Ports and Adapters')" … `onionArchitecture().domainModels("com.myapp.domain.model..")...adapter("persistence", "com.myapp.adapter.persistence..")` — verified.
- **Detect:**
  - **Python:** an import-linter `forbidden` contract from `app.domain` to adapters, API and framework packages (`include_external_packages = true`).
  - **TS:** a dependency-cruiser `forbidden` rule from `^src/(domain|core)` to infra, UI or framework paths.
  - **Java:** ArchUnit `onionArchitecture()`.
  - **Manual:** grep controllers for business-rule branching.
- **Tools:** import-linter, dependency-cruiser, ArchUnit, ripgrep.
- **Applies to:** services with a distinguishable domain core. Skip thin CRUD apps and scripts.
- **When not to apply / counterpoints:**
  - The benefits rest on a practitioner pattern, not outcome data.
  - Adding ports after the fact is a restructure (F15).
  - The LLM evidence is a 15-run pilot.
- **Fix risk:** medium

### T26-F18 — Detect implicit coupling across boundaries: file pairs in different top-level modules that co-change in ≥30% of their commits with ≥5 shared revisions, plus average top-level modules touched per commit; report as "boundary does not match change pattern" and fix only via F15
- **Grade:** C · **Verdict:** CORRECTED. What changed:
  - **D'Ambros et al.** is now verified in full text. Change coupling correlated with defects (Spearman above 0.5 in all three systems, maximum above 0.8 in Eclipse). It correlated "more than metrics but less than number of changes", and more than changes for major and high-priority bugs in some settings.
  - **Mo 2015, read in full,** contradicts the researcher's claim that Implicit Cross-module Dependency is "among the strongest predictors". Its bug-frequency increases were small and inconsistent: +7% to +46% in most OSS projects, negative in Ivy (−15%) and OpenJPA (−5%), and +165% in the commercial project. Unstable Interface and Cross-Module Cycle dominated.
  - **The 30%/5 thresholds** are Code Maat defaults, not calibrated values.
- **Rationale:**
  - **Definition.** Change coupling is "the implicit relationship between two or more software artifacts that have been observed to frequently change together".
  - **Defect link.** It correlates with defects in three systems.
  - **ANMCC.** The average number of modified components per commit (ANMCC) was proposed as an architectural technical debt (ATD) indicator.
  - **Hotspot patterns.** The history-based cross-module pattern exists, but its measured effect was modest.
- **Evidence:**
  - [On the Relationship Between Change Coupling and Software Defects](https://www.inf.usi.ch/lanza/PUBS/P/DAmb2009e.pdf) — D'Ambros, Lanza, Robbes, WCRE 2009 (DOI 10.1109/WCRE.2009.19) — peer-reviewed — "Change coupling correlates with defects, more than metrics but less than number of changes." For major and high-priority bugs, the delta to number of changes "is often negative, i.e., change coupling measures correlate more than number of changes" — full text verified. The systems are Eclipse, ArgoUML and Mylyn.
  - [Hotspot Patterns](https://doi.org/10.1109/wicsa.2015.12) — Mo, Cai, Kazman, Xiao, WICSA 2015 — peer-reviewed — "two novel hotspot patterns, Unstable Interface and Implicit Cross-module Dependency ... detected by the combination of history and architecture information". Table VIII shows ICD's modest bug-frequency increases — full text verified.
  - [An empirical investigation of modularity metrics for indicating architectural technical debt](https://doi.org/10.1145/2602576.2602581) — Li, Liang, Avgeriou, Guelfi, Ampatzoglou, QoSA 2014 — peer-reviewed — "the average number of modified components per commit (ANMCC): a higher ANMCC indicates more ATD". IPCI and IPGF correlate with ANMCC across 13 OSS projects — verified in the abstract.
  - [Code Maat README — coupling](https://github.com/adamtornhill/code-maat) — Adam Tornhill — official docs — "Modules that are logically coupled have a hidden, implicit dependency between them such that a change to one of them leads to a predictable change in the coupled module." Defaults: min-revs 5, min-shared-revs 5, min-coupling 30 — verified.
  - [HN comment (barbarbar)](https://news.ycombinator.com/item?id=33940863) — Hacker News, 2022-12-11 — practitioner forum — "When adding small features you end up jumping all over the place in all 'layers'. So a little change in controllers, services, repositories, entities." — verified.
- **Detect:**
  - **Co-change pairs:** `git log --all --numstat --date=short --pretty=format:"--%h--%ad--%aN" --no-renames > log.txt`, then `java -jar code-maat.jar -l log.txt -c git2 -a coupling`. Keep the pairs whose top-level directories differ.
  - **ANMCC:** approximate it by counting distinct top-level directories per commit. The researcher's awk pipeline was not executed; it skips root-level files.
- **Tools:** Code Maat (v1.0.4, 2023), git, awk.
- **Applies to:** repositories with enough history, at least 5 shared revisions per pair.
- **When not to apply / counterpoints:**
  - Filter out legitimately paired files: code and tests, schema and migration, interface and implementation.
  - Thin history makes the signal noise.
  - In Mo 2015, this particular pattern had weak and inconsistent effects.
  - There is no evidence that reorganising by feature fixes it.
- **Fix risk:** low

## Practitioner voice
- [A Packwerk Retrospective](https://shopify.engineering/a-packwerk-retrospective) — Shopify (McGibbon & Salzberg), Feb 7, 2024, on years of Packwerk in a Rails monolith:
  - Privacy checks turned the tool into "an API design tool" and were removed in Packwerk 3.0.
  - Todo files lingered for years; detection "vastly outpaced" teams' capacity to fix.
  - Packages were drawn on naming semantics, not runtime behaviour.
  - Zero-violation packages still crashed because Packwerk can't see non-Zeitwerk loading.
  - Lesson: boot and test each package in isolation.
- [Go import cycles: three strategies](https://www.dolthub.com/blog/2025-03-14-go-import-cycle-strategies/) — DoltHub (Zach Musgrave), Mar 2025:
  - A package restructure to remove cycles took 64 commits and 24,000 lines across 467 files.
  - The author notes that such moves "much of the time" introduce new cycles. That is a general remark, not a claim about that PR.
  - The global function-pointer hack causes nil-pointer panics.
  - He prefers narrow interfaces, and pleads for a compiler flag to allow cycles.
- [HN 48525444](https://news.ycombinator.com/item?id=48525444) — cadamsdotcom, June 2026:
  - "lint your architecture in a pre-commit check", with import-linter, then custom AST checkers.
  - "Resist its attempts to add a `# noqa: imports` escape hatch, because future agents will gleefully abuse that".
- [HN 46920000](https://news.ycombinator.com/item?id=46920000) — hannofcart, Feb 2026: a TypeScript `pnpm check` in pre-commit.
  - It includes dependency-cruiser modularisation rules and a custom script so shared/util folders aren't "over stuffed".
  - He reports a "dramatic improvement in code quality" of agent-written code.
- [HN 41574134](https://news.ycombinator.com/item?id=41574134) — jiggawatts, 2024, on hexagonal architecture: "You also won't replace your database engine or queue either. If you do for some reason, it'll be a partial rewrite of you[r] app no matter what."
- [HN 41564867](https://news.ycombinator.com/item?id=41564867) — yuppiepuppie, 2024: two legacy hexagonal systems both needed DB moves, and "We ended up rewriting most of the application".
- [HN 41565596](https://news.ycombinator.com/item?id=41565596) — Avi-D-coder, 2024: "Every layer of indirection ossifies the underlying concrete implementations." His advice is to start concrete and abstract only after two or three implementations exist.
- [HN 37858141](https://news.ycombinator.com/item?id=37858141) — vilunov, 2023, dissenting on Twelve-Factor config:
  - Env vars force secrets into the environment and drop type-safe structured files.
  - Dot-env files get committed anyway.
  - A reply by twic ([37863684](https://news.ycombinator.com/item?id=37863684)) prefers config files, which don't get "implicitly passed down to subprocesses".
- [HN 45877606](https://news.ycombinator.com/item?id=45877606) — bognition, Nov 2025:
  - Enforcement by one person "with an iron fist ... doesn't scale".
  - Multi-module Maven can forbid imports between modules.
  - "In Python you can't do any of this."
- [HN 45878463](https://news.ycombinator.com/item?id=45878463) — ivanjermakov, Nov 2025: a one-line jibe at "30+ microservice projects where almost every service connects to a single oracle database". The lesson "code boundaries without data boundaries give hidden coupling" is our interpretation.
- [HN 41366093](https://news.ycombinator.com/item?id=41366093) — JonChesterfield, 2024: directory-tree "firewalls" in C eventually hit a cycle.
  - The "fix" is to abandon the scheme, add static-inline workarounds, "or to move the multiply-used dependency up through the tree".
  - "'Misc' is prone to ending up at the top level."
- [How GitHub uses eBPF to improve deployment safety](https://github.blog/engineering/infrastructure/how-github-uses-ebpf-to-improve-deployment-safety/) — GitHub (Lawrence Gripper, Aleksey Levenstein), Apr 16, 2026:
  - "to deploy GitHub, we needed GitHub".
  - It describes direct, hidden and transient circular dependencies in deploy tooling that could block an incident fix.
  - Cycles also exist at service and deploy level.
- [Goodbye Microservices](https://www.twilio.com/en-us/blog/developers/best-practices/goodbye-microservices) — Segment (Alexandra Noonan), July 2018:
  - Shared-library versions diverged across more than 140 services, with "3 full-time engineers spending most of their time just keeping the system alive".
  - They needed "a rock solid testing suite" before consolidating into one service.
- [The perception of Architectural Smells in industrial practice](https://arxiv.org/abs/2110.06750) — Sas et al., 2021, 21 interviewees:
  - Cycles were linked to deadlocks and an "intertwined mess"; one blocked extracting a microservice.
  - Developers "code around" **Hub-Like** dependencies rather than refactor them. *Corrected: the researcher said "smells" in general.*
  - A missing regression suite was cited as a reason not to refactor.
  - Some teams avoid refactoring because "their clients do not pay for refactoring time".
  - SonarQube was mentioned "only once in regard to an AS (i.e. to detect cycles)".
- [HN 33940863](https://news.ycombinator.com/item?id=33940863) — barbarbar, 2022: with controller/service/repository layers, "When adding small features you end up jumping all over the place in all 'layers'". This is anecdotal support for package-by-feature.

## Contradictions and open questions

**Contradictions**
- **Harmful versus harmless cycles.**
  - Oyetoyan et al. 2015 (full text): package-tree location does not separate critical from harmless cycles.
  - Laval et al. 2012 and Al-Mutawa et al. 2014: package-local cycles (ui ↔ ui.internal) are common and often intended.
  - Mo et al. 2015: cycles that *cross* module boundaries are among the most error-prone patterns.
  - Resolution: use location and cross-module status for priority only, never to declare a cycle safe.
- **Structure versus structure+history.**
  - Mo et al. 2015's abstract says structure-history hotspot patterns contribute more.
  - Its own tables rank the structure-only Cross-Module Cycle among the top two, and the history-based Implicit Cross-module Dependency near the bottom.
  - Use both signals. Do not treat history as mandatory for prioritising cycles.
- **God Classes versus God Components.** These are different granularities.
  - Olbrich 2010, class level, three Java systems: size-normalised God Classes changed less and had fewer defects, assuming equal functionality per LOC.
  - Sas 2021: practitioners rank God *Components* among the most important smells.
- **Singletons.**
  - C++ Core Guidelines I.3 says avoid (static) singletons.
  - Microsoft's .NET guidance recommends DI-registered singleton *services* to avoid global state.
  - They are not in conflict once the two meanings are separated. The skill must not "fix" a container-managed singleton.
- **Network metrics.** Zimmermann & Nagappan 2008 found +10 points of recall at Microsoft. Premraj & Herzig 2011 agreed under random sampling, but found no advantage in forward-release and cross-project settings.
- **Payoff of architectural refactoring.**
  - Xiao/Kazman/Cai: debt concentration, plus a *predicted* ROI.
  - Anquetil & Laval: an Eclipse restructuring did not reduce cycles.
  - Microsoft engineers perceive substantial cost and risk.
  - Windows 7's refactored modules lost inter-module dependencies but grew in size.
- **Tests as a safety net.** SmellBench agents passed the full scikit-learn suite while one added 140 smells. Segment and Sas et al. treat a solid regression suite as a precondition. Tests are necessary, not sufficient.
- **Configuration.** Twelve-Factor says env vars; HN practitioners prefer typed files; the manifesto is under (slow) revision.
- **Hexagonal architecture.**
  - Cockburn frames it as isolation for testing.
  - HN practitioners report ossifying indirection and rewrites anyway.
  - The only LLM data is a 15-run pilot in which frontier models largely complied.
- **Language-enforced acyclicity.** The Go spec forbids cycles, and the Eclipse plugins are suggestive but confounded. DoltHub argues the ban "costs far more than it's worth".
- **Martin's metrics.**
  - Tools encode the Stable Dependencies Principle; Martin calls his own standard "arbitrary"; practitioners rate Unstable Dependency "detrimental but not critical".
  - SmellBench found Unstable Dependency predominantly genuine: 12 of 14 true or partially valid. *Corrected: this is not the "most genuine" type. Improper API Usage had 0/4 false positives on a smaller sample.*
- **Deferred imports.** The Python FAQ endorses moving an import into a function to resolve a cycle, while the researcher's rule called it "hiding". Pylint still flags such cycles. Treat a deferred import as a documented mitigation that keeps the cycle on the books.

**Open questions**
- **Oyetoyan, Cruzes & Conradi (2013, JSS):** closed access with an elided abstract. Its defect-level result is unverified.
- **Melton & Tempero (2007, EMSE):** known only via Laval et al.'s secondary description.
- **Package-by-feature versus package-by-layer:** no empirical comparison on defects or change effort was found.
- **Thresholds:** there is no empirically grounded threshold for largest-SCC size, fan-out or co-change percentage. The numbers here are tool defaults: 10 for max-dependencies, 20 for CBO, 30%/5 for Code Maat, and PMD's Lanza-Marinescu values.
- **Language coverage:** the evidence is mostly Java and C/C++. Python evidence is limited to Li et al. 2022 (OpenStack code reviews) and SmellBench (scikit-learn). TS/JS and Rust have essentially none.
- **Fresh repositories:** history-based prioritisation fails on freshly generated repos. What replaces it for an AI-built "finished" project?
- **AI-specific evidence is thin:**
  - SmellBench is an unreviewed preprint on one project.
  - Slater is a 15-run pilot.
  - Larsen & Moghaddam is accepted at SEAA 2026 but covers Java only.
- **Commercial tooling:** DV8 and Arcan are commercial, and no open-source equivalent with validated thresholds was found.
- **Frozen baselines:** can auto-inferred rules (`tach sync`, `depcruise --baseline`) freeze an unintended architecture? No study was found.
- **Config centralisation:** the "single validated config entry point" sub-rule in F13 has no external source in this dossier.

## Dropped findings
None. All 19 findings survived. The following evidence items were corrected, re-scoped or moved rather than dropped:
- **HN 41366572 in F07:** wrong author, and it argues the opposite of how it was used. Moved to counterpoints.
- **The Slater pilot:** re-scoped in F05 and F14 as 4/5 runs of Llama 3 8B.
- **The Kazman ROI:** re-scoped as predicted.
- **The DoltHub "new cycles" remark:** re-scoped as a general statement.
- **The "Implicit Cross-module Dependency is among the strongest predictors" claim (F18):** reversed per Mo 2015's full text.
- **The Node docs and Python FAQ as "avoid cycles" sources:** re-scoped as hazard descriptions.
