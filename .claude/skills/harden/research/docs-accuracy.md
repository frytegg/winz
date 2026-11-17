# Documentation that matches behaviour: README and setup instructions, examples, docstrings, API docs and agent context files
> Code G106 · slug docs-accuracy · verified 2026-09-23 · counts: verified 9 / corrected 11 / downgraded 1 / dropped 0

## Summary

Documentation drift is common and lasts a long time. It is also easy to catch mechanically, which makes it exactly the kind of defect a third-party reviewer is expected to find in a finished project.

**How common it is (each figure re-read in the primary source during this pass)**
- **Stale references in READMEs and wikis.** Tan, Wagner and Treude (EMSE vol. 29, 2024; online Nov 2023) found at least one outdated code-element reference in 28.9% (265/918) of the top-1000 GitHub projects at the time of analysis. Across full histories, 82.3% (658/800) had one at some point. Currently outdated references had been outdated for 4.7 years on average, and about 55% still survived a month after appearing.
- **Stale references in agent context files.** Treude and Baltes (2026 preprint) ran the same checker (DOCER) on 612 agent context files: CLAUDE.md, AGENTS.md, Copilot instruction files, GEMINI.md and .cursorrules. It flagged stale references in 23.0% of 356 repositories. On a hand-checked sample of 50 flagged elements, 32 (64%) were genuine.
- **Agents do what these files say.** Gloaguen et al. (2026): `uv` was used 1.6 times per task when the context file mentioned it, against fewer than 0.01 times when it did not. A stale command in these files will get run.
- **Fresh checkouts often fail to build or run:**
  - Java builds: more than 38% of 7,200+ failed (Sulír and Porubän, PLATEAU 2016).
  - Java builds under each JDK: the full study, published in EMSE 2026 after a 2024 registered report, built 2,500 projects on JDK 6–23. From Java 8 onward only 30–44% succeeded on any single JDK, and about 32% failed on every JDK. Building with the wrong Java version was a major failure factor. The authors' hypothesis that failure rates keep rising was not confirmed.
  - Python gists: 75.6% need non-trivial configuration before they run (Horton and Parnin, ICSME 2018).
  - Jupyter notebooks: of 863,878 runs, only 24.11% finished without errors and 4.03% reproduced their stored results (Pimentel et al., MSR 2019).
- **LLM-written docs name things that do not exist.**
  - DocAgent (ACL 2025): only 61.10% of the repository entities mentioned by a chat baseline (GPT-4o-mini) actually existed.
  - ETF (ACL 2025): 31.63% (130/411) of LLM-written code summaries were annotated as hallucinated.

**Procedure, in step order**

Run this after all code changes in the hardening pass, since those changes create drift of their own.

- **Step 0. List the documentation.** `git ls-files '*.md' '*.rst' '*.ipynb' docs/ CLAUDE.md AGENTS.md GEMINI.md .cursorrules '.cursor/rules/*' .github/copilot-instructions.md .env.example 'LICENSE*' 'SECURITY*' 'CHANGELOG*' 'CONTRIBUTING*'`, plus the package manifests.
- **Step 1. Map the drift the pass caused (F03, F11).**
  - Renamed and deleted files: `git diff -M --name-status BASE..HEAD | grep -E '^(R|D)'`.
  - For every old path or symbol: `git grep -n -w -F OLD -- '*.md' '*.rst' docs/ CLAUDE.md AGENTS.md .env.example`.
  - Leave CHANGELOG entries alone.
- **Step 2. Check what the setup instructions install, before running them (F02).** `grep -nE 'registry|index-url|extra-index-url|curl .*[|] *(ba)?sh'` over the README, the agent files, .npmrc, pip.conf and .cargo/config.toml.
- **Step 3. Replay the README from a fresh clone (F01).**
  - Clone with `git clone --no-local . /tmp/fresh` into a disposable container or a new venv, with no host caches.
  - Use the documented runtime version.
  - Install with commands that enforce the lockfile: `npm ci`, `pnpm install --frozen-lockfile`, `uv sync --locked`, `cargo build --locked`.
  - Follow setup → build → test → run exactly as written, and log every deviation.
  - Run the non-destructive commands in the agent files too (install, build, lint, typecheck, test). Never run deploy, publish, migrate or delete commands.
- **Step 4. Run the examples as tests (F06, F07).**
  - Python: `pytest --doctest-modules --doctest-glob='*.md'`, or pytest-examples.
  - Notebooks: `pytest --nbmake`.
  - Rust: `cargo test --doc`.
  - Go: `go test ./...` with `// Output:` comments, plus `go vet ./...`.
  - TypeScript: typescript-docs-verifier.
  - CLI transcripts: `cog --check`, or trycmd.
- **Step 5. Build the docs with warnings treated as errors (F08).**
  - `sphinx-build -W -n`
  - `mkdocs build --strict`
  - `typedoc --treatWarningsAsErrors`
  - `RUSTDOCFLAGS='-D warnings' cargo doc --no-deps`
  - `javadoc -Xdoclint:all -Werror`
- **Step 6. Check links (F09).**
  - Local links and anchors block the pass: `lychee --offline --include-fragments`.
  - External links only go in the report.
  - lychee parses Markdown and HTML natively. For Sphinx sites, use `sphinx-build -b linkcheck` instead of relying on lychee's plain-text fallback for `.rst`.
- **Step 7. Check docstrings against signatures (F10).** Use pydoclint, or ruff D417 and the DOC rules (preview). For JS/TS use `jsdoc/check-param-names`; for Java use javadoc doclint.
- **Step 8. Check for drift between docs and code.**
  - CLI `--help` output against the flags in the README (F13).
  - Environment variables the code reads against .env.example (F14).
  - OpenAPI spec against the implementation, with Schemathesis run against a local instance only (F15).
  - Every version, image tag and URL in the install steps must resolve (F16).
- **Step 9. Check the agent files (F04, F05).**
  - Every path, symbol and command they mention exists.
  - AGENTS.md, CLAUDE.md and the README do not prescribe different commands for the same job.
  - Size: Anthropic's target is under 200 lines per CLAUDE.md. Apply the same threshold to other agent files by analogy.
- **Step 10. Check the repository hygiene files (F17–F20).**
  - The LICENSE file matches the licence field in every manifest.
  - SECURITY.md exists and gives a real contact.
  - The pass's user-visible changes are listed under CHANGELOG `[Unreleased]`.
  - The README states the project's status and limitations.
- **Step 11. Sort every finding into safe-fix or report-only (F21)**, then write the report.

**Versions of standards and tools confirmed in this pass**
- Standards and policies: OpenSSF Scorecard checks.md (main branch, read 2026-09-23), REUSE 3.3 (2024-11-14), PEP 639 (Final), Keep a Changelog 1.1.0.
- Language docs: Python 3.14.7 doctest; javadoc for JDK 21; golang.org/x/tools v0.50.0.
- Documentation and test tools: pytest 9.1.1; Sphinx 8.1+ behaviour; MkDocs 1.6.1 (last release 2024-08-30); lychee v0.24.2; trycmd 1.2.1 (2026-07-21).
- Linters and checkers: ruff 0.16.8; pydoclint 0.9.1; Schemathesis 4.28.0.
- Environment-file tools: dotenv-linter v4.0.0 (the researcher's "3.3.1" was outdated); dotenv-diff 3.4.1 (2026-09-06).
- npm CLI v11 docs.
- Do not adopt Dredd: it was archived on 2024-11-08.

## Findings

### G106-F03 — Every code-formatted identifier, path, flag, config key and env var in the docs must exist at HEAD

**The rule.**
- Every identifier, file path, CLI flag, config key and env var written in code formatting in the README, docs/ and wiki pages must still exist in the source at HEAD.
- Run the check systematically for every symbol and path the hardening pass renamed or deleted.
- **SAFE-FIX** when the pass itself made the rename: the old→new mapping is known and the new name is verified.
- **REPORT-ONLY** for other flagged references.
- Exclude CHANGELOG files, release notes and migration guides: their references to removed elements are historically correct.

- **Grade:** A · **Verdict:** VERIFIED (all figures confirmed in the arXiv full text; the EMSE publication was confirmed via Crossref; the counterpoint wording now follows the paper's own description)
- **Rationale:**
  - This is the best-measured form of drift. It persists for years, and the refactorings, deletions and renames in a hardening pass create new instances of it.
  - Detection is cheap: look for a backticked token that no longer occurs anywhere in the source.
  - A flag is not automatically a documentation error. In Tan et al., 47.6% of historic fixes changed the code rather than the docs, and 4 of the 8 projects that replied called the reports false positives. Hence the split between fixing and reporting.
- **Evidence:**
  - [Detecting Outdated Code Element References in Software Repository Documentation](https://arxiv.org/abs/2212.01479) — Tan, Wagner, Treude — Empirical Software Engineering 29(1), 2024 (online 2023-11-21), DOI 10.1007/s10664-023-10397-6 — peer-reviewed.
    - Data: "28.9% (265/918) of the projects contain at least one outdated document" (top1000, at analysis time).
    - "82.3% (658/800) of the projects … found to be outdated at some point in history."
    - Currently outdated references had been outdated "for 4.7 years" on average; "around 55% chance of surviving … after a month".
    - How they were resolved: 47.6% (8271/17368) by changing the source code, 39.1% by updating the docs, 13.3% by deleting the docs.
    - Maintainer response: "4 projects have responded positively, while the other 4 reported the issues as false positives."
    - "A project's change log may also be incorrectly flagged as outdated."
    - Verification note: the arXiv v1 PDF was read in full.
  - [Software Documentation Issues Unveiled](https://doi.org/10.1109/ICSE.2019.00122) — Aghajani, Nagy, Vega-Márquez, Linares-Vásquez, Moreno, Bavota, Lanza — ICSE 2019 — peer-reviewed.
    - Data: "mined, analyzed, and categorized 878 documentation-related artifacts stemming from four different sources".
    - Verification note: the abstract was read via Semantic Scholar. The figure "up-to-dateness problems account for 39% of documentation content issues" was confirmed only as quoted by Tan et al. (secondary); the full paper was not opened.
  - [Detecting API documentation errors](https://doi.org/10.1145/2509136.2509523) — Zhong, Su — OOPSLA 2013 — peer-reviewed.
    - Data: errors include "broken code names and obsolete code samples"; "DOCREF has detected more than 1,000 new documentation errors … Many of the errors have already been confirmed and fixed".
    - Verification note: the abstract was read via OpenAlex.
  - Tooling: the DOCER implementation is on [Zenodo 7384588](https://zenodo.org/records/7384588) (v1.0.0, 2022-12-01) and in the GitHub repo wesleytanws/DOCER (last push May 2023, a research prototype). The same authors packaged it as a GitHub Actions tool that scans on every pull request: "Wait, wasn't that code here before? Detecting Outdated Software Documentation", ICSME 2023, DOI 10.1109/ICSME58846.2023.00071 (abstract read via OpenAlex).
- **Detect:**
  - **(a) Drift caused by the pass.** Run `git diff -M --name-status BASE..HEAD | grep -E '^(R|D)'`. For each old path or symbol, run `git grep -n -w -F OLD -- '*.md' '*.rst' '*.txt' docs/ ':!CHANGELOG*'`.
  - **(b) General sweep, DOCER-style:**
    1. Extract the backticked tokens with the pipeline below.
    2. For each token, check it still occurs in the source.
    3. Check each path with `test -e`.
    4. Triage the hits by hand.
    ```
    grep -ohE '`[^` ]{3,}`' README.md docs/*.md | tr -d '`' | sort -u
    git grep -q -w -F TOKEN -- ':!*.md' ':!*.rst' || echo STALE TOKEN
    ```
- **Tools:** git grep, git diff -M, DOCER (Zenodo 7384588 or its GitHub Action), ast-grep.
- **Applies to:** README, docs/, wikis, tutorials and API guides in any language. Run after every hardening step that renames, moves or deletes something.
- **When not to apply / counterpoints:**
  - Regex extraction misses references in prose and flags common words.
  - Tan et al. report two kinds of real false positives:
    - a CMake flag that was removed from the source but is still relevant to users;
    - a name no longer spelled out in the source whose "functionality remains in the program logic" (the gnostic `text_out` case).
  - When code and docs disagree, the code may be the regression: 47.6% of historic resolutions changed the code.
  - Deleting a stale section can remove context that is still valuable.
- **Fix risk:** low

### G106-F06 — Every code example that claims to run must be executed by the test suite

**The rule.** Every code example that claims to run must be executed by the test suite:
- **Python:** `pytest --doctest-modules`, and `--doctest-glob='*.md'` (or pytest-examples).
- **Rust:** `cargo test --doc`.
- **Go:** `Example*` functions with an `// Output:` comment.
- **TypeScript:** typescript-docs-verifier.
- **Several languages:** byexample.

Audit the escape hatches: Rust ```` ```ignore ```` blocks, Go examples with no Output comment (these only compile) and doctest `+SKIP`.
- **SAFE-FIX:** add the runner, and fix an example when its corrected output has been verified against the intended behaviour.
- **REPORT-ONLY:** when an example's expected output and the code disagree and no test decides which is right.

- **Grade:** A · **Verdict:** CORRECTED (the pytest-examples tagline was misquoted; everything else was confirmed verbatim)
- **Rationale:**
  - Language maintainers built executable examples precisely because examples go stale without anyone noticing.
  - Running them turns drift into a failing test.
- **Evidence:**
  - [doctest — Test interactive Python examples](https://docs.python.org/3/library/doctest.html) — Python Software Foundation (Python 3.14.7 docs), 2026 — official docs. Quote: "To check that a module's docstrings are up-to-date by verifying that all interactive examples still work as documented." Confirmed verbatim.
  - [How to run doctests](https://docs.pytest.org/en/stable/how-to/doctest.html) — pytest (latest 9.1.1), 2026 — official docs. Confirmed verbatim:
    - "By default, all files matching the test*.txt pattern will be run".
    - "--doctest-glob can be given multiple times".
    - The NUMBER option relaxes float matching.
  - [Documentation tests](https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html) — Rust Project, 2026 — official docs. Confirmed verbatim:
    - "This makes sure that examples within your documentation are up to date and working."
    - On `ignore`: "Do note that this is almost never what you want".
  - [Testable Examples in Go](https://go.dev/blog/examples) — Andrew Gerrand, Go Blog, 7 May 2015 — official docs. Confirmed verbatim:
    - The framework "compares the output against the example's 'Output:' comment".
    - "Examples without output comments are useful for demonstrating code that cannot run as unit tests … while guaranteeing the example at least compiles."
  - [go/analysis/passes/tests](https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/tests) — Go Team, x/tools v0.50.0 — official docs. Quote: it checks "malformed names, wrong signatures and examples documenting non-existent identifiers." Confirmed.
  - [typescript-docs-verifier](https://github.com/bbc/typescript-docs-verifier) — BBC, v3.0.2 (2026-03-02) — tool README. Quote: "Verifies that typescript examples in markdown files actually compile." Confirmed; `--input-files` defaults to README.md.
  - [pytest-examples](https://github.com/pydantic/pytest-examples) — Pydantic, v0.0.18 — tool README. Actual tagline: "Pytest plugin for testing examples in docstrings and markdown files." Corrected; the researcher's version added "Python code".
  - [byexample](https://byexamples.github.io/byexample/) — byexample project — tool docs. Quote: "Write snippets of code in your documentation and execute them as regression tests." Confirmed.
- **Detect:**
  ```
  pytest --doctest-modules --doctest-glob='*.md' -q
  cargo test --doc
  go test ./... && go vet ./...
  npx typescript-docs-verifier --input-files README.md docs/*.md
  # escape hatches, each hit justified or removed:
  grep -rnE '```(rust,)?ignore' --include='*.rs' --include='*.md' .
  grep -rn '+SKIP' .
  # plus: Go Example funcs with no Output comment
  ```
- **Tools:** pytest, pytest-examples, cargo test --doc, go test / go vet, typescript-docs-verifier, byexample.
- **Applies to:** libraries and CLIs with examples in docstrings, the README or docs; mainly Python, Rust, Go and TS/JS.
- **When not to apply / counterpoints:**
  - Doctests that compare output break easily when dependencies change. A SageMath packager on HN (verified) reports "relatively brittle doctests … often breaking on minor changes in dependencies".
  - Some practitioners reject doctests outright: "doctests are nonsense, just write tests" (HN, verified).
  - Examples that touch the network need `no_run`, or must be compile-only.
  - Updating the expected output to match the code can enshrine a bug.
- **Fix risk:** low

### G106-F08 — Build the generated reference docs with warnings as errors and cross-reference checks on

**The rule.**
- Build the generated reference docs with warnings treated as errors and cross-reference checking on:
  - **Sphinx:** `sphinx-build -W -n`.
  - **MkDocs:** `mkdocs build --strict`, with `validation.links.not_found` and `validation.links.anchors` set to `warn`.
  - **TypeDoc:** `--treatWarningsAsErrors`. The `validation.invalidLink` and `validation.notExported` checks are already on by default.
  - **rustdoc:** `RUSTDOCFLAGS='-D warnings' cargo doc --no-deps`.
  - **javadoc:** `-Xdoclint:all -Werror`.
- **SAFE-FIX** a broken reference when its target was renamed and the new target resolves.
- **REPORT-ONLY** when the target was removed.

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - Doc generators already know which references dangle, but by default they only warn.
  - Rustdoc's lints do not run under rustc or `cargo build`, so only a doc build catches them.
- **Evidence:**
  - [sphinx-build](https://www.sphinx-doc.org/en/master/man/sphinx-build.html) — Sphinx, 2026 — official docs. Confirmed:
    - `-W`: "sphinx-build exits with exit status 1 if any warnings are generated".
    - "Changed in version 8.1: sphinx-build no longer exits on the first warning, but instead runs the entire build".
    - `-n`: "generates warnings for all missing references".
  - [TypeDoc Validation Options](https://typedoc.org/documents/Options.Validation.html) — TypeDoc, 2026 — official docs. Confirmed:
    - invalidLink: "Produce warnings for @link tags which cannot be resolved".
    - treatWarningsAsErrors: "treat any reported warnings as fatal errors".
    - Defaults show `notExported: true` and `invalidLink: true`.
  - [Rustdoc lints](https://doc.rust-lang.org/rustdoc/lints.html) and [Cargo environment variables](https://doc.rust-lang.org/cargo/reference/environment-variables.html) — Rust Project — official docs. Confirmed:
    - broken_intra_doc_links "warns by default".
    - "except for missing_docs, these lints are only available when running rustdoc, not rustc".
    - RUSTDOCFLAGS is passed "to all rustdoc invocations that Cargo performs".
  - [MkDocs configuration](https://www.mkdocs.org/user-guide/configuration/#validation) — MkDocs 1.6 — official docs. Confirmed:
    - strict: "Set to true to halt processing when a warning is raised."
    - `links.not_found` and `anchors` validations; anchors are "New in MkDocs 1.6".
  - [javadoc (JDK 21)](https://docs.oracle.com/en/java/javase/21/docs/specs/man/javadoc.html) — Oracle, 2023 — official docs. Confirmed:
    - doclint reference group: "the reference in @see or {@link ...} cannot be found, or a bad name is given for @param or @throws".
    - `-Werror`: "Reports an error if any warnings occur."
- **Detect:** run the relevant command and treat any non-zero exit code as a finding:
  - `sphinx-build -W -n -b html docs _build/html`
  - `mkdocs build --strict`
  - `npx typedoc --treatWarningsAsErrors`
  - `RUSTDOCFLAGS='-D warnings' cargo doc --no-deps --all-features`
  - `javadoc -Xdoclint:all -Werror …`
- **Tools:** sphinx-build, mkdocs, typedoc, cargo doc / rustdoc, javadoc.
- **Applies to:** projects that generate API or reference docs.
- **When not to apply / counterpoints:**
  - Nitpicky mode floods the output with unresolvable third-party references. Use `nitpick_ignore` or intersphinx rather than turning it off.
  - Warnings-as-errors can break builds on toolchain upgrades, so pin the toolchain.
  - This covers only the docs the generator processes, not the README.
  - MkDocs core has not released since 1.6.1 (2024-08-30); check that the project's doc toolchain is still maintained before investing in it.
- **Fix risk:** low

### G106-F09 — Check every link with lychee: gate on local links, report external ones

**The rule.**
- Check links in Markdown and HTML docs and in doc comments with lychee.
- **Local links and anchors block the pass:** `lychee --offline --include-fragments --no-progress .`
- **External links are checked separately and only reported:** `lychee --cache --max-cache-age 1d`, with `GITHUB_TOKEN` set.
- Prefer repository-relative links over absolute `github.com/.../blob/main` URLs.
- **SAFE-FIX** a broken relative link to a moved file once the target is verified.
- **REPORT-ONLY** for dead external links. Replace one only with a canonical URL you actually opened.

- **Grade:** A · **Verdict:** CORRECTED (the claim that lychee "checks … reStructuredText" natively is outdated: the current README says lychee supports HTML and Markdown and falls back to best-effort plain-text URL extraction for other formats, and `.rst` is not in its default `--extensions` list)
- **Rationale:**
  - Links decay silently and are rarely updated even when their targets change.
  - Relative links survive branches and clones.
  - External checks are noisy (rate limits, bot walls), hence gating on local links and only reporting external ones.
- **Evidence:**
  - [9.6 Million Links in Source Code Comments: Purpose, Evolution, and Decay](https://arxiv.org/abs/1901.07440) — Hata, Treude, Kula, Ishio — ICSE 2019 (DOI 10.1109/ICSE.2019.00123) — peer-reviewed. Confirmed in the abstract:
    - "Links are rarely updated, but many link targets evolve. Almost 10% of the links included in source code comments are dead."
    - Their link-fixing PRs resulted "in most of our fixes being merged successfully."
  - [lychee](https://github.com/lycheeverse/lychee) — lycheeverse, v0.24.2 (2026-05-01) — tool README. Confirmed:
    - `--offline`: "Only check local files and block network requests".
    - `--include-fragments` defaults to anchor-only.
    - Exit code 2 means "Link check failures".
    - Setting `GITHUB_TOKEN` avoids GitHub rate limits.
    - `--max-cache-age` defaults to 1d.
    - "lychee supports HTML and Markdown file formats. For any other file format, lychee falls back to a 'plain text' mode". Corrected.
  - [lychee-action](https://github.com/lycheeverse/lychee-action) — lycheeverse — tool README and action.yml. Confirmed:
    - Its example uses a scheduled cron run plus create-issue-from-file.
    - "In order to mitigate issues regarding rate limiting or to reduce stress on external resources, one can setup lychee's cache".
    - `fail` defaults to `true` in action.yml.
    - The default args glob includes `./**/*.rst`, which goes through plain-text mode.
  - [About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes) — GitHub Docs, 2026 — official docs. Quote: "GitHub will automatically transform your relative link or image path based on whatever branch you're currently on, so that the link or path always works." Confirmed.
- **Detect:**
  - Gate: `lychee --offline --include-fragments --no-progress './**/*.md' './**/*.html'`
  - Sphinx projects: `sphinx-build -b linkcheck docs _build/linkcheck`
  - Report: `lychee --cache --max-cache-age 1d --no-progress . > links-report.txt`
  - Absolute self-links: `grep -rnE 'github.com/<owner>/<repo>/(blob|tree)/' --include='*.md' .`
- **Tools:** lychee, lychee-action, sphinx-build -b linkcheck, grep.
- **Applies to:** every repo with Markdown or HTML docs, and source comments that contain URLs. For RST, prefer the Sphinx linkcheck builder.
- **When not to apply / counterpoints:**
  - External checks produce false positives: 429/403 responses, Cloudflare, login walls.
  - The action fails the workflow by default, which blocks unrelated work during third-party outages.
  - Anchors that only appear after JavaScript runs are missed; lychee says so itself.
  - Hata's 10% figure is for links in source comments, not README links specifically.
- **Fix risk:** low

### G106-F10 — Lint docstrings and JSDoc against function signatures

**The rule.**
- **Python:** pydoclint:
  - DOC101/102/103: argument mismatch;
  - DOC105: type-hint mismatch;
  - DOC203: return mismatch;
  - DOC501/502: raises mismatch.

  Alternatively, ruff D417 (Google convention) plus the ruff DOC rules (preview).
- **JS/TS:** eslint-plugin-jsdoc `jsdoc/check-param-names`.
- **Java:** `-Xdoclint:reference,missing`.
- **SAFE-FIX:** rename or remove documented parameters that no longer exist, and reorder them to match the signature.
- **REPORT-ONLY:** writing new descriptions of what a function does, and removing a documented exception that callees may raise.

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - Parameter and return drift is the most mechanically checkable part of a docstring.
  - The hardening pass changes signatures, so a structural lint catches that drift at almost no cost.
- **Evidence:**
  - [pydoclint violation codes](https://jsh9.github.io/pydoclint/violation_codes.html) — jsh9, pydoclint 0.9.1 (2026-07-03) — official docs. Confirmed verbatim:
    - DOC101 "Docstring contains fewer arguments than in function signature".
    - DOC105 "Argument names match, but type hints do not match".
    - DOC203 "Return type(s) in the docstring not consistent with the return annotation".
    - DOC502 "has a 'Raises' section in the docstring, but there are not 'raise' statements in the body".
  - [ruff D417 undocumented-param](https://docs.astral.sh/ruff/rules/undocumented-param/) and [DOC502](https://docs.astral.sh/ruff/rules/docstring-extraneous-exception/) — Astral, ruff 0.16.8 — official docs. Confirmed:
    - D417 "only checks docstrings with an arguments (e.g. Args) section" and "is enabled when using the google convention".
    - DOC502 is "Preview (since 0.5.5)".
    - Its known issues: "It may often be desirable to document all exceptions that a function could possibly raise, even those which are not explicitly raised".
  - [eslint-plugin-jsdoc check-param-names](https://github.com/gajus/eslint-plugin-jsdoc/blob/main/docs/rules/check-param-names.md) — gajus — official docs. Confirmed:
    - "Ensures that parameter names in JSDoc are matched by corresponding items in the function declaration."
    - With `enableFixer`, the fixer reorders parameters and removes duplicates.
- **Detect:**
  - `pydoclint --style=google src/` (or `--style=numpy`)
  - `ruff check --preview --select D417,DOC src/`
  - `npx eslint --rule '{"jsdoc/check-param-names":"error"}' src/`
  - `javadoc -Xdoclint:reference,missing -Werror`
- **Tools:** pydoclint, ruff, eslint-plugin-jsdoc, javadoc doclint.
- **Applies to:** Python, JS/TS and Java codebases with structured docstrings.
- **When not to apply / counterpoints:**
  - These lints check structure, not whether the prose is true.
  - Forcing every parameter to be documented breeds boilerplate.
  - The raises rules conflict with documenting exceptions propagated from callees; ruff says so itself.
  - The ruff DOC rules are still in preview.
  - Automatic reordering in jsdoc needs `enableFixer`.
- **Fix risk:** low

### G106-F17 — Keep exactly one authoritative licence statement

**The rule.**
- There must be a LICENSE, COPYING or LICENSES/ file at the repo root whose text matches an SPDX licence.
- The same SPDX expression must appear in:
  - every manifest: package.json `license`; pyproject.toml `license` per PEP 639, never with both the legacy and the new field; Cargo.toml `license`;
  - the README's licence section or badge.
- **REPORT-ONLY**, because this is legal:
  - Never choose, add or change a licence.
  - Propose a manifest patch aligned to the existing LICENSE file for the owner to approve.
  - If no licence is intended, say "All rights reserved" explicitly and use `UNLICENSED` in package.json.

- **Grade:** A · **Verdict:** CORRECTED (the rationale overstated Wolter et al.)
- **Rationale:**
  - Licences are the documentation users weigh most when deciding whether to adopt a project.
  - Scorecard scores the presence and location of a licence file.
  - Package ecosystems now standardise on SPDX expressions, so a mismatch between a manifest and LICENSE is a mechanical, visible contradiction.
  - Wolter et al. measured something related but different. They compared the top-level declared licence with the licences found inside the code, and about half of 1,000 repos under-declared. They did not measure disagreement between a manifest and the LICENSE file. Their result is indirect support that declared licences are often incomplete.
- **Evidence:**
  - [OpenSSF Scorecard checks: License](https://github.com/ossf/scorecard/blob/main/docs/checks.md) — OpenSSF, main branch read 2026-09-23 — standard. Confirmed:
    - Risk Low.
    - A detected LICENSE/COPYRIGHT/COPYING file or LICENSES dir scores 6/10; top-level location 3/10; an FSF or OSI licence 1/10.
  - [Open Source License Inconsistencies on GitHub](https://doi.org/10.1145/3571852) — Wolter, Barcomb, Riehle, Harutyunyan — TOSEM 32(5), 2023 — peer-reviewed.
    - Quote: "about half of the repositories did not fully declare all licenses found in the code. Of these, approximately 10% represented a permissive vs. copyleft license mismatch"; "existing tools cannot fully identify licences".
    - Verification note: the abstract was read via Crossref. The scope was narrowed as described in the rationale.
  - [PEP 639](https://peps.python.org/pep-0639/) — PyPA — standard. Confirmed:
    - Status: Final.
    - PyPI "MUST reject any that specify both License and License-Expression fields".
  - [package.json: license](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#license) — npm, v11 docs — official docs. Confirmed: `"SEE LICENSE IN <filename>"` for custom licences, and `"UNLICENSED"` to grant no rights.
  - [REUSE Specification 3.3](https://reuse.software/spec-3.3/) — FSFE, 2024-11-14 — standard. Confirmed: "Each License File MUST be placed in the LICENSES/ directory in the root of the Project"; files carry SPDX-License-Identifier tags.
  - [Open Source Survey 2017](https://opensourcesurvey.org/2017/) — GitHub — industry report. Quote: "64% say an open source license is very important in deciding whether to use a project". Confirmed.
- **Detect:**
  - `ls LICENSE* COPYING* LICENSES/`
  - `head -5 LICENSE`
  - `jq -r .license package.json`
  - `grep -nE '^(license|license-files|license_file)' pyproject.toml Cargo.toml`
  - `grep -n 'License ::' pyproject.toml setup.cfg` (legacy classifiers)
  - `grep -niE 'licen[cs]e' README.md`
  - Optional: `licensee detect .` or `reuse lint`.
  - Flag an `ISC` value (npm init's default) when LICENSE says something else.
- **Tools:** jq, grep, licensee (maintained), reuse lint (FSFE reuse-tool), ScanCode (optional).
- **Applies to:** every repository that will be shared, submitted or published.
- **When not to apply / counterpoints:**
  - Hackathon rules sometimes dictate the licence.
  - Vendored third-party code needs its own notices, which REUSE handles.
  - Wolter et al. note that existing tools cannot fully identify licences.
- **Fix risk:** high

### G106-F01 — Replay the README verbatim from a fresh clone in a disposable environment

**The rule.**
- Before hand-over, reproduce the README's setup → build → test → run path exactly as written, from a fresh clone.
- Use a disposable environment:
  - a container or new venv at the documented runtime version;
  - no host caches;
  - installs that enforce the lockfile (`npm ci`, `pnpm install --frozen-lockfile`, `uv sync --locked`, `cargo build --locked`).
- Timebox the replay and log every deviation:
  - a missing prerequisite;
  - a renamed or wrong command;
  - an undocumented flag or env var;
  - a version mismatch;
  - an OS-specific step.
- **SAFE-FIX** a step only when its corrected form ran successfully in that sandbox.
- **REPORT-ONLY** for steps that could not be run: another OS, paid APIs, special hardware, credentials.

- **Grade:** B · **Verdict:** CORRECTED
  - The Sulír 2024 registered report is now a full EMSE 2026 paper, whose results do not confirm its "rising failures" hypothesis.
  - Venues added: Gistable (ICSME 2018) and Milliken et al. (SANER 2025).
  - A practitioner paraphrase was softened.
- **Rationale:**
  - Build and run failures from a fresh checkout are common.
  - The author's machine hides the implicit state (global tools, caches, env vars, the right JDK or Node version) that makes them pass.
  - Published causes match what a verbatim replay exposes:
    - dependency problems;
    - the wrong runtime version;
    - commands or arguments that the install docs never mention.
  - Documentation guidance (Diátaxis, Google, Software Engineering at Google) says tutorials and samples must be tested because systems change.
- **Evidence:**
  - [A Quantitative Study of Java Software Buildability](https://arxiv.org/abs/1712.01024) — Sulír, Porubän — PLATEAU 2016 — peer-reviewed (workshop). Quote: "over 7,200 open source Java projects. We found that more than 38% of builds ended in failure … the largest portion of errors are dependency-related." Confirmed in the abstract.
  - [Local Software Buildability across Java Versions](https://doi.org/10.1007/s10664-026-10806-6) — Sulír, Porubän, Chodarev — EMSE 2026 (registered report [arXiv 2408.11544](https://arxiv.org/abs/2408.11544), 2024) — peer-reviewed.
    - Background: "Several studies have so far found that about 40–60% of such attempts fail."
    - Results for 2,500 projects on JDK 6–23:
      - "there is no monotonic trend"; success from Java 8 onward "range from 30 to 44%";
      - "about 32% of projects fail for all JDKs";
      - "Downgrading the latest JDK can fix 52% of failed builds";
      - "Building projects with a wrong Java version is a significant failure factor."
    - Verification note: the published abstract was read via Crossref. It replaces the researcher's quote of the registered report's hypothesis.
  - [Gistable: Evaluating the Executability of Python Code Snippets on GitHub](https://arxiv.org/abs/1808.04919) — Horton, Parnin — ICSME 2018 (DOI 10.1109/ICSME.2018.00031) — peer-reviewed. Quote: "75.6% of gists require non-trivial configuration to overcome missing dependencies, configuration files, reliance on a specific operating system, or some other environment configuration." Confirmed; the venue was confirmed via Crossref.
  - [Beyond pip install: Evaluating LLM Agents for the Automated Installation of Python Projects](https://arxiv.org/html/2412.06294v1) — Milliken, Kang, Yoo — SANER 2025 (DOI 10.1109/SANER64311.2025.00009) — peer-reviewed. Confirmed:
    - The Installamatic agent installed 21 of 40 repos (55%) at least once in ten tries.
    - The main failure cause: "a successful installation process requires commands or arguments that are not mentioned in the install-relevant documentation". Example: NoneBot2 needing `poetry … --all-extras`.
  - [Diátaxis — Tutorials](https://diataxis.fr/tutorials/) — Daniele Procida — framework docs. Confirmed:
    - "Your tutorial ought to be so well constructed that things can't go wrong, that your tutorial works for every user, every time."
    - The section heading reads "Aspire to perfect reliability".
  - [Technical Writing Two: Sample code](https://developers.google.com/tech-writing/two/sample-code) — Google Developers — official docs. Quote: "Always test your sample code. Over time, systems change and your sample code may break." Confirmed.
  - [Rules for Writing Software Tutorials](https://refactoringenglish.com/chapters/rules-for-software-tutorials/) — Michael Lynch, *Refactoring English* (book chapter published online 2025-01-02) — book. Quote: "Ideally, the repository should run against a continuous integration system such as CircleCI or GitHub Actions to demonstrate that your example builds in a fresh environment." Confirmed in the raw HTML.
  - [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci) and [pnpm install](https://pnpm.io/cli/install) — npm, pnpm — official docs. Confirmed:
    - npm: "If dependencies in the package lock do not match those in package.json, npm ci will exit with an error, instead of updating the package lock."
    - pnpm `--frozen-lockfile`: "fails to install if the lockfile is out of sync with the manifest"; the default is true in CI.
    - Also confirmed: `uv run/sync --locked` ("If the lockfile is not up-to-date, uv will raise an error") and `cargo build --locked` (exits with an error if Cargo.lock is missing or would change).
- **Detect:**
  1. `git clone --no-local . /tmp/fresh`. Uncommitted and ignored files do not come along; that is intended.
  2. Start a container at the documented runtime: `docker run --rm -it -v /tmp/fresh:/w -w /w <image:version> bash`. Or use a clean venv with no global tools on PATH.
  3. Execute the README code blocks in order, exactly as written.
  4. Keep a deviations log. Each row holds: step, command as written, what actually worked, and the evidence (exit code and error text).
  5. Check that the README states runtime versions consistent with the manifest: `engines`, `.nvmrc`, `.python-version`, `rust-toolchain.toml`, the Maven or Gradle toolchain. The EMSE 2026 result makes the stated JDK or runtime version a first-class check.
  6. Any step that needs manual intervention is a finding.
- **Tools:** git, docker/podman, python -m venv / uv, npm ci, pnpm install --frozen-lockfile, uv sync --locked, cargo build --locked, Doc Detective (optional; actively maintained repo).
- **Applies to:** any project with setup or usage instructions. Mandatory before hand-over to judges, collaborators, maintainers or agents.
- **When not to apply / counterpoints:**
  - A Linux container cannot verify Windows- or macOS-specific steps. Mark those "unverified", or use a CI OS matrix.
  - Replays involving GPUs, cloud credentials or paid APIs cannot be reproduced.
  - Agent-setup benchmarks measure agent skill as much as doc quality, so their numbers are not comparable to human build studies. They were confirmed on arXiv:
    - [EnvBench](https://arxiv.org/abs/2503.14443): best approach configured 6.69% of Python repos and 29.47% of JVM repos, on deliberately hard repos.
    - [SetupBench](https://arxiv.org/abs/2507.09063): repository setup success 38.9–57.4%.
  - README commands can have side effects, hence the disposable environment.
  - A practitioner adds that self-testing "works better if you have someone else try it out instead" (HN, verified).
- **Fix risk:** low

### G106-F04 — Treat agent context files as executable configuration

**The rule.**
- Applies to CLAUDE.md, AGENTS.md, GEMINI.md, .cursorrules, .cursor/rules/* and .github/copilot-instructions.md.
- Check:
  - that every path, symbol and command they mention exists at HEAD;
  - that the non-destructive commands (install, build, lint, typecheck, test) exit 0 in the fresh-clone sandbox;
  - for deploy, publish, release, migrate, seed or delete commands, only that the script or target exists. Never run them.
- Flag machine-specific absolute paths and oversized files.
- **SAFE-FIX** paths and commands re-verified by running them.
- **REPORT-ONLY** for conventions, architecture descriptions and claims about behaviour.

- **Grade:** B · **Verdict:** CORRECTED
  - The smells paper is accepted at SCAM 2026, not merely a preprint.
  - Its Conflicting Instructions rate is 28 flagged but only 16 confirmed.
  - The 200-line target is Anthropic's guidance for CLAUDE.md specifically.
  - The contested-benefit studies now have verified URLs.
- **Rationale:**
  - Stale references are measurably common in these files.
  - The files evolve like configuration, through small additions, and some are never revisited after generation.
  - Agents follow them closely: tool usage jumps when a tool is mentioned, and the AGENTS.md guidance says agents will run the listed checks.
  - So a stale or wrong command is a live defect, not cosmetic drift.
- **Evidence:**
  - [Context Rot in AI-Assisted Software Development](https://arxiv.org/abs/2606.09090) — Treude, Baltes — 2026 — preprint.
    - Confirmed in the v1 HTML: "identifies stale code element references in 23.0% of repositories" (82/356; 95% CI 18.8–27.2%).
    - There were 230 stale references among 18,048 verified ones.
    - The 612 files were: 147 CLAUDE.md, 234 AGENTS.md, 211 Copilot instruction files, 6 GEMINI.md, 9 .cursorrules and 5 other.
    - In the hand-checked sample: "32 (64%) were genuine referential rot".
    - Its RQ3 ("Which forms of context rot affect AI assistant behavior?") is posed as open.
  - [Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?](https://arxiv.org/abs/2602.11988) — Gloaguen, Mündler, Müller, Raychev, Vechev — 2026 (v2, 2026-06-23) — preprint. Confirmed:
    - "uv is used 1.6 times per instance on average when mentioned in the context files, compared to fewer than 0.01 times when it is not mentioned".
    - The abstract: context files do "not generally improve task success rates, while increasing inference cost by over 20% on average"; "instructions in the context files are well followed".
  - [AGENTS.md](https://agents.md/) — agents.md open format — official docs. Confirmed: "The agent will attempt to execute relevant programmatic checks and fix failures before finishing the task." "Treat AGENTS.md as living documentation."
  - [How Claude remembers your project](https://code.claude.com/docs/en/memory) — Anthropic — official docs. Confirmed: "target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence." "Review your CLAUDE.md files … periodically to remove outdated or conflicting instructions."
  - [Configuration Smells in AGENTS.md Files](https://arxiv.org/abs/2606.15828) — dos Santos, Costa, Montandon, Silva, Valente — SCAM 2026 (journal ref on arXiv v5) — peer-reviewed.
    - Covers 100 repositories.
    - Prevalence: Lint Leakage 62%, Context Bloat 42% (200+ lines), Skill Leakage 35%, Init Fossilization 24% (a single commit to the file).
    - Conflicting Instructions: 28 flagged by the LLM heuristic, but "only 16 cases were confirmed (57%)". Corrected: 16%, not 28%, is the confirmed rate.
  - [Agent READMEs: An Empirical Study of Context Files for Agentic Coding](https://arxiv.org/abs/2511.12884) — Chatlatanagulchai, Li, Kashiwa, Reid, … Adams, Hassan, Iida — 2025 (v2 2026) — preprint. Confirmed:
    - 2,303 files from 1,925 repos.
    - The files "evolve like configuration code through frequent, small additions".
    - Test procedures appear in 75.9% of files, architecture in 68.1%.
- **Detect:**
  - **Commands:** `grep -nE '(npm|pnpm|yarn|npx|bun|uv|pip|poetry|python|pytest|cargo|go|make|just|docker|gradle|mvn) ' CLAUDE.md AGENTS.md GEMINI.md .cursorrules .github/copilot-instructions.md`. Resolve each against the manifest (F05) and run the safe ones.
  - **Paths:** extract every path-like token from AGENTS.md and CLAUDE.md, then report the ones that do not exist:
    ```
    grep -ohE '[A-Za-z0-9_./-]+[.](ts|tsx|js|py|rs|go|md|json|toml|ya?ml|sh)' AGENTS.md CLAUDE.md | sort -u |
      while read p; do [ -e "$p" ] || echo "MISSING $p"; done
    ```
  - **Machine-specific paths:** `grep -nE '(~/|/Users/|/home/|[A-Z]:[/])'` on the same files.
  - **Symbols:** run the F03 sweep over the backticked tokens.
  - **Size:** `wc -l`. Flag CLAUDE.md files over 200 lines (Anthropic's target) and other agent files over the same threshold by analogy (the smells paper's Context Bloat cut-off).
  - **Fossilization:** `git log --oneline -- AGENTS.md CLAUDE.md | wc -l`. Flag files with a single commit.
- **Tools:** git grep, wc, DOCER, agents-lint (third-party; quality unverified).
- **Applies to:** any repository with committed agent context files. Not the user's private `~/.claude` files.
- **When not to apply / counterpoints:**
  - No study yet shows directly that stale context files lower agent task success; Treude and Baltes leave it as RQ3.
  - Whether context files help at all is contested. All verified on arXiv:
    - [Gloaguen et al.](https://arxiv.org/abs/2602.11988): no success gain, and inference cost up more than 20%.
    - [Lulla et al.](https://arxiv.org/abs/2601.20404) (10 repos, 124 PRs): AGENTS.md was associated with a 28.64% lower median runtime and 16.58% fewer output tokens.
    - [Shepard and Albrecht](https://arxiv.org/abs/2606.20512): probe-and-refine-tuned guidance resolved 33.0%, against 25.5% unguided and 28.3% for a static knowledge base.
    - [Khatri](https://arxiv.org/abs/2607.27250) (288 runs): the context strategy "does not measurably move correctness".
  - The detector's precision is about 64%.
  - Editing these files changes agent behaviour, so keep edits minimal and verified.
- **Fix risk:** medium

### G106-F07 — Execute every shipped notebook top-to-bottom in a fresh kernel

**The rule.**
- Execute every notebook shipped as documentation, a tutorial or a result, top to bottom in a fresh kernel, from the fresh-clone environment: `pytest --nbmake --nbmake-timeout=600 **/*.ipynb`, or `jupyter nbconvert --to notebook --execute`.
- Each of these is a defect:
  - any error;
  - any dependence on hidden state from out-of-order runs (non-monotonic `execution_count`);
  - any unpinned import.
- **SAFE-FIX** missing imports, paths and dependency pins verified by re-running.
- **REPORT-ONLY** when numeric results change.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - Notebooks are the least reproducible documentation artefact measured at scale. Most do not run cleanly, and very few reproduce their stored outputs.
  - The same paper uses gaps in execution counters and non-linear cell order as proxies for hidden state.
- **Evidence:**
  - [A Large-scale Study about Quality and Reproducibility of Jupyter Notebooks](https://leomurta.github.io/papers/pimentel2019a.pdf) — Pimentel, Murta, Braganholo, Freire — MSR 2019 — peer-reviewed.
    - Data: 1,159,166 unique notebooks from 264,023 repos.
    - "Out of 863,878 attempted executions of valid notebooks … only 24.11% executed without errors and only 4.03% produced the same results."
    - Verification note: confirmed in the PDF text.
  - [nbmake](https://github.com/treebeardtech/nbmake) — Treebeard Technologies — tool README. Confirmed:
    - "Executes notebooks using pytest and nbclient".
    - `--nbmake-timeout`, and the `skip-execution` and `raises-exception` cell tags.
    - Maintenance note: the latest release is 1.5.5 (2024-12-23) and the last push was March 2025. The project is not archived, but its activity has slowed.
- **Detect:**
  - Run all notebooks: `pytest --nbmake **/*.ipynb`
  - Check cell order. Flag nulls and non-increasing sequences:
    ```
    for f in $(git ls-files '*.ipynb'); do
      jq -c '[.cells[]|select(.cell_type=="code")|.execution_count]' "$f"
    done
    ```
  - Compare each notebook's imports against the declared dependencies.
- **Tools:** nbmake, jupyter nbconvert --execute, jq.
- **Applies to:** data-science, research, quant and ML repos, and any repo whose README points to notebooks.
- **When not to apply / counterpoints:**
  - Long-running, GPU or proprietary-data notebooks cannot run in CI. Tag them `skip-execution` and say so in the README.
  - Stochastic results need seeds before comparison.
  - The MSR 2019 data predates many modern practices, and no newer replication at this scale was found.
- **Fix risk:** low

### G106-F11 — Re-read the comments and docstrings of every function the pass changed

**The rule.**
- For every function whose body was modified, re-read its docstring and leading comments.
- Flag a comment that:
  - mentions a token the diff deleted (the OVERLAP(comment, deleted-tokens) heuristic); or
  - describes the old control flow, return values or raised errors.
- Update such comments in the same commit as the code.
- **SAFE-FIX** comments on code that was changed, when the new behaviour is pinned by a test.
- **REPORT-ONLY** comments on code that was not changed.

- **Grade:** B · **Verdict:** CORRECTED (softened: ETF identifies outdated comments as one category of hallucination cause; it does not measure how much they mislead)
- **Rationale:**
  - Detectors that see the code edit beat detectors that inspect code after the fact.
  - Even a trivial token-overlap rule reaches 74.1% precision (68.0 F1) on a deliberately balanced benchmark.
  - Wen et al. show that some kinds of code change are more likely to leave comments inconsistent.
  - ETF lists outdated comments among the causes of hallucinated LLM code summaries.
  - So a hardening pass that edits code without re-reading the comments next to it manufactures drift.
- **Evidence:**
  - [Deep Just-In-Time Inconsistency Detection Between Comments and Source Code](https://arxiv.org/abs/2010.01625) — Panthaplackel, Li, Gligoric, Mooney — AAAI 2021 — peer-reviewed.
    - Table 2, full test set:
      - OVERLAP(C, deleted): P 74.1, F1 68.0;
      - post hoc models: F1 66.3–67.2;
      - just-in-time with features: F1 79.6–80.9.
    - @param comments reach F1 of about 90 in the appendix.
    - "Since our dataset is balanced, we can get 50% exact match by simply copying C".
    - Verification note: confirmed in the PDF text.
  - [A Large-Scale Empirical Study on Code-Comment Inconsistencies](https://doi.org/10.1109/ICPC.2019.00019) — Wen, Nagy, Bavota, Lanza — ICPC 2019 — peer-reviewed.
    - Quote: "mining 1.3 Billion AST-level changes from the complete history of 1,500 systems … identifying cases in which code-comment inconsistencies are more likely to be introduced."
    - Verification note: abstract only, via Semantic Scholar.
  - [ETF: An Entity Tracing Framework for Hallucination Detection in Code Summaries](https://arxiv.org/html/2410.14748v4) — Maharaj et al. (IBM / IIT Bombay) — ACL 2025 Main — peer-reviewed.
    - Quote: "HC4: Natural language Context: This refers to cases where natural language in code snippets, such as outdated comments or log statements, causes hallucinations in code summaries."
    - Verification note: confirmed.
- **Detect:**
  1. Collect the identifiers the diff removed:
     ```
     git diff -U0 BASE..HEAD | grep -E '^-[^-]' | grep -oE '[A-Za-z_][A-Za-z0-9_]{2,}' | sort -u > removed.txt
     ```
  2. Collect the comment lines in the changed hunks:
     ```
     git diff -U10 BASE..HEAD | grep -E '^[ +].*(#|//|/[*]|"""|///)'
     ```
  3. Flag comment lines that contain a removed token: `grep -wFf removed.txt`.
  4. Manually re-read the docstrings of every modified function.
- **Tools:** git diff, grep -wFf, ast-grep.
- **Applies to:** any language, during and immediately after a refactoring or hardening pass.
- **When not to apply / counterpoints:**
  - The research detectors are not packaged tools.
  - The benchmark is balanced, while real inconsistency rates are far lower, so expect lower precision in the field.
  - Token overlap misses semantic drift, where the same names now mean different things.
- **Fix risk:** low

### G106-F12 — Treat LLM-written documentation as unverified until every entity in it is checked

**The rule.**
- Treat any documentation written or rewritten by an LLM, including during this pass, as unverified until every concrete entity in it has been checked to exist and match at HEAD:
  - function and class names, parameters;
  - CLI flags, commands, env vars;
  - file paths, config keys;
  - versions and numbers.
- Every claim about behaviour ("64-byte aligned", "thread-safe", "O(n)", "supports X", rate limits) must point to a test, a benchmark or a code location.
- **SAFE-FIX:** remove or correct entities that do not exist.
- **REPORT-ONLY:** behaviour, performance and security claims that cannot be verified. Never add such claims.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - Measured LLM documentation output names non-existent repository entities at high rates.
  - Models also describe what an identifier's name suggests rather than what the code does ("Name Bias").
  - Practitioners find this in public, AI-written READMEs.
- **Evidence:**
  - [DocAgent: A Multi-Agent System for Automated Code Documentation Generation](https://arxiv.org/html/2504.08725v3) — Yang et al. (Meta; code at facebookresearch/DocAgent) — ACL 2025 — peer-reviewed. Confirmed in Table 3:
    - Existence Ratio: Chat (GPT-4o-mini) 61.10%, Chat (CodeLlama-34B) 68.03%, FIM-CL 45.04%, DocAgent (GPT-4o-mini) 95.74%.
    - "nearly half of its [FIM's] references to repository entities might be incorrect".
  - [ETF](https://arxiv.org/html/2410.14748v4) — Maharaj et al. — ACL 2025 — peer-reviewed. Confirmed:
    - Hallucinated summaries: 130 of 411 (31.63%).
    - Entities: 3.05% INCORRECT, 6.11% IRRELEVANT.
    - "Name Bias refers to the tendency of language models to rely on identifier names when interpreting code".
  - [HN comment](https://news.ycombinator.com/item?id=43967418) — zxilly, 2025-05-12 — practitioner forum. Quote: "there are hallucinatory descriptions in the Readme (make test), and also in the code, such as the rate limit set at line 158, which is the wrong number". Confirmed via the HN API.
  - [HN comment](https://news.ycombinator.com/item?id=47073955) — gcr, 2026-02-19 — practitioner forum. Quote: "unlike what the README claims, the arrays it produces aren't actually 64-byte aligned after all"; "I offer failing unit tests, but no fixes." Confirmed.
- **Detect:** for each doc changed by an LLM (identify these with `git log` or from the pass's own diff):
  1. Extract the entities: backticked tokens, `--flags`, UPPER_SNAKE env vars, paths, and `make X` or `npm run X` commands.
  2. Verify each one: `git grep -w -F`, `test -e`, and the F05 manifest check.
  3. List every sentence with performance, security or compatibility wording: `grep -nE 'fast|faster|secure|thread-safe|aligned|O[(]|supports|compatible|production-ready|[0-9]+(x|%| ms)'`. Each one needs evidence or goes in the report.
- **Tools:** git grep, test -e, grep.
- **Applies to:** any README, docstring, API doc or agent file written or edited by an LLM.
- **When not to apply / counterpoints:**
  - The measured models are from 2024–25 (open 7–70B models, GPT-4o-mini). 2026 frontier models may do better.
  - Multi-agent verification raises the existence ratio to about 96%.
  - An entity that exists is necessary, but not sufficient, for a correct doc.
- **Fix risk:** low

### G106-F15 — Check the API implementation against its published schema with Schemathesis

**The rule.**
- When the project publishes an OpenAPI or GraphQL schema, run Schemathesis against a local or test instance only.
- Treat failures of `status_code_conformance`, `content_type_conformance`, `response_schema_conformance` or `response_headers_conformance` as drift between spec and implementation.
- Prefer generating the schema from code, so it cannot drift.
- Do not adopt Dredd, which is archived.
- **REPORT-ONLY:** a human decides whether the spec or the code is wrong.

- **Grade:** B · **Verdict:** CORRECTED (the Schemathesis paper is peer-reviewed at ICSE 2022 Companion; the researcher said "arXiv preprint, venue not verified")
- **Rationale:**
  - API docs are machine-checkable when a schema exists, and schema-driven fuzzing finds real defects.
  - Practitioners converge on one machine-readable source of truth.
- **Evidence:**
  - [Schemathesis built-in checks](https://schemathesis.readthedocs.io/en/stable/reference/checks/) — Schemathesis 4.28.0 (2026-09-22) — official docs. Confirmed:
    - status_code_conformance "Verifies the response status code is documented in the schema for the operation".
    - "All checks are enabled by default unless explicitly disabled", except `max_response_time`.
  - [Deriving Semantics-Aware Fuzzers from Web API Schemas](https://arxiv.org/abs/2112.10328) — Hatfield-Dodds, Dygalo — ICSE 2022 Companion (DOI 10.1145/3510454.3528637) — peer-reviewed.
    - Quote: "Schemathesis finds 1.4 times to 4.5 times more unique defects than the respectively second-best fuzzer for each target" (8 fuzzers, 16 services).
    - Verification note: the venue was confirmed via Crossref.
  - [apiaryio/dredd](https://github.com/apiaryio/dredd) — Apiary/Oracle — repo. Quote: "archived by the owner on Nov 8, 2024. It is now read-only." Confirmed.
  - [HN comment](https://news.ycombinator.com/item?id=37835032) — t1mmen, 2023-10-10 — practitioner forum. Quote: "human documentation is absurdly error-prone and it's almost always and immediately out of date. (Zod or other DSL) -> OpenAPI -> generated docs … always accurate". Confirmed.
- **Detect:**
  1. Start the app locally with test data.
  2. Run `uvx schemathesis run http://localhost:PORT/openapi.json`.
  3. Grep the output for the conformance checks.
  4. If the spec is hand-written, diff its paths against the router's route table (or use oasdiff).
- **Tools:** Schemathesis, oasdiff (optional; actively maintained), framework spec generators.
- **Applies to:** HTTP and GraphQL services that publish a schema or API docs.
- **When not to apply / counterpoints:**
  - Schemathesis sends many requests, including mutating ones. Never point it at production or shared data.
  - Stateful endpoints need auth and fixtures.
  - Specs generated from code are accurate on shape but often thin on meaning.
- **Fix risk:** medium

### G106-F18 — Check the community-profile and Scorecard files, prioritised for a solo project

**The rule.** For a hand-over or public repo, check the files that GitHub's community profile and OpenSSF Scorecard look for, prioritised for a solo project:
- **README:** must have.
- **LICENSE:** must have.
- **SECURITY.md:** supported versions, plus a real reporting channel.
- **CONTRIBUTING and CODE_OF_CONDUCT:** only if outside contributions are invited.

What to fix and what to report:
- **REPORT-ONLY** for contact details and policy content. Never invent an email address.
- **SAFE-FIX** only placement problems.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - These are the checks third parties will run, so the reviewer should anticipate them.
  - For a solo or finished project, the licence and a security contact carry real value; the rest is optional.
- **Evidence:**
  - [OpenSSF Scorecard checks: Security-Policy, Maintained](https://github.com/ossf/scorecard/blob/main/docs/checks.md) — OpenSSF, main branch — standard. Confirmed:
    - Security-Policy (risk Medium) looks for "a file named SECURITY.md (case-insensitive) in a few well-known directories".
    - Scoring: an email or URL 6/10, free text 3/10, disclosure-specific text 1/10.
    - Maintained gives the top score for "at least one commit per week during the previous 90 days". The same page adds: "a lack of active maintenance is not necessarily always a problem".
  - [About community profiles for public repositories](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories) — GitHub Docs — official docs. Confirmed: "README, CODE_OF_CONDUCT, LICENSE, or CONTRIBUTING, in a supported location", plus a security policy and issue templates in `.github/ISSUE_TEMPLATE`.
  - [Adding a security policy to your repository](https://docs.github.com/en/code-security/getting-started/adding-a-security-policy-to-your-repository) — GitHub Docs — official docs. Quote: "add information about supported versions of your project and how to report a vulnerability." Confirmed.
- **Detect:**
  - `ls -1 README* LICENSE* SECURITY* CONTRIBUTING* CODE_OF_CONDUCT* .github/ docs/`
  - `grep -niE 'mailto:|@|https?://|security advisor|private vulnerability' SECURITY.md`
  - Optional: `scorecard --repo=github.com/OWNER/REPO --checks=License,Security-Policy`
- **Tools:** OpenSSF Scorecard CLI, GitHub community profile page, grep.
- **Applies to:** public or shared repositories, hackathon submissions and handed-over projects.
- **When not to apply / counterpoints:**
  - Scorecard is a heuristic, and its Maintained check penalises finished projects. Do not create busywork commits to game it.
  - Boilerplate CODE_OF_CONDUCT and CONTRIBUTING files in a solo project add noise.
  - A placeholder SECURITY.md with no real channel is worse than none.
- **Fix risk:** low

### G106-F20 — The README must answer the basic questions, including status and limitations

**The rule.**
- Check that the README answers each of these with verified content:
  - what the project does, and its current status (working / partial / mocked / abandoned);
  - why it is useful;
  - how to install and run it (verified by F01);
  - where to get help;
  - who maintains it;
  - the licence.
- For a finished project handed to judges or maintainers, require an explicit "Status and limitations" section listing what is stubbed, mocked or untested.
- **SAFE-FIX:** structural additions containing only verified facts.
- **REPORT-ONLY:** the wording of purpose, status and limitations, for the owner to confirm.

- **Grade:** B · **Verdict:** CORRECTED (the Aghajani et al. 2020 abstract phrase "insufficient and inadequate content and obsolete, ambiguous information" is the paper's motivating background, not a survey result, so it no longer supports "dominates practitioners' complaints")
- **Rationale:**
  - A large README study finds that purpose and status are often missing.
  - GitHub's own guidance lists what, why, how, where and who.
  - 93% of respondents to GitHub's 2017 survey had run into incomplete or outdated docs.
  - Technical documentation is the most-used resource for learning to code.
  - A stated status and limitations section also stops a finished project over-claiming (see F12).
- **Evidence:**
  - [Categorizing the Content of GitHub README Files](https://arxiv.org/abs/1802.06997) — Prana, Treude, Thung, Atapattu, Lo — EMSE 2019 (DOI 10.1007/s10664-018-9660-3) — peer-reviewed. Confirmed:
    - 4,226 sections from 393 READMEs.
    - "many README files lack information regarding the purpose and status of a repository".
    - Classifier F1 0.746.
  - [Software Documentation: The Practitioners' Perspective](https://doi.org/10.1145/3377811.3380405) — Aghajani et al. — ICSE 2020 — peer-reviewed.
    - Two surveys with 146 practitioners.
    - Verification note: abstract only, via Semantic Scholar. The quoted issue list is background framing.
  - [About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes) — GitHub Docs — official docs. Confirmed list: "What the project does / Why the project is useful / How users can get started with the project / Where users can get help with your project / Who maintains and contributes to the project".
  - [Open Source Survey 2017](https://opensourcesurvey.org/2017/) — GitHub — industry report. Quote: "Incomplete or outdated documentation is a pervasive problem, observed by 93% of respondents". Confirmed.
  - [Stack Overflow Developer Survey 2025](https://survey.stackoverflow.co/2025/developers) — Stack Overflow — industry report. Quote: "Technical documentation is the most used resource for learning, with nearly 68% of respondents using it in the past year." Confirmed; the question was "How did you learn to code?"
- **Detect:**
  - List the README headings: `grep -nE '^#{1,3} ' README.md`.
  - Check each item on the list above.
  - Flag a README with no status or limitations statement.
  - Cross-check claims against F12.
- **Tools:** grep, manual review.
- **Applies to:** all handed-over or published projects.
- **When not to apply / counterpoints:**
  - README bloat is its own failure. Keep the README short and link out.
  - Gloaguen et al.'s finding that repository overviews do not help concerns agent files, not human READMEs.
- **Fix risk:** low

### G106-F21 — Classify every documentation finding as SAFE-FIX or REPORT-ONLY before acting

**The rule.** Classify every documentation finding before acting on it.
- **SAFE-FIX** (apply directly, one commit per class):
  - broken relative links and anchors to moved files;
  - references to identifiers and paths the pass itself renamed;
  - commands and version pins that ran successfully in the fresh-clone sandbox;
  - blocks regenerated from real output (cog, trycmd, `--help`);
  - docstring parameter names that mechanically mismatch the signature;
  - missing .env.example keys, added with empty values;
  - CHANGELOG `[Unreleased]` entries.
- **REPORT-ONLY:**
  - doc and code disagree about behaviour and no test decides which is right;
  - detector-flagged stale references the pass did not cause;
  - dead external links with no verified replacement;
  - licence text, security contacts, status and limitation claims;
  - performance or security claims.
- **When a doc is known to be wrong** but the right content is unknown, add a visible "may be outdated" note rather than silently deleting it.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - Detectors are imprecise, and a disagreement does not say which side is wrong: nearly half of historic resolutions changed the code, not the docs.
  - Fixes that are mechanical and verified by running them do get accepted.
  - A visible warning beats wrong docs that look authoritative.
- **Evidence:**
  - [Detecting Outdated Code Element References](https://arxiv.org/abs/2212.01479) — Tan, Wagner, Treude — EMSE 2024 — peer-reviewed. Confirmed:
    - Resolutions were 47.6% code changes, 39.1% doc updates and 13.3% doc deletions.
    - "4 projects have responded positively, while the other 4 reported the issues as false positives."
  - [Context Rot in AI-Assisted Software Development](https://arxiv.org/html/2606.09090v1) — Treude, Baltes — 2026 — preprint. Quote: "32 (64%) were genuine referential rot and the remainder false positives or ambiguous." Confirmed.
  - [Software Engineering at Google, Ch. 10 Documentation](https://abseil.io/resources/swe-book/html/ch10.html) — Winters, Manshreck, Wright (O'Reilly, 2020); chapter written by Tom Manshreck — book, free official HTML. Confirmed:
    - Docs should "Undergo reviews for changes (and change with the code it documents)" and "Be periodically evaluated (tested, in some respect)".
    - "someone adding a note that 'This no longer works!' is more helpful than saying nothing and leaving something that seems authoritative but no longer works."
  - [9.6 Million Links in Source Code Comments](https://arxiv.org/abs/1901.07440) — Hata et al. — ICSE 2019 — peer-reviewed. Quote: "most of our fixes being merged successfully". Confirmed.
- **Detect:** for each finding, record:
  1. the evidence: command output, grep hit, file and line;
  2. whether the pass caused it;
  3. whether a test or an executed command confirms the corrected text;
  4. its class: SAFE-FIX or REPORT-ONLY.

  Apply only the SAFE-FIX items, each in its own `docs:` commit, and list the REPORT-ONLY items in the hand-over report.
- **Tools:** git, a report template.
- **Applies to:** every documentation change made by an automated or agent-driven hardening pass.
- **When not to apply / counterpoints:**
  - Over-conservative reporting creates noise that owners ignore.
  - The thresholds are judgement calls, not measured optima.
- **Fix risk:** low

### G106-F02 — Treat install and setup commands as untrusted input before the replay runs them

**The rule.**
- Treat install and setup commands in the README and agent files as untrusted input before the fresh-clone replay runs them.
- Check package names, registry and index URLs, and version pins against the lockfile and the official registry.
- Refuse, and report, any step that:
  - redirects to a non-default registry (`--registry`, `--index-url`, `--extra-index-url`, .npmrc, a `[source]` replacement in .cargo/config.toml); or
  - pipes a remote script into a shell from an unverified domain.
- **REPORT-ONLY:** never "fix" docs by adding or changing a registry.

- **Grade:** C · **Verdict:** DOWNGRADED (B → C: the core evidence is a single, not yet peer-reviewed 2026 preprint; the npm docs support only the lockfile half of the rule)
- **Rationale:**
  - The verification step itself follows the docs.
  - A 2026 preprint shows coding agents that read setup docs being redirected to untrusted registries.
  - It also reports that a deterministic check of names, sources and versions before install closes most of the gap.
  - Installs that enforce the lockfile make an unexpected dependency change fail loudly.
- **Evidence:**
  - [Setup Complete, Now You Are Compromised: Weaponizing Setup Instructions Against AI Coding Agents](https://arxiv.org/abs/2607.15143) — Bagmar, Saraf — 2026-07-16 — preprint. Confirmed verbatim in the abstract:
    - "twelve scenarios in five attack classes".
    - "Source-based attacks like registry redirection are missed almost everywhere. The source blind spot recurs on npm and Cargo, where nearly every model installs the untrusted dependency."
    - "plausible separator-confusion names (azurecore for azure-core) slip through".
    - "a deterministic pre-install check that verifies names, sources, and versions before any code runs closes most of it."
  - [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci) — npm, v11 docs — official docs. Quote: "will never write to package.json or any of the package-locks: installs are essentially frozen." Confirmed.
- **Detect:**
  - Scan for registry redirects and piped installers:
    ```
    grep -nE 'registry|index-url|extra-index-url|--registry|curl [^|]*[|] *(ba)?sh|wget [^|]*[|] *sh|iwr [^|]*[|] *iex' \
      README* docs/ AGENTS.md CLAUDE.md .npmrc pip.conf .cargo/config.toml
    ```
  - For every `npm i X` or `pip install X` in the docs, confirm X appears in the lockfile or manifest and on the official registry (`npm view X name`; `pip index versions X`). Typosquats show up as names absent from the lockfile.
- **Tools:** grep / git grep, npm view, pip index versions, cargo search.
- **Applies to:** all ecosystems, especially npm, PyPI and Cargo, and any automated or agent-driven replay of setup docs.
- **When not to apply / counterpoints:**
  - Legitimate private mirrors and corporate registries exist; verify the domain instead of banning the pattern.
  - Official `curl | sh` installers (rustup, uv, nvm) are normal; check the host and HTTPS.
  - The study is a single preprint.
- **Fix risk:** low

### G106-F05 — Keep one source of truth for project commands

**The rule.**
- Cross-check every command named in the README, CONTRIBUTING and the agent files against:
  - the task runner: package.json scripts, Makefile or justfile targets, pyproject scripts or tasks, Cargo aliases;
  - the commands CI actually runs (.github/workflows);
  - each other.
- Check that the lockfile type matches the documented package manager.
- A command that does not resolve is a defect. So are two files prescribing different commands for the same job.
- **SAFE-FIX:**
  - point all docs at the manifest's canonical command, after verifying it runs; or
  - reduce CLAUDE.md to an `@AGENTS.md` import plus Claude-specific lines.
- **REPORT-ONLY** when it is unclear which variant is intended.

- **Grade:** C · **Verdict:** CORRECTED (the smells paper's Conflicting Instructions count was 28 flagged, 16 confirmed, and it covers contradictions within one file, not between AGENTS.md and CLAUDE.md)
- **Rationale:**
  - Anthropic's docs warn that contradictory instructions are resolved arbitrarily.
  - The CI workflow is the de facto executed truth, so docs that diverge from it are the likelier side to be wrong. This is a judgement call, not a measured result.
- **Evidence:**
  - [How Claude remembers your project](https://code.claude.com/docs/en/memory) — Anthropic — official docs. Confirmed:
    - "if two rules contradict each other, Claude may pick one arbitrarily."
    - It documents the `@AGENTS.md` import as the way to share one file across tools.
  - [Configuration Smells in AGENTS.md Files](https://arxiv.org/html/2606.15828v5) — dos Santos et al. — SCAM 2026 — peer-reviewed. Confirmed:
    - The Conflicting Instructions heuristic "detected 28 cases … only 16 cases were confirmed (57%)".
    - Association rules show Conflicting Instructions co-occurring with Context Bloat (confidence 0.81).
  - [Show HN: agents-lint (author comment)](https://news.ycombinator.com/item?id=47189930) — devGiacomo, 2026-02-28 — practitioner forum. Quote: "if you have both AGENTS.md and CLAUDE.md, they can silently contradict each other. One says `npm run test`, the other says `npm run test:unit`. Agents pick one arbitrarily." Confirmed via the HN API.
- **Detect:**
  - List the scripts: `jq -r '.scripts|keys[]' package.json`, and Makefile targets via `make -qp`.
  - List the documented commands and diff them against the scripts:
    ```
    grep -ohE '(npm|pnpm|yarn|bun) (run )?[A-Za-z0-9:_-]+' README.md CONTRIBUTING.md AGENTS.md CLAUDE.md | sort -u
    ```
  - Compare them with the `run:` steps in `.github/workflows/*.yml`.
  - Check the lockfile against the manager the README names: `ls pnpm-lock.yaml package-lock.json yarn.lock bun.lockb uv.lock poetry.lock`.
- **Tools:** jq, make -qp, git grep, diff/comm.
- **Applies to:** projects with a task runner and more than one instructional doc.
- **When not to apply / counterpoints:**
  - Some differences are deliberate: CI may run a stricter variant, and several package managers may be supported on purpose.
  - The LLM-based conflict detector has only 57% precision.
- **Fix risk:** low

### G106-F13 — Generate or check the README's CLI usage against the real --help output

**The rule.** If the project ships a CLI, the usage and flags documented in the README must be generated from, or checked against, the real `--help` output. Any one of these satisfies it:
- embed the output with cog (`cog -r README.md`, and `cog --check README.md` in CI);
- snapshot console transcripts with trycmd;
- at minimum, diff the two flag sets.

What to fix and what to report:
- **SAFE-FIX:** regenerate the block from actual output.
- **REPORT-ONLY:** a documented flag missing from `--help`.

- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:**
  - Help text is the one piece of documentation the program can produce itself.
  - Generating the README from it removes a whole class of drift.
- **Evidence:**
  - [Using cog to update --help in a Markdown README file](https://til.simonwillison.net/python/cog-to-update-help-in-readme) — Simon Willison (TIL created 2021-11-18, updated 2022-02-12) — engineering blog. Confirmed:
    - "cog -r README.md" and "cog --check README.md".
    - "include a test that will fail if I forget to update the content".
  - [Cog documentation](https://cog.readthedocs.io/) — Ned Batchelder (cogapp 3.6.0, 2025-09-21) — official docs. Quote: "it finds chunks of Python code embedded in them, executes the Python code, and inserts its output back into the original file." Confirmed.
  - [trycmd](https://docs.rs/trycmd/latest/trycmd/) — assert-rs, 1.2.1 (2026-07-21, per crates.io) — official docs. Confirmed:
    - `.case("README.md")` support, `console`/`trycmd` code blocks, and "$ " to start a command.
    - `TRYCMD=overwrite cargo test` updates the snapshots.
- **Detect:** diff the flags in `--help` against the flags in the docs, then repeat for each subcommand:
  ```
  COLUMNS=100 mycli --help | grep -oE -- '--[a-z0-9][a-z0-9-]+' | sort -u > help.txt
  grep -ohE -- '--[a-z0-9][a-z0-9-]+' README.md docs/*.md | sort -u > doc.txt
  comm -3 help.txt doc.txt
  ```
- **Tools:** cog, trycmd, byexample, comm.
- **Applies to:** projects that expose a command-line interface.
- **When not to apply / counterpoints:**
  - Help output varies with terminal width and platform.
  - A README may intentionally document only a subset of the flags.
  - Flags of external tools named in the README produce false diffs.
- **Fix risk:** low

### G106-F14 — Keep .env.example in sync with the env vars the code reads

**The rule.**
- Every environment variable the code reads must appear in .env.example, with an empty or clearly fake value.
- Every key in .env.example must be read somewhere, or be marked optional or deprecated.
- **SAFE-FIX:** add missing keys with empty values and a one-line comment.
- **REPORT-ONLY:**
  - removing keys (the code may read them dynamically, or another deploy target may need them);
  - any value that looks like a real secret, which also needs rotating.

- **Grade:** C · **Verdict:** CORRECTED (the current dotenv-linter release is v4.0.0, 2025-10-18, not 3.3.1; the twelve-factor source is a methodology website, not a book)
- **Rationale:**
  - Under twelve-factor practice, config lives in env vars, and .env.example is often its only documentation.
  - Practitioners report it drifting and crashing new setups.
- **Evidence:**
  - [The Twelve-Factor App: Config](https://12factor.net/config) — Adam Wiggins (last updated 2017) — methodology site. Confirmed:
    - "The twelve-factor app stores config in environment variables".
    - The litmus test is whether the codebase "could be made open source at any moment, without compromising any credentials."
  - [dotenv-linter](https://github.com/dotenv-linter/dotenv-linter) — dotenv-linter, v4.0.0 — tool README. Quote: "$ dotenv-linter diff .env .env.example … .env is missing keys: BAR / .env.example is missing keys: FOO". Confirmed; the version was corrected.
  - [dotenv-diff](https://www.npmjs.com/package/dotenv-diff) — Chrilleweb, 3.4.1 (2026-09-06) — tool README. Quote: "Scan your codebase to detect every environment variable reference. It helps you catch missing, unused, duplicated, and misused variables". Confirmed via the npm registry API.
  - [HN comment](https://news.ycombinator.com/item?id=44792267) — theozero, 2025-08-04 — practitioner forum. Quote: "Instead of a .env.example (which quickly gets out of date), it uses a .env.schema". Confirmed; the commenter is promoting varlock.
- **Detect:**
  1. List the keys the code uses:
     ```
     git grep -ohE 'process[.]env[.][A-Z0-9_]+|import[.]meta[.]env[.][A-Z0-9_]+|getenv[(].[A-Z0-9_]+|environ[[].[A-Z0-9_]+|environ[.]get[(].[A-Z0-9_]+|env::var[(].[A-Z0-9_]+|Getenv[(].[A-Z0-9_]+' \
       | grep -oE '[A-Z0-9_]{2,}$' | sort -u > used.txt
     ```
  2. List the keys documented in .env.example:
     ```
     grep -oE '^[A-Z0-9_]+' .env.example | sort -u > documented.txt
     ```
  3. `comm -3 used.txt documented.txt`
  4. Also run `dotenv-linter diff .env .env.example`, and dotenv-diff for JS/TS.
  5. Check dynamic access by hand.
  6. If a zod or pydantic-settings schema exists, treat it as the source of truth.
- **Tools:** git grep, comm, dotenv-linter, dotenv-diff, ast-grep.
- **Applies to:** any app configured through environment variables. Mandatory under this user's convention that .env.example lists every key.
- **When not to apply / counterpoints:**
  - Dynamic key access and variables injected by the framework or platform produce false diffs.
  - A validated schema is a better single source than regex scans.
  - The scanners are small tools.
  - Adding a key can change behaviour if setup scripts copy .env.example to .env and the app treats an empty value as set.
- **Fix risk:** low

### G106-F16 — Every version, image tag and URL in the install steps must resolve today

**The rule.**
- Every version, image tag, download URL and package name in the install instructions must resolve today.
- The docs must describe the released artefact, not unreleased HEAD behaviour, or say explicitly that they do.
- Prefer referencing version files over hard-coding versions in prose.
- **SAFE-FIX:** a tag or version confirmed to resolve and to match the lockfile.
- **REPORT-ONLY:** docs and published artefact diverge.

- **Grade:** C · **Verdict:** CORRECTED (Gao et al. is now published in IEEE TSE 2025; the rationale's "installation sections are the most frequently edited README content" is not in the source)
- **Rationale:**
  - Installation sections are actively maintained; a study of 1,163 README commits that update them found six recurring categories of change.
  - Version skew between the docs on main and the published artefact is a real-world failure, shown in a verified practitioner account.
  - The EMSE 2026 Java study (F01) independently shows that a wrong runtime version is a major failure factor.
- **Evidence:**
  - [Adapting Installation Instructions in Rapidly Evolving Software Ecosystems](https://arxiv.org/abs/2312.03250) — Gao, Treude, Zahedi — IEEE TSE 2025 (DOI 10.1109/TSE.2025.3552614) — peer-reviewed.
    - Quote: "investigating 400 GitHub repositories with 1,163 README commits that focused on updates in installation-related sections".
    - Six categories, including "pre-installation instructions" and "external resource management".
  - [HN comment](https://news.ycombinator.com/item?id=46973202) — LoganDark, 2026-02-11 — practitioner forum. Confirmed:
    - `docker pull ghcr.io/zulip/zulip-server:11.5-0` returned "not found".
    - A config variable documented on main was not in the image: "that change seemingly hasn't reached the image I'm using".
  - [Rules for Writing Software Tutorials](https://refactoringenglish.com/chapters/rules-for-software-tutorials/) — Michael Lynch, 2025 — book. Quote: "Good: Declare explicit versions for your dependencies" … "Install Node.js 22.x. I tested this on Node.js v22.12.0 (LTS)." Confirmed.
- **Detect:**
  1. Extract the candidates:
     ```
     grep -ohE '[a-z0-9./-]+:[0-9][A-Za-z0-9._-]*|@[0-9]+[.][0-9]+[.][0-9]+|==[0-9][0-9.]*|https?://[^ )>]+' README.md docs/*.md
     ```
  2. Resolve each one with `docker manifest inspect`, `npm view`, `pip index versions` or `curl -fsIL`.
  3. Compare the documented runtime versions with the manifest's engines, requires-python and rust-version fields.
- **Tools:** docker manifest inspect, npm view, pip index versions, curl.
- **Applies to:** projects whose install docs pin versions, images or download URLs.
- **When not to apply / counterpoints:**
  - There is a trade-off: hard-coded versions go stale faster, while unpinned instructions are less reproducible.
  - The direct evidence is one qualitative study plus anecdotes.
- **Fix risk:** low

### G106-F19 — Record the pass's user-visible changes under CHANGELOG [Unreleased]

**The rule.**
- If the project keeps a CHANGELOG, record every user-visible change the hardening pass makes under `## [Unreleased]`, grouped as Added, Changed, Deprecated, Removed, Fixed or Security.
- Never rewrite past entries.
- Exclude CHANGELOG files and release notes from stale-reference checks.
- **SAFE-FIX** (append-only).

- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:**
  - The pass changes names and observable behaviour, and the CHANGELOG is where downstream users look for that.
  - Historical entries that mention removed elements are correct by definition.
- **Evidence:**
  - [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) — Olivier Lacan, 2023 — convention. Confirmed:
    - "Changelogs are for humans, not machines."
    - "Keep an Unreleased section at the top to track upcoming changes."
    - Types: Added, Changed, Deprecated, Removed, Fixed, Security.
  - [Detecting Outdated Code Element References](https://arxiv.org/abs/2212.01479) — Tan, Wagner, Treude — EMSE 2024 — peer-reviewed. Quote: "A project's change log may also be incorrectly flagged as outdated … These references should not be considered as outdated as they only serve as a notice". Confirmed.
- **Detect:**
  - Check that the changelog was updated: `git diff --stat BASE..HEAD -- 'CHANGELOG*'`.
  - Compare against the pass's list of renamed or removed public names, flags, env vars and config keys; each needs an `[Unreleased]` entry.
  - Confirm no historical line was removed: `git diff BASE..HEAD -- CHANGELOG.md | grep -E '^-'` should show nothing.
- **Tools:** git diff.
- **Applies to:** projects that already keep a CHANGELOG or release notes.
- **When not to apply / counterpoints:**
  - Many small or hackathon projects need no CHANGELOG; do not create one unasked.
  - Keep a Changelog is a convention, not an empirically validated standard.
- **Fix risk:** low

## Practitioner voice

All links were opened through the official Hacker News API (hacker-news.firebaseio.com), and each gist was checked against the comment text.

- [agents-lint author on AGENTS.md rot](https://news.ycombinator.com/item?id=47189930) — devGiacomo, 2026-02-28. Rot he found on real repos:
  - absolute `~/Projects/bird/bird` paths that "work on one MacBook";
  - the official agents.md repo telling agents to "execute the test suite (if present)";
  - copy-pasted Turborepo commands that break single-package projects;
  - AGENTS.md vs CLAUDE.md contradictions (`npm run test` vs `npm run test:unit`).

  He built in a weekly CI schedule because "your codebase evolves around a static file".
- [Stale symbols in AI config files](https://news.ycombinator.com/item?id=47531882) — ravikirany22, 2026-03-26. "AGENTS.md and CLAUDE.md that reference renamed functions, deleted interfaces, or outdated patterns actively mislead the model". He claims "10-84% of symbol references" are stale in the TypeScript repos he audited. This is an anecdotal, unpublished audit.
- [Hard-coded paths in CLAUDE.md go stale](https://news.ycombinator.com/item?id=45790101) — maddmann, 2025-11-02. He proposes regenerating the paths in a pre-commit hook. The article author replies "We have a linter that checks for this" and, one level down, that it covers "All markdown files, yeah".
- [/init-generated context files "begging to get out of date"](https://news.ycombinator.com/item?id=45713267) — simonkagedal, 2025-10-26. In the replies:
  - simonw confirms that a single-line CLAUDE.md containing `@AGENTS.md` works;
  - theshrike79 keeps explicit uv instructions in AGENTS.md because agents otherwise go "python -> python3 -> damnit -> uv run python, wasting precious tokens".
- [Zulip docker README, followed verbatim](https://news.ycombinator.com/item?id=46973202) — LoganDark, 2026-02-11. The documented image tag was "not found", and a config variable documented on main was absent from the shipped image.
- [README claims vs source](https://news.ycombinator.com/item?id=47073955) — gcr, 2026-02-19. "Unlike what the README claims, the arrays it produces aren't actually 64-byte aligned"; he files issues with failing unit tests.
- [Hallucinated README commands](https://news.ycombinator.com/item?id=43967418) — zxilly, 2025-05-12. "Hallucinatory descriptions in the Readme (make test)", plus a wrong rate-limit number in the code.
- [Fresh-VM tutorial testing](https://news.ycombinator.com/item?id=42579689) — codetrotter, 2025-01-02. Good tutorial authors "set up a fresh VM and follow their own guide step by step", which catches forgotten dependencies and config tweaks.
- [TEST YOUR DOCS](https://news.ycombinator.com/item?id=42580592) — yoz, 2025-01-03. "Run through your own tutorial with a fresh VM", but "this works better if you have someone else try it out instead". He treats it as a usability test.
- [Misled by outdated comments](https://news.ycombinator.com/item?id=28417511) — pcmoney, 2021-09-04. "I generally open git blame to see if the comments predate any code now. Tests on the other hand almost never lie."
- [Dissent: brittle doctests](https://news.ycombinator.com/item?id=17999801) — timokau (Sage packager for Nix), 2018-09-16. Sage's "relatively brittle doctests testing everything … often breaking on minor changes in dependencies".
- [Dissent: "doctests are nonsense"](https://news.ycombinator.com/item?id=42361165) — sophacles, 2024-12-08. "Just write tests". Rust-style snippet validation "still make[s] me nervous".
- [Doctest keeps books working](https://news.ycombinator.com/item?id=42583736) — __mharrison__, 2025-01-03. "I often use doctest to ensure my books 'compile'. Students hate it when your code doesn't work."
- [.env.example drifts](https://news.ycombinator.com/item?id=44792267) — theozero, 2025-08-04. ".env.example (which quickly gets out of date)". He promotes a `.env.schema` alternative (varlock), so he has an interest in it.
- [dotenv-diff's motivation](https://news.ycombinator.com/item?id=46209361) — chrilleweb (the tool's author), 2025-12-09. ".env.example goes out of sync"; "New developer joins → app crashes due to missing env".
- [Generate API docs from a schema](https://news.ycombinator.com/item?id=37835032) — t1mmen, 2023-10-10. "Human documentation is absurdly error-prone and it's almost always and immediately out of date", so use Zod → OpenAPI → generated docs.
- [Newcomers update the onboarding docs](https://news.ycombinator.com/item?id=40655575) — hnthrowaway0328, 2024-06-12. "Ask the onboarding person to update the whole package once they went through the whole process."
- [Soft rules vs hooks](https://news.ycombinator.com/item?id=46429901) — AdieuToLogic, 2025-12-30. He quotes a project README: "'soft' rules in an CLAUDE.md or AGENTS.md file cannot replace hard technical constraints". The quote is that README's wording, cited by the commenter. Its point is to enforce critical rules with hooks.

## Contradictions and open questions

**Contradictions**
- **Do agent context files help?** All four studies are verified on arXiv.
  - Gloaguen et al.: no general task-success gain and inference cost up more than 20%; repository overviews do not help.
  - Lulla et al. (124 PRs): 28.64% lower median runtime and 16.58% fewer output tokens.
  - Shepard and Albrecht: 33.0% vs 25.5% resolution with tuned guidance.
  - Khatri: correctness not measurably moved.

  All of them agree that agents follow the instructions they are given, which is why accuracy still matters.
- **Executable docs.** The Python, Rust and Go docs promote doctests and testable examples, while practitioners report that output-comparing doctests are brittle, and some reject them.
- **Doc bug or code bug?** 64% of flags are genuine (Treude and Baltes), yet 47.6% of historic resolutions changed the code (Tan et al.). Auto-editing docs to match code can paper over regressions.
- **Just-in-time comment detectors** reach F1 of about 80 on a balanced dataset. Precision will be lower in the field.
- **Link checking.** lychee-action fails the workflow by default, yet its own README recommends scheduled runs, caching and issue creation.
- **Fresh-checkout failure rates vary with the population studied:**
  - more than 38% of Java builds failed (2016);
  - 40–60% in earlier studies;
  - 30–44% success per JDK from Java 8 on, with about 32% failing on every JDK (EMSE 2026);
  - 75.6% of gists need configuration;
  - 24.11% of notebooks run cleanly;
  - agent benchmarks (EnvBench 6.69% Python; Installamatic 55%) deliberately select hard repos.
- **Rising failure rates.** Sulír et al. hypothesised that build failures keep rising with newer Java versions. Their own EMSE 2026 results did not confirm it: there is no monotonic trend.
- **OpenSSF Scorecard.** The Maintained check penalises finished projects, and the check's own text concedes that low maintenance "is not necessarily always a problem".

**Open questions**
- **Stale context files and agent success.** No study directly measures whether stale commands or paths in CLAUDE.md or AGENTS.md lower agent task success. It is RQ3 in Treude and Baltes.
- **LLM hallucination rates.** They were measured on 2024–25 models. The rate for 2026 frontier models writing docs inside an agent loop is unknown.
- **.env.example tooling.** There is no mature cross-language tool for drift between code and .env.example:
  - dotenv-diff is focused on JS/TS;
  - dotenv-linter only compares files;
  - regex scans miss dynamic access.
- **DOCER maintenance.** The wesleytanws/DOCER repo was last pushed in May 2023 (4 stars). The current status of the ICSME 2023 GitHub Action was not checked. It is unverified whether either still works on current repos and on agent files outside the Treude and Baltes study.
- **LLM doc-drift reviewers.** The precision of LLM-based doc-drift reviewers is unmeasured.
- **OS-specific setup.** How should a single-container replay verify OS-specific steps (Windows / Git Bash vs Linux)? No cost-benefit evidence was found.
- **Aghajani full papers.** Neither the ICSE 2019 nor the ICSE 2020 paper was opened; only the abstracts were read, plus the 39% figure quoted by Tan et al.
- **Timebox and stopping rule.** No empirical guidance was found on how long to spend on the fresh-clone protocol, or when to stop.
- **MkDocs.** Core MkDocs has not released since 1.6.1 (Aug 2024); its maintenance outlook was not assessed here.

## Dropped findings

None. Every cited source was located and opened. One finding was downgraded (F02) and the others were corrected where needed.
