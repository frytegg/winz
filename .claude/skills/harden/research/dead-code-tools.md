# Dead code and unused-dependency detection tooling per language
> Code T07 · slug dead-code-tools · verified 2026-09-23 · counts: verified 13 / corrected 9 / downgraded 1 / dropped 0

Verification method: every cited URL was re-opened with WebFetch on 2026-09-23 (PDFs were downloaded and text-extracted with pdftotext; peer-reviewed papers were checked against their abstracts via the Semantic Scholar API or arXiv). The WebSearch quota for this session was exhausted, so nothing below rests on a search-engine snippet: each claim is backed by a page that was actually opened. "Abstract only" means the full paper was not read.

## Summary

Tool versions confirmed online on 2026-09-23:
- Knip 6.38.0 (released 2026-09-23; 6.37.0 on 09-18, 6.36.0 on 09-16)
- ESLint docs v10.11.0
- Tailwind CSS docs v4.3
- vulture 2.16 (2026-03-25, per PyPI)
- deadcode (Python) v2.4.1
- Cppcheck manual 2.21.0
- IWYU 0.26 (pairs with Clang 22)
- Go `deadcode` in golang.org/x/tools v0.50.0 (2026-09-08)
- gopls `unusedfunc` in the **gopls module v0.23.0** (2026-07-07; the researcher wrote "x/tools v0.23.0", which is wrong)
- maven-dependency-plugin 3.11.0
- DepClean 2.2.0
- Staticcheck: the semantics from release 2020.2 still apply

Main conclusions (corrected where needed):

1. **Every detector only produces candidates.** The official docs of Knip, vulture, Go deadcode and IWYU all say findings must be reviewed before anything is deleted. Google (Sensenmann) and Meta (SCARF) delete automatically, but only after adding runtime usage data to the static graph and, at Meta, a text search (BigGrep). Even then, Sensenmann's changes need owner approval.
2. **Work top-down and repeat.** Remove unreachable files and modules first, then unused exports and symbols, then unused dependencies. Re-run the tools until the report stops shrinking, because findings come in chains (Knip's guide says so explicitly) and dead code can form cycles (Meta and Google both handle this in their deletion graphs).
3. **The main sources of false positives are the same in every language:**
   - entry points the tool does not know about (framework conventions, plugins, config files)
   - dynamic, reflective or string-based use
   - build configurations that were not analysed (GOOS/GOARCH, `#ifdef`, Cargo features, build tags)
   - the public API of a library
   - imports kept for their side effect or as re-exports
   - storage layout in upgradeable contracts
   - CSS class names built at runtime
   - Rust struct fields kept only for their drop behaviour or auto-trait effect (rustc documents this)
4. **Tool status has changed:**
   - Archived, and pointing users to Knip: depcheck (archived 2025-06-16), unimported (2024-03-10) and tsr (2025-10-23).
   - ts-prune is maintained again (its README says it was "resurrected after a long hiatus"), although Knip's comparison page still lists it as archived. It still only covers unused exports.
   - GCC's `-Wunreachable-code` was discontinued in GCC 4.5 (2010), according to Mozilla bug 1235717. The current GCC Warning Options page does not document the flag. Use Clang's version instead.
   - Since Staticcheck 2020.2, U1000 treats every exported identifier as used.
5. **Evidence that deleting dead code pays off.**
   - Peer-reviewed studies: Romano et al. (TSE 2020), Caivano et al. (ESEM 2021) and Romano et al. (EASE 2024) found that dead code harms maintenance, that it is rarely revived, and that removing it lowers compile time and executable size. Malavolta et al. (TSE 2023) found that eliminating JS dead code (mostly unused third-party library code, removed by their Lacuna tool) improves mobile web load time. These results come mostly from one research group and mostly from Java desktop apps. They were checked from abstracts only.
   - Dependency bloat: 75.1% of dependency relationships in Maven Central artifacts are bloated (Soto-Valero et al., EMSE 2021).
   - Industrial scale: Meta's SCARF deleted more than 100M lines over five years (blog). The ESEC/FSE 2023 paper gives 104M. Google's Sensenmann has deleted nearly 5% of Google's C++.
6. **Tests alone are a weak safety net.** In 521 Java projects, tests covered only 58% of direct and 20% of transitive dependency calls (Hejderup & Gousios, published in the Journal of Systems and Software, not only a preprint). A safe deletion needs builds of every configuration, a text search for the name, and small commits that can each be reverted.
7. **The costliest documented failure is code that was NOT removed.** Knight Capital lost more than $460M in about 45 minutes (SEC order, 2013). "Power Peg" code, unused since 2003, was still on the servers, and a repurposed flag switched it back on on the one server out of eight that missed the deploy.

**Commands and false-positive handling, by language**

**TS/JS**
- Commands:
  - `npx knip`
  - `npx knip --production --strict`
  - `knip --fix --fix-type exports,types` (add `--allow-remove-files` to delete files)
  - `tsc --noEmit` with `noUnusedLocals`, `noUnusedParameters`, `allowUnreachableCode: false` and `allowUnusedLabels: false`
  - ESLint `@typescript-eslint/no-unused-vars` (with the base rule turned off), plus `no-unreachable`
- False positives: set `entry`/`project` patterns and plugins first. Use `ignoreDependencies`, `ignoreExportsUsedInFile` and `ignoreUnresolved` only as a last resort. Use `@public`/`@internal` tags sparingly.

**Python**
- Commands:
  - `ruff check --select F401,F841,ERA001`
  - `vulture src --min-confidence 90 --sort-by-size`
  - `vulture src --make-whitelist > whitelist.py`
  - `deadcode . --fix --dry`
  - `deptry .`, run inside the project venv (it needs the installed packages' metadata)
- False positives:
  - vulture: `--ignore-decorators`, `--ignore-names`, and a whitelist file (the method vulture recommends)
  - deadcode: `# noqa: DCxx`
  - deptry: `per_rule_ignores` and `package_module_name_map`
  - Ruff: `lint.pyflakes.allowed-unused-imports`
  - re-exports: `import x as x` or `__all__`

**Rust**
- Commands:
  - add `#![warn(unreachable_pub)]`, then act on the `dead_code` / `unused_*` warnings
  - `cargo shear` (`--fix`; `--expand` on nightly)
  - `cargo machete --with-metadata`
  - `cargo +nightly udeps`
- False positives: add the crate to the ignore list under `[package.metadata.cargo-shear]`, `[package.metadata.cargo-machete]` or `[package.metadata.cargo-udeps.ignore]`. Prefix a name with `_` to mark it as intentionally unused.

**Go**
- Commands:
  - `deadcode [-test] ./...`, and `-whylive=pkg.Func` to see why something is still reachable
  - `staticcheck -matrix` for U1000
  - gopls `unusedfunc`
  - `go mod tidy -diff`
- False positives: `go:linkname`, assembly, and build configurations that were not analysed.

**C/C++**
- Commands:
  - `-Wall -Wextra` (`-Wextra` is needed for `-Wunused-parameter`)
  - Clang's `-Wunreachable-code`
  - `cppcheck --enable=unusedFunction` with `--cppcheck-build-dir` (or single-threaded)
  - `-Wl,--gc-sections -Wl,--print-gc-sections`
  - clang-tidy `misc-unused-parameters` and `misc-include-cleaner`
  - IWYU, with its output reviewed by hand
- False positives: keep deliberate includes with `// IWYU pragma: keep`. Watch for platform `#ifdef`s, and for virtual functions and callbacks whose signatures are fixed.

**Solidity**
- Commands: `slither . --detect dead-code,unused-state` and `slither-check-upgradeability`.
- Never remove, reorder or retype state variables in upgradeable contracts.

**CSS**
- PurgeCSS and Tailwind read source files as plain text. Keep class names complete in the source, and protect dynamic ones with a safelist or Tailwind's `@source inline()`.

**Java**
- Commands: `mvn dependency:analyze -DfailOnWarning=true` and DepClean (`mvn se.kth.castor:depclean-maven-plugin:2.2.0:depclean`).
- Both analyse bytecode, so check anything loaded by reflection or at runtime before removing it.

## Findings

### T07-F16 — Remove unused dependencies as a first-class hardening step
Use the tool for each ecosystem:
- JS: Knip
- Python: deptry
- Rust: cargo-shear / cargo-machete / cargo-udeps
- Go: `go mod tidy`
- Java: `mvn dependency:analyze` or DepClean

Also fix the reverse problems: dependencies that are imported but not declared (they arrive only transitively), and dev dependencies used in production code.

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Dependency bloat is common and measurable, and developers accept the fixes. 75.1% of Maven dependency relationships were bloated, and 18 of the 21 answered removal pull requests were merged. PyTrim found bloat in 39 of 971 Python packages. Each unused dependency adds install time, compile time and supply-chain surface. cargo-machete's author measured a 5% compile-time speedup on one project, which is a single anecdote.
- **Evidence:**
  - [A Comprehensive Study of Bloated Dependencies in the Maven Ecosystem](https://arxiv.org/abs/2001.07808) — Soto-Valero, Harrand, Monperrus, Baudry, Empirical Software Engineering, 2021 — peer_reviewed — "Our key result is that 75.1% of the analyzed dependency relationships are bloated" (9,639 artifacts, 723,444 relationships); "18/21 answered pull requests were accepted and merged by developers, removing 131 dependencies in total." — abstract confirmed word for word on arXiv. The figure counts every relationship in the resolved tree, so it includes transitive ones. The abstract does not break it down by type.
  - [PyTrim: A Practical Tool for Reducing Python Dependency Bloat](https://arxiv.org/abs/2510.00674) — Karakatsanis, Alexopoulos, Karyotakis, Proestakis, Talos, Louridas, Mitropoulos, ASE 2025 — peer_reviewed — "Dependency bloat is a persistent challenge in Python projects, which increases maintenance costs and security risks"; bloat found in 39 of 971 packages; 6 PRs merged; 98.3% accuracy on 37 earlier human fixes — abstract confirmed.
  - [deptry rules](https://deptry.com/rules-violations/) — deptry, 2026 — official_docs — DEP001 missing, DEP002 unused, DEP003 transitive ("imported within a project, where the corresponding dependencies are in the dependency tree, but not as direct dependencies"), DEP004 misplaced dev, DEP005 stdlib — confirmed.
  - [dependency:analyze](https://maven.apache.org/plugins/maven-dependency-plugin/analyze-mojo.html) — Apache Maven, plugin 3.11.0 — official_docs — "determines which are: used and declared; used and undeclared; unused and declared"; `failOnWarning` defaults to `false`; filter with `ignoredUnusedDeclaredDependencies` — confirmed.
  - [cargo-machete, find unused dependencies quickly](https://bouvier.cc/tech/cargo-machete/) — Benjamin Bouvier, 2022-04-27 — engineering_blog — "a 5% compile time speedup overall" — confirmed. Single project.
- **Detect:**
  - JS: `knip --dependencies`
  - Python: `deptry .` (inside the venv)
  - Rust: `cargo shear`, and `cargo machete --with-metadata`
  - Go: `go mod tidy -diff` (prints the changes as a diff and exits non-zero if any exist)
  - Java: `mvn dependency:analyze -DfailOnWarning=true`, or `mvn se.kth.castor:depclean-maven-plugin:2.2.0:depclean` (DepClean needs `mvn test-compile` first)
  - Treat "used but undeclared" findings (deptry DEP003, Maven's "used undeclared") as bugs too, and declare those dependencies explicitly.
- **Tools:** knip, deptry, cargo-shear, cargo-machete, cargo-udeps, go mod tidy, maven-dependency-plugin, DepClean
- **Applies to:** All package-managed ecosystems.
- **When not to apply / counterpoints:** Some dependencies look unused but are not:
  - dependencies used only through reflection (DepClean says it "ignores some dependencies used only via reflection (e.g., frameworks like Spring or Hibernate)")
  - plugins and CLIs
  - type-only packages and peer requirements

  Record each of these in the tool's ignore list with a comment saying why. Removing a direct dependency that is also pulled in transitively does not remove it from the install tree.
- **Fix risk:** medium

### T07-F02 — JS/TS: use Knip as the single tool; do not adopt archived tools; describe the project to Knip instead of suppressing findings
Use Knip (v6.x; 6.38.0 released 2026-09-23) for unused files, exports, dependencies and unresolved imports. Do not adopt depcheck (archived 2025-06-16), unimported (archived 2024-03-10) or tsr (archived 2025-10-23). Fix false positives by describing the project to Knip (entry patterns, plugins, workspaces) rather than suppressing them. ts-prune is maintained again, but it only covers exports.

- **Grade:** A · **Verdict:** CORRECTED
  - Added tsr's archive date (2025-10-23) and the notice "please use similar tools such as Knip".
  - Knip issues #1930 and #2024 are **closed** (fixed), not open as the researcher said. They remain useful as examples of regressions.
  - ts-prune has been revived, so Knip's comparison page is out of date on that point.
- **Rationale:** The maintainers of depcheck, unimported and tsr all point users to Knip. Knip ships framework plugins and understands workspaces. Its own guide says to "address root causes" and to use `ignore*` options "only as last resorts". Older tools produced false positives across whole modern TS projects (depcheck #673, labelled wontfix).
- **Evidence:**
  - [depcheck README (archived)](https://github.com/depcheck/depcheck) — depcheck maintainers, 2025 — official_docs — "Depcheck is no longer actively maintained" … "We strongly recommend switching to knip"; archived June 16, 2025 — confirmed.
  - [unimported README (archived)](https://github.com/smeijer/unimported) — Stephan Meijer, 2024 — official_docs — "This project is no longer maintained. There's a project called knip which has more features, and is actively maintained"; archived March 10, 2024 — confirmed.
  - [tsr README (archived)](https://github.com/line/tsr) — LINE, 2025 — official_docs — "This project has ended. If you need similar functionality, please use similar tools such as Knip."; archived Oct 23, 2025 — added by the verifier (substitutes for the researcher's unsourced tsr claim).
  - [Comparison & Migration](https://knip.dev/explanations/comparison-and-migration) — Knip, 2026 — official_docs — depcheck, unimported, ts-prune and tsr are each listed as "The project is archived and recommends Knip." — confirmed, but the page is outdated for ts-prune (see below).
  - [ts-prune README](https://github.com/nadeesha/ts-prune) — nadeesha/ts-prune, 2026 — official_docs — "This project has been resurrected after a long hiatus … It needs to keep working."; requires Node >= 22.18 and TypeScript 6.0.3 — confirmed. The repository is not archived.
  - [Handling Issues](https://knip.dev/guides/handling-issues) — Knip, 2026 — official_docs — the causes of false positives are template-string dynamic imports, scripts with unsupported arguments, a missing plugin, and unrecognised path aliases; `ignoreDependencies`, `ignoreExportsUsedInFile` and `ignoreUnresolved` are "last resorts" — confirmed.
  - [Knip releases](https://github.com/webpro-nl/knip/releases) — webpro-nl/knip, 2026 — official_docs — 6.38.0 (Sept 23), 6.37.0 (Sept 18), 6.36.0 (Sept 16) — confirmed.
  - [False alerts on unused dependencies #673](https://github.com/depcheck/depcheck/issues/673) — depcheck issue tracker, 2021 — practitioner_forum — "lists pretty much all dependencies and devDependencies as unused"; labelled wontfix; mentions metro.config.js, .eslintrc.js, storybook and e2e/environment.js — confirmed.
- **Detect:** Run `npx knip` for all issue types. Narrow the run with `knip --files`, `--dependencies` or `--exports`. Fix false positives in this order: `entry`/`project` patterns, `paths` for aliases, then contributing or enabling a plugin. Use `ignoreDependencies`, `ignoreExportsUsedInFile` and `ignoreUnresolved` only as a last resort.
- **Tools:** knip; ts-prune (exports only)
- **Applies to:** JS/TS apps and monorepos (npm/pnpm/yarn workspaces).
- **When not to apply / counterpoints:** Knip ships frequent releases and has regressions. Examples, all now closed:
  - #2024: Yarn PnP npm aliases were reported as unused starting with 6.27.0.
  - #1930: compiler registration was not workspace-aware, which caused false positives in monorepos.
  - #1951–#1953: local vitest reporter paths were flagged as unlisted dependencies.

  Pin the Knip version and read the report before acting on it. Knip's own docs warn that tags and exclusions "hide issues".
- **Fix risk:** medium

### T07-F04 — Run a separate production-only reachability pass
Exclude tests, stories, mocks and dev tooling. Code reachable only from tests is dead production code: delete it together with the tests that exist only for it. Keep the default pass (tests included) as well.

- **Grade:** A · **Verdict:** VERIFIED (strengthened: Knip's production-mode page states the rationale directly)
- **Rationale:** Tests make dead production code look alive. Knip's production mode and Go deadcode's `-test` switch exist to separate these two views. Google's Sensenmann makes a test "share the fate" of the library it tests, so both are deleted together.
- **Evidence:**
  - [Production Mode](https://knip.dev/features/production-mode) — Knip, 2026 — official_docs — "Test files usually import production files. This prevents production files or their exports from being reported as unused, while sometimes both of them can be deleted." "The production run does not replace the default run." Production entries are marked with a `!` suffix, and `--strict` implies `--production` — confirmed.
  - [deadcode command](https://pkg.go.dev/golang.org/x/tools/cmd/deadcode) — Go team, x/tools v0.50.0 (2026-09-08) — official_docs — "The -test flag causes it to analyze test executables too. Tests sometimes make use of functions that would otherwise appear to be dead code, and public API functions reported as dead with -test indicate possible gaps in your test coverage." — confirmed. Comparing the output with and without `-test` is the researcher's own technique; the doc does not prescribe it.
  - [Sensenmann: Code Deletion at Scale](https://testing.googleblog.com/2023/04/sensenmann-code-deletion-at-scale.html) — Phil Norman, Google Testing Blog, 2023-04-28 — engineering_blog — "What we really want is for each test to share the fate of the library it is testing. We can do this by making the library and its test interdependent, thus creating loops in the graph" — confirmed through the blog's Atom feed (the HTML page does not render the post body).
- **Detect:**
  - JS/TS: compare the output of `knip` with `knip --production --strict`.
  - Go: compare `deadcode ./...` with `deadcode -test ./...`. Anything reported dead without `-test` but live with it is used only by tests.
  - Python (manual equivalent): compare `vulture src/` with `vulture src/ tests/`.
- **Tools:** knip, golang.org/x/tools/cmd/deadcode, vulture
- **Applies to:** Applications. In a library, public API that only tests exercise is still live (see T07-F12).
- **When not to apply / counterpoints:** Test helpers and mocks are legitimately test-only. Knip says to exclude them "use negated patterns to exclude those files in production mode" rather than delete them. Go's docs note that public API reported dead with `-test` may mean the tests have gaps, not that the code is dead.
- **Fix risk:** medium

### T07-F12 — Decide whether the project is a library or an application before hunting unused exports
In a library, exported or public items with no caller in the repo are API, not dead code. Remove them only in a semver-major change. In an application, nothing outside consumes the entry exports, so check those too.

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** The tools build this distinction in:
  - Knip skips entry-file exports by default and offers `--include-entry-exports` and the `@public` tag.
  - Staticcheck treats every exported identifier as used.
  - rustc's `dead_code` lint only covers unexported items.
  - Go deadcode needs a `main`.
  - ts-prune warns that uses outside the project are invisible to it.
- **Evidence:**
  - [Handling Issues](https://knip.dev/guides/handling-issues) — Knip, 2026 — official_docs — by default Knip excludes entry-file exports; `--include-entry-exports` flag — confirmed.
  - [JSDoc & TSDoc tags](https://knip.dev/reference/jsdoc-tsdoc-tags) — Knip, 2026 — official_docs — "Tag the export as @public and Knip will not report it"; "adding tags or excluding a certain type of issues from the report is usually not recommended. It hides issues, which is often a sign of code smell." — confirmed.
  - [ts-prune README](https://github.com/nadeesha/ts-prune) — nadeesha/ts-prune, 2026 — official_docs — "Uses outside the configured project are not visible. Mark public entrypoints or ignore exports consumed elsewhere."; "Frameworks and build tools may consume exports through conventions or reflection that ts-prune cannot detect." — confirmed.
  - [Staticcheck 2020.2 release notes](https://staticcheck.dev/changes/2020.2/) — Dominik Honnef, 2020 — official_docs — "all exported package-level identifiers will be considered used from now on, even if these identifiers are declared in package main or tests, even if they are otherwise unused." — confirmed.
- **Detect:** Check how the project is published:
  - package.json: `exports`, `main`, `bin`, and the `private` flag
  - Cargo: `[lib]` vs `[[bin]]`
  - Go: `package main`
  - Python: `[project.scripts]` vs a published package

  For apps, run `knip --include-entry-exports`. For libraries, keep Knip's default and tag deliberate API with `@public`.
- **Tools:** knip, staticcheck, rustc, ts-prune
- **Applies to:** All languages; critical for published packages and SDKs.
- **When not to apply / counterpoints:** Internal "libraries" inside a monorepo whose only consumers are in the same repo can be analysed as a whole program (Knip workspaces), so their unused exports are real dead code.
- **Fix risk:** high

### T07-F09 — Only declare code dead if it is dead in every shipped build configuration
That means each OS/arch, build tag, `#ifdef` branch, Cargo feature set and deployment target. Run the detector once per configuration and delete only what every run agrees is dead.

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Several official docs and trackers describe the same false positive: code used only on another platform, or behind another tag or feature, is reported as dead.
- **Evidence:**
  - [deadcode command documentation](https://pkg.go.dev/golang.org/x/tools/cmd/deadcode) — Go team, 2026 — official_docs — "valid only for a single GOOS/GOARCH/-tags configuration, so a function reported as dead may be live in a different configuration" — confirmed.
  - [Build tags (Running Staticcheck)](https://staticcheck.dev/docs/running-staticcheck/cli/build-tags/) — Staticcheck, 2026 — official_docs — "If we don't check the Windows build, then the function bar seems unused"; `-matrix` "automates running Staticcheck multiple times and merging results afterwards"; `-merge` combines separate runs — confirmed.
  - [false positive for U1000 when variable is used only in a test and on a different platform #983](https://github.com/dominikh/go-tools/issues/983) — dominikh/go-tools issue tracker, 2021 — practitioner_forum — a variable used in `x_linux.go` is reported "var v is unused (U1000)" when staticcheck runs on darwin/arm64 — confirmed.
  - [Bug 1235717 - Enable clang's -Wunreachable-code warnings](https://bugzilla.mozilla.org/show_bug.cgi?id=1235717) — Mozilla, ~2016 (fixed in Firefox 46) — practitioner_forum — platform `#ifdef` blocks legitimately make code unreachable on some platforms; "hundreds of -Wunreachable-code-break warnings in the IDL bindings' generated code" — confirmed.
  - [cargo-udeps README](https://github.com/est31/cargo-udeps) — est31, 2026 — official_docs — known limitation: it "doesn't account for build scripts or feature flag usage" — confirmed (paraphrased by the fetch).
- **Detect:**
  - Go: `staticcheck -matrix` with one line per GOOS/tag, plus `GOOS=<os> deadcode ./...` for each target.
  - Rust: run the analysis for each feature combination. cargo-machete's `--with-metadata` resolves with `--all-features`.
  - C/C++: compile every platform configuration with warnings on.
  - Manual: grep for `//go:build`, `#ifdef` and `#[cfg(` around every candidate.
- **Tools:** staticcheck -matrix/-merge, deadcode, cargo-machete --with-metadata, compiler builds per target
- **Applies to:** Go, Rust, C/C++, and any language with conditional compilation or per-environment entry points.
- **When not to apply / counterpoints:** Running every configuration is expensive. For a single-target app, one configuration may be all that ships; confirm that before skipping the extra runs.
- **Fix risk:** high

### T07-F03 — Make the TS compiler and ESLint fail the build on local dead code
- In tsconfig, set `noUnusedLocals: true`, `noUnusedParameters: true`, `allowUnreachableCode: false` and `allowUnusedLabels: false`.
- In ESLint, use `@typescript-eslint/no-unused-vars` with the base `no-unused-vars` turned off, plus `no-unreachable` (optional once TS has `allowUnreachableCode: false`).
- Set `reportUsedIgnorePattern: true` so that `_`-prefixed names that are actually used get flagged.

- **Grade:** A · **Verdict:** CORRECTED. The researcher said "the defaults (`undefined`) only show editor suggestions" for all four options. That is true only for `allowUnreachableCode` and `allowUnusedLabels`. `noUnusedLocals` and `noUnusedParameters` are simply off unless set. The ESLint note that `no-unreachable` can be turned off is unconditional, but it only holds when TS is set to `allowUnreachableCode: false`.
- **Rationale:** These checks cost nothing and are exact within a file. With the TS defaults, unreachable code and unused labels produce only editor suggestions, so they pass CI. typescript-eslint says its rule is "more configurable than TypeScript's compiler options" (ignore patterns; settings per line, file or folder).
- **Evidence:**
  - [TSConfig Reference](https://www.typescriptlang.org/tsconfig/#allowUnreachableCode) — Microsoft TypeScript, 2026 — official_docs — `allowUnreachableCode`: "undefined (default) provide suggestions as warnings to editors … false raises compiler errors about unreachable code"; "only about code which is provably unreachable due to the use of JavaScript syntax"; "does not affect errors on the basis of code which appears to be unreachable due to type analysis"; `noUnusedParameters`: "Parameters declaration with names starting with an underscore (_) are exempt" — confirmed.
  - [no-unused-vars](https://typescript-eslint.io/rules/no-unused-vars/) — typescript-eslint, 2026 — official_docs — "you must disable the base rule as it can report incorrect errors"; "These lint rules are more configurable than TypeScript's compiler options" — confirmed.
  - [no-unused-vars](https://eslint.org/docs/latest/rules/no-unused-vars) — ESLint v10.11.0, 2026 — official_docs — defaults are `vars: "all"`, `args: "after-used"`, `caughtErrors: "all"`, `reportUsedIgnorePattern: false`; reportUsedIgnorePattern "will report variables that match any of the valid ignore pattern options … if they have been used" — confirmed.
  - [no-unreachable](https://eslint.org/docs/latest/rules/no-unreachable) — ESLint, 2026 — official_docs — "It is safe to disable this rule when using TypeScript because TypeScript's compiler enforces this check." — confirmed.
- **Detect:**
  - `tsc --noEmit -p tsconfig.json` reports TS6133 (declared but never read), TS7027 (unreachable code) and TS7028 (unused label).
  - `eslint .` with `@typescript-eslint/no-unused-vars: [error, {argsIgnorePattern: '^_', varsIgnorePattern: '^_', reportUsedIgnorePattern: true}]`.
  - Neither tool finds unused exports; use Knip for those (T07-F02). The error codes are standard tsc codes and were not re-verified on a docs page.
- **Tools:** tsc, eslint, typescript-eslint
- **Applies to:** TypeScript/JavaScript.
- **When not to apply / counterpoints:**
  - The TS check only covers unreachability visible in the syntax.
  - Unused parameters are often required by a callback or interface signature. Rename them with a `_` prefix instead of removing them.
  - ESLint's `caughtErrors: "all"` default flags unused `catch (e)` bindings.
- **Fix risk:** low

### T07-F05 — Python toolchain
- Ruff for local and import-level dead code (F401, F841, ERA001).
- vulture or deadcode for unused definitions across the project, filtered by confidence.
- deptry for unused, missing and misplaced dependencies.

Triage vulture findings by confidence tier, and record accepted false positives in a whitelist file rather than as scattered inline ignores.

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Python's dynamic features make whole-project detection inherently unreliable, and vulture's own docs say so. The confidence tiers let the reviewer act first on near-certain items (unreachable code at 100%, unused imports at 90%) and treat the 60% tier (functions, classes, attributes) as leads only.
- **Evidence:**
  - [vulture README](https://github.com/jendrikseipp/vulture) — Jendrik Seipp, 2026 — official_docs — "Due to Python's dynamic nature, static code analyzers like Vulture are likely to miss some dead code. Also, code that is only called implicitly may be reported as unused." Confidence: unreachable code and function/method/class arguments 100%, imports 90%, attributes/classes/functions/methods/properties/variables 60% — confirmed from the raw README.
  - [vulture on PyPI](https://pypi.org/project/vulture/) — Jendrik Seipp, 2026 — official_docs — 2.16 released 2026-03-25; "The recommended option is to add used code that is reported as unused to a Python module and add it to the list of scanned paths." — confirmed.
  - [F401 unused-import](https://docs.astral.sh/ruff/rules/unused-import/) — Astral (Ruff), 2026 — official_docs — "Fixes to remove unused imports are safe, except in `__init__.py` files." — confirmed.
  - [F841 unused-variable](https://docs.astral.sh/ruff/rules/unused-variable/) — Astral (Ruff), 2026 — official_docs — "This rule's fix is marked as unsafe because removing an unused variable assignment may delete comments that are attached to the assignment." Uses `lint.dummy-variable-rgx` — confirmed.
  - [deptry rules](https://deptry.com/rules-violations/) and [usage](https://deptry.com/usage/) — deptry, 2026 — official_docs — DEP002: "Development dependencies are not considered for this rule"; must run in the project's venv "since it needs access to the metadata of the installed packages"; `per_rule_ignores` and `package_module_name_map` exist — confirmed.
  - [deadcode (Python)](https://github.com/albertas/deadcode) — albertas, 2026 — official_docs — "ruff and flake8 - don't have rules for unused global code detection, only for local ones"; `--dry` shows the changes that would be made without writing them; codes DC01–DC13 (DC12 commented-out code, DC13 unreachable code); `# noqa: DCxx`; v2.4.1 — confirmed. The quote "suggested fixes for all files" could not be matched word for word, so it is paraphrased.
  - [Ask HN: Why dead code detection in Python is harder than most tools admit](https://news.ycombinator.com/item?id=46866141) — duriantaco (author of the skylos tool), ~Feb 2026 — practitioner_forum — lists "dynamic dispatch (getattr, registries, plugin systems)", "framework entrypoints (Flask/FastAPI routes, Django views, pytest fixtures)", and "be aggressive and flag false positives that people stop trusting" — confirmed word for word in the original post. The author builds a competing tool.
- **Detect:**
  1. `ruff check --select F401,F841,ERA001 .`
  2. `vulture src/ --min-confidence 90 --sort-by-size`, then `vulture src/` (the 60% tier) as leads only.
  3. `vulture src/ --make-whitelist > whitelist.py`, then run `vulture src/ whitelist.py`. For frameworks use `--ignore-decorators "@app.route"` and `--ignore-names`.
  4. `deadcode . --fix --dry` (preview only).
  5. `deptry .` inside the venv. Use `package_module_name_map` where package and module names differ, and `[tool.deptry.per_rule_ignores]` for plugins that are never imported.
- **Tools:** ruff, vulture, deadcode, deptry; pylint's unused-* family (not researched)
- **Applies to:** Python 3 projects.
- **When not to apply / counterpoints:**
  - vulture's 100% tier includes unused function **arguments**, which are often required by framework callbacks or overridden method signatures. Rename them with `_` instead of removing them.
  - A module-level `__getattr__` or `importlib.import_module` makes modules reachable in ways no AST tool sees (swynx on HN, a vendor).
  - deptry must run inside the project environment.
- **Fix risk:** medium

### T07-F06 — Never auto-remove an import, file or package entry that exists for its side effect or as a public re-export
- In a Python `__init__.py`, make the intent explicit (`from m import x as x`, or list the name in `__all__`) instead of deleting the import.
- In JS, keep bare imports such as `import './polyfill'` and `import './x.css'`.
- Never declare `"sideEffects": false` without listing the CSS and polyfill files.

- **Grade:** A · **Verdict:** VERIFIED. The verifier added Ruff's `lint.pyflakes.allowed-unused-imports` option.
- **Rationale:** These imports look unused, but removing them silently changes runtime behaviour: a registration no longer runs, a stylesheet disappears in production, or a module's public interface shrinks.
- **Evidence:**
  - [F401 unused-import](https://docs.astral.sh/ruff/rules/unused-import/) — Astral (Ruff), 2026 — official_docs — for third-party and stdlib imports in `__init__.py`, "the suggested removal is unsafe because it alters the module's public interface"; mark re-exports with a redundant alias (`from module import member as member`) or `__all__`; the options `lint.ignore-init-module-imports` and `lint.pyflakes.allowed-unused-imports` exist — confirmed.
  - [Tree Shaking guide](https://webpack.js.org/guides/tree-shaking/) — webpack, 2026 — official_docs — "A CSS file imported for its side effect alone needs to be added to the side effect list so it will not be unintentionally dropped in production mode" — confirmed.
  - [ts-prune README](https://github.com/nadeesha/ts-prune) — nadeesha/ts-prune, 2026 — official_docs — "Namespace uses that cannot be tracked, side-effect imports, and wildcard re-exports can keep unused exports out of the report." — confirmed.
- **Detect:**
  - Python: review every F401 hit in `__init__.py` by hand, and every bare `import pkg.module` of a first-party module (it may register something on import).
  - JS: find bare imports with `grep -rnE "^import ['\"]" src`, and check package.json for `"sideEffects"`.
  - After changes, build in production mode and compare the emitted CSS/JS asset list with the previous build.
- **Tools:** ruff, webpack/rollup/esbuild build output, grep/ast-grep
- **Applies to:** Python packages and JS/TS bundles. Go blank imports (`import _ "pkg"`, used for driver registration) are the same pattern, but this was not verified in this task.
- **When not to apply / counterpoints:** Imports that are truly unused and have no side effect are safe to remove. Ruff classifies the non-`__init__` F401 fix as safe (see T07-F21 for a caveat).
- **Fix risk:** high

### T07-F07 — Rust: `dead_code` only fires on unexported items
- In binaries and internal crates, first turn on `unreachable_pub` and demote accidental `pub` to `pub(crate)`. Then act on the `dead_code` / `unused_*` warnings.
- For Cargo dependencies, use cargo-shear, cross-check with cargo-machete `--with-metadata` or `cargo +nightly udeps`, and record known false positives in the crate's metadata ignore list.

- **Grade:** A · **Verdict:** VERIFIED. The verifier added rustc's documented limitation on fields kept for their side effects.
- **Rationale:** A stray `pub` hides dead code from rustc. `unreachable_pub` flags `pub` items that other crates cannot actually reach. The three dependency tools trade precision against cost differently:
  - machete: regex over source files (fast, imprecise)
  - udeps: compiles on nightly
  - shear: parses with rust-analyzer's parser (and can expand macros on nightly)
- **Evidence:**
  - [rustc warn-by-default lints: dead_code](https://doc.rust-lang.org/rustc/lints/listing/warn-by-default.html) — Rust project, 2026 — official_docs — "The dead_code lint detects unused, unexported items."; "prefix the name with an underscore such as _foo"; "To preserve the numbering of tuple structs with unused fields, change the unused fields to have unit type or use PhantomData"; limitation: "Removing fields that are only used for side-effects and never read will result in behavioral changes" (fields whose drop performs an action, or whose type affects auto traits like Send/Sync) — confirmed.
  - [rustc allowed-by-default lints: unreachable_pub](https://doc.rust-lang.org/rustc/lints/listing/allowed-by-default.html) — Rust project, 2026 — official_docs — "triggers for pub items not reachable from other crates"; suggests `pub(crate)`; "'allow' by default because it will trigger for a large amount of existing Rust code" — confirmed.
  - [cargo-shear README](https://github.com/Boshen/cargo-shear) — Boshen, 2026 — official_docs — uses "rust-analyzer's parser (ra_ap_syntax)"; "cannot detect 'hidden' imports from macro expansions without the `--expand` flag (nightly only)"; also reports unlinked source files; ignore list under `[package.metadata.cargo-shear]` — confirmed.
  - [cargo-machete README](https://github.com/bnjbvr/cargo-machete) — Benjamin Bouvier, 2026 — official_docs — "fast (yet imprecise)"; `--with-metadata` runs `cargo metadata --all-features` and may modify Cargo.lock; `[package.metadata.cargo-machete] ignored = ["prost"]` — confirmed.
  - [cargo-udeps README](https://github.com/est31/cargo-udeps) — est31, 2026 — official_docs — "it needs Rust nightly to actually run"; cannot analyse dependencies used only in doctests; does not account for build scripts or feature flags; `[package.metadata.cargo-udeps.ignore]` and `[workspace.metadata.cargo-udeps.ignore]` — confirmed.
  - [cargo-machete, find unused dependencies quickly](https://bouvier.cc/tech/cargo-machete/) — Benjamin Bouvier, 2022 — engineering_blog — 1.08 s on rust-lang/rust, 0.58 s on wasmtime; "Code generated via macros or build scripts aren't inspected" — confirmed.
- **Detect:**
  1. Add `#![warn(unreachable_pub)]` at the crate root (binaries and internal crates).
  2. Run `cargo check` / `cargo clippy` for every target and feature set you ship.
  3. For dependencies: `cargo shear`, then `cargo shear --fix`; `cargo shear --expand` (nightly) when macros hide imports; `cargo machete --with-metadata`; `cargo +nightly udeps`.
- **Tools:** rustc lints, clippy, cargo-shear, cargo-machete, cargo-udeps
- **Applies to:** Rust crates and workspaces.
- **When not to apply / counterpoints:**
  - In library crates, `pub` items are API. Do not demote them.
  - Never delete a never-read field that is kept for its drop behaviour or for its auto-trait effect.
  - Ignore lists hide real regressions if nobody revisits them.
- **Fix risk:** low

### T07-F08 — Go: deadcode for whole-program unreachable functions, staticcheck U1000 for unused unexported identifiers
Add gopls `unusedfunc` for live feedback in the editor. Before deleting, run `-whylive` on any surprising result. Check go.mod with `go mod tidy -diff` before letting `go mod tidy` rewrite it.

- **Grade:** A · **Verdict:** CORRECTED. `unusedfunc` ships in the **gopls module v0.23.0** (2026-07-07), not in "x/tools v0.23.0". The deadcode command page is x/tools v0.50.0 (2026-09-08). The Staticcheck quote was checked word for word.
- **Rationale:** deadcode builds a call graph from `main` with Rapid Type Analysis, so it finds dead functions that per-package tools miss. U1000 treats every exported package-level identifier as used. Its whole-program mode was removed in 2020.2 because it "did not work well with the kind of caching that we use" and "may have caused flaky results", so U1000 cannot find dead exported API.
- **Evidence:**
  - [Finding unreachable functions with deadcode](https://go.dev/blog/deadcode) — Alan Donovan, The Go Blog, 2023-12-12 — official_docs — "if it reports a function as dead code, it means the function cannot be called even through these dynamic mechanisms. However the tool may fail to report some functions that in fact can never be executed." — confirmed.
  - [deadcode command documentation](https://pkg.go.dev/golang.org/x/tools/cmd/deadcode) — Go team, x/tools v0.50.0 — official_docs — "Just because a function is reported as dead does not mean it is unconditionally safe to delete it"; does "not currently understand the aliasing created by //go:linkname directives"; marker-interface methods and generated files are excluded by default (include generated files with `-generated`) — confirmed.
  - [Staticcheck 2020.2 release notes](https://staticcheck.dev/changes/2020.2/) — Dominik Honnef, 2020 — official_docs — whole-program mode "did not work well with the kind of caching that we use in Staticcheck … may have caused flaky results"; "all exported package-level identifiers will be considered used from now on" — confirmed.
  - [unusedfunc analyzer](https://pkg.go.dev/golang.org/x/tools/gopls/internal/analysis/unusedfunc) — Go team (gopls v0.23.0, 2026-07-07) — official_docs — "not as precise as the golang.org/x/tools/cmd/deadcode tool, but it has the advantage that it runs within the modular analysis framework, enabling near real-time feedback within gopls"; false positives from go:linkname, assembly and build tags — confirmed.
  - [go mod tidy](https://pkg.go.dev/cmd/go#hdr-Add_missing_and_remove_unused_modules) — Go team, 2026 — official_docs — "removes unused modules that don't provide any relevant packages"; `-diff` prints the changes as a unified diff without modifying files, and exits non-zero if there are any; `-v` prints the removed modules — confirmed.
- **Detect:**
  1. `go install golang.org/x/tools/cmd/deadcode@latest`
  2. `deadcode ./...`, then `deadcode -test ./...`
  3. `deadcode -whylive=<pkg>.<Func>` to see the path that keeps a function alive
  4. `staticcheck ./...` and filter for U1000; use `-matrix` when build tags are involved
  5. `go mod tidy -diff`, then `go mod tidy -v`
- **Tools:** golang.org/x/tools/cmd/deadcode, staticcheck, gopls unusedfunc, go mod tidy
- **Applies to:** Go executables (deadcode needs a `main`). For libraries, use `-test` or U1000.
- **When not to apply / counterpoints:** Callers through `go:linkname` or assembly produce false "dead" reports. Staticcheck deliberately under-reports exported code. Also see the contradiction below about deadcode's soundness claim.
- **Fix risk:** low

### T07-F10 — C/C++: compile with `-Wall -Wextra`, and know the gaps
- `-Wall -Wextra` is needed for `-Wunused-parameter`.
- `-Wunused-function` only covers static functions. Unused functions with external linkage need whole-program analysis: cppcheck's `unusedFunction` check (with a build dir, or single-threaded) or the linker's `--gc-sections --print-gc-sections`.
- Use Clang's `-Wunreachable-code`. GCC's flag has been a no-op since 4.5.

- **Grade:** A · **Verdict:** CORRECTED
  - The researcher said the misc-unused-parameters docs state that parameters "cannot be removed from virtual functions or function pointers". The docs do not say this. They say the fix removes a parameter only "if all callers of the function are in the same translation unit and can be updated", and offer an `IgnoreVirtual` option.
  - `--enable=unusedFunction` is now verified from cppcheck's own help text. This resolves one of the researcher's open questions.
  - The claim that GCC dropped `-Wunreachable-code` rests on the Mozilla bug. The current GCC Warning Options page simply does not document the flag.
- **Rationale:** The obvious flags leave large gaps. Cppcheck's whole-program check silently needs a build dir when it runs multi-threaded.
- **Evidence:**
  - [GCC Warning Options](https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html) — GNU/GCC, 2026 — official_docs — `-Wunused-function`: "Warn whenever a static function is declared but not defined or a non-inline static function is unused. This warning is enabled by -Wall."; `-Wunused-parameter`: "This option is not enabled by -Wunused unless -Wextra is also specified." — confirmed. `-Wunreachable-code` is not documented on the page.
  - [Cppcheck manual](https://cppcheck.sourceforge.io/manual.pdf) — Cppcheck team, v2.21.0 — official_docs — "Whole program analysis does not work when multiple threads are used unless you use a Cppcheck build dir. For instance, the unusedFunction warnings require whole program analysis." — confirmed word for word (the PDF was text-extracted).
  - [cppcheck cmdlineparser.cpp (help text)](https://raw.githubusercontent.com/danmar/cppcheck/main/cli/cmdlineparser.cpp) — Cppcheck project, 2026 — source — `--enable=` lists `unusedFunction`: "Check for unused functions. It is recommended to only enable this when the whole program is scanned." — added by the verifier.
  - [ld Options](https://sourceware.org/binutils/docs/ld/Options.html) — GNU binutils, 2026 — official_docs — `--gc-sections`: "Enable garbage collection of unused input sections."; `--print-gc-sections`: "List all sections removed by garbage collection. The listing is printed on stderr." — confirmed.
  - [Bug 1235717](https://bugzilla.mozilla.org/show_bug.cgi?id=1235717) — Mozilla, ~2016 — practitioner_forum — GCC discontinued `-Wunreachable-code` in 2010 (4.5) because its results depended on the optimisation level; MSVC's C4702 fires in VS2013's own standard-library headers — confirmed (paraphrase).
  - [Re: [RFC PATCH v1] perf build: Fix build for clang's -Wunreachable-code](https://lkml.iu.edu/hypermail/linux/kernel/2504.1/08119.html) — Ian Rogers, LKML, 2025-04-11 — practitioner_forum — "Clang's unreachable code warning is able to catch bugs like the famous 'goto fail' which gcc's unreachable code warning fails to warn about"; Namhyung Kim: "I'm not sure if it's useful…", "The proposed changes don't look like an improvement."; the patch touched 24 files — confirmed.
  - [misc-unused-parameters](https://clang.llvm.org/extra/clang-tidy/checks/misc/unused-parameters.html) — LLVM clang-tidy, 2026 — official_docs — the fix comments out the parameter name, or removes the parameter "if all callers of the function are in the same translation unit and can be updated"; options `StrictMode`, `IgnoreVirtual`, `IgnoreMacroParameters` — confirmed; quote corrected.
- **Detect:**
  - `CFLAGS += -Wall -Wextra`, and with Clang add `-Wunreachable-code`.
  - `cppcheck --enable=unusedFunction --cppcheck-build-dir=b src`
  - Link with `-Wl,--gc-sections -Wl,--print-gc-sections` and read the list of removed sections on stderr.
  - `clang-tidy -checks='-*,misc-unused-parameters' ...`
- **Tools:** gcc/clang warnings, cppcheck, GNU ld, clang-tidy
- **Applies to:** C and C++ applications. In a shared library, exported symbols are API.
- **When not to apply / counterpoints:**
  - Clang's unreachable-code warnings are noisy in generated code, macros and platform `#ifdef`s (Firefox; pushback on LKML).
  - The linker removes whole sections. Per-function granularity needs the compiler to put each function in its own section (`-ffunction-sections`), and this was NOT verified: the ld page does not mention it.
  - Unused parameters of virtual functions or callbacks are part of a contract. Comment out the name or use `[[maybe_unused]]`; do not delete the parameter.
- **Fix risk:** medium

### T07-F11 — C/C++ include cleanup: never apply IWYU's `fix_includes.py` output blindly
Use clang-tidy `misc-include-cleaner` (or clangd's include-cleaner) or IWYU to find unused and missing includes. Keep intentional includes with `// IWYU pragma: keep`, and map private headers with `// IWYU pragma: private, include "public.h"`.

- **Grade:** A · **Verdict:** CORRECTED. The claim that include-cleaner "respects IWYU pragmas" does not appear on the clang-tidy check page. The verifier found it on the clangd include-cleaner design page, which the check page links to, and substituted that source.
- **Rationale:** The IWYU README calls the tool experimental and biased toward Google's own source tree, and lists the manual corrections that are routinely needed after running it.
- **Evidence:**
  - [include-what-you-use README](https://github.com/include-what-you-use/include-what-you-use) — IWYU project, 2026 — official_docs — "This is experimental software, as of June 2024. It was originally written to work specifically in the Google source tree, and may make assumptions, or have gaps, that are immediately and embarrassingly evident in other types of code." Clang 22 pairs with IWYU 0.26. Manual fixes after `fix_includes.py`: restore `// IWYU pragma: keep` lines, delete unneeded additions, fix forward declarations, replace private headers (for example `<bits/stl_vector.h>` with `<vector>`) — confirmed.
  - [misc-include-cleaner](https://clang.llvm.org/extra/clang-tidy/checks/misc/include-cleaner.html) — LLVM clang-tidy, 2026 — official_docs — "Checks for unused and missing includes. Generates findings only for the main file of a translation unit."; options `IgnoreHeaders`, `DeduplicateFindings`, `UnusedIncludes`, `MissingIncludes` — confirmed.
  - [Include Cleaner design](https://clangd.llvm.org/design/include-cleaner) — clangd/LLVM, 2026 — official_docs — "Include Cleaner respects `keep`, `always_keep`, `private`, and `export`/`begin_exports`/`end_exports`." — substituted source.
- **Detect:** Run `clang-tidy -checks='-*,misc-include-cleaner' -p build src/*.cpp`. For IWYU, review the `fix_includes.py` diff by hand, restore any include marked `// IWYU pragma: keep`, replace private headers, then rebuild every configuration.
- **Tools:** clang-tidy misc-include-cleaner, clangd, include-what-you-use
- **Applies to:** C/C++ with a compilation database.
- **When not to apply / counterpoints:** Removing an include that another header relied on transitively can break other translation units or platforms. Rebuild everything after each batch.
- **Fix risk:** medium

### T07-F20 — Keep suppressions narrow, central and auditable
Prefer, in this order:
- a vulture whitelist file
- ignore lists in the Knip config, `[package.metadata.cargo-*]` or `[tool.deptry.per_rule_ignores]`
- the `_` prefix for bindings that are intentionally unused

Turn on stale-suppression reporting (ESLint `reportUsedIgnorePattern`, Knip tag hints), and re-check every suppression each time the detector runs.

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Every escape hatch hides future real findings. Knip warns that tags "hide issues" and reports tag hints once a suppression is no longer needed. ESLint can flag `_` names that are in fact used.
- **Evidence:**
  - [JSDoc & TSDoc tags](https://knip.dev/reference/jsdoc-tsdoc-tags) — Knip, 2026 — official_docs — "adding tags or excluding a certain type of issues from the report is usually not recommended. It hides issues, which is often a sign of code smell."; tag hints are reported when a tag becomes unnecessary — confirmed.
  - [vulture on PyPI](https://pypi.org/project/vulture/) — Jendrik Seipp, 2026 — official_docs — whitelists are "the recommended option" — confirmed.
  - [no-unused-vars](https://eslint.org/docs/latest/rules/no-unused-vars) — ESLint, 2026 — official_docs — reportUsedIgnorePattern — confirmed.
  - [cargo-machete README](https://github.com/bnjbvr/cargo-machete) — Benjamin Bouvier, 2026 — official_docs — `[package.metadata.cargo-machete] ignored = ["prost"]` — confirmed.
- **Detect:** Build an inventory of suppressions:
  - `git grep -nE "noqa: (F401|F841|DC)|eslint-disable.*no-unused|@public|@internal|allow\(dead_code\)|IWYU pragma: keep|purgecss (start )?ignore"`
  - `whitelist.py` files
  - the `ignore*` keys in `knip.json`
  - the cargo-* metadata tables

  Each entry needs a comment giving the reason. Remove entries whose target no longer exists or is now referenced.
- **Tools:** git grep, eslint, knip, vulture
- **Applies to:** All languages.
- **When not to apply / counterpoints:** The `_` prefix is the idiomatic, compiler-sanctioned way to keep a required but unused parameter (TS, Rust, Ruff `dummy-variable-rgx`), so it is not a smell in itself.
- **Fix risk:** low

### T07-F21 — Split auto-fixes into "apply automatically" and "apply only after review"
Always start from a clean git tree.

Apply automatically:
- Ruff F401 outside `__init__.py`, **except** bare imports of first-party modules that may exist for their side effects (T07-F06)
- Knip's removal of the `export` keyword

Apply only after review:
- Ruff F841 (unsafe: it can delete comments)
- Knip file deletion (`--allow-remove-files`)
- deadcode `--fix` (preview with `--dry` first)
- cargo-shear `--fix`
- IWYU `fix_includes.py`
- `go mod tidy` (check with `-diff` first)

- **Grade:** A · **Verdict:** CORRECTED. As written, the rule conflicted with T07-F06: pyflakes/Ruff flag *any* unused import, including one kept for a registration side effect. The verifier narrowed the "apply automatically" list. This caveat is the verifier's reasoning; Ruff's docs do not state it.
- **Rationale:** The tool authors classify fix safety themselves:
  - Ruff marks the F841 fix unsafe.
  - Knip tells users to rely on version control to review and undo, and makes file deletion opt-in.
  - deadcode offers a dry run.
  - IWYU lists the manual corrections its fixer routinely needs.
- **Evidence:**
  - [Auto-fix](https://knip.dev/features/auto-fix) — Knip, 2026 — official_docs — "Use a VCS (version control system) like Git to review and undo changes as necessary."; `--allow-remove-files` is required to delete files; `--fix-type` accepts dependencies, exports, types, files, catalog; for unused exports it removes only the `export` keyword; it recommends ESLint or Biome for unused locals — confirmed.
  - [F841 unused-variable](https://docs.astral.sh/ruff/rules/unused-variable/) — Astral (Ruff), 2026 — official_docs — the fix is unsafe because it "may delete comments that are attached to the assignment" — confirmed.
  - [deadcode (Python)](https://github.com/albertas/deadcode) — albertas, 2026 — official_docs — `--dry` shows the changes without applying them — confirmed.
  - [include-what-you-use README](https://github.com/include-what-you-use/include-what-you-use) — IWYU project, 2026 — official_docs — the four manual corrections after `fix_includes.py` — confirmed.
- **Detect:**
  1. `git status --porcelain` must print nothing.
  2. `ruff check --fix` (safe fixes only; never pass `--unsafe-fixes` without review).
  3. `knip --fix --fix-type exports,types`, then review the diff.
  4. `knip --fix --allow-remove-files`, only after the checks in T07-F13 and T07-F14.
  5. `deadcode . --fix --dry`.
  6. `cargo shear --fix`, then review Cargo.toml.
  7. `go mod tidy -diff`.
- **Tools:** ruff, knip, deadcode, cargo-shear, IWYU, go mod tidy
- **Applies to:** All languages.
- **When not to apply / counterpoints:** Knip's fixer does not remove the local code that becomes unused once the `export` keyword is gone. Run the local linters again afterwards.
- **Fix risk:** medium

### T07-F22 — Solidity: use Slither's `dead-code` and `unused-state` detectors, but never touch state variables in upgradeable contracts
In upgradeable or proxy contracts, never delete, reorder or retype a state variable, even if it is flagged unused. Check every change with `slither-check-upgradeability`.

- **Grade:** A · **Verdict:** CORRECTED (quote fixes only)
  - Slither's `unused-state` description is "Unused state variable."; "Remove unused state variables." is its recommendation.
  - The upgradeability table describes `missing-variables` as "Variable missing in the v2" (Medium) and `order-vars-contracts` as "Incorrect vars order with the v2" (High).
- **Rationale:** In proxy-based upgradeable contracts, the storage layout is part of the deployed state. Removing an "unused" variable shifts the slots of the variables after it and corrupts their values.
- **Evidence:**
  - [Detector Documentation](https://github.com/crytic/slither/wiki/Detector-Documentation) — Trail of Bits / crytic, 2026 — official_docs — `dead-code`: Informational / Medium, "Functions that are not used." / "Remove unused functions."; `unused-state`: Informational / High, "Unused state variable." / "Remove unused state variables." — confirmed.
  - [Writing Upgradeable Contracts](https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable) — OpenZeppelin, 2026 — official_docs — you cannot "change the order in which the contract state variables are declared, nor their type" or "remove an existing variable"; doing so makes "the upgraded version of the contract to have its storage values mixed up, and can lead to critical errors"; alternatives are storage gaps and ERC-7201 namespaced storage — confirmed.
  - [Upgradeability Checks](https://github.com/crytic/slither/wiki/Upgradeability-Checks) — crytic, 2026 — official_docs — `missing-variables` (Medium), `order-vars-contracts` (High); usage `slither-check-upgradeability project ContractName` with `--new-contract-name` and `--proxy-name` — confirmed.
- **Detect:** Run `slither . --detect dead-code,unused-state`. For upgradeable contracts, run `slither-check-upgradeability . ContractV1 --new-contract-name ContractV2 [--proxy-name Proxy]`. Treat any contract that inherits from Initializable or UUPSUpgradeable, or is deployed behind a proxy, as having a frozen storage layout.
- **Tools:** slither, slither-check-upgradeability, OpenZeppelin Upgrades plugins
- **Applies to:** Solidity/EVM contracts, especially proxies (Transparent, UUPS, Beacon, Diamond).
- **When not to apply / counterpoints:** A non-upgradeable contract that has not been deployed yet can drop unused state. Unused internal functions do not affect storage.
- **Fix risk:** high

### T07-F23 — CSS: class names must appear in full in the source
PurgeCSS and Tailwind treat source files as plain text. Before purging or deleting "unused" CSS, replace dynamically built class names with static lookup maps, or protect them with explicit safelists.

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** The scanners do not parse code, so they cannot see concatenated class names. Getting this wrong removes styles that are used at runtime, a visual regression that unit tests do not catch.
- **Evidence:**
  - [Detecting classes in source files](https://tailwindcss.com/docs/detecting-classes-in-source-files) — Tailwind CSS v4.3 docs, 2026 — official_docs — "Since Tailwind scans your source files as plain text, it has no way of understanding string concatenation or interpolation"; "Always map props to static class names"; `@source inline("underline")` — confirmed.
  - [Safelisting](https://purgecss.com/safelisting.html) — PurgeCSS, 2026 — official_docs — standard/deep/greedy patterns; `/* purgecss start ignore */` … `/* purgecss end ignore */`; use `/*!` when PostCSS-style optimisers run first — confirmed.
- **Detect:** Grep for dynamic class construction (template literals in `className`/`class`, `'bg-' +` and similar). Compare the list of selectors in the production CSS before and after. Do a visual smoke test of the pages that use dynamic variants.
- **Tools:** Tailwind CSS v4, PurgeCSS, grep
- **Applies to:** Web front-ends that use utility CSS or CSS purging.
- **When not to apply / counterpoints:** Classes added by third-party scripts or CMS content outside the scanned files are invisible to these tools and must be safelisted.
- **Fix risk:** medium

### T07-F01 — Treat dead-code removal as a top-down graph pass, repeated until the report stops changing
1. Remove files and modules that the real entry points cannot reach.
2. Remove unused exports and symbols.
3. Remove unused dependencies.

Re-run every detector after each batch of deletions until the report stops changing. Delete dead cycles (dead code that only references itself) as a unit.

- **Grade:** B · **Verdict:** VERIFIED. The claim that Python tools cannot find cycles because they match by name is the researcher's reasoning, not something a source states.
- **Rationale:** Findings come in chains. SCARF and Sensenmann both handle cycles explicitly.
- **Evidence:**
  - [Handling Issues](https://knip.dev/guides/handling-issues) — Knip, 2026 — official_docs — "Findings come in chains, so reducing unused files also reduces unused exports and dependencies." Order: unused files, unresolved imports, unused exports, unused dependencies — confirmed.
  - [Automating dead code cleanup](https://engineering.fb.com/2023/10/24/data-infrastructure/automating-dead-code-cleanup/) — Will Shackleton, Andy Pincombe, Katriel Cohn-Gordon (Meta), 2023-10-24 — engineering_blog — "we can detect and delete cycles, where different parts of the codebase depend on each other. Deleting entire subgraphs accelerates the deletion of dead code…" — confirmed.
  - [Sensenmann: Code Deletion at Scale](https://testing.googleblog.com/2023/04/sensenmann-code-deletion-at-scale.html) — Phil Norman, Google Testing Blog, 2023-04-28 — engineering_blog — tests and their libraries are made interdependent, "thus creating loops in the graph", handled "using Tarjan's strongly connected components algorithm" — confirmed via the Atom feed.
  - [Recommendation Update: Use knip to detect dead code and types](https://effectivetypescript.com/2023/07/29/knip/) — Dan Vanderkam, 2023-07-29 — engineering_blog — ts-prune "couldn't detect unused dependencies", missed "mutually recursive dead code", "made no attempts to understand whether your test code was alive or dead" — confirmed.
  - [HN comment](https://news.ycombinator.com/item?id=47050014) — swynx (vendor of the Swynx scanner), 2026 — practitioner_forum — "If no path from any entry point reaches a module, it's dead with very high confidence"; "two passes - file-level reachability (high confidence, low noise)…"; self-reported "~1.7%" false-positive rate — confirmed; vendor claim.
- **Detect:**
  - JS/TS: `npx knip --files`, then `--exports`, then `--dependencies`.
  - Go: `deadcode ./...`.
  - Rust: `cargo shear` also reports unlinked `.rs` files.
  - Python: after each batch, re-run vulture/deadcode to find newly exposed items.
  - Stop when two consecutive runs show nothing new.
- **Tools:** knip, golang.org/x/tools/cmd/deadcode, cargo-shear, vulture, deadcode (Python)
- **Applies to:** All languages; most valuable on finished apps where the entry points are known.
- **When not to apply / counterpoints:** Reachability is only as good as the list of entry points. Knip: "Configuration and entry files may be reported as unused because there is no plugin yet." Tools that match by name under-report; deadcode (Python) says that if several definitions share a name, "they all wont be reported if at least one usage of that name is being detected".
- **Fix risk:** medium

### T07-F13 — Before deleting anything a static tool flags, search for dynamic and out-of-code references
Search for:
- the name as a string anywhere in the repo, including config, YAML/JSON, templates, SQL, scripts, Dockerfiles and CI
- framework registries, decorators and dependency injection
- reflection, `getattr` and `importlib`
- CLI tools listed as dependencies

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Every static analyser documents this blind spot. Meta's SCARF, even after static and runtime analysis, still searches for text references (BigGrep) as a final safety check.
- **Evidence:**
  - [Automating dead code cleanup](https://engineering.fb.com/2023/10/24/data-infrastructure/automating-dead-code-cleanup/) — Meta, 2023 — engineering_blog — "SCARF must be capable of introspecting any and all types of dynamic usage in addition to the static dependency graph"; "Our systems also err on the side of caution, by searching for textual references to code and data through our BigGrep system" — confirmed. The same post: "five years on, it has automatically deleted more than 100 million lines of code in over 370,000 change requests."
  - [Dead Code Removal at Meta: Automatically Deleting Millions of Lines of Code and Petabytes of Deprecated Data](https://dl.acm.org/doi/10.1145/3611643.3613871) — Shackleton, Cohn-Gordon, Rigby, Abreu et al., ESEC/FSE 2023 — peer_reviewed — "In the last year alone, it has removed petabytes of data across 12.8 million distinct assets, and deleted over 104 million lines of code." — abstract only (Semantic Scholar API).
  - [dependency:analyze](https://maven.apache.org/plugins/maven-dependency-plugin/analyze-mojo.html) — Apache Maven 3.11.0 — official_docs — "limitations due to the fact that it works at bytecode level"; "Certain dependencies that are known to be used and loaded by reflection are always ignored" — confirmed.
  - [DepClean README](https://github.com/ASSERT-KTH/depclean) — ASSERT-KTH, 2026 — official_docs — "ignores some dependencies used only via reflection (e.g., frameworks like Spring or Hibernate)"; `ignoreDependencies` regex — confirmed.
- **Detect:** For each candidate name N:
  - `git grep -n -w N` across the whole repo (not just `src`)
  - the decorator and registry patterns, and `getattr(`, `importlib.import_module(`, `reflect.`, `Class.forName`
  - for dependencies, also package.json scripts, config files and Dockerfiles

  If any hit is dynamic, keep the item and add a documented ignore entry.
- **Tools:** git grep / ripgrep, ast-grep, knip, vulture, mvn dependency:analyze, DepClean
- **Applies to:** All languages; highest risk in Python, JS, Java/Kotlin (reflection, dependency injection), Ruby and PHP.
- **When not to apply / counterpoints:** A text search gives false "alive" signals for common names such as `get` or `run`. Accept that some dead code will stay when its name is too generic to disprove.
- **Fix risk:** high

### T07-F18 — Delete dead code instead of commenting it out, wrapping it in `if (false)`, or keeping it "just in case"
It is rarely revived, and version control keeps it anyway. Prioritise removal: peer-reviewed studies found that dead code hurts maintenance and that removing it reduces compile time and binary size.

- **Grade:** B (was A) · **Verdict:** DOWNGRADED
  - All four studies were checked from their abstracts only.
  - Three of the four come from a single research group (Romano/Scanniello), and the three maintenance studies all use Java desktop apps.
  - Malavolta et al. measured the removal of mostly **third-party library** JS by a tool (Lacuna), not developers deleting their own source code.
  - The evidence is real and on-topic, but narrow in scope. Grade B.
- **Rationale:**
  - Romano et al.: interviews plus four experiments concluded that dead code is harmful during maintenance and evolution.
  - Caivano et al.: dead methods survive long and are rarely revived.
  - Romano et al. (EASE 2024): removing dead methods improves internal structure and cuts compile time and executable size.
- **Evidence:**
  - [A Multi-Study Investigation into Dead Code](https://doi.org/10.1109/TSE.2018.2842781) — Romano, Vendome, Scanniello, Poshyvanyk, IEEE TSE 46(1), 2020 — peer_reviewed — "in the maintenance and evolution phases, where our results suggest that dead code is harmful"; "developers should avoid this smell" — abstract only.
  - [An Exploratory Study on Dead Methods in Open-source Java Desktop Applications](https://doi.org/10.1145/3475716.3475773) — Caivano, Cassieri, Romano, Scanniello, ESEM 2021 — peer_reviewed — 13 apps, 1,044 commits; "dead methods generally survive for a long time"; "dead methods are rarely revived"; "most dead methods are dead since the creation of the corresponding methods" — abstract only.
  - [A Folklore Confirmation on the Removal of Dead Code](https://doi.org/10.1145/3661167.3661188) — Romano, Toriello, Cassieri, Francese, Scanniello, EASE 2024 (short paper) — peer_reviewed — 23 Java desktop apps; "after removing dead methods, the internal structure of source code significantly improves, while the time to compile source code significantly diminishes as well as the space to store executable code" — abstract only.
  - [JavaScript Dead Code Identification, Elimination, and Empirical Assessment](https://doi.org/10.1109/TSE.2023.3267848) — Malavolta, Nirghin, Scoccia, Romano, Lombardi, Scanniello, Lago, IEEE TSE, 2023 — peer_reviewed — 30 mobile web apps; dead code comes largely from third-party libraries and was eliminated by the Lacuna tool; "the removal of JavaScript dead code has a positive impact on the loading time of mobile web apps, while significantly reducing the number of bytes transferred over the network" — abstract only.
  - [Sensenmann HN thread](https://news.ycombinator.com/item?id=35755841) — Xorlev, 2023 — practitioner_forum — "it's in version control forever. It's not as if it entirely disappears." — confirmed.
- **Detect:**
  - Unreachable code after a return: TS7027, ESLint `no-unreachable`, vulture's 100% tier, Clang `-Wunreachable-code`, deadcode (Python) DC13.
  - Constant-false guards: grep for `if (false)`, `if False:`, `if 0`, `#if 0`.
  - Commented-out code: see T07-F19.
- **Tools:** tsc, eslint, vulture, clang, ruff, deadcode, grep
- **Applies to:** All languages.
- **When not to apply / counterpoints:** The harm is context-dependent, not universal. `#if 0` blocks in C are sometimes deliberate documentation; ask before removing them.
- **Fix risk:** low

### T07-F15 — Do not treat a green test suite as proof that a deletion is safe
Delete in small, single-purpose commits that can each be reverted. After each batch:
- build every configuration (T07-F09)
- run the full test suite
- do a production-mode build or bundle
- smoke-run the real entry points

- **Grade:** B · **Verdict:** CORRECTED. Hejderup & Gousios is published in the *Journal of Systems and Software* (per its arXiv record), so it is peer-reviewed, not only a preprint.
- **Rationale:** In the measured projects, test suites exercised only part of the code they depend on. Most of Uber's generated flag-removal diffs compiled and passed tests, yet about a third still needed human changes before landing.
- **Evidence:**
  - [Can We Trust Tests To Automate Dependency Updates? A Case Study of Java Projects](https://arxiv.org/abs/2109.11921) — Joseph Hejderup, Georgios Gousios, Journal of Systems and Software (arXiv 2021) — peer_reviewed — "tests only cover 58% of direct and 20% of transitive dependency calls"; tests detect only "47% of direct and 35% of indirect artificial faults on average"; 521 Java projects — abstract confirmed.
  - [Piranha: Reducing Feature Flag Debt at Uber](https://doi.org/10.1145/3377813.3381350) — Ramanathan, Clapp, Barik, Sridharan, ICSE-SEIP 2020 — peer_reviewed — "over 85% of the generated diffs compile and pass tests successfully"; "65% of the diffs landed without any changes"; 1381 flags (17% of all flags) — abstract confirmed.
  - [HN comment](https://news.ycombinator.com/item?id=47050014) — swynx (vendor), 2026 — practitioner_forum — "Delete it and see if tests break" works at small scale, but it burns CI minutes and the false positives erode trust in the tool — confirmed.
- **Detect:** Use `git log --stat` to check that each commit handles one concern. Then run the build matrix and the tests, do a production build, and compare the emitted assets and bundle sizes with the previous commit.
- **Tools:** git, CI build matrix, test runner, bundler
- **Applies to:** All languages.
- **When not to apply / counterpoints:** On a small codebase with high coverage, tests do catch most mistakes (HN user shoo: high coverage is "essential"). The Hejderup numbers concern dependency calls in Java and may not carry over to other languages.
- **Fix risk:** low

### T07-F17 — Treat stale feature flags and configuration switches as the highest-risk dead code
- Find flags whose value is the same in every environment.
- Keep the branch that runs, and delete the other branch together with the flag.
- Never reuse a retired flag name or value for new behaviour.

- **Grade:** B · **Verdict:** CORRECTED. The Hodgson article on martinfowler.com was first published 2016-02-08 and last updated 2017-10-09 (the researcher wrote 2017). The Knight details were confirmed in the SEC order text.
- **Rationale:** Knight Capital lost more than $460M in about 45 minutes. "Power Peg" code, left on the production servers since 2003, was switched back on by a repurposed flag on the one server (out of eight) that did not receive the new code. Hodgson describes toggles as inventory with a carrying cost. Piranha shows that the cleanup can be largely automated.
- **Evidence:**
  - [In the Matter of Knight Capital Americas LLC (Release No. 34-70694)](https://www.sec.gov/litigation/admin/2013/34-70694.pdf) — U.S. SEC, 2013-10-16 — incident_report — "Despite the lack of use, the Power Peg functionality remained present and callable at the time of the RLP deployment. The new RLP code also repurposed a flag that was formerly used to activate the Power Peg code."; "in 2003, Knight elected to leave the Power Peg code on SMARS's production servers"; "orders sent with the repurposed flag to the eighth server triggered the defective Power Peg code"; "lost more than $460 million"; "approximately forty-five minutes" — confirmed word for word from the PDF text.
  - [Feature Toggles (aka Feature Flags)](https://martinfowler.com/articles/feature-toggles.html) — Pete Hodgson, 2016 (updated 2017) — engineering_blog — "Savvy teams view their Feature Toggles as inventory which comes with a carrying cost, and work to keep that inventory as low as possible."; "Some go as far as creating 'time bombs' which will fail a test (or even refuse to start an application!) if a feature flag is still around after its expiration date." — confirmed.
  - [Piranha: Reducing Feature Flag Debt at Uber](https://doi.org/10.1145/3377813.3381350) — ICSE-SEIP 2020 — peer_reviewed — diffs for 1381 flags; 65% landed unchanged; ~80% touch more than one file; works on Objective-C, Java and Swift — abstract confirmed.
  - [Knightmare: A DevOps Cautionary Tale](https://dougseven.com/2014/04/17/knightmare-a-devops-cautionary-tale/) — Doug Seven, 2014-04-17 — engineering_blog — "why code that had been dead for 8-years was still present in the code base is a mystery" — confirmed.
- **Detect:** List every flag, env var and config key read in code, for example with `git grep -nE "(getFlag|isEnabled|process\.env\.|os\.environ|feature_)"`. Compare them against every environment's config. A flag with the same value everywhere, or with no config entry at all, is a candidate. Uber's open-source Piranha (github.com/uber/piranha) automates the refactor; it was not evaluated here.
- **Tools:** git grep, Piranha (uber/piranha), config diff
- **Applies to:** Any codebase with feature flags, kill switches, env-driven branches or legacy modes.
- **When not to apply / counterpoints:** Kill switches and operational toggles are meant to live long and to stay at the same value most of the time. Do not remove them as "stale" (T07-F14).
- **Fix risk:** medium

### T07-F14 — "Not executed recently" or "not covered by tests" is evidence, not proof
Before deleting, send any candidate on a rare but critical path to its owner for confirmation. Typical cases:
- disaster recovery and failover
- kill switches
- year-end or audit jobs
- data migrations
- admin tooling
- error handlers

Never delete these on tool output alone.

- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:** Sensenmann deletes binaries that have not run "for a long time", and Googlers report rarely rejecting its changes. Other practitioners describe exactly the failure mode this invites. A finished project usually has no runtime telemetry, so the static signal is weaker still.
- **Evidence:**
  - [Sensenmann: Code Deletion at Scale](https://testing.googleblog.com/2023/04/sensenmann-code-deletion-at-scale.html) — Phil Norman, Google Testing Blog, 2023 — engineering_blog — "a log entry is written when a program runs, recording the time and which specific binary it is … If a program hasn't been used for a long time, we try sending a deletion changelist."; "It submits over 1000 deletion changelists per week, and has so far deleted nearly 5% of all C++ at Google." — confirmed via the Atom feed.
  - [Sensenmann HN discussion](https://news.ycombinator.com/item?id=35755841) — kortilla, lrem, UncleMeat, Xorlev, 2023 — practitioner_forum — kortilla: "This is how you end up deleting stuff only called in rare but critical cases: - during outage - at end of year - during audits"; "There are industries where this mindset is _business ending_"; lrem: "a 'stop the robot uprising' button that we seem to press every couple years. Needs code in _a lot_ of microservices that looks dead for all intents and purposes." — confirmed word for word.
- **Detect:** Classify every deletion candidate by its path. Send to the owner anything under recovery, failover, migration, admin, cron/scheduled, `*_backup*` or kill-switch code, and anything reachable only from signal handlers or ops scripts. If logs or APM exist, check call counts over at least one full business cycle.
- **Tools:** git grep, runtime logs/APM (if available), Go deadcode -whylive
- **Applies to:** Operational systems, trading and finance, regulated industries, and anything with rare manual procedures.
- **When not to apply / counterpoints:** In high-churn codebases, Googlers find the "dead for six months" heuristic very reliable (UncleMeat: "I do occasionally reject the sensenmann CLs, but only very very rarely"), and the code stays recoverable from version control.
- **Fix risk:** high

### T07-F19 — Remove commented-out code blocks, but review each hit by hand
Detectors of commented-out code have known false positives on comments that happen to parse as code. Keep code samples in docstrings and documentation comments.

- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:** Ruff and eradicate both call commented-out code dead code that should be removed, and both admit false positives. Removing it changes no behaviour, but any notes about intent in those lines are lost.
- **Evidence:**
  - [ERA001 commented-out-code](https://docs.astral.sh/ruff/rules/commented-out-code/) — Astral (Ruff), 2026 — official_docs — "Commented-out code is dead code, and is often included inadvertently. It should be removed."; known problem: false positives on comments that resemble Python code (issue #4845) — confirmed.
  - [eradicate README](https://github.com/PyCQA/eradicate) — PyCQA, 2026 — official_docs — "Eradicate removes commented-out code from Python files."; "False positives can happen"; `--whitelist` / `--whitelist-extend` — confirmed.
- **Detect:**
  - Python: `ruff check --select ERA001`, or `eradicate --in-place` after review.
  - Other languages: a grep heuristic such as `grep -nE '^\s*(//|#)\s*[A-Za-z_][A-Za-z0-9_.]*\s*(\(|=|\{)'` (a heuristic, not a standard), with every hit reviewed.
  - deadcode (Python) DC12.
- **Tools:** ruff ERA001, eradicate, deadcode (Python)
- **Applies to:** All languages (tool support is strongest in Python).
- **When not to apply / counterpoints:** The evidence is tool-author guidance only; no empirical study was retrieved. SonarSource's rule S125 was not verified.
- **Fix risk:** low

## Practitioner voice

- [Googlers on Sensenmann (HN)](https://news.ycombinator.com/item?id=35755841) — UncleMeat: "'This code has been dead for six months' is a _very_ good heuristic that the code is not relevant. I do occasionally reject the sensenmann CLs, but only very very rarely." Xorlev: "it's in version control forever."
- [Pushback on usage-based deletion (same thread)](https://news.ycombinator.com/item?id=35755841) — kortilla: deletion by usage removes code "only called in rare but critical cases: during outage, at end of year, during audits", and "There are industries where this mindset is _business ending_". lrem (a Googler): a "stop the robot uprising" button, pressed every couple of years, whose code "looks dead for all intents and purposes".
- [Ask HN: Python dead-code detection (2026)](https://news.ycombinator.com/item?id=46866141) — Tools must choose between missing dead code and false positives "that people stop trusting". The culprits named are getattr/registries, Flask/FastAPI/Django/pytest conventions, and decorators. The poster builds a competing tool (skylos).
- [swynx on the same thread](https://news.ycombinator.com/item?id=47050014) — A vendor of the Swynx scanner. "Delete it and see if tests break" burns CI time and erodes trust. Check file-level reachability first, then exports. A module-level `__getattr__` is a "sleeper problem". A tool flagged its own pytest plugin hooks as unused at 60% confidence.
- [benrutter on "On Bloat" (HN, 2025-02-14)](https://news.ycombinator.com/item?id=43048828) — "Even using neat tools like Vulture, dead code elimination is a mostly manual, care-requiring task."
- [Mozilla bug 1235717](https://bugzilla.mozilla.org/show_bug.cgi?id=1235717) — Firefox 46 enabled Clang's `-Wunreachable-code`. The obstacles were false positives from platform `#ifdef`s and hundreds of `-Wunreachable-code-break` warnings in generated IDL bindings. GCC dropped the warning in 2010 because its results varied with the `-O` level.
- [LKML perf thread (2025)](https://lkml.iu.edu/hypermail/linux/kernel/2504.1/08119.html) — Ian Rogers: Clang's warning catches "goto fail"-style bugs. Maintainer Namhyung Kim: "I'm not sure if it's useful … The proposed changes don't look like an improvement."
- [depcheck #673](https://github.com/depcheck/depcheck/issues/673) — depcheck flagged "pretty much all dependencies and devDependencies as unused" in a React Native/TS project. Closed as wontfix; the project was archived in 2025.
- [How I cleaned up our codebase with Knip (dev.to, 2025-06-29)](https://dev.to/rkhaslarov/how-i-cleaned-up-our-codebase-with-knip-and-why-you-should-too-41mg) — Rufat Khaslarov's team "removed around 3.5k lines of code at once", then ran Knip on every PR.
- [cargo-machete author's post (2022)](https://bouvier.cc/tech/cargo-machete/) — udeps needs a nightly compile of the whole crate. Machete's regex scan takes about 1 s on rust-lang/rust. One work project saw "a 5% compile time speedup overall". Macros and build scripts cause false positives.
- [Knightmare (Doug Seven, 2014)](https://dougseven.com/2014/04/17/knightmare-a-devops-cautionary-tale/) — Code "dead for 8-years was still present in the code base", and a repurposed flag switched it back on.
- [Knip false-positive issues](https://github.com/webpro-nl/knip/issues?q=is%3Aissue+false+positive) — #1930 (compiler registration not workspace-aware in monorepos), #2024 (Yarn PnP npm aliases reported as unused since 6.27.0), #1951–#1953 (vitest reporter paths flagged as unlisted dependencies). **All are now closed.** They show that Knip releases regress now and then, so pin the version and read the report.
- [Effective TypeScript: use knip (2023)](https://effectivetypescript.com/2023/07/29/knip/) — Dan Vanderkam switched his recommendation from ts-prune to Knip. ts-prune missed unused dependencies, mutually recursive dead code and test-only liveness, and at the time it was "in maintenance mode and won't be receiving updates".

## Contradictions and open questions

**Contradictions**
- **ts-prune status.** Knip's comparison page (fetched 2026-09-23) still says ts-prune "is archived and recommends Knip", and Effective TypeScript (2023) called it "in maintenance mode". The current README says it "has been resurrected after a long hiatus", requires Node >= 22.18 and TypeScript 6.0.3, and the repo is not archived. Treat it as maintained again, but it still only finds unused exports.
- **cargo-udeps viability.** The cargo-shear README's "Prior Art" section says cargo-udeps "does not seem to work anymore with the latest versions of `cargo`" and "does not work with cargo workspaces". The cargo-udeps README documents a workspace-level ignore (`[workspace.metadata.cargo-udeps.ignore]`) and ongoing use (Nushell, Servo, Crater). This is a competitor's claim that was not tested independently.
- **Go deadcode soundness.** The Go blog (2023) says a function reported dead "cannot be called even through these dynamic mechanisms", which implies only false negatives. The current command doc says it does not understand `//go:linkname`, that results hold for one GOOS/GOARCH/tags configuration only, and that a reported function is not "unconditionally safe to delete". In practice, false "dead" reports are possible.
- **Meta SCARF numbers.** The 2023 blog says SCARF deleted more than 100M lines "five years on", across more than 370,000 change requests. The ESEC/FSE 2023 abstract attaches "deleted over 104 million lines of code" to "In the last year alone". Cite ">100M lines" without a time frame, or cite each source separately.
- **Automated deletion based on usage.** Googlers find "dead for six months" very reliable and rarely reject Sensenmann changes. Others (kortilla, lrem) describe rare but critical paths that look dead, and call the mindset "business ending" in some industries.
- **Value of Clang's `-Wunreachable-code`.** Ian Rogers (LKML 2025) and Mozilla (enabled in Firefox 46) find it valuable. Namhyung Kim (perf maintainer) doubts it, and Firefox hit hundreds of warnings in generated code.
- **Tests as the safety net.** HN user shoo calls high coverage essential. swynx says delete-and-test erodes trust. Hejderup & Gousios measured coverage of 58% of direct and 20% of transitive dependency calls. Piranha's diffs passed tests more than 85% of the time, yet only 65% landed without changes.
- **"Certain" does not mean "safe to remove".** vulture's 100% tier includes unused function arguments. clang-tidy `misc-unused-parameters` removes a parameter only when every caller is in the same translation unit, and offers `IgnoreVirtual`. rustc warns that removing never-read fields can change drop and auto-trait behaviour.
- **ESLint vs TS on unreachable code.** ESLint says `no-unreachable` is "safe to disable when using TypeScript". TS only errors on unreachable code when `allowUnreachableCode: false`; the default only gives editor suggestions.
- **Ruff F401 "safe" fix vs side-effect imports (verifier's reasoning).** Ruff classifies F401 removal outside `__init__.py` as safe. An import kept only for a registration side effect is still flagged and would be removed. That is why T07-F21 was narrowed.

**Open questions**
- No peer-reviewed false-positive or false-negative rates were found for Knip, vulture, deadcode (Python), cargo-shear, cargo-machete or deptry on real projects. The only figure found (~1.7%, swynx) is a vendor's self-report.
- Cross-language platforms were not verified: SonarQube rules (S1144, S125) were not reachable during research, and Semgrep was not researched.
- Per-function `--gc-sections` needs `-ffunction-sections`/`-fdata-sections`. This was not verified from GCC docs.
- The docs for rustc's `unused_crate_dependencies` lint could not be retrieved (the page was truncated), so its false-positive profile compared with cargo-shear, machete and udeps is unknown.
- How much runtime evidence should a hardening agent require before deleting a rare path in a finished project with no telemetry? Google and Meta rely on runtime logs that small projects lack.
- LLM-based dead-code triage (the DCE-LLM paper, NAACL 2025, was cited by the researcher but **not verified here**). It is unclear whether the agent should use it on top of deterministic tools.
- Java, Kotlin, C#/.NET and PHP tools for dead code inside the code (IntelliJ inspections, R8/ProGuard usage reports, Roslyn IDE0051/IDE0005, PHPStan) were not covered. Only Maven dependency tools were verified.
- The empirical evidence that dead code is harmful comes mostly from one research group and from Java desktop apps. No independent replication in other ecosystems was found.
- Go blank imports (`import _ "pkg"`) as side-effect imports are general knowledge; they were not verified in this task.

## Dropped findings

None. All 23 findings had real, reachable sources that supported the core claim. One finding was downgraded (T07-F18, A to B). Nine were corrected:
- T07-F02: closed Knip issues described as open; tsr date added; ts-prune revived
- T07-F03: "undefined default" applied to the wrong options
- T07-F08: gopls module version
- T07-F10: misc-unused-parameters quote; cppcheck flag verified
- T07-F11: IWYU pragma support moved to the clangd design page
- T07-F15: Hejderup is a journal paper
- T07-F17: Fowler article date
- T07-F21: rule narrowed so it no longer conflicts with T07-F06
- T07-F22: Slither description and recommendation fields swapped
