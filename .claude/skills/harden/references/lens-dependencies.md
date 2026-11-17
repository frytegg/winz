# Lens: Dependencies

> Finds third-party dependency problems: declared versus used packages, lockfiles and constraints, vulnerable, stale or abandoned packages, install and CI hardening, authenticity, necessity, vendoring and licences.
> Read when: the scope contains a dependency manifest or lockfile, a CI workflow or a Dockerfile, or source files import third-party packages with no manifest (DP-02 then runs through its manual path and reports the missing manifest).

## Contents

- Procedure
- Rules: DP-01 to DP-03 (declared versus used), DP-04 to DP-08 (lockfiles, constraints, duplicates), DP-09 to DP-11 (vulnerabilities, upgrades, freshness), DP-12 to DP-15 (install, CI and supply-chain hardening), DP-16 to DP-19 (abandonment, necessity, vendoring, licences)
- False-positive exclusions
- Evidence limits

## Procedure

You are a fresh-context, read-only lens subagent working on the slice the orchestrator gave you (detection step 8). You return candidates only. Your tools are Read, Grep and Glob: never edit or write a file and never run a command. A detector whose output is missing from `.harden/tools/` becomes a limit line in your coverage note, not a guess.

1. **Load context.** Read `.harden/inventory.json` (manifests, lockfiles, languages, CI files, vendor directories) and `.harden/config.json` (scope, exclude globs).
   - For each detected language, read its language file. The exact pinned commands are in its "Dead code & dependencies" section.
   - JVM and .NET have no language file. Use the commands in the Detect bullets below instead.
   - Work on the baseline checkout. The orchestrator records every tool version for `tool_versions` and saves raw outputs under `.harden/tools/`.
2. **Stay read-only.** Never edit, install, update, tidy, dedupe or fix anything. The orchestrator's detector runs keep the same limits; in particular, nobody runs these in this pass:
   - any form of `npm audit fix`;
   - `go mod tidy` without `-diff`;
   - `cargo machete --with-metadata`, which may modify `Cargo.lock`, anywhere but a disposable git worktree of the run's repository (RS-15, PF-21);
   - any dedupe other than `npm find-dupes` or `pnpm dedupe --check`;
   - `osv-scanner --call-analysis=rust|all`, which runs dependency `build.rs` scripts (native Windows has no sandbox).

   Never add `ignore*` entries to silence a detector.
3. **Classify each manifest.** Decide whether it is an application/service or a published library, and whether it is a workspace root or member. Record the evidence: manifest fields, release config, README. If you cannot tell, treat it as a library for DP-04 and DP-07.
4. **Detector commands for each language family (run by the orchestrator in detection step 4; read their outputs from `.harden/tools/`).** In an unseeded pass (DT-21), skip them. Tools and rule ids:
   - **JS/TS:**
     - knip issue types `dependencies`, `unlisted`, `unresolved` and `binaries`, then `--production --strict`;
     - `npm audit`, runtime scope first, then the full tree;
     - `npm find-dupes` or `pnpm dedupe --check`;
     - lockfile-lint (npm and yarn only) and `npm audit signatures`;
     - @e18e/eslint-plugin `ban-dependencies`;
     - not depcheck, which is archived.
   - **Python:** deptry DEP001–DEP005, pip-audit, `pip check`, pipdeptree, `uv lock --check`.
   - **Rust:** cargo-machete confirmed by cargo-udeps (nightly); cargo-deny `advisories`, `bans`, `licenses` and `sources`; `cargo tree -d` and `cargo tree -i`.
   - **Go:** `go mod tidy -diff` (Go 1.23+) and govulncheck.
   - **JVM:** `mvn dependency:analyze`, DepClean, Gradle `buildHealth`.
   - **.NET:** `dotnet package list` (.NET 10+) or `dotnet list package` (earlier SDKs), with `--vulnerable`, `--outdated`, `--deprecated` and `--include-transitive`.
   - **Any ecosystem:**
     - osv-scanner, for vulnerabilities and licences;
     - OpenSSF Scorecard checks Pinned-Dependencies, Dependency-Update-Tool, Maintained and License;
     - the libyear family;
     - the ripgrep patterns in DP-04 and DP-13, run over CI files and Dockerfiles (you can also run these through the Grep tool);
     - `git ls-files` (DP-04), `git log -- <lockfile>` (DP-05), the jq filter of DP-06, and the registry queries of DP-15 and DP-16.
5. **Do the manual checks.** Run `rg` patterns through the Grep tool. Registry queries (`npm view`, `pip index versions`, `cargo search`, `go list -m`) and `git log` are detector commands: read their output from `.harden/tools/` or list them as not run.
   - the DP-01 search, for every unused hit;
   - registry metadata (DP-15) and maintenance status (DP-16), for each direct runtime dependency;
   - bot config (DP-14) and install-hardening config (DP-12);
   - the comments on overrides, resolutions, `[patch]` and `replace` entries (DP-08);
   - vendor directories (DP-18);
   - `git log -- <lockfile>`, looking for lockfile changes that no manifest change explains (DP-05);
   - with no manifest at all, the DP-02 manual path.
6. **Return candidates in the findings schema, plus files_read, as your final message; the orchestrator merges them** into `.harden/candidates.json`. files_read lists every file you read with its line ranges (DT-02). Follow `assets/findings.schema.json`:
   - Set `lens: "dependencies"`, `rule_ref: "DP-NN"`, `verified: false` and `status: "candidate"`.
   - Point `file`/`line` at the manifest line that declares the dependency. Exceptions: a phantom dependency points at its import site, a lockfile source at the lockfile line, and a CI pin at its `uses:` or `FROM` line.
   - Record evidence of kind `tool` (the command and an output excerpt) and kind `source` (the file:line of each manual check).
   - Take tier, class and fix risk from the rule. A semver-major upgrade is always T2, and no dependency change is T0.
   - Write one candidate per dependency.
   - Give detector-only hits `confidence: "needs_review"`, because these detectors have no published false-positive rates.
   - In `notes`, name the proof the apply phase must run (DP-01, DP-03, DP-10), and for any T1 change to a manifest or lockfile, the paths the orchestrator must record with `run_state.py allow-config-edit` once the item is approved (SKILL.md invariant 2).
7. **Stop at candidates.** A separate verification stage re-runs the tools and checks every file:line. End your message with a coverage note: files read, detector outputs used and missing, rules not checked and why.

## Rules

### DP-01 — Remove an unused declared dependency only on three independent signals
- **Rule:** Propose a removal only when three signals agree. (a) A detector flags the dependency. (b) A manual search of config files, package scripts, Dockerfiles, CI, docs and string-based loading finds no use. (c) The apply phase shows that a clean frozen install, build, tests and a production start or smoke run all pass without it, in a fresh clone of the run's repository at the item's commit (PF-21). Remove one dependency per commit. The removal runs only after the item is approved and the orchestrator records `run_state.py allow-config-edit <manifest or lockfile> --reason <finding id>` (SKILL.md invariant 2); without that record the hook and diff_guard refuse it.
- **Detect:** knip issue type `dependencies` (covers dependencies and devDependencies). deptry DEP002 (unused) and DEP005 (stdlib declared). cargo-machete (fast, imprecise), with each hit confirmed by `cargo +nightly udeps`. `go mod tidy -diff` (Go 1.23+; non-zero exit when not tidy). `mvn dependency:analyze -DfailOnWarning=true` or `mvn test-compile se.kth.castor:depclean-maven-plugin:2.2.0:depclean`. `./gradlew buildHealth`. Then run `rg -n '<pkg>'` over `*.config.*`, `.babelrc`, tsconfig, pyproject `[tool.*]`, package scripts, Dockerfiles, CI YAML and docs, and look for `require(variable)`, importlib, `Class.forName`, plugin names and entry points.
- **Not when:** A false-positive exclusion below applies. The dependency is optional or a peer that a published library keeps for its consumers. The finding is Maven transitive bloat (57% of relationships in Soto-Valero 2021): fix that with exclusions, not by deleting declarations.
- **Tier:** T1 · **Class:** structural · **Fix risk:** medium · **Grade:** A
- **Source:** [Bloated Dependencies in Maven](https://arxiv.org/abs/2001.07808) (Soto-Valero et al., EMSE 2021: 2.7% of 723,444 Maven relationships are unused direct declarations; 36% of 9,639 artifacts have at least one; 18 of 21 answered removal PRs were merged); [Dependency Smells in JavaScript Projects](https://arxiv.org/abs/2010.14573) (Jafari et al., IEEE TSE 2022: an unused dependency in 915 of 1,146 JS projects, detected with depcheck); [OWASP A03:2025](https://top10.owasp.org/2025/A03_2025-Software_Supply_Chain_Failures) (OWASP, 2025); [Knip handling issues](https://knip.dev/guides/handling-issues) (Knip); [depcheck, archived](https://github.com/depcheck/depcheck) (2025); [cargo-machete](https://github.com/bnjbvr/cargo-machete); [cargo-udeps](https://github.com/est31/cargo-udeps); [Maven dependency:analyze](https://maven.apache.org/plugins/maven-dependency-plugin/analyze-mojo.html); [DepClean](https://github.com/ASSERT-KTH/depclean); [go mod tidy](https://pkg.go.dev/cmd/go#hdr-Add_missing_and_remove_unused_modules) · dossier: dependency-hygiene T16-F01; eval-v1-calibration E01-F10

### DP-02 — Declare every package the code imports directly
- **Rule:** Declare every directly imported package, and never rely on it arriving transitively (a "phantom" dependency). Use a constraint that admits the currently resolved version, so the lockfile does not move. In a published library, a runtime import satisfied only by a devDependency breaks consumers: declare it as a runtime dependency. The declaration runs only after the item is approved and the orchestrator records `run_state.py allow-config-edit <manifest or lockfile> --reason <finding id>` (SKILL.md invariant 2); without that record the hook and diff_guard refuse it.
- **Detect:** knip issue types `unlisted`, `unresolved` and `binaries`. deptry DEP001 (missing) and DEP003 (transitive). `mvn dependency:analyze` ("used and undeclared"). Gradle `buildHealth` (used transitive). Additions in `go mod tidy -diff`. To find the version to declare: `npm ls <pkg> --all`, `pnpm why <pkg>`, `cargo tree -i <crate>`, `pipdeptree --reverse --packages <pkg>`. Manual path when source files import packages and no manifest exists (these detectors then have nothing to read): list the imports with the Grep tool (`^\s*(import|from)\s` in `*.py`; `require\(|from ['"]` in `*.js`/`*.ts`), drop standard-library and local modules by hand, and report the missing manifest as one T2 report-only candidate naming the packages, because creating a manifest and lockfile resolves versions afresh (DP-04).
- **Not when:** The hit is a config-loaded plugin reported as missing, a known depcheck-era false positive; confirm it by hand. The Python distribution name differs from the module name: configure deptry's mapping instead (reasoning, unsourced). A framework meta-package re-exports the sub-package (reasoning, unsourced).
- **Tier:** T1 · **Class:** structural · **Fix risk:** low · **Grade:** B
- **Source:** [Phantom dependencies](https://rushjs.io/pages/advanced/phantom_deps/) (Rush, Microsoft); [Knip handling issues](https://knip.dev/guides/handling-issues); [deptry rules](https://deptry.com/rules-violations/); [Dependency Analysis Gradle Plugin](https://github.com/autonomousapps/dependency-analysis-gradle-plugin); [Dependency Smells](https://arxiv.org/abs/2010.14573) (Jafari et al., IEEE TSE 2022: a missing dependency in 729 of 1,146 JS projects, detected with depcheck); [pipdeptree](https://github.com/tox-dev/pipdeptree) · dossier: dependency-hygiene T16-F02

### DP-03 — Put each dependency in the section where it runs, and prove the split
- **Rule:** Classify each dependency by where it runs: runtime, or dev/build/test. On the JVM, also check `api` vs `implementation` vs `compileOnly`. Move misclassified entries, and prove every move in the apply phase: do a production-only install in a fresh clone of the run's repository at the item's commit (PF-21; `npm ci --omit=dev` or the ecosystem equivalent), then run the real start command or smoke test. Moving a package to devDependencies is not a fix for a vulnerability alert; scope the audit instead (DP-09). The move runs only after the item is approved and the orchestrator records `run_state.py allow-config-edit <manifest or lockfile> --reason <finding id>` (SKILL.md invariant 2); without that record the hook and diff_guard refuse it.
- **Detect:** deptry DEP004 (a dev dependency that should be regular). `knip --production --strict`: any unlisted item means runtime code imports a devDependency. Gradle `buildHealth` (wrong configuration). Manually, look for build tools declared as runtime dependencies.
- **Not when:** The project is a bundled front-end, the setting of the ASE 2022 study, where the split mostly affects tooling, audit scope and image size, not runtime correctness. A framework needs "dev-looking" packages at build time inside the image. Never claim that a move reduces install-time malware risk, which applies to every section.
- **Tier:** T1 · **Class:** structural · **Fix risk:** medium · **Grade:** B
- **Source:** [Not All Dependencies are Equal](https://arxiv.org/abs/2207.14711) (Latendresse et al., ASE 2022, 100 bundled JS projects: in the body's Finding 4, 28.2% of the dependencies shipped in production bundles are declared as devDependencies); [deptry rules](https://deptry.com/rules-violations/); [Knip production mode](https://knip.dev/features/production-mode); [npm audit: Broken by Design](https://overreacted.io/npm-audit-broken-by-design/) (Abramov, 2021); [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci) (npm v11) · dossier: dependency-hygiene T16-F03; eval-v1-calibration E01-F10

### DP-04 — Applications commit the lockfile and install in frozen mode
- **Rule:** Report an application or service that does not commit a lockfile matching the manifest, and CI or deploy steps that do not install in frozen or locked mode (the mode in which drift fails the install). Propose the committed lockfile and the frozen install commands. Never delete and regenerate a lockfile as "cleanup": regeneration moves every transitive version at once. Local gates cannot prove workflow edits, and creating or regenerating a lockfile is a lockfile edit, so these stay proposals (SE-22 reports the same gap).
- **Detect:** `git ls-files | grep -E '(package-lock.json|pnpm-lock.yaml|yarn.lock|uv.lock|poetry.lock|pylock(\.[^.]+)?\.toml|Cargo.lock|go.sum|packages.lock.json)'`. Check that `.gitignore` does not exclude the lockfile. `rg -nP 'npm install|pip install -r|uv sync(?!.*--locked)' .github Dockerfile*`; the locked alternatives are `npm ci`, `uv sync --locked`, `uv lock --check` and `pip install --require-hashes -r`. pnpm is already frozen by default in CI when a lockfile exists, so flag only an explicit `--no-frozen-lockfile`.
- **Not when:** The project is a library. Library lockfiles are unresolved: the archived OpenSSF npm guide says library CI should ignore the lockfile, the Cargo team (2023) says do what is best and add scheduled latest-dependency tests, and Snyk (2019) says avoid them. Report; do not auto-fix. The project is a Go module: go.mod plus minimal version selection plays the lockfile role. The project has no lockfile at all: creating one fixes a fresh resolution, which is a behaviour change the owner makes with full gates.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** low · **Grade:** A
- **Source:** [Pinning Is Futile](https://www.cs.cmu.edu/~ckaestne/pdf/fse25.pdf) (He, Vasilescu, Kästner, FSE 2025); [npm package-lock.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json); [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci); [pnpm install](https://pnpm.io/cli/install); [OpenSSF npm guide](https://github.com/ossf/package-manager-best-practices/blob/main/published/npm.md) (v1.1, archived 2023); [Cargo lockfile guidance](https://blog.rust-lang.org/2023/08/29/committing-lockfiles/) (Cargo team, 2023); [PEP 751](https://peps.python.org/pep-0751/) (2025); [uv sync](https://docs.astral.sh/uv/concepts/projects/sync/); [pip secure installs](https://pip.pypa.io/en/stable/topics/secure-installs/); [Dependency Smells](https://arxiv.org/abs/2010.14573) (Jafari et al., IEEE TSE 2022: no lockfile in 304 of 1,146 JS projects) · dossier: dependency-hygiene T16-F04

### DP-05 — Treat lockfile content and lockfile diffs as security-relevant
- **Rule:** Report every resolved package that does not come from the expected registry over HTTPS with an integrity hash. Report every git, URL, file or tarball source, and every lockfile change that no manifest change explains. Apply the same review rule to the pass's own commits.
- **Detect:** `lockfile-lint --path package-lock.json --allowed-hosts npm --validate-https --validate-integrity` (for yarn, `--allowed-hosts npm yarn`; npm and yarn lockfiles only). `rg -nP '"resolved": "(?!https://registry\.npmjs\.org/)' package-lock.json`. `rg -n '(git\+|github:|file:|https?://[^\s]*\.tgz)' package.json *.lock pnpm-lock.yaml`. For pnpm, check that `blockExoticSubdeps` is not set to false (added in v10.26.0; default true). `cargo deny check sources`. `npm audit signatures`.
- **Not when:** The git or URL dependency is deliberate, such as an unreleased upstream fix or an internal fork; report it as "document and time-box". The source is a private registry mapped to a claimed internal scope (DP-15).
- **Tier:** T2 · **Class:** report-only · **Fix risk:** low · **Grade:** C
- **Source:** [npm lockfiles as a security blindspot](https://snyk.io/blog/why-npm-lockfiles-can-be-a-security-blindspot-for-injecting-malicious-modules/) (Snyk, Liran Tal, 2019); [lockfile-lint](https://github.com/lirantal/lockfile-lint/tree/main/packages/lockfile-lint); [pnpm dependency resolution](https://pnpm.io/settings/dependency-resolution); [npm audit](https://docs.npmjs.com/cli/v11/commands/npm-audit); [cargo-deny sources](https://embarkstudios.github.io/cargo-deny/checks/sources/index.html) · dossier: dependency-hygiene T16-F05

### DP-06 — In an application, the lockfile freezes the graph and the manifest has no open specifiers
- **Rule:** In an application, the committed lockfile freezes the whole graph; manifest pins are optional. Replace `*`, `latest`, `x`, unbounded `>=`, git-branch and URL specifiers with a constraint that admits the currently locked version, then verify that no resolved version in the lockfile changed. The edit runs only after the item is approved and the orchestrator records `run_state.py allow-config-edit <manifest or lockfile> --reason <finding id>` (SKILL.md invariant 2); without that record the hook and diff_guard refuse it.
- **Detect:** npm: `jq -r '(.dependencies//{}),(.devDependencies//{}) | to_entries[] | select(.value|test("^(\\*|latest|x|>=|git|github:|https?:|file:)")) | "\(.key) \(.value)"' package.json`. Python applications: confirm that `uv.lock`, `poetry.lock` or `pylock.toml` exists. Rust: `cargo deny check bans` with `wildcards = "deny"` (the default is warn). Go: check only for `replace` directives that point at local paths.
- **Not when:** There is no lockfile yet: report DP-04 instead, because DP-06 needs a committed lockfile to prove nothing moved. The URL specifier is deliberate (DP-05). On pinning, CISA (2025) and Snyk (2022) say pin. He et al. show that pinning only direct dependencies is futile, and can even be harmful, in npm graphs of 498 or more dependencies (26% of repositories in their dataset). The resolution: the lockfile freezes the tree. This result is npm-specific.
- **Tier:** T1 · **Class:** structural · **Fix risk:** medium · **Grade:** B
- **Source:** [Pinning Is Futile](https://www.cs.cmu.edu/~ckaestne/pdf/fse25.pdf) (FSE 2025); [Renovate: dependency pinning](https://docs.renovatebot.com/dependency-pinning/); [Semantic Versioning Will Not Save You](https://hynek.me/articles/semver-will-not-save-you/) (Schlawack, 2021); [Dependency Smells](https://arxiv.org/abs/2010.14573) (Jafari et al., IEEE TSE 2022); [cargo-deny bans](https://embarkstudios.github.io/cargo-deny/checks/bans/cfg.html) · dossier: dependency-hygiene T16-F06

### DP-07 — In a library, use compatible ranges and no caps without a known break
- **Rule:** In a published library, report runtime dependencies that have any of these: an exact pin consumers cannot override, an upper cap with no known-broken version behind it, or a `*`, `latest`, unbounded `>=`, git or URL specifier. Never change a published library's ranges in the pass, because consumers cannot fix an over-restrictive cap.
- **Detect:** Python: `==` pins and `<` caps in `[project].dependencies`. npm: the DP-06 jq filter. Rust: cargo-deny `wildcards`.
- **Not when:** The entry is a library devDependency; Renovate allows those to be pinned. The cap excludes a version known to be broken.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** medium · **Grade:** B
- **Source:** [Renovate: dependency pinning](https://docs.renovatebot.com/dependency-pinning/); [PyPA install_requires vs requirements](https://packaging.python.org/en/latest/discussions/install-requires-vs-requirements/); [Upper bound version constraints](https://iscinumpy.dev/post/bound-version-constraints/) (Schreiner, 2021); [Semantic Versioning Will Not Save You](https://hynek.me/articles/semver-will-not-save-you/) (2021); [Dependency Smells](https://arxiv.org/abs/2010.14573) (Jafari et al., IEEE TSE 2022, 1,146 JS projects: pinned 52.2%, URL 10.2%, restrictive 9.2%) · dossier: dependency-hygiene T16-F06

### DP-08 — Converge duplicate versions only within declared ranges
- **Rule:** Report packages resolved at more than one version, and find which dependent holds the old copy. Converge only through an in-range upgrade of that dependent, one per commit, and only after the item is approved and the orchestrator records `run_state.py allow-config-edit <manifest or lockfile> --reason <finding id>` (SKILL.md invariant 2); without that record the hook and diff_guard refuse it. Never force convergence with overrides, resolutions or `[patch]` outside a dependent's range, and report every override, resolution, `[patch]` or Go `replace` that has no comment explaining why.
- **Detect:** Rust: `cargo tree -d`, then `cargo tree -i <crate>`, plus `cargo deny check bans` (`multiple-versions`). npm: `npm find-dupes`, then `npm ls <pkg> --all`. pnpm: `pnpm dedupe --check`, then `pnpm why <pkg>`. Python: `pip check` and pipdeptree's conflict warnings. .NET: `dotnet package list --include-transitive` (`dotnet list package` on earlier SDKs).
- **Not when:** The duplicates span semver-major lines and are waiting for an upstream upgrade. The duplicates are npm nested copies, which npm tolerates by design. Google's One Version Rule targets a single-graph monorepo, so do not apply it outside one. Remember that dedupe changes transitive versions: run full gates.
- **Tier:** T1 · **Class:** behavioural · **Fix risk:** medium · **Grade:** B
- **Source:** [The One Version Rule](https://opensource.google/documentation/reference/thirdparty/oneversion) (Google); [cargo tree](https://doc.rust-lang.org/cargo/commands/cargo-tree.html); [npm dedupe](https://docs.npmjs.com/cli/v11/commands/npm-dedupe); [pnpm dedupe](https://pnpm.io/cli/dedupe); [npm overrides](https://docs.npmjs.com/cli/v11/configuring-npm/package-json); [SWE at Google ch. 21](https://abseil.io/resources/swe-book/html/ch21.html) (Winters, 2020); [pip check](https://pip.pypa.io/en/stable/cli/pip_check/) · dossier: dependency-hygiene T16-F07

### DP-09 — Scan all dependencies for known vulnerabilities, triage by scope and reachability, fix minimally
- **Rule:** Scan direct and transitive dependencies. Rank runtime alerts first, then by reachability where the tool supports it. Fix each alert with the lowest fixed version inside the declared range, one dependency per commit, and never run bulk force fixes (`npm audit fix --force` installs semver-major changes). A fix that needs a semver-major upgrade is T2: report it. The upgrade runs only after the item is approved and the orchestrator records `run_state.py allow-config-edit <manifest or lockfile> --reason <finding id>` (SKILL.md invariant 2); without that record the hook and diff_guard refuse it.
- **Detect:** `osv-scanner scan source -r .`; `govulncheck ./...`; `pip-audit -r requirements.txt`; `npm audit --omit=dev --audit-level=high`, then a separate full audit; `cargo deny check advisories`; `dotnet package list --vulnerable --include-transitive` (`dotnet list package` on earlier SDKs); in PR CI, dependency-review-action with `fail-on-scopes: runtime`.
- **Not when:** The alert is on a build-tool-only dependency: lower its priority but keep it, because install-time malware still matters. Outside Go, reachability is not production-grade, so treat "not reachable" as unproven; critical runtime vulnerabilities still get the upgrade.
- **Tier:** T1 · **Class:** behavioural · **Fix risk:** medium · **Grade:** A
- **Source:** [Do Developers Update Their Library Dependencies?](https://arxiv.org/abs/1709.04621) (Kula et al., EMSE 2017, 4,600+ projects: 81.5% keep outdated dependencies; 69% of interviewees were unaware of their vulnerable ones); [Counting Those That Matter](https://arxiv.org/abs/1808.09753) (Pashchenko et al., ESEM 2018, 200 SAP Java libraries: about 20% of vulnerable dependencies not deployed, 81% fixable by updating); [Go vulnerability management](https://go.dev/doc/security/vuln/); [OSV-Scanner](https://google.github.io/osv-scanner/usage/scan-source); [pip-audit](https://github.com/pypa/pip-audit); [npm audit](https://docs.npmjs.com/cli/v11/commands/npm-audit); [dependency-review-action](https://github.com/actions/dependency-review-action); [npm audit: Broken by Design](https://overreacted.io/npm-audit-broken-by-design/) (2021) · dossier: dependency-hygiene T16-F08

### DP-10 — One upgrade per commit, and treat every upgrade as potentially breaking
- **Rule:** Make each upgrade commit cover one dependency or one coherent family. It touches only the manifest, the lockfile and minimal adaptation code, is never mixed with refactors, and passes the full build, tests, production build and start, even for a patch or minor bump. Majors are T2; when you report one, recommend stepping one major at a time after reading the changelog. If the project's tests are weak, limit the pass to security-driven upgrades. Each upgrade runs only after the item is approved and the orchestrator records `run_state.py allow-config-edit <manifest or lockfile> --reason <finding id>` (SKILL.md invariant 2); without that record the hook and diff_guard refuse it.
- **Detect:** Run `git log --stat` over the pass's own commits. Flag any upgrade commit that touches more than the manifest, the lockfile and minimal adaptation code, bumps several unrelated majors, or mixes in a refactor. Renovate's equivalent is `:separateMultipleMajorReleases`.
- **Not when:** Extreme caution builds technical lag. Ochoa et al. found that 83.4% of 119,879 Maven upgrades comply with SemVer and that only 7.9% of 293,817 clients are affected, so do not withhold a security fix whose gates are green.
- **Tier:** T1 · **Class:** behavioural · **Fix risk:** high · **Grade:** B
- **Source:** [Renovate upgrade best practices](https://docs.renovatebot.com/upgrade-best-practices/); [Semantic Versioning Will Not Save You](https://hynek.me/articles/semver-will-not-save-you/) (2021); [SWE at Google ch. 21](https://abseil.io/resources/swe-book/html/ch21.html) (Hyrum's Law); [Breaking Bad?](https://arxiv.org/abs/2110.07889) (Ochoa et al., EMSE 2022); [BUMP](https://arxiv.org/abs/2401.09906) (SANER 2024: 571 breaking updates from 153 Java projects) · dossier: dependency-hygiene T16-F16, T16-F08

### DP-11 — Report freshness as a baseline, never as a target
- **Rule:** Report a table with, for each dependency: scope, current version, latest version, majors behind, libyears and known CVEs. Use it to prioritise. Never bulk-upgrade to latest in a hardening pass.
- **Detect:** The libyear family: `npx libyear@<x.y.z>`, pylibyear, `cargo libyear`, go-libyear, libyear-maven-plugin. Also `npm outdated`, `cargo outdated` and `pip list --outdated`, and `dotnet package list --outdated` (`dotnet list package --outdated` on .NET 9 and earlier).
- **Not when:** Do not treat freshness as security: floating to the newest releases raises exposure to malicious ones. Libyear also penalises stable, feature-complete libraries.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** low · **Grade:** B
- **Source:** [Libyear](https://libyear.com/); [2026 OSSRA](https://www.blackduck.com/resources/analyst-reports/open-source-security-risk-analysis.html) (Black Duck, 947 commercial codebases: 92% contain components 4 or more years out of date); [Dependency abandonment](https://www.cs.cmu.edu/~ckaestne/pdf/icse25_abandonment.pdf) (ICSE 2025, citing Decan: about 14 months for 50% of projects to install a patch); [Dependency drift fitness function](https://www.thoughtworks.com/radar/techniques/dependency-drift-fitness-function) (Thoughtworks); [dotnet package list](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-package-list) · dossier: dependency-hygiene T16-F17; eval-v1-calibration E01-F10

### DP-12 — Harden the install path: release-age delay, scripts off with an allowlist, no trust downgrades
- **Rule:** Check that installs apply three protections: a minimum release age (cooldown) with an exclude path for urgent security fixes, dependency lifecycle scripts run only from an allowlist, and a failure on trust downgrades where the package manager supports it. Report any explicit project setting that weakens them. Propose a delay value but never impose one: pnpm uses 1 day, Dependabot 3 and Renovate 14 before automerge, and the right value is unresolved.
- **Detect:** In `pnpm-workspace.yaml`: `minimumReleaseAge` (added in v10.16.0; 1440 minutes by default since v11, 0 before), `minimumReleaseAgeExclude`, `allowBuilds` (install scripts are off by default since v10), and `trustPolicy: no-downgrade` (added in v10.21.0; off by default). For npm: `ignore-scripts=true` in `.npmrc`, or `npm ci --ignore-scripts`. `npm audit signatures`. Renovate `minimumReleaseAge`. Dependabot `cooldown` (a 3-day default applies to version updates when it is absent; security updates are exempt). List packages with install scripts: `rg -l '"(pre|post)?install"' node_modules/*/package.json node_modules/@*/*/package.json`.
- **Not when:** A delay also delays security patches, so keep the exclude path. Delays measured in days do not stop long cons like xz. Disabling scripts breaks packages with native builds until they are allowlisted, so list those packages first.
- **Tier:** T1 · **Class:** behavioural · **Fix risk:** low · **Grade:** B
- **Source:** [pnpm dependency resolution](https://pnpm.io/settings/dependency-resolution); [pnpm supply chain security](https://pnpm.io/supply-chain-security); [Dependabot options](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference); [Renovate minimumReleaseAge](https://docs.renovatebot.com/configuration-options/#minimumreleaseage); [CISA Shai-Hulud alert](https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem) (2025: over 500 packages); [xz timeline](https://research.swtch.com/xz-timeline) (Cox, 2024); [event-stream](https://blog.npmjs.org/post/180565383195/details-about-the-event-stream-incident) (npm, 2018) · dossier: dependency-hygiene T16-F10

### DP-13 — Pin CI actions, reusable workflows and base images to immutable references
- **Rule:** Report third-party actions and reusable workflows not pinned to a full commit SHA, and base images not pinned to a digest. Propose each pin with a version comment, using the SHA the tag resolves to today, so the code that runs does not change. Local gates cannot prove workflow edits, so these stay proposals (SE-27 reports the same pins). If a workflow ran a compromised action, secret rotation is a human task.
- **Detect:** `rg -nP 'uses:\s*[^@\s]+@(?![0-9a-f]{40}\b)' .github/workflows` (the `-P` flag is required). `rg -n '^FROM\s+[^@\s]+(\s|$)' --glob 'Dockerfile*'`. `rg -n 'curl .*\|\s*(ba)?sh' .github scripts`. Scorecard `Pinned-Dependencies`. Resolve each SHA with `git ls-remote https://github.com/<owner>/<action> refs/tags/<tag>`.
- **Not when:** No update automation exists: SHA pins without a bot freeze vulnerable versions, so report the pin together with DP-14 instead. Keep in mind that pinning an action does not pin what it downloads at runtime. The build-ci lens covers the wider CI surface.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** low · **Grade:** A
- **Source:** [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use) (GitHub, 2026); [CISA tj-actions alert](https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-tj-actionschanged-files-cve-2025-30066-and-reviewdogaction) (2025: secrets were exposed in workflows that ran the malicious commit between 2025-03-12 and 2025-03-15); [Scorecard checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md); [Renovate best practices](https://docs.renovatebot.com/upgrade-best-practices/) · dossier: dependency-hygiene T16-F14

### DP-14 — Require a sustained, low-noise update mechanism
- **Rule:** Report whether the project has a tuned update mechanism. That means either a Dependabot or Renovate config with grouping, a cooldown or release age, periodic lockfile maintenance and automerge only for green minor/patch updates; or, where the owner judges bots too noisy, scheduled CI that runs a reachability-based vulnerability check plus tests against the latest dependencies. Never add or reconfigure a bot in the pass.
- **Detect:** Look for `.github/dependabot.yml`, `renovate.json`, `.renovaterc` and scheduled workflows. Scorecard `Dependency-Update-Tool` checks only that a tool is enabled. Find stale bot PRs with `gh pr list --app dependabot --state open`. Renovate `config:best-practices` includes `:maintainLockFilesWeekly`, and Renovate advises a `minimumReleaseAge` of `"14 days"` for automerge.
- **Not when:** A Go project with scheduled govulncheck already meets the second option. Bots are contested: they reduce lag, yet 11.3% of projects in the TSE 2023 study dropped Dependabot and Valsorda (2026) calls it noise. So report; do not prescribe.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** low · **Grade:** B
- **Source:** [Dependabot in practice](https://arxiv.org/abs/2206.07230) (R. He et al., IEEE TSE 2023); [Renovate best practices](https://docs.renovatebot.com/upgrade-best-practices/); [Dependabot options](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference); [Scorecard checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md); [Turn Dependabot Off](https://words.filippo.io/dependabot/) (Valsorda, 2026); [gh pr list](https://cli.github.com/manual/gh_pr_list) · dossier: dependency-hygiene T16-F09

### DP-15 — Verify each direct dependency is the authentic, intended package
- **Rule:** Confirm that each direct dependency exists on the official registry under its canonical name, is not a typo-variant or personal fork, and has a plausible age, maintainers and repository. Internal packages must use a claimed scope with a registry mapping. Check runtime dependencies, recent additions and anything an AI agent added first; report suspects, and treat a confirmed malicious package as a human incident that includes credential rotation.
- **Detect:** `npm view <pkg> time.created repository.url maintainers`; `pip index versions <pkg>` or the PyPI JSON API; `cargo search <crate>`; `go list -m -versions <module>`. Flag names that are new relative to when the code was written, lack a repository link, or are one edit away from a popular name (the researcher's own heuristics, unsourced). Check the scope mapping in `.npmrc` and the pip index config. Run `npm audit signatures`.
- **Not when:** A legitimate niche package looks suspicious on metadata alone. Never treat registry existence as proof, because attackers pre-register hallucinated names.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** low · **Grade:** B
- **Source:** [Package hallucinations](https://arxiv.org/abs/2406.10279) (Spracklen et al., USENIX Security 2025, 16 LLMs, 576,000 samples: hallucination rates of at least 5.2% for commercial models and 21.7% for open-source ones); [OpenSSF Concise Guide](https://best.openssf.org/Concise-Guide-for-Evaluating-Open-Source-Software); [OpenSSF npm guide](https://github.com/ossf/package-manager-best-practices/blob/main/published/npm.md); [OWASP A03:2025](https://top10.owasp.org/2025/A03_2025-Software_Supply_Chain_Failures); [npm view](https://docs.npmjs.com/cli/v11/commands/npm-view) · dossier: dependency-hygiene T16-F15

### DP-16 — Report abandoned dependencies with four context factors, and never replace them in the pass
- **Rule:** For each direct runtime dependency, record its status: deprecated, archived, yanked or quarantined, flagged by an unmaintained advisory, or without a release past a named threshold. For each abandoned one, report "act" (replace, fork, vendor) or "keep and monitor", weighed on four factors. (1) Depth of integration: files, API calls, and use in CI or package scripts. (2) Available alternatives. (3) Importance of the functionality. (4) External environmental pressure, meaning pressure on the dependency to keep evolving with its environment, not general security exposure.
- **Detect:** Renovate `abandonmentThreshold` or `abandonments:recommended`. `npm view <pkg> deprecated`. `dotnet package list --deprecated`. `cargo deny check advisories` (`unmaintained` defaults to all, `yanked` to warn). PyPI project status (PEP 792: archived, quarantined, deprecated). Scorecard `Maintained`. Manually check the last release, unanswered security issues and the maintainer count.
- **Not when:** A narrow, stable package such as isarray has no recent commits; that alone does not make it abandoned. Thresholds conflict (Scorecard 90 days, OpenSSF 12 months, a Renovate example of 2 years), so name the one you used.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** high · **Grade:** B
- **Source:** [Dependency abandonment in npm](https://www.cs.cmu.edu/~ckaestne/pdf/icse25_abandonment.pdf) (Miller et al., ICSE 2025: 15% of widely used npm packages were abandoned within six years; 18% of exposed projects removed them); [Abandabot](https://www.cs.cmu.edu/~ckaestne/pdf/icse26_abandabot.pdf) (ICSE 2026); [We Feel Like We're Winging It](https://www.cs.cmu.edu/~ckaestne/pdf/fse23.pdf) (FSE 2023); [OpenSSF Concise Guide](https://best.openssf.org/Concise-Guide-for-Evaluating-Open-Source-Software); [PEP 792](https://peps.python.org/pep-0792/); [cargo-deny advisories](https://embarkstudios.github.io/cargo-deny/checks/advisories/cfg.html) · dossier: dependency-hygiene T16-F11

### DP-17 — Challenge each dependency's necessity; recommend replacing it only when every condition holds
- **Rule:** Recommend replacing a direct dependency with a platform built-in or a few owned lines only when all four conditions hold. It is used at one or two call sites. It implements trivial logic with no platform edge cases. It drags in a disproportionate subtree. It is not a parser, crypto, protocol, date/time-zone or cross-platform OS abstraction. Report the recommendation; a human makes the replacement decision.
- **Detect:** Tree size: `npm ls --all | wc -l`, `cargo tree | wc -l`, `pipdeptree | wc -l`, `go list -m all | wc -l`. Import sites for each dependency, with rg. Each dependency's subtree: `pnpm why`, `npm ls <pkg>`, `cargo tree -p <crate>`, `go mod why -m <module>`. @e18e/eslint-plugin `ban-dependencies` (eslint-plugin-depend is deprecated).
- **Not when:** Reimplementing would discard bug fixes found in the field. A native built-in can differ in edge semantics. Raw crate and line counts mislead: 3.67M vendored lines fell to 1.83M once filtered to Linux-only code (Lobsters, 2025).
- **Tier:** T2 · **Class:** report-only · **Fix risk:** medium · **Grade:** C
- **Source:** [Our Software Dependency Problem](https://research.swtch.com/deps) (Cox, 2019); [OpenSSF Concise Guide](https://best.openssf.org/Concise-Guide-for-Evaluating-Open-Source-Software); [left-pad postmortem](https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm) (npm, 2016); [Build It Yourself](https://lucumr.pocoo.org/2025/1/24/build-it-yourself/) (Ronacher, 2025); [module-replacements](https://github.com/e18e/module-replacements); [@e18e/eslint-plugin](https://github.com/e18e/eslint-plugin); [Lobsters: Build It Yourself](https://lobste.rs/s/a5vkze/build_it_yourself); [Lobsters: Rust Dependencies Scare Me](https://lobste.rs/s/j3nhhc/rust_dependencies_scare_me) (2025) · dossier: dependency-hygiene T16-F12, T16-F18

### DP-18 — Vendored and forked code lives in one marked place, with licence, origin and a patch record
- **Rule:** Report vendored or forked third-party code that is missing any of these: one clearly marked location, its licence, the exact upstream tag or commit, and a record of local patches. Recommend vendoring only when a dependency is abandoned or needs an unmerged fix and replacing it would cost more. Verify vendored code against the upstream VCS tag, diff release tarballs against the tag, and treat opaque binary test fixtures as suspect.
- **Detect:** `fd -t d '^(vendor|third_party|external)$'` and `fd -t d --full-path 'lib/vendor$'`. `rg -l --glob '*.min.js' . src`. A LICENSE file and an origin record for each vendored package. `diff -r vendored/ <upstream tag checkout>`. For Go `vendor/`, `go mod tidy -diff` must be clean.
- **Not when:** The project is a Go module using the checksum database, which does not need vendoring for reproducibility. Vendoring also removes automatic security updates, so any vendoring recommendation must say how advisories will be watched by hand.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** medium · **Grade:** C
- **Source:** [We Feel Like We're Winging It](https://www.cs.cmu.edu/~ckaestne/pdf/fse23.pdf) (FSE 2023); [Google third-party code policy](https://opensource.google/documentation/reference/thirdparty); [xz timeline](https://research.swtch.com/xz-timeline) (Cox, 2024); [xz backdoor report](https://www.openwall.com/lists/oss-security/2024/03/29/4) (Freund, 2024); [Lobsters: Rust Dependencies Scare Me](https://lobste.rs/s/j3nhhc/rust_dependencies_scare_me) · dossier: dependency-hygiene T16-F18

### DP-19 — Keep every dependency's licence on an explicit allowlist
- **Rule:** Report every direct or transitive dependency whose licence is not machine-identifiable or not on the project's allowlist for its distribution model. On each major upgrade, diff the LICENSE file, because projects relicense. Licence compatibility needs legal judgement: report it, never decide it.
- **Detect:** `cargo deny check licenses` (unlisted licences are denied; confidence threshold 0.8; `clarify` covers missing metadata). `osv-scanner --licenses="<project allowlist>" .`. dependency-review-action `allow-licenses` (SPDX ids). The pipdeptree summary report (flag unverified). Scorecard `License`, which checks only the project's own licence.
- **Not when:** The code is private, undistributed and under no licence obligations. When metadata is missing or wrong, report it for clarification instead.
- **Tier:** T2 · **Class:** report-only · **Fix risk:** low · **Grade:** B
- **Source:** [2026 OSSRA](https://www.blackduck.com/resources/analyst-reports/open-source-security-risk-analysis.html) (Black Duck: 68% of 947 commercial codebases have licence conflicts); [OpenSSF Concise Guide](https://best.openssf.org/Concise-Guide-for-Evaluating-Open-Source-Software); [cargo-deny licenses](https://embarkstudios.github.io/cargo-deny/checks/licenses/cfg.html); [OSV-Scanner licence scanning](https://google.github.io/osv-scanner/usage/license-scanning/); [HashiCorp adopts BSL](https://www.hashicorp.com/blog/hashicorp-adopts-business-source-license) (2023) · dossier: dependency-hygiene T16-F13

## False-positive exclusions

- **Loaded by name or reflection:**
  - JDBC drivers, logging bindings and ORM dialects.
  - Babel, ESLint or PostCSS plugins named in config.
  - Code reached through `require(variable)`, importlib, `Class.forName` or entry points.
  - Dependencies added conditionally in config files, which knip may miss.
- **Maven analyzer limits:**
  - It always ignores some dependencies loaded by reflection, for example `org.slf4j:slf4j-simple`.
  - It misses uses that happen only through constants, source-retention annotations or Javadoc links.
- **Rust:**
  - cargo-machete gives false positives on code generated by `build.rs` and on renamed crates.
  - cargo-udeps can also miss unused crates.
- **Used outside the source tree:** CLI binaries run only in package scripts or CI, and dependencies used only in Docker or deployment steps.
- **Types and peers:** `@types/*` packages, peer dependencies that plugins require, and a library's optional or peer dependencies kept for its consumers.
- **Name mismatches (reasoning, unsourced):** a Python distribution name that differs from its module name, and meta-packages that re-export sub-packages.
- **Build-tool-only alerts,** as in the Create React App example: deprioritise them, but do not drop them.
- **Expected duplicates:** duplicates across semver-major lines that wait on an upstream upgrade, and npm nested duplicates.
- **Deliberate sources:** documented git or URL dependencies, and private-registry sources mapped to a claimed internal scope.
- **Go modules:** a Go module with go.mod and go.sum is not missing a lockfile.
- **Stable but quiet packages:** narrow, stable packages with no recent commits, such as isarray, or Ronacher's terminal-size code, which still works 10 years later.
- **Niche packages:** legitimate packages that merely look unusual on registry metadata.

## Evidence limits

- **Detectors:** no false-positive or false-negative rates have been published for knip, deptry, cargo-machete or cargo-udeps. DP-01 therefore relies on multi-signal verification, and detector hits start as `needs_review`.
- **Jafari's JS prevalence figures** (79.8% unused, 63.6% missing, over 1,146 projects) come from depcheck, which has the same blind spots. Treat them as upper bounds.
- **Headline numbers versus the paper body:**
  - Soto-Valero's "75.1% bloated" (Maven) is mostly transitive bloat.
  - Latendresse's "production" means the bundler output of 100 JS projects, 51 of which ship no dependencies. Cite Finding 4 from the body, not the abstract.
- **Pinning:** He et al. (FSE 2025) simulated npm resolution. Their result does not transfer to Python's flat resolution, where pins break co-installability.
- **Reachability:** it is production-grade only for Go. Rust call analysis is experimental and executes `build.rs`. JS, Python and JVM reachability tools were not evaluated.
- **Malicious-package takedown:** there is no empirical time-to-takedown distribution. pnpm's "removed within an hour" is a vendor claim.
- **Abandonment:** the act-or-keep logic rests on one qualitative study (22 interviews, then 124 maintainers rating 372 dependencies). Staleness thresholds are conventions.
- **DP-10:** the one-dependency-per-commit and no-refactor-mixing parts rest on vendor docs and practitioner essays. They are C-level inside a B rule.
- **Breaking-change rates:** Raemaekers (Maven, cited by Jafari: over 35% of minor and over 23% of patch releases break) uses a different dataset from Ochoa, so the two are not comparable.
- **Grade-C rules:**
  - lockfile injection rests on one demonstrated attack, with no frequency data (DP-05);
  - no peer-reviewed measurement of trivial-package risk was accessed (DP-17);
  - vendoring guidance is policy and opinion (DP-18).
- **OSSRA 2026** (947 commercial codebases, Nov 2024 to Oct 2025) is biased toward commercial and M&A audits.
- **The OpenSSF npm guide v1.1** has been archived since 2023-10-09 and predates the pnpm v10/v11 defaults.
- **Python bloat:** Drosos et al. (FSE 2024) was not read, so there is no Python-specific prevalence figure.
- **Unconfirmed command details:** cargo-udeps `--all-targets`, the pipdeptree licence flag, and the `npm view <pkg> deprecated` field.
