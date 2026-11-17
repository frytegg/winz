# Language-agnostic tooling and discovering the right tools for any language
> Code T25 · slug polyglot-tooling · verified 2026-09-23 · counts: verified 4 / corrected 13 / downgraded 2 / dropped 0

## Summary

The research wave for T25 ran on 2026-09-23. Its web search budget ran out partway through, so it relied on WebFetch, the HN, StackExchange, arXiv, OpenAlex and GitHub APIs, and curl for PDFs. Reddit and Lobsters blocked automated access, so the practitioner voices come from Hacker News and Software Engineering StackExchange.

Two independent verification passes (the workflow was resumed, and the second pass re-opened every source rather than trusting the first) re-checked every source through primary endpoints. Where they disagreed, the stricter reading was kept (T25-F10 downgraded, T25-F18 corrected). Endpoints used:
- HN items through the Firebase item API, including each thread's root story;
- SE questions and answers through the StackExchange API;
- paper abstracts through the OpenAlex and arXiv APIs, and the Google CACM PDF through pdftotext;
- CVE records through the MITRE CVE API;
- tool versions through authenticated `gh api` and the npm, PyPI and Maven Central registries;
- documentation pages as raw HTML or markdown;
- the Wayback Machine for the CACM Facebook article (cacm.acm.org returns 403), and Semantic Scholar for abstracts OpenAlex lacks;
- a local Docker reproduction on this Windows 11 / Git Bash machine for T25-F18.

**Tool versions confirmed on 2026-09-23** (GitHub releases API):

| Tool | Version | Released |
|---|---|---|
| MegaLinter | v10.1.0 | 2026-09-05 |
| super-linter | v8.7.0 | 2026-06-19 |
| Semgrep | v1.177.0 | 2026-09-10 |
| Opengrep | v1.30.0 | 2026-09-07 |
| ast-grep | 0.45.3 | 2026-08-31 |
| lizard | 1.24.0 | 2026-08-19 |
| scc | v4.1.0 | 2026-09-07 |
| tokei | v15.0.0 | 2026-09-06 |
| jscpd | v5.3.2 | 2026-09-23, 11:28 UTC, the day of this check |
| Qlty CLI | v0.644.0 | 2026-08-28 |
| golangci-lint | v2.13.2 | 2026-08-27 |
| Ruff | 0.16.8 | 2026-09-16 |
| sarif-tools | 3.0.5 | 2025-07-17 |
| pnpm | v12.5.1 (GitHub release); 12.6.0 on npm | 2026-09-18 |
| ESLint | v10.11.0 | docs HEAD |
| Comby | 1.8.1 | 2022-06-28 (repo not archived) |

**Main corrections made in this pass**
- **tokei:** JSON output is built in by default. Only YAML and CBOR need `--features`.
- **OpenRewrite:** `rewrite-maven-plugin` 6.48.0 is tagged on GitHub but returns 404 on Maven Central. The newest version on Central is 6.46.1.
- **`sarif diff`:** it compares rule codes and occurrence counts per severity and lists new locations. It does not match individual results by fingerprint.
- **Semgrep exit codes:**
  - 5 = config is not valid YAML;
  - 7 = at least one rule is invalid (not "missing config");
  - 8 = unknown language.
  - The JSON `paths.skipped` list is only emitted with `--verbose`.
- **pnpm:** in pnpm 12 the command is documented as `pnx`, with aliases `pnpm dlx` and `pnpx`.
  - Release-age and trust policies apply only when the project configures them.
  - The executed package may run its own postinstall; its dependencies' build scripts are skipped or prompted.
- **A misattributed quote:** "The standard practice is that people is pressed to make every single warning shut up" is from the SE 158535 question author, quoted in answer 160010.
- **Google's 10% rule:** it is a ratio of "Not useful" clicks to "Please fix" clicks per analyzer, not a share of findings ignored.
- **Facebook Infer fix rates:** now verified from the primary CACM article (archived copy), not only an HN quote. The "0% batch" figure rests on only 20–30 assigned issues.
- **MegaLinter:** the general claim that "a repo-root linter config takes precedence over defaults" is not on the configuration page. It is restored in a narrower, sourced form. Each linter descriptor looks for one specific file name in the workspace (e.g. `.ruff.toml`) and otherwise falls back to MegaLinter's own template. A project whose config lives elsewhere (e.g. `[tool.ruff]` in pyproject.toml) can therefore be linted with MegaLinter's template unless `<LINTER>_CONFIG_FILE=LINTER_DEFAULT` is set. `IGNORE_GENERATED_FILES` defaults to false.
- **Code Red affiliation:** only the first author (Tornhill) is from CodeScene; co-author Borg was at RISE / Lund University. The hotspot rule (T25-F10) is downgraded to C because no source validates the churn × complexity heuristic independently.
- **Git Bash + Docker (T25-F18):** reproduced locally. Without `MSYS_NO_PATHCONV`, the bind mount silently pointed at a newly created empty host directory, while an explicit container path failed loudly. So "reports clean" is a possible outcome, not a certain one.
- **Qlty licence:** BSL 1.1 (Change Date 2028-12-10 → GPL-3.0). Its Additional Use Grant excludes offering it as part of a commercial "Artificial Intelligence Coding Service" to third parties.
- **ESLint bulk suppressions:** introduced in v9.24.0. They suppress only rules set to "error", and the docs recommend running `--fix` first.
- **New, verified tool capabilities worth using:**
  - `scc --hotspots` / `--coupling` (git-history hotspot and change-coupling reports, present in the v4.1.0 README);
  - Opengrep `--taint-intrafile` (taint across functions within one file);
  - jscpd v5 SARIF `partialFingerprints["jscpdCloneHash/v1"]`.

**MAIN CONCLUSIONS (unchanged in substance)**

(1) **Tools are an external, checkable third party, but a noisy one.**
- In Google's 2009 FindBugs Fixit, 3,954 warnings were reviewed and only 16% (640) were fixed.
- Google developers judged 74% of compile-time issues "real problems" against 21% of issues found in checked-in code.
- In Tencent's industrial dataset, 328 of 433 alarms were false positives.
- Real-world SAST studies find few real vulnerabilities:
  - single tools: 11.2–26.5% (Bennett et al.);
  - seven Java tools as evaluated: 12.7% (Li et al.);
  - all tools combined: about 29% (70.9% undetected, Li et al.) to 38.8% (Bennett et al.).

So the skill must (a) triage every finding, (b) never read a clean scan as proof of absence, and (c) check that files were actually analysed.

(2) **On a finished codebase, fix old issues only when they matter and baseline the rest.** The main support is Google's Software Engineering book ch. 20, SonarQube new-code docs, ESLint bulk suppressions, Semgrep `--baseline-commit`, golangci-lint `new-from-rev` and jscpd `--baseline`. "Matters" means security, correctness or hotspots. This conflicts with the "fix everything, then enforce" camp; see Contradictions.

(3) **Apply only behaviour-preserving autofixes automatically.** ESLint and Ruff formally separate safe fixes from suggestions or unsafe fixes. Semgrep's `--autofix` warns of data loss and is labelled experimental.

(4) **Running tools is itself a supply-chain and code-execution risk.**
- reviewdog/action-setup@v1 was compromised (CVE-2025-30154). Composite actions that referenced it internally were compromised "regardless of version or pinning method".
- eslint-config-prettier 8.10.1/9.1.1/10.1.6/10.1.7 dropped malware on Windows (CVE-2025-54313).
- `dotnet format` may restore, compile and run analyzers, and Cargo runs `build.rs`.

So pin exact versions or digests, run in temporary environments, and keep secrets out of the environment.

**TOOL-DISCOVERY PROCEDURE (for agents)**
- **Step 0:** record OS and shell. On Git Bash, use `MSYS_NO_PATHCONV=1` and `$(pwd -W)` for `docker -v`. This was checked empirically on this machine (T25-F18).
- **Step 1: take inventory.**
  - Languages: `scc --by-file --format json --no-cocomo .` or `github-linguist --breakdown --json`.
  - Exclusions: generated or vendored code (`.gitattributes` `linguist-generated` / `linguist-vendored`, `.gitignore`).
  - Existing tooling: package.json scripts, pyproject `[tool.*]`, `.pre-commit-config.yaml`, `.golangci.yml`, `eslint.config.*`, `biome.json`, `ruff.toml`, `clippy.toml`, `.clang-tidy`, `.editorconfig`, Makefile/justfile, `.github/workflows`.
- **Step 2:** run the project's own gates first (`pre-commit run --all-files`, the lint/test scripts) with the project's pinned versions.
- **Step 3: fill gaps per language, in this order.**
  - (a) Analyzers bundled with the toolchain: compiler warnings, `go vet`/`gofmt`, `cargo clippy`/`rustfmt`, `dotnet format --verify-no-changes`.
  - (b) The ecosystem's de-facto linter/formatter.
  - (c) Curated catalogues: analysis-tools.dev (500+ tools; data in analysis-tools-dev/static-analysis), the trunk-io/plugins per-technology table, MegaLinter descriptors and flavors (67 languages).
- **Step 4: vet each candidate tool.**
  - Latest release date and archived flag: `gh api repos/OWNER/REPO/releases/latest` (the unauthenticated API rate-limits quickly).
  - Licence: AGPL for MegaLinter; BSL for Qlty, with an AI-coding-service clause.
  - SARIF or JSON output.
  - Whether fixes are classified safe or unsafe.
  - Whether it can run pinned and temporary.
  - For JVM plugins, whether the version resolves on Maven Central.
- **Step 5: run the cross-language layer.**
  - Structural search: ast-grep, or Semgrep/Opengrep.
  - Duplication: jscpd.
  - Complexity: lizard.
  - Size: scc or tokei.
  - Churn hotspots: `scc --hotspots`, git log, or code-maat.
- **Step 6:** collect SARIF/JSON, check coverage and exit codes, triage, and fix in small, separate commits. Re-run everything and compare before and after (`sarif diff` gives per-rule count and location deltas; fingerprint-level matching needs jq).

**CROSS-LANGUAGE TOOL TABLE (corrected)**

- **scc**
  - Install: `go install github.com/boyter/scc/v4@v4.1.0`.
  - Run: `scc --by-file --format json --no-cocomo`.
  - Formats: tabular, wide, json, json2, csv, csv-stream, cloc-yaml, html, html-table, sql, sql-insert, openmetrics.
  - Its complexity number is a per-file approximation that "fails to identify recursive methods", not per-function cyclomatic complexity.
  - v4.1.0 also has `--hotspots` (complexity × change frequency) and `--coupling`.
- **tokei**
  - Install: `cargo install tokei --locked --root <tmp>`.
  - Run: `tokei -o json`.
  - JSON works without features; YAML/CBOR need `--features all`.
- **lizard**
  - Run: `uvx lizard@<ver> -C 15 -w .` (default CCN threshold 15).
  - Outputs: `--csv`, `--xml`, `--html`, and `-w` for gcc-style warnings.
  - Covers 26 languages and does no preprocessing.
  - Exits non-zero when there are warnings.
  - On incorrect syntax it can fail softly and silently (omission or misinterpretation).
- **jscpd v5**
  - Run: `pnpm dlx jscpd@5.3.2 --reporters json,sarif --output report/ --fail-on-empty .`.
  - Defaults: min-tokens 50, min-lines 5, mode mild.
  - 15 reporters, including sarif and ai.
  - Also has `--baseline` / `--fail-on-new-clones`.
  - Note: 5.3.2 is hours old at check time; a `minimumReleaseAge` policy would refuse it.
- **ast-grep**
  - Install: npm `@ast-grep/cli`, pip `ast-grep-cli`, or `cargo install ast-grep --locked`.
  - Search/rewrite: `ast-grep run -p PAT [-r REWRITE] -l LANG --json=stream`. Exit 0 means matches, 1 means none.
  - Rules: `ast-grep scan --inline-rules ... --format sarif`. Exit 1 only if an error-severity rule matches.
  - On Linux, call `ast-grep`, not `sg`.
- **Semgrep CE**
  - Run: `semgrep scan --config <explicit rules> --metrics=off --sarif-output=f.sarif --json-output=f.json`.
  - Add `--error` to exit 1 on findings.
  - `--baseline-commit` shows only new findings.
  - `--autofix --dryrun` previews fixes.
  - CE analysis is intraprocedural; cross-file analysis is in paid Semgrep Code only.
  - Registry rules are under the Semgrep Rules License v1.0: "internal business purposes" only.
- **Opengrep** (LGPL-2.1 fork)
  - Run: `opengrep scan --sarif-output=sarif.json -f rules .`.
  - `--taint-intrafile` adds inter-method taint within a file.
- **MegaLinter**
  - Run: `npx mega-linter-runner --flavor <f> --release v10.1.0 -e 'SARIF_REPORTER=true'`.
  - Needs Node and Docker; AGPL-3.0. `--release` defaults to `latest`, so always pass it.
- **super-linter**
  - Run: `docker run -e RUN_LOCAL=true -v <repo>:/tmp/lint ghcr.io/super-linter/super-linter:<pinned tag or digest>` (from docs/run-linter-locally.md).
  - `SAVE_SUPER_LINTER_OUTPUT=true` writes outputs, "most" in JSON.
- **Qlty**
  - Commands: `qlty init`; `qlty check --all`; `qlty smells --all`; `qlty metrics --max-depth=2 --sort complexity --all`.
  - 70+ tools, 40+ languages, BSL 1.1.
- **SonarQube Community Build**
  - Run: `docker run --rm -e SONAR_HOST_URL -e SONAR_TOKEN -v <repo>:/usr/src sonarsource/sonar-scanner-cli`. Needs a server.
- **pre-commit:** `pre-commit run --all-files`; `pre-commit autoupdate --freeze`.
- **sarif-tools:** `sarif summary`, `sarif diff`, `sarif csv`, `sarif blame`, `sarif trend`.
- **Codemod tools**
  - jscodeshift: `npx jscodeshift -t t.js --dry --print`.
  - LibCST: `python3 -m libcst.tool codemod Mod.Cmd .`.
  - OpenRewrite: `mvn -U org.openrewrite.maven:rewrite-maven-plugin:<version on Maven Central, 6.46.1 on 2026-09-23>:dryRun -Drewrite.activeRecipes=...` writes `target/site/rewrite/rewrite.patch`.
  - rust-analyzer SSR: `foo($a,$b) ==>> ($a).foo($b)`.
  - clang-tidy: `-p build --export-fixes=fixes.yaml`, then `clang-apply-replacements`.
- **Per-language SARIF/JSON outputs**
  - `ruff check --output-format sarif`
  - golangci-lint `output.formats` sarif
  - `eslint -f @microsoft/eslint-formatter-sarif -o out.sarif` (package v3.1.0)
  - `go vet -json`
  - `dotnet format --report <dir>` (JSON)

## Findings

### T25-F08 — Triage every tool finding before editing code
Label each finding true positive, false positive or won't-fix, with a one-line reason tied to the code. Fix only true positives, ranked by correctness and security first, then maintainability. On already-shipped code, expect most warnings not to be real bugs. An LLM may pre-filter findings, but its verdict must rest on code evidence, not on the warning text alone.
- **Grade:** A · **Verdict:** VERIFIED. All figures matched the primary texts. Wording tightened: Google defines an "effective false positive" as an issue after which developers "did not take positive action", and its 10% gate is a ratio of "Not useful" to "Please fix" clicks.
- **Rationale:** Measured false-positive and low-value rates are high, especially for code that has already shipped.
  - Google's FindBugs Fixit (May 2009) reviewed 3,954 warnings (42% of 9,473). Bugs were filed for 44% (1,746), but only 16% (640) were fixed.
  - Google developers judged 74% of compile-time issues "real problems" against 21% of issues found in checked-in code. The paper attributes the gap to the "survivor effect".
  - An industrial Tencent study had 328 false positives among 433 alarms, at 10–20 minutes of manual inspection per alarm. Hybrid LLM plus static-analysis techniques removed 94–98% of false positives "with high recall".
  - SonarQube "bug" violations were generally not fault-prone in 21 mature Java projects.
- **Evidence:**
  - [Lessons from Building Static Analysis Tools at Google](https://storage.googleapis.com/gweb-research2023-media/pubtools/4365.pdf). Sadowski, Aftandilian, Eagle, Miller-Cushon, Jaspan (Google), CACM 61(4), April 2018, DOI 10.1145/3188720. Peer-reviewed magazine article.
    - Quote: "They reviewed a total of 3,954 such warnings (42% of 9,473 total), but only 16% (640) were actually fixed, despite the fact that 44% of reviewed issues (1,746) resulted in a bug report being filed."
    - Quote: "survey participants deemed 74% of the issues flagged at compile time as 'real problems,' compared to 21% of those found in checked-in code."
    - Quote: code-review checks must "Produce less than 10% effective false positives."
    - Verification: PDF downloaded and all three passages found verbatim.
  - [Reducing False Positives in Static Bug Detection with LLMs: An Empirical Study in Industry](https://arxiv.org/abs/2601.18844). Du, Feng, Zou, Xu, Ma, Zhang, Liu, Peng, Lou (Tencent / Fudan), arXiv 2026-01-26. Preprint.
    - Quote: "433 alarms (328 false positives, 105 true positives)... 10-20 minutes of manual inspection per alarm... hybrid techniques of LLM and static analysis eliminate 94-98% of false positives with high recall."
    - Verification: arXiv API abstract matches.
  - [Are SonarQube Rules Inducing Bugs?](https://arxiv.org/abs/1907.00376). Lenarduzzi, Lomio, Huttunen, Taibi, SANER 2020. Peer-reviewed.
    - Quote: "violations considered as 'bugs' by SonarQube were generally not fault-prone."
    - Verification: arXiv abstract matches; 21 projects confirmed.
  - [Why don't software developers use static analysis tools to find bugs?](https://doi.org/10.1109/icse.2013.6606613). Johnson, Song, Murphy-Hill, Bowdidge, ICSE 2013. Peer-reviewed.
    - Quote: from interviews with 20 developers, "false positives and the way in which the warnings are presented, among other things, are barriers to use."
    - Verification: OpenAlex abstract matches.
  - [HN comment on code-quality tool evaluation](https://news.ycombinator.com/item?id=49727585). HN user paimapi, 2026-09-16. Practitioner.
    - Quote: "reviewing and validating a lot of tools like this (qlty, Sonarqube, fallow, etc) and the false positive rate is anywhere from 20% to 80% for a lot of our sniff tests."
    - Verification: Firebase API text matches; thread is "ImpactGate: A merge gate that scores the structural decay AI adds".
- **Detect:**
  - Keep a triage table next to the report, keyed by SARIF fingerprint (or rule id plus location). Columns: status (TP/FP/WONTFIX), evidence (code line or test), fix commit.
  - Gate: no code edit may cite a finding whose status is not TP.
  - Track the false-positive ratio per rule. If a rule goes above about 10% (in the spirit of Google's Tricorder gate), disable or down-rank it for the rest of the run.
- **Tools:** sarif-tools (`sarif csv`), jq, the project's test suite.
- **Applies to:** All static-analysis output on finished or legacy code.
- **When not to apply / counterpoints:**
  - Google's SWE book reports an overall effective false-positive rate "just below 5%" for curated analyzers, so low noise is possible with strict curation. The high rates come from default or broad rule sets.
  - The Tencent result is a single-company preprint on three bug types from one enterprise-customised tool; do not extrapolate it.
- **Fix risk:** low

### T25-F07 — Never report "clean" or "no security issues" from tool output
State each tool's scope and known blind spots in the report. Run complementary tools, for example a structural/SAST tool plus the language linter plus a type checker. Turn any bug pattern found by hand into a custom ast-grep or Semgrep rule and scan the whole repo for siblings.
- **Grade:** A · **Verdict:** VERIFIED. Attribution completed: the Semgrep* authors are Bennett, Hall, Winter, Counsell. Two nuances added: Opengrep's intrafile taint, and the in-sample nature of the Semgrep* custom-rule gain.
- **Rationale:** Peer-reviewed benchmarks on real vulnerabilities show low recall.
  - Seven free Java SAST tools detected 12.7% of real-world vulnerabilities. Even with all tools combined, 70.9% stayed undetected.
  - Four tools on production code found 11.2–26.5% each and 38.8% combined. Semgrep with new rules found 44.7%.
  - For C/C++, a single SAST tool warned in the vulnerable functions of 52% of vulnerability-contributing commits (VCCs). At least 76% of those warnings were irrelevant, and 22% of VCCs went undetected.
  - Semgrep Community Edition is intraprocedural; cross-file analysis is paid-only.
- **Evidence:**
  - [Comparison and Evaluation on Static Application Security Testing (SAST) Tools for Java](https://doi.org/10.1145/3611643.3616262). Kaixuan Li, Sen Chen, Lingling Fan et al., ESEC/FSE 2023. Peer-reviewed.
    - Quote: "only 12.7% of real-world vulnerabilities can be detected by the selected tools. Even combining the detection capability of all tools, most vulnerabilities (70.9%) remain undetected."
    - Verification: OpenAlex abstract matches.
  - [Semgrep*: Improving the Limited Performance of Static Application Security Testing (SAST) Tools](https://doi.org/10.1145/3661167.3661262). Bennett, Hall, Winter, Counsell, EASE 2024. Peer-reviewed.
    - Quote: "detection rates of individual tools range from 11.2% to 26.5%, but combining these four tools can detect 38.8%... Our newly configured Semgrep tool detects 44.7% of vulnerabilities."
    - Verification: OpenAlex abstract matches.
  - [An Empirical Study of Static Analysis Tools for Secure Code Review](https://arxiv.org/abs/2407.12241). Charoenwet, Thongtanunam, Pham, Treude, ISSTA 2024. Peer-reviewed.
    - Quote: "a single SAST can produce warnings in vulnerable functions of 52% of VCCs... at least 76% of the warnings in vulnerable functions are irrelevant to the VCCs, and 22% of VCCs remain undetected."
    - Verification: arXiv abstract matches; ISSTA acceptance noted in the arXiv comment.
  - [Semgrep docs: cross-file analysis](https://docs.semgrep.dev/semgrep-code/semgrep-pro-engine-intro). Semgrep, 2026. Official docs.
    - Quote: cross-file analysis "Accounts for information flowing between files, including cross-file taint analysis, constant propagation, and type inference". Semgrep CE "can only analyze interactions within a single function".
    - Verification: page fetched.
  - [Opengrep README](https://github.com/opengrep/opengrep/blob/main/README.md). Opengrep, 2026. Official docs.
    - Quote: "Superior Taint Analysis (`--taint-intrafile`): ... Inter-method taint flow"; created because "Semgrep moved critical features behind a commercial licence."
    - Verification: added by the verifier; page fetched.
- **Detect:**
  - Manual check of the final report: every "clean" statement must name the tools, versions, rule packs and scope, e.g. "Semgrep CE 1.177.0, p/default, intraprocedural only".
  - For each confirmed manual finding, write a rule (`ast-grep scan --inline-rules '<yaml>' --json=stream`, or a Semgrep YAML rule), run it repo-wide, and list sibling occurrences.
- **Tools:** semgrep/opengrep custom rules, `ast-grep scan --inline-rules`, language type checkers, CodeQL where applicable.
- **Applies to:** Security and correctness claims in any language, especially C/C++, Java and web backends.
- **When not to apply / counterpoints:**
  - These benchmarks measure security vulnerabilities, not maintainability smells.
  - Adding tools raises recall and noise together (T25-F08).
  - The Semgrep* 44.7% comes from rules written for patterns missed on the same curated dataset, so it is an in-sample upper bound, not a generalisable recall.
- **Fix risk:** low

### T25-F06 — Before trusting "no findings", confirm the files were analysed and read the exit-code contract
Record files scanned, files skipped and parse errors per tool. Treat "zero files" or "parse errors on N files" as a failed run, not a clean one.
- **Grade:** A · **Verdict:** CORRECTED.
  - Semgrep exit codes fixed: 5 = invalid YAML config, 7 = at least one invalid rule, 8 = unknown language.
  - Semgrep JSON `paths.skipped` is present only with `--verbose`.
  - tokei's JSON works without features.
  - clang-tidy can also take flags after `--`.
  - Added: lizard exits non-zero on warnings and fails softly on bad syntax.
- **Rationale:** Exit codes and empty-scan behaviour differ between tools, so a generic "exit 0 = clean" check misreads results.
  - **Semgrep:** exits 0 even with findings unless `--error` is passed; 2 means it failed. Its JSON carries `paths.scanned` and `errors`; `paths.skipped` appears only with `--verbose`.
  - **ast-grep:** `run` exits 1 when nothing matches. `scan` exits 1 only when an error-severity rule matches.
  - **jscpd:** prints a warning and still exits 0 when it analysed no files, unless `--fail-on-empty` is set.
  - **lizard:** covers a fixed list of 26 languages and does no preprocessing. On incorrect or unknown syntax it may silently omit or misinterpret code ("soft failures").
  - **clang-tidy:** without a compile database or explicit flags it cannot see the real build configuration.
- **Evidence:**
  - [Semgrep CLI reference (exit codes)](https://docs.semgrep.dev/cli-reference). Semgrep, 2026. Official docs.
    - Quote: "0: Semgrep ran successfully and found no errors (or did find errors, but the --error flag is not being used). 1: ... found issues in your code (while using the --error flag). 2: Semgrep failed. 3: Invalid syntax of the scanned language ... only while using the --strict flag. 4: ... invalid pattern ... 5: Semgrep configuration is not valid YAML. 7: At least one rule in the configuration is invalid. 8: Semgrep does not understand specified language."
    - Verification: raw page grepped; the researcher's labels for 7 and 8 were wrong.
  - [semgrep_output_v1.atd](https://raw.githubusercontent.com/semgrep/semgrep-interfaces/main/semgrep_output_v1.atd). Semgrep, 2026. Official schema.
    - Quote: `cli_output` has `errors: cli_error list`; `paths <doc text="targeting information">: scanned_and_skipped` with `scanned: fpath list` and "Note that you get this field only if you use semgrep --verbose ... ?skipped: skipped_target list option".
    - Verification: file downloaded; the `--verbose` caveat was added.
  - [ast-grep run reference](https://ast-grep.github.io/reference/cli/run.html) and [ast-grep scan reference](https://ast-grep.github.io/reference/cli/scan.html). ast-grep, 2026. Official docs.
    - Quote (run): "0: at least one line matches, 1: no matches found".
    - Quote (scan): "1: if at least one rule matches (if severity setted to error) 0: if no rules match"; `--format` github | sarif.
    - Verification: both pages fetched.
  - [jscpd Rust engine docs](https://github.com/kucherenko/jscpd/blob/master/docs/rust.md). Andrey Kucherenko, 2026. Official docs.
    - Quote: "A scan that analyzes no files ... prints `Warning: jscpd analyzed no files` and still exits 0 ... `--fail-on-empty` (config key `failOnEmpty`) turns that into an error".
    - Verification: raw markdown grepped.
  - [ESLint Command Line Interface](https://eslint.org/docs/latest/use/command-line-interface). ESLint, 2026. Official docs.
    - Quote: exit 0 = no linting errors; 1 = at least one linting error (or too many warnings under `--max-warnings`); 2 = "configuration problem or an internal error". `--max-warnings` default -1.
    - Verification: page fetched.
  - [lizard README](https://github.com/terryyin/lizard). Terry Yin, 2026. Official docs.
    - Quote: 26-language list; "C/C++ preprocessing or macro expansion is not performed"; incorrect syntax can cause "omission, misinterpretation, improper analysis"; "The exit code of lizard will be none-Zero if there are warnings."
    - Verification: README.rst downloaded. Lizard "doesn't require all the header files or Java imports"; the researcher's phrasing "does not parse" was slightly off.
  - [Clang-Tidy documentation](https://clang.llvm.org/extra/clang-tidy/). LLVM Project, 2026. Official docs.
    - Quote: "-p <build-path> is used to read a compile command database... When no build path is specified, a search for compile_commands.json will be attempted through all parent paths". Compilation options can also be given after `--`.
    - Verification: page fetched.
  - [tokei source (src/input.rs, Cargo.toml)](https://github.com/XAMPPRocky/tokei). XAMPPRocky, 2026. Source code.
    - Data: `Format::Json` is unconditional and `serde_json` is a non-optional dependency. Only `cbor` and `yaml` are feature-gated.
    - Verification: the researcher's "tokei without features cannot serialise output" is wrong for JSON.
- **Detect:** for each tool, compare the number of files analysed against the scc/tokei file count for that language.
  - Semgrep: run with `--verbose` when you need the skipped list, then `jq '.paths.scanned|length, (.errors|length), (.paths.skipped // [] | length)' semgrep.json`.
  - jscpd: always pass `--fail-on-empty`.
  - ESLint: exit 2 means a config failure, not "no issues".
  - ast-grep run: exit 1 means "no match", not an error.
  - clang-tidy: check that `compile_commands.json` exists or that flags were passed.
  - lizard: list files whose extension is not on its language list.
- **Tools:** semgrep JSON, `jscpd --fail-on-empty`, ast-grep, eslint, lizard, clang-tidy, scc/tokei (as the denominator).
- **Applies to:** Every automated run, and especially the final "clean" claim in a hardening report.
- **When not to apply / counterpoints:**
  - Some tools do not report what they skipped at all. There the only check is a planted-violation smoke test: add a known-bad snippet in a temporary copy and confirm it is flagged.
  - Parse errors on intentionally invalid fixtures or templates may be expected. List them rather than failing the run.
- **Fix risk:** low

### T25-F05 — Prefer SARIF 2.1.0, else JSON; merge all results into one list; never parse console prose
- **Grade:** A · **Verdict:** CORRECTED. `sarif diff` semantics fixed (rule-code and count deltas plus new locations, not fingerprint matching). GitHub's truncation behaviour added. jscpd's SARIF fingerprint key added.
- **Rule:** Merge all results into one list with rule id, severity, file, line and fingerprint.
  - **Native SARIF:** `semgrep --sarif-output`, `opengrep --sarif-output`, `ast-grep scan --format sarif`, `ruff --output-format sarif`, golangci-lint `output.formats` sarif, `jscpd --reporters sarif`, `eslint -f @microsoft/eslint-formatter-sarif`, MegaLinter `SARIF_REPORTER=true`.
  - **JSON/CSV/XML/YAML only:** `scc --format json`, `tokei -o json`, `lizard --csv/--xml`, `go vet -json`, `dotnet format --report`, `clang-tidy --export-fixes` (YAML).
  - Summarise with `sarif summary`. For before/after, use `sarif diff` for per-rule deltas plus jq on fingerprints for result-level matching.
- **Rationale:**
  - SARIF 2.1.0 (Plus Errata 01, 28 Aug 2023) is the current OASIS standard; no later version is published on docs.oasis-open.org. It carries rule ids, locations and fingerprints.
  - GitHub caps uploads at 10 MB gzipped per file, 20 runs per file and 25,000 results per run. Beyond that it keeps the top 5,000 by severity. It deduplicates on `partialFingerprints.primaryLocationLineHash`.
  - MegaLinter's aggregated SARIF includes only SARIF-capable linters, so gaps must be filled from each tool's own JSON.
- **Evidence:**
  - [SARIF Version 2.1.0 Plus Errata 01](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html). OASIS, 2023. Standard.
    - Quote: "OASIS Standard incorporating Approved Errata, 28 August 2023"; "This document defines a standard format for the output of static analysis tools."
    - Verification: fetched. The directory index lists only v2.0 and v2.1.0.
  - [SARIF support for code scanning](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning). GitHub Docs, 2026. Official docs.
    - Quote: "For each gzip-compressed SARIF file, SARIF upload supports a maximum size of 10 MB." Results per run 25,000 ("Top 5,000 by severity" on truncation); runs per file 20. "Code scanning only uses the primaryLocationLineHash."
    - Verification: fetched.
  - [MegaLinter SARIF reporter](https://megalinter.io/latest/reporters/SarifReporter/). OX Security, 2026. Official docs.
    - Quote: "Only linters able to handle SARIF will provide output in the aggregated SARIF file." `SARIF_REPORTER` defaults to false; output is `mega-linter-report.sarif`.
    - Verification: fetched.
  - [Ruff configuration (CLI help)](https://docs.astral.sh/ruff/configuration/). Astral, 2026. Official docs.
    - Quote: `--output-format` possible values "concise, full, json, json-lines, junit, grouped, github, gitlab, pylint, rdjson, azure, sarif".
    - Verification: raw page grepped.
  - [golangci-lint configuration file](https://golangci-lint.run/docs/configuration/file/). golangci-lint, 2026. Official docs.
    - Quote: sarif: "Prints issues in the SARIF format."
    - Verification: fetched.
  - [@microsoft/eslint-formatter-sarif README](https://github.com/microsoft/sarif-js-sdk/tree/main/packages/eslint-formatter-sarif). Microsoft, 2026. Official docs.
    - Quote: "eslint -f @microsoft/eslint-formatter-sarif -o yourfile.sarif yourfile.js"; "you can use the form `-f @microsoft/sarif`". The short form `-f sarif` does not work.
    - Verification: raw README; npm latest 3.1.0.
  - [microsoft/sarif-tools](https://github.com/microsoft/sarif-tools). Microsoft, 2025 (v3.0.5). Official docs.
    - Quote: "diff Find the difference between two [sets of] SARIF files".
    - Output format: "+" = "new issue types at this severity", "-" = resolved issue types, and "codes" lists each issue code whose occurrence count changed, with "+@" new locations.
    - Verification: the researcher's "new, resolved and changed issues" overstated the granularity. It works per rule code, not per fingerprinted result.
  - [jscpd Rust engine docs](https://github.com/kucherenko/jscpd/blob/master/docs/rust.md). jscpd, 2026. Official docs.
    - Quote: "File reporters write into the --output directory (default report/) using the jscpd-report.* prefix"; 15 built-in reporters; the baseline uses "the same hash the SARIF reporter emits as `partialFingerprints["jscpdCloneHash/v1"]`". The README claims "~79% fewer tokens than the default console reporter" for `ai` (vendor claim).
    - Verification: raw markdown grepped.
- **Detect:**
  - For every tool in the plan, confirm a documented JSON/SARIF flag and write output to files.
  - Run `uvx --from sarif-tools sarif summary <dir>`.
  - Check that every result has a ruleId and a location: `jq '[.runs[].results[] | select(.ruleId==null or .locations==null)] | length' f.sarif` should print 0.
- **Tools:** SARIF 2.1.0, sarif-tools, jq, semgrep/opengrep, ast-grep, ruff, golangci-lint, jscpd, @microsoft/eslint-formatter-sarif, MegaLinter SARIF reporter.
- **Applies to:** All tool runs whose output an agent will read, compare or report.
- **When not to apply / counterpoints:**
  - SARIF quality varies: some tools omit fingerprints, and some map every issue to "warning".
  - Metric tools (lizard, scc, tokei) have no SARIF at all.
  - Large SARIF files flood an agent's context. Summarise with sarif-tools or jq, or use compact outputs (jscpd `ai`, `ast-grep --json=stream`).
- **Fix risk:** low

### T25-F03 — Run audit tools in temporary, isolated environments at exact versions; never add them to the project just to audit
- **Grade:** A · **Verdict:** CORRECTED.
  - pnpm details updated: in pnpm 12 the command is `pnx` (aliases `pnpm dlx`, `pnpx`). Release-age and trust policies apply only when configured. The executed package's own postinstall runs by default.
  - Transitive-mutable-ref lesson added from CVE-2025-30154.
  - Caution added about pinning same-day releases.
- **Rule:**
  - Use `pnpm dlx <pkg>@<x.y.z>` (`pnx`), `uvx <tool>@<x.y.z>`, `cargo install --locked --root <tmpdir> <crate>`, or `docker run --rm <image>@sha256:<digest>`.
  - For pre-commit, use frozen SHAs (`pre-commit autoupdate --freeze`).
  - Tools that need the project's dependencies (pytest, mypy, tsc, eslint with plugins) run in the project's own environment (`uv run`, `pnpm exec`).
  - Never use `@latest`, `:latest` or mutable tags such as `@v1`. This includes tags referenced inside composite actions you depend on.
- **Rationale:** Mutable references to lint tooling have been hijacked in the wild.
  - reviewdog/action-setup@v1 was compromised on 2025-03-11 between 18:42 and 20:31 UTC and dumped secrets into workflow logs (CVE-2025-30154, CVSS 8.6). Other reviewdog actions that used it internally (action-shellcheck, action-staticcheck, action-ast-grep, action-typos, action-composite-template) were compromised "regardless of version or pinning method".
  - eslint-config-prettier 8.10.1/9.1.1/10.1.6/10.1.7 ran `node-gyp.dll` malware on Windows at install (CVE-2025-54313).
  - GitHub's docs state that a full commit SHA is the only immutable action reference. Docker documents digest pinning.
- **Evidence:**
  - [uv docs: Using tools](https://docs.astral.sh/uv/guides/tools/). Astral, 2026. Official docs.
    - Quote: "Tools are installed into temporary, isolated environments when using uvx"; `command@<version>`; for pytest or mypy, "you'll want to use uv run instead of uvx".
    - Verification: fetched.
  - [pnpm: pnx (aliases pnpm dlx, pnpx)](https://pnpm.io/cli/dlx). pnpm, 2026 (docs default 12.x). Official docs.
    - Quote: "Fetches a package from the registry without installing it as a dependency, hotloads it, and runs whatever default command binary it exposes."
    - Quote: "Since v11.0.0, pnx ... honors the project-level security and trust policy settings ... minimumReleaseAge ... trustPolicy ... This means pnx will refuse to execute freshly published or insufficiently trusted packages".
    - Quote: "The actual packages executed by dlx are allowed to run postinstall scripts by default." Dependency build scripts are skipped or prompted.
    - Verification: raw page grepped.
  - [cargo install](https://doc.rust-lang.org/cargo/commands/cargo-install.html). Cargo Book, 2026. Official docs.
    - Quote: `--root` "Directory to install packages into."; "By default, the Cargo.lock file that is included with the package will be ignored... The --locked flag can be used to force Cargo to use the packaged Cargo.lock file if it is available."
    - Verification: fetched.
  - [docker image pull](https://docs.docker.com/reference/cli/docker/image/pull/). Docker Docs, 2026. Official docs.
    - Quote: "When pulling an image by digest, you specify exactly which version of an image to pull. Doing so, allows you to 'pin' an image to that version, and guarantee that the image you're using is always the same."
    - Verification: fetched.
  - [pre-commit](https://pre-commit.com/). pre-commit, 2026. Official docs.
    - Quote: "the value of rev is an immutable ref (such as a tag or SHA)"; `--freeze`: "Store 'frozen' hashes in rev instead of tag names"; "Each hook is initialized in a separate environment appropriate to the language".
    - Verification: fetched. Note that pre-commit assumes tags are immutable; GitHub's docs say tags can be moved, so `--freeze` is the safe form.
  - [Secure use reference (GitHub Actions)](https://docs.github.com/en/actions/reference/security/secure-use). GitHub Docs, 2026. Official docs.
    - Quote: "Pinning an action to a full-length commit SHA is currently the only way to use an action as an immutable release"; "a tag can be moved or deleted if a bad actor gains access to the repository".
    - Verification: fetched.
  - [CVE-2025-30154](https://cveawg.mitre.org/api/cve/CVE-2025-30154). MITRE / GHSA-qmg3-hpqr-gqvc, 2025. Incident record.
    - Quote: "reviewdog/action-setup@v1 was compromised March 11, 2025, between 18:42 and 20:31 UTC ... dumps exposed secrets to Github Actions Workflow Logs. Other reviewdog actions that use reviewdog/action-setup@v1 ... would also be compromised, regardless of version or pinning method".
    - Verification: MITRE API, published 2025-03-19, CVSS 3.1 8.6.
  - [CVE-2025-54313](https://cveawg.mitre.org/api/cve/CVE-2025-54313). MITRE, 2025. Incident record.
    - Quote: "eslint-config-prettier 8.10.1, 9.1.1, 10.1.6, and 10.1.7 has embedded malicious code... Installing an affected package executes an install.js file that launches the node-gyp.dll malware on Windows."
    - Verification: MITRE API, published 2025-07-19, CVSS 7.5.
- **Detect:**
  - `git grep -nE '(npx|pnpm dlx|pnx|bunx) [@a-z][^ @]*( |$)|@latest\b|:latest\b|uses: [^@]+@v?[0-9]+(\.[0-9]+)?$|rev: (main|master|HEAD)$|uvx [a-z-]+( |$)'`.
  - In the agent's own command log, every tool invocation must carry an exact version or digest.
  - `git diff --stat -- package.json pnpm-lock.yaml pyproject.toml uv.lock` must show no audit-only dependencies.
- **Tools:** pnpm dlx/pnx, uvx, `cargo install --locked --root`, docker digest pinning, `pre-commit autoupdate --freeze`, git grep.
- **Applies to:** Every tool run by the hardening agent, and the audited project's CI configs.
- **When not to apply / counterpoints:**
  - Pinning freezes bugs and misses new rules, so pin a recent version and record it in the report.
  - An exact pin does not protect against a deliberately pinned malicious version. A release-age delay helps there, e.g. jscpd 5.3.2 was hours old at check time.
  - SHA-pinning a composite action does not protect against mutable refs inside it (CVE-2025-30154).
  - Air-gapped setups need pre-pulled images.
- **Fix risk:** low

### T25-F04 — Treat running analyzers as executing project code, and "auto" rule configs as sending data out
- **Grade:** A · **Verdict:** CORRECTED. The pnpm statement was narrowed: the executed package's own postinstall runs by default, while dependency build scripts are skipped or prompted. The Semgrep quote was aligned with the CLI help text.
- **Rule:**
  - Run build-aware tools (dotnet format/analyzers, cargo clippy/check, anything that restores packages or loads JS/Python config and plugins) only on trusted code, or in a throwaway container with no credentials in the environment.
  - On proprietary code, prefer explicit local or pinned rule packs and turn telemetry off (Semgrep `--metrics=off`, not `--config auto`).
- **Rationale:**
  - Microsoft warns that `dotnet format` may restore, compile and run analyzers.
  - Cargo compiles and runs `build.rs` before building.
  - Semgrep `--config auto` logs in to the registry with the project URL, and metrics default to "auto".
- **Evidence:**
  - [dotnet format command](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-format). Microsoft Learn, updated 2026-09-18. Official docs.
    - Quote: "dotnet format may restore, compile, and run analyzers from the specified project or solution. Only invoke the tool against trusted code."
    - Verification: fetched verbatim. `--no-restore` also exists.
  - [Cargo Book: Build Scripts](https://doc.rust-lang.org/cargo/reference/build-scripts.html). Rust project, 2026. Official docs.
    - Quote: "Placing a file named build.rs in the root of a package will cause Cargo to compile that script and execute it just before building the package."
    - Verification: fetched.
  - [Semgrep CLI reference](https://docs.semgrep.dev/cli-reference). Semgrep, 2026. Official docs.
    - Quote: "NOTE: Using `--config auto` will log in to the Semgrep Registry with your project URL." "By default, Semgrep will report pseudonymous usage metrics to its server if you pull your configuration from the Semgrep registry." `--metrics`: "If 'auto', metrics are sent whenever the --config value pulls from the Semgrep server or if the user is logged in... If 'off', metrics are disabled altogether".
    - Verification: raw page grepped.
  - [pnpm pnx / dlx](https://pnpm.io/cli/dlx). pnpm, 2026. Official docs.
    - Quote: "The actual packages executed by dlx are allowed to run postinstall scripts by default."
    - Verification: raw page grepped.
- **Detect:**
  - Check each tool's docs for "restore", "compile", "build", "plugins" or "metrics".
  - Run `env | grep -iE 'token|secret|key|password' | cut -d= -f1` (names only; never print values) in the shell that will run the tools, and unset any hits.
  - Grep agent commands for `--config auto` without `--metrics=off`.
- **Tools:** docker/podman (throwaway container), `semgrep --metrics=off`, env scrubbing, `dotnet format --no-restore` where the solution is already restored.
- **Applies to:** C#/.NET, Rust, JS/TS (config files and plugins), Python (mypy plugins, pytest collection), and any tool with an "auto" or cloud rule mode.
- **When not to apply / counterpoints:** For the user's own trusted, finished project, full sandboxing is often overkill. The practical minimum is no secrets in the environment and pinned tools.
- **Fix risk:** low

### T25-F11 — Auto-apply only fixes the tools classify as safe; treat suggestions and unsafe fixes as manual edits
- **Grade:** A · **Verdict:** CORRECTED. The claim that clippy `--fix` applies only "machine-applicable" suggestions is not in the fetched docs; the docs only say it "can automatically apply some lint suggestions" and that `--fix` implies `--all-targets`. The practitioner counterpoint (HN 39559307) is now verified directly.
- **Rule:**
  - Safe fixes may be applied: ESLint `--fix`, Ruff default (safe-only) fixes, `cargo clippy --fix`, `dotnet format`.
  - Treat these as manual edits, reviewing each hunk and running the tests: ESLint suggestions, Ruff `--unsafe-fixes`, Semgrep `--autofix`, clang-tidy `--fix-errors`.
  - Always preview first: `--fix-dry-run`, `--dryrun`, `ruff check --diff`, OpenRewrite `dryRun`.
  - Commit one tool, or one rule, per commit.
- **Rationale:** Tool authors explicitly separate fixes by safety.
  - ESLint tells rule authors that fixes should never change runtime behaviour. Suggestions exist for changes that might, and are not applied by `--fix`.
  - Ruff documents that unsafe fixes can change runtime behaviour, e.g. `IndexError` becomes `StopIteration`.
  - Semgrep labels autofix as experimental, with possible data loss.
  - clang-tidy bails out on compile errors unless `--fix-errors` is given.
- **Evidence:**
  - [ESLint: Custom Rules](https://eslint.org/docs/latest/extend/custom-rules). ESLint, 2026. Official docs.
    - Quote: "Avoid any fixes that could change the runtime behavior of code and cause it to stop working." Suggestions are for when "a fix potentially changes functionality or if there are multiple valid ways to fix a rule"; they let "tools, such as editors, to expose helpers for users to manually apply".
    - Verification: raw page grepped.
  - [Ruff linter: fix safety](https://docs.astral.sh/ruff/linter/). Astral, 2026. Official docs.
    - Quote: "an unsafe fix could lead to a change in runtime behavior, the removal of comments, or both" (RUF015 example, IndexError to StopIteration); "Ruff only enables safe fixes by default."
    - Verification: raw page grepped.
  - [Semgrep CLI reference](https://docs.semgrep.dev/cli-reference). Semgrep, 2026. Official docs.
    - Quote: "-a, --autofix Apply autofix patches. WARNING: data loss can occur with this flag... this mode is experimental and not guaranteed to function properly." `--dryrun` "will print the changes to the console".
    - Verification: fetched.
  - [Clang-Tidy documentation](https://clang.llvm.org/extra/clang-tidy/). LLVM, 2026. Official docs.
    - Quote: "--fix - Apply suggested fixes. Without -fix-errors clang-tidy will bail out if any compilation errors were found."; "--export-fixes=<filename> - YAML file to store suggested fixes in. The stored fixes can be applied ... with clang-apply-replacements."
    - Verification: raw page grepped.
  - [Clippy usage](https://doc.rust-lang.org/clippy/usage.html). Rust project, 2026. Official docs.
    - Quote: "Clippy can automatically apply some lint suggestions, just like the compiler. Note that `--fix` implies `--all-targets`".
    - Verification: added by the verifier; replaces the unsupported "machine-applicable" wording.
  - [ESLint CLI](https://eslint.org/docs/latest/use/command-line-interface). ESLint, 2026. Official docs.
    - Quote: `--fix-dry-run` applies fixes without saving; `--fix-type` problem / suggestion / layout / directive.
    - Verification: fetched. Here "suggestion" is a rule *type*, not the suggestions feature.
  - [HN comment on structural replace](https://news.ycombinator.com/item?id=47853251). HN user nextaccountic, 2026-04-21. Practitioner.
    - Quote: "at every point you do a replace, you need to verify if it was the right thing to do or if it was a false positive... If there are hundreds, it's less appealing to check them manually."
    - Verification: Firebase API.
  - [HN comment: formatter broke a non-header .h file](https://news.ycombinator.com/item?id=39559307). HN user rurban, 2024-03-01. Practitioner.
    - Quote: "Turns out there was a .h file not a header, but some custom list of algorithm states, broken by fmt."
    - Verification: Firebase API; now verified directly.
- **Detect:**
  1. Preview: `eslint --fix-dry-run --format json`, `ruff check --diff`, `semgrep --autofix --dryrun`, `mvn ...rewrite-maven-plugin:<ver>:dryRun`.
  2. After applying: `git diff --stat` per commit, and the full test suite between tool commits.
  3. Grep the agent's command history for `--unsafe-fixes`, `--fix-errors`, `--autofix` without `--dryrun`, or `ast-grep ... -U`. Each needs an explicit per-hunk review note.
- **Tools:** eslint `--fix`/`--fix-dry-run`, ruff `--fix`/`--diff`, `cargo clippy --fix`, `dotnet format --verify-no-changes`, `semgrep --autofix --dryrun`, `clang-tidy --export-fixes`, OpenRewrite `dryRun`.
- **Applies to:** All autofix-capable tools in every language.
- **When not to apply / counterpoints:**
  - Even "safe" fixes can break code outside the tool's model: reflection, eval, generated code, templating, macros, or files with misleading extensions (HN 39559307).
  - Tests are the real check. A finished project with thin tests needs smaller batches.
- **Fix risk:** medium

### T25-F15 — Do not enable "everything"; start from defaults or recommended sets and add stricter rules one by one with a reason
- **Grade:** A · **Verdict:** CORRECTED. The Google rationale was restated: an analyzer is disabled when its ratio of "Not useful" to "Please fix" clicks goes above 10%, not "when under 10% of findings are ignored". The golangci-lint v2 syntax is `linters.default: all`.
- **Rule:**
  - Start from each tool's default or recommended set.
  - Add stricter groups rule by rule, with a written reason, keeping only rules with low false positives and a clear defect or maintainability link.
  - Reject configs that select Ruff `ALL`, the whole Clippy `restriction` group, or all golangci-lint linters (`linters.default: all`, or v1 `enable-all: true`), unless the tool version is pinned and each rule has been reviewed.
- **Rationale:**
  - Clippy says `restriction` should "emphatically" not be enabled as a whole, and `pedantic` has occasional false positives.
  - Ruff warns that `ALL` silently enables new rules on each upgrade.
  - Only a subset of SonarQube's Java rules relate to faults.
  - Google's Tricorder disables an analyzer whose "Not useful" ratio exceeds 10%.
- **Evidence:**
  - [Clippy documentation](https://doc.rust-lang.org/clippy/). Rust project, 2026. Official docs.
    - Quote: pedantic = "lints which are rather strict or have occasional false positives"; "The restriction category should, emphatically, not be enabled as a whole. The contained lints may lint against perfectly reasonable code, may not have an alternative suggestion, and may contradict any other lints".
    - Verification: fetched.
  - [Ruff linter docs](https://docs.astral.sh/ruff/linter/). Astral, 2026. Official docs.
    - Quote: "Use ALL with discretion. Enabling ALL will implicitly enable new rules whenever you upgrade. Start with a small set of rules (select = ["E", "F"]) and add a group at-a-time."
    - Verification: raw page grepped.
  - [Are SonarQube Rules Inducing Bugs?](https://arxiv.org/abs/1907.00376). Lenarduzzi et al., SANER 2020. Peer-reviewed.
    - Quote: "companies should carefully consider which rules they really need to apply, especially if their goal is to reduce fault-proneness."
    - Verification: arXiv abstract.
  - [Lessons from Building Static Analysis Tools at Google](https://storage.googleapis.com/gweb-research2023-media/pubtools/4365.pdf). Sadowski et al., CACM 2018. Peer-reviewed.
    - Quote: "The Tricorder team tracks such not-useful clicks, computing the ratio of 'Please fix' vs. 'Not useful' clicks. If the ratio for an analyzer goes above 10%, the Tricorder team disables the analyzer until the author(s) improve it."
    - Verification: PDF text.
  - [golangci-lint configuration file](https://golangci-lint.run/docs/configuration/file/). golangci-lint, 2026. Official docs.
    - Quote: `linters.default` accepts `standard` (default), `all`, `none`, `fast`.
    - Verification: added by the verifier.
- **Detect:** in pyproject.toml, ruff.toml, lib.rs/main.rs and .golangci.yml, run `git grep -nE 'select *= *\[[^]]*"ALL"|extend-select *= *\[[^]]*"ALL"|clippy::restriction|#!\[(warn|deny)\(clippy::(restriction|pedantic|nursery)\)\]|^\s*default: *all|enable-all: *true'`. For each strict group, require a pinned tool version and a per-rule allowlist.
- **Tools:** ruff, cargo clippy, golangci-lint, eslint, git grep.
- **Applies to:** Linter configuration changes proposed by the hardening pass, in all languages.
- **When not to apply / counterpoints:**
  - Some teams deliberately use `ALL` plus explicit ignores with a pinned version, so that new rules surface on upgrade. That is valid if upgrades are reviewed.
  - Strict groups can suit safety-critical code.
- **Fix risk:** low

### T25-F14 — Know what each cross-language metric measures; use metrics to rank, not as absolute pass/fail limits
- **Grade:** A · **Verdict:** VERIFIED. Added from the same sources: scc v4.1.0's `--hotspots`, and lizard's own caveat that it measures how complex code "looks".
- **Rule:**
  - Per-function cyclomatic complexity: lizard (default `-C 15`).
  - Size and composition only: scc or tokei. scc's "complexity" is a per-file count of branch tokens, not cyclomatic complexity, and misses recursion.
  - Duplication: jscpd (defaults min-tokens 50, min-lines 5, mode mild). Renamed or near-miss clones must be switched on explicitly with `--ignore-identifiers`, `--max-gap-lines` or `--similarity`.
- **Rationale:** Mixing up metric definitions leads to the wrong refactoring targets. For example, a long switch-heavy data file gets a high scc score even with trivial functions. The tools' own docs state their definitions, defaults and limits.
- **Evidence:**
  - [scc README](https://github.com/boyter/scc). Ben Boyter, 2026 (v4.1.0). Official docs.
    - Quote: complexity "tries to be an approximation of cyclomatic complexity ... although done only on a file level ... even if it fails to identify recursive methods. The goal was never for it to be exact." Also: `--hotspots` "render the hotspots report (files ranked by complexity × change frequency over recent git history)".
    - Verification: raw README, and README at tag v4.1.0 via the GitHub API.
  - [lizard README](https://github.com/terryyin/lizard). Terry Yin, 2026 (1.24.0). Official docs.
    - Quote: "-C CCN ... The default value is 15"; function-length default 1000; `-w` "clang/gcc's warning format"; `--csv`, `-X/--xml`, `-H/--html`, `-m` modified CCN; "This tool actually calculates how complex the code 'looks' rather than how complex the code really 'is'."
    - Verification: README.rst downloaded.
  - [jscpd Rust engine docs](https://github.com/kucherenko/jscpd/blob/master/docs/rust.md) and [README](https://github.com/kucherenko/jscpd). jscpd, 2026 (v5.3.2). Official docs.
    - Quote: `--min-tokens` 50, `--min-lines` 5; "`--mode mild` (default) drops whitespace tokens, `--mode weak` also drops comments, `--mode strict` keeps every token"; README: 224 formats, "default runs still report only `exact` clones".
    - Verification: raw markdown grepped.
- **Detect:**
  - Function complexity: `uvx lizard@<ver> --csv . > lizard.csv`, sorted by CCN and NLOC.
  - Size: `scc --by-file --format json --no-cocomo .`
  - Duplication: `pnpm dlx jscpd@<ver> --reporters json,sarif --output report/ --fail-on-empty .`, adding `--ignore-identifiers` for renamed clones.
- **Tools:** lizard, scc, tokei, jscpd.
- **Applies to:** All languages each tool supports; ranking inputs for T25-F10.
- **When not to apply / counterpoints:**
  - Thresholds such as CCN 15 are tool defaults, not validated defect cut-offs; see the complexity-metrics topic.
  - jscpd v5's `--dead-code` (JS/TS/Python only) and `--health` are new, vendor-described features with no independent evaluation found.
- **Fix risk:** low

### T25-F18 — On Git Bash / MSYS2, disable POSIX-to-Windows argument conversion for Docker and path-taking tools
Use `MSYS_NO_PATHCONV=1 docker run -v "$(pwd -W):/tmp/lint" ...`, `MSYS2_ARG_CONV_EXCL`, or a doubled leading slash. Check that the container sees the files before trusting results.
- **Grade:** A · **Verdict:** CORRECTED. Official docs confirm the mechanism, and two local reproductions confirm it on this machine. The researcher's claim that the linter then "sees no files and reports clean" is overstated and now given as a possible outcome, not a certain one. In the reproduction the bind mount silently pointed at a new, empty host directory, but a container path passed as an argument failed loudly.
- **Rationale:** Git Bash rewrites arguments that look like POSIX paths, including the container side of `-v host:/tmp/lint` (the `:` is treated as a path-list separator and becomes `;`) and bare container paths.
  - The mount can then silently point at the wrong (new, empty) directory. A tool that scans its default workspace would see nothing: the empty-scan failure of T25-F06.
  - A tool given the rewritten path as an argument usually errors instead.
  - This matters because the user works on Windows with Git Bash.
- **Evidence:**
  - [Git for Windows Release Notes (Known issues)](https://raw.githubusercontent.com/git-for-windows/build-extra/main/ReleaseNotes.md). Git for Windows, 2026. Official docs.
    - Quote: "If you specify command-line options starting with a slash, POSIX-to-Windows path conversion will kick in ... you need to set the environment variable MSYS_NO_PATHCONV temporarily ... Alternatively, you can double the first slash to avoid POSIX-to-Windows path conversion".
    - Verification: raw file grepped.
  - [MSYS2 docs: Filesystem Paths](https://www.msys2.org/docs/filesystem-paths/). MSYS2, 2026. Official docs.
    - Quote: "When calling native executables from the context of Cygwin, then all the arguments that look like Unix paths will get auto converted to Windows." "MSYS2_ARG_CONV_EXCL can either be * to mean exclude everything, or a list of one or more arguments prefixes separated by ;".
    - Verification: raw page grepped.
  - [super-linter: run locally](https://github.com/super-linter/super-linter/blob/main/docs/run-linter-locally.md). super-linter, 2026. Official docs.
    - Quote: `docker run -e LOG_LEVEL=DEBUG -e RUN_LOCAL=true -v /path/to/local/codebase:/tmp/lint --rm ghcr.io/super-linter/super-linter:latest`.
    - Verification: the command is in docs/run-linter-locally.md, not the main README.
  - Empirical check by the verifier on 2026-09-23 (Windows 11, Git Bash, Docker 29.2.1). This is a local reproduction, not a published source.
    - `python -c "import sys;print(sys.argv)" -v "$(pwd):/tmp/lint" /tmp/lint` received `C:\Users\...\Documents;C:\Users\...\Temp\lint` and `C:/Users/.../Temp/lint`.
    - `docker run --rm --entrypoint ls -v "$(pwd):/tmp/lint" <image> /tmp/lint` started the container, but the in-container path had been rewritten to a Windows temp path and did not exist.
    - With `MSYS_NO_PATHCONV=1` and `$(pwd -W)`, the probe file was listed. `C:/...:/src` built from `pwd -W` was left untouched even without the variable.
    - Second pass, same machine: `-v "$(pwd):/src"` reached native programs as `C:\...\pathconv_test;C:\Program Files\Git\src`, and `-v /c/repo:/src` as `C:\repo;C:\Program Files\Git\src`.
      - `docker run --rm --pull=never --entrypoint ls -v "$(pwd):/src" <local image> /src` printed `ls: cannot access 'C:/Program Files/Git/src'` (exit 2).
      - Docker Desktop also silently created an empty host directory named `pathconv_test;C` from the mangled bind spec. The mount was wrong without any error.
      - Adding `-w /src` made the daemon refuse with "the working directory 'C:/Program Files/Git/src' is invalid".
      - `MSYS_NO_PATHCONV=1 ... -v "$(pwd -W):/src" ... ls /src` listed `marker.txt`. The test directories were removed afterwards.
- **Detect:**
  - On Windows, if `uname -s` matches `MINGW*` or `MSYS*`, every `docker run -v`/`--mount` or `/`-prefixed argument needs `MSYS_NO_PATHCONV=1`.
  - Smoke test: `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/src" <image> ls /src | head` must list repo files.
- **Tools:** Git Bash, MSYS2, docker/podman.
- **Applies to:** Windows hosts using Git Bash or MSYS2, and any tool that takes `/`-prefixed arguments.
- **When not to apply / counterpoints:**
  - PowerShell and WSL do not do this conversion.
  - Disabling conversion globally breaks commands that rely on it, so scope it to single commands.
  - Whether the mangled run fails loudly or silently depends on the tool. In the reproduction, `ls` errored while the mount itself went wrong silently. A linter that scans its default workspace, or tolerates a missing path, could report "clean".
- **Fix risk:** low

### T25-F09 — On a finished codebase: baseline, fix what matters, suppress the rest through the tool's baseline mechanism
1. Record a baseline of the current findings.
2. Fix old findings that are (a) correctness or security issues, (b) in hotspots (T25-F10), or (c) safely auto-fixable (T25-F11).
3. Suppress the remainder through the tool's baseline mechanism, not per-line ignores, so new code meets the full standard.

Baseline mechanisms:
- ESLint bulk suppressions (v9.24.0+);
- Semgrep `--baseline-commit`;
- golangci-lint `new-from-rev` / `new-from-merge-base`;
- jscpd `--baseline` / `--fail-on-new-clones`;
- SonarQube "new code".

Do not mass-edit working code for low-value rules.
- **Grade:** B · **Verdict:** CORRECTED.
  - The Facebook source was upgraded from an HN quote to the primary CACM article (archived copy), with correct authors.
  - Caveat added: the "0% batch" figure comes from 20–30 assigned issues.
  - ESLint facts added: suppressions cover only "error" rules; run `--fix` first; available since v9.24.0.
- **Rationale:**
  - Google writes that old issues in working code are typically worth fixing only when particularly important.
  - Findings are acted on far more often when shown in the context of a change. At Facebook, Infer bug lists handed out in batch had a near-zero fix rate, while the same analysis at diff time reached over 70%.
  - Mature tools now ship baseline features for exactly this reason.
  - Each edit to tested legacy code is a chance to add a bug; see the practitioner question SE 158535, where "fixes" to silence warnings introduced bugs.
- **Evidence:**
  - [Software Engineering at Google, Ch. 20 Static Analysis](https://abseil.io/resources/swe-book/html/ch20.html). Chapter by Caitlin Sadowski, book eds. Winters, Manshreck, Wright, O'Reilly 2020. Book (free online edition).
    - Quote: "we generally focus on newly introduced warnings; existing issues in otherwise working code are typically only worth highlighting (and fixing) if they are particularly important (security issues, significant bug fixes, etc.)." "The overall effective false-positive rate is just below 5%."
    - Verification: fetched.
  - [Scaling Static Analyses at Facebook (archived full text)](https://web.archive.org/web/2023/https://cacm.acm.org/magazines/2019/8/238344-scaling-static-analyses-at-facebook/fulltext). Distefano, Fähndrich, Logozzo, O'Hearn, CACM 62(8), Aug 2019, DOI 10.1145/3338112. Peer-reviewed magazine article.
    - Quote: "the diff time deployment saw a 70% fix rate, where a more traditional 'offline' or 'batch' deployment ... saw a 0% fix rate." "We assigned 20-30 issues to developers, and almost none of them were acted on. We had worked hard to get the false positive rate down to what we thought was less than 20%... the fix rate rocketed to over 70%."
    - Verification: cacm.acm.org returns 403; the Wayback copy was fetched and passages found verbatim. HN item 20844718 (sqs) quotes the same text.
  - [SonarQube: About new code](https://docs.sonarsource.com/sonarqube-server/user-guide/about-new-code.md). SonarSource, 2026. Official docs.
    - Quote: "When you add new code to your projects, you usually touch a portion of the old code in the process. As a consequence, analyzing and cleaning new code allows you to fix issues in your old code and gradually improve the overall quality of your codebase."
    - Verification: fetched.
  - [ESLint: Bulk Suppressions](https://eslint.org/docs/latest/use/suppressions). ESLint, 2026. Official docs.
    - Quote: "While the rule will be enforced for new code, the existing violations will not be reported." "Only rules configured as 'error' are suppressed." "It is recommended to execute the command with the --fix flag so that you don't suppress violations that can be auto-fixed."
    - Verification: raw page grepped. The [v9.24.0 release post](https://eslint.org/blog/2025/04/eslint-v9.24.0-released/) says "This release introduces the bulk suppressions feature."
  - [Semgrep CLI reference](https://docs.semgrep.dev/cli-reference). Semgrep, 2026. Official docs.
    - Quote: "--baseline-commit ... Only show results that are not found in this commit hash. Aborts run if not currently in a git directory, there are unstaged changes, or given baseline hash doesn't exist."
    - Verification: raw page grepped.
  - [golangci-lint configuration file](https://golangci-lint.run/docs/configuration/file/). golangci-lint, 2026. Official docs.
    - Quote: new-from-rev: "Show only new issues created after git revision REV."; new-from-merge-base: "...after the best common ancestor (merge-base against HEAD)."
    - Verification: fetched.
  - [jscpd baseline docs](https://github.com/kucherenko/jscpd/blob/master/docs/rust.md). jscpd, 2026. Official docs.
    - Quote: "Gate CI on new duplication only, tolerating clones that already exist."
    - Verification: raw markdown.
  - [HN comment on adopting linters in legacy C++](https://news.ycombinator.com/item?id=39556049). HN user joshmarinacci, 2024-02-29. Practitioner.
    - Quote: "you need to start using them incrementally. Trying to fix all the issues found at once is a quick recipe for madness."
    - Verification: Firebase API.
- **Detect:**
  - Count old findings per rule with `sarif summary`, and label each rule category (correctness, security, maintainability, style).
  - Fix all TP correctness/security findings, hotspot findings, and safe-autofix rules.
  - Baseline the rest with each tool's own mechanism: `eslint --fix --suppress-rule <id>`, `semgrep --baseline-commit $(git rev-parse HEAD)` (clean tree required), `.golangci.yml issues.new-from-rev`, `jscpd --baseline .jscpd-baseline.json --update-baseline`, then `--fail-on-new-clones`.
  - Reject plans that add hundreds of per-line ignore comments.
- **Tools:** eslint bulk suppressions, `semgrep --baseline-commit`, golangci-lint `new-from-rev`, `jscpd --baseline`, SonarQube new code, sarif-tools.
- **Applies to:** Existing codebases being hardened after they already work; most important above a few thousand LOC.
- **When not to apply / counterpoints:**
  - The top-voted SE 193620 answer (score 14; the accepted answer scores 4) says to fix all warnings mechanically and make them errors at once, or they "pop up like mushrooms".
  - The user's goal of strengthening the finished project favours fixing more than Google's default. Resolve by precision: fix high-precision rules with safe fixes wholesale, and baseline the rest.
  - The Facebook contrast is a single anecdote on 20–30 issues.
- **Fix risk:** medium

### T25-F12 — For multi-file search or rewrite, use syntax-aware tools (never regex/sed) and always dry-run first
- **Grade:** B · **Verdict:** CORRECTED.
  - The OpenRewrite plugin version in the researcher's command (6.48.0) is tagged on GitHub (2026-09-09) but returns 404 on Maven Central, so the command would not resolve. The newest version on Central on 2026-09-23 is 6.46.1.
  - The ast-grep install and `sg` note live on the quick-start page.
- **Rule:**
  - Cross-language: ast-grep (tree-sitter), or Semgrep/Opengrep patterns.
  - Language-specific, format-preserving codemods: jscodeshift (recast), LibCST (Python), OpenRewrite (JVM), rust-analyzer SSR (path-resolving), clang-tidy fix-its.
  - Run the formatter as a separate pass.
  - Split large rewrites into small, independently tested commits.
  - Do not rely on Comby as the primary engine: no release since June 2022, and WSL-only on Windows.
- **Rationale:**
  - Pattern tools match syntax trees, so comments, strings and formatting do not create false matches.
  - Codemod frameworks preserve the formatting of untouched code.
  - Google's large-scale-change process runs the formatter as a separate pass and tests every shard.
- **Evidence:**
  - [ast-grep introduction](https://ast-grep.github.io/guide/introduction.html) and [quick start](https://ast-grep.github.io/guide/quick-start.html). ast-grep, 2026. Official docs.
    - Quote: "ast-grep is a new AST based tool to manage your code, at massive scale"; tree-sitter based; `ast-grep --pattern 'var code = $PAT' --rewrite 'let code = $PAT' --lang js`; install via `cargo install ast-grep --locked`, `npm i @ast-grep/cli -g` ("for pnpm, you may need manually approve postinstall script"), `pip install ast-grep-cli`; "Linux has a default command sg for setgroups. You can use the full command name ast-grep instead of sg."
    - Verification: raw pages grepped.
  - [ast-grep: Rewrite code](https://ast-grep.github.io/guide/rewrite-code.html). ast-grep, 2026. Official docs.
    - Quote: "ast-grep run --pattern 'foo' --rewrite 'bar' --lang python This will show you a diff of the changes that will be made... You can also use the --update-all or -U flag to automatically accept the changes without confirmation."
    - Verification: added by the verifier. It confirms that `run -r` without `-U` is a preview.
  - [jscodeshift README](https://github.com/facebook/jscodeshift). Meta, 2026 (GitHub release v17.3.0; npm latest 17.4.0). Official docs.
    - Quote: "-d, --(no-)dry dry run (no changes are made to files)"; "-p, --(no-)print print transformed files to stdout"; "tries to preserve the style of original code"; parsers babel, babylon, flow, ts, tsx.
    - Verification: raw README.
  - [LibCST README](https://github.com/Instagram/LibCST). Instagram/Meta, 2026 (v1.9.0). Official docs.
    - Quote: "LibCST parses Python 3.0 -> 3.15 source code as a CST tree that keeps all formatting details (comments, whitespaces, parentheses, etc). It's useful for building automated refactoring (codemod) applications and linters."
    - Verification: raw README.
  - [OpenRewrite: rewrite-maven-plugin](https://docs.openrewrite.org/reference/rewrite-maven-plugin). Moderne/OpenRewrite, 2026. Official docs.
    - Quote: dryRun "does not alter your source files at all ... outputs a report in the form of a patch file, by default under target/site/rewrite/rewrite.patch".
    - Verification: raw page grepped. Version checked against repo1.maven.org: 6.46.1 = 200, 6.47.0/6.48.0 = 404.
  - [rust-analyzer: Structural Search and Replace](https://rust-analyzer.github.io/book/features.html). rust-analyzer, 2026. Official docs.
    - Quote: "<search_pattern> ==>> <replace_pattern>"; "Paths in the search pattern will then match the code if they resolve to the same item, even if they're written differently."
    - Verification: raw page grepped.
  - [Software Engineering at Google, Ch. 22 Large-Scale Changes](https://abseil.io/resources/swe-book/html/ch22.html). Hyrum Wright (chapter author), 2020. Book.
    - Quote: "All of the LSC-generation tools run the automated formatter appropriate to the language being changed as a separate pass". "Each independent shard is tested by running it through TAP, Google's CI framework." "The majority of LSCs across Google actually have near-zero functional impact".
    - Verification: raw HTML grepped.
  - [Comby README](https://github.com/comby-tools/comby) and GitHub releases API. comby-tools, 2026. Official docs and API.
    - Data: latest release 1.8.1, published 2022-06-28. Repo not archived (last push 2026-06-08). Windows: "Install the Windows Subsystem for Linux and install Ubuntu."
    - Verification: `gh api`, raw README.
  - [HN comment on agent refactoring tools](https://news.ycombinator.com/item?id=48978866). HN user the_mitsuhiko, 2026-07-20. Practitioner.
    - Quote: "I found that making these refactors with ast-grep is quite efficient."; "we did not find a ton of evidence of LSP helping, even for finding data." The commenter also says they have no evals.
    - Verification: Firebase API.
- **Detect:**
  - Reject any agent step that uses `sed -i` / `perl -pi` or a regex replace across more than one source file.
  - Required pipeline:
    1. `ast-grep run -p '<pat>' -r '<rewrite>' -l <lang>` (preview), `semgrep --autofix --dryrun`, or `jscodeshift --dry --print`.
    2. Review the matches (`--json=stream` for counts).
    3. Apply (`-U` / `--update-all`).
    4. Run the formatter.
    5. Run the tests.
    6. Commit.
  - To verify a pattern: `ast-grep run --debug-query=ast -p '<pat>' -l <lang>`.
- **Tools:** ast-grep, semgrep/opengrep, jscodeshift, ts-morph, LibCST, OpenRewrite, rust-analyzer SSR, clang-tidy with clang-apply-replacements.
- **Applies to:** Renames, API migrations, cross-file dead-code removal, repeated pattern fixes.
- **When not to apply / counterpoints:**
  - Tree-sitter tools see syntax, not types or name resolution (rust-analyzer SSR and OpenRewrite are exceptions). For pure renames in typed languages, IDE/LSP rename is safer.
  - Practitioners report that models under-use ast-grep unless strongly steered (HN 47922896), so the skill must prescribe it explicitly.
  - For JVM plugins, check that the pinned version resolves on Maven Central before use.
- **Fix risk:** medium

### T25-F16 — Audit suppressions as findings; the agent must never make a report "clean" by adding ignores or loosening config
- **Grade:** B · **Verdict:** CORRECTED. The quote "The standard practice is that people is pressed to make every single warning shut up" belongs to the SE 158535 question author; answer 160010 only quotes it. The question itself is the stronger evidence. Added that the RUF100 fix can be unsafe in edge cases.
- **Rule:**
  - Every new suppression must name the specific rule and give a reason: ESLint `-- reason`, `# noqa: CODE`, `#[allow(clippy::x)]` with a comment.
  - Remove stale suppressions with ESLint `reportUnusedDisableDirectives` and Ruff RUF100.
  - Report the suppression count before and after.
- **Rationale:**
  - The pressure to silence mandated tools is documented, and silencing working code introduces bugs.
  - ESLint says inline disabling should be restricted to clear, valid reasons, documented after `--`.
  - ESLint and Ruff both ship detectors for unused suppressions.
  - An agent optimising for "zero findings" would otherwise game its own metric.
- **Evidence:**
  - [ESLint: Configure Rules](https://eslint.org/docs/latest/use/configure/rules). ESLint, 2026. Official docs.
    - Quote: "Disabling ESLint rules inline should be restricted and used only in situations with a clear and valid reason for doing so. Disabling rules inline should not be the default solution to resolve linting errors." reportUnusedDisableDirectives: "This setting defaults to 'warn'."
    - Verification: raw page grepped.
  - [Ruff rule RUF100 unused-noqa](https://docs.astral.sh/ruff/rules/unused-noqa/). Astral, 2026. Official docs.
    - Quote: "A noqa directive that no longer matches any diagnostic violations is likely included by mistake, and should be removed to avoid confusion." "Fix is always available." "The rule's fix is marked as unsafe when a full suppression comment would be removed and there are other nested comments on the same line."
    - Verification: raw page grepped.
  - [How to avoid the pitfalls of static analysis](https://softwareengineering.stackexchange.com/questions/158535/how-to-avoid-the-pitfalls-of-static-analysis). SE question author (2012-07-28) and answer 158544. Practitioner.
    - Quote (question): "The standard practice is that people is pressed to make every single warning shut up... People add type casts to every rvalue ... hiding real problematic type mismatches ... People introduce off by one bugs... The warnings are silenced. The bug reports start rolling in. The main point is the original code was working ... whereas the fixes were not."
    - Quote (answer 158544): "It encourages tired / overworked (or lazy) programmers to make 'fixes' to make the warnings go away."
    - Verification: StackExchange API. Attribution corrected.
- **Detect:**
  - Before/after counts: `git grep -cE 'eslint-disable|@ts-(ignore|expect-error)|# *noqa|# *type: *ignore|NOLINT|#\[allow\(|@SuppressWarnings|nosemgrep|//nolint|# *pylint: *disable|# *pragma: *no cover|biome-ignore|#pragma warning disable' -- ':!**/vendor/**'`.
  - On the agent's own diff: `git diff -U0 | grep -E '^\+.*(eslint-disable|noqa|NOLINT|nolint|#\[allow|@SuppressWarnings|nosemgrep|type: ignore)'` must be empty, or each hit needs a same-line reason.
  - Also run `eslint --report-unused-disable-directives` and `ruff check --select RUF100`.
- **Tools:** git grep, eslint `reportUnusedDisableDirectives`, ruff RUF100, clippy allow attributes.
- **Applies to:** All languages with inline suppression syntax.
- **When not to apply / counterpoints:**
  - A suppression is correct for a confirmed false positive, and better than rewriting correct code to please a tool.
  - Baseline files (T25-F09) are an accepted, reviewable alternative to inline ignores.
- **Fix risk:** low

### T25-F17 — Put mechanical changes in their own commits and register them in .git-blame-ignore-revs
Formatter runs, import sorting and mass renames go in their own commits, with no hand edits mixed in. Add their SHAs to `.git-blame-ignore-revs` and tell the user to set `git config blame.ignoreRevsFile .git-blame-ignore-revs` per repo. Introduce a new formatter style only if the project already has one configured, or the user approves the large diff.
- **Grade:** B · **Verdict:** VERIFIED.
- **Rationale:**
  - Mixing reformatting with behaviour changes hides the real change and pollutes blame.
  - Git and GitHub support ignoring listed revisions.
  - Google's large-scale-change tooling runs the formatter as a separate pass.
  - Practitioners recommend one "giant" formatting changeset, but warn that IDEs need configuring and that a globally set `ignoreRevsFile` breaks `git blame` in repos without the file.
- **Evidence:**
  - [git-blame documentation](https://git-scm.com/docs/git-blame). Git project, 2026. Official docs.
    - Quote: `--ignore-rev`: "Ignore changes made by the revision when assigning blame, as if the change never happened." `blame.ignoreRevsFile`: "Ignore revisions listed in the file, one unabbreviated object name per line ... Whitespace and comments beginning with # are ignored."
    - Verification: fetched.
  - [Viewing and understanding files (ignore commits in blame view)](https://docs.github.com/en/repositories/working-with-files/using-files/viewing-and-understanding-files). GitHub Docs, 2026. Official docs.
    - Quote: "All revisions specified in the .git-blame-ignore-revs file, which must be in the root directory of your repository, are hidden from the blame view." Local: `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
    - Verification: fetched.
  - [Advantages and Disadvantages of Forced Code Reformat](https://softwareengineering.stackexchange.com/questions/92256/advantages-and-disadvantages-of-forced-code-reformat). SE contributors, 2011. Practitioner.
    - Quote (answer 92258, score 24): "one person does a reformat over the whole code base ... so there's one 'giant' change set for formatting (that everyone can ignore), but after that, all diffs are real code diffs."
    - Quote (answer 92263, score 11): it "Creates a resistance to changing style conventions as these will now create large misleading diff changes."
    - Verification: StackExchange API.
  - [HN comments on .git-blame-ignore-revs](https://news.ycombinator.com/item?id=43869786). HN users y-curious (2025-05-02) and DHowett ([item 47113680](https://news.ycombinator.com/item?id=47113680), 2026-02-22). Practitioner.
    - Quote (y-curious): "devs need to point their IDE to the file ... I got a lot of people complaining about blame disappearing completely".
    - Quote (DHowett): "If you configure your git client to use it, git blame will fail in any repository in which one is not present."
    - Verification: Firebase API.
  - [Software Engineering at Google, Ch. 22](https://abseil.io/resources/swe-book/html/ch22.html). Google, 2020. Book.
    - Quote: "All of the LSC-generation tools run the automated formatter appropriate to the language being changed as a separate pass".
    - Verification: raw HTML.
- **Detect:**
  - For each commit made by the pass, run `git show --stat` and check by hand that formatter commits contain no semantic edits.
  - `git diff -w --ignore-blank-lines <sha>^ <sha>` should be nearly empty for whitespace-only formatters.
  - Record each formatting commit with `git log --format='# %s%n%H' -1 >> .git-blame-ignore-revs`, then verify with `git blame --ignore-revs-file .git-blame-ignore-revs <file>`.
- **Tools:** git, the project's formatter.
- **Applies to:** Any repo under git where the pass runs a formatter or other mass mechanical edits.
- **When not to apply / counterpoints:**
  - Reformatting a finished project can conflict with open branches and destroy deliberate hand layout.
  - If the project has no formatter, propose one rather than imposing it.
  - Set `blame.ignoreRevsFile` per repo, not globally.
- **Fix risk:** low

### T25-F10 — Rank refactoring targets by hotspot score (change frequency × complexity); report stable complex code but do not refactor it just to lower a metric
- **Grade:** C (was B) · **Verdict:** DOWNGRADED, and corrected. Every source is real and quoted correctly, but none independently validates the rule's actual heuristic, ranking by churn × complexity:
  - Nagappan and Ball validated *relative churn alone*, on one system (Windows Server 2003 binaries, 2005).
  - The 1.2% / 12.5% / 45% figures are a vendor example.
  - Code Red measures CodeScene's "Code Health" metric against defects, not hotspots.
  - Attribution corrected: only the first author of Code Red (Tornhill) is from CodeScene; co-author Borg was at RISE / Lund University.
  - Kept: the counterpoint citation (Lenarduzzi, Saarimäki, Taibi, JSS 170, 2020) and the verified tool option `scc --hotspots`.
- **Rationale:**
  - Relative code churn predicted defect density on Windows Server 2003, separating fault-prone from non-fault-prone binaries with 89% accuracy.
  - CodeScene (vendor) shows an example where hotspots were 1.2% of the code but received 12.5% of development effort and held 45% of bugs.
  - A study first-authored by CodeScene's founder, covering 39 proprietary codebases, found 15× more defects in low-Code-Health code.
  - Fixing where the code changes most is a sensible way to limit how much stable code gets touched. That is reasoning, not a measured result.
- **Evidence:**
  - [Use of relative code churn measures to predict system defect density](https://doi.org/10.1145/1062455.1062514). Nagappan (NCSU) and Ball (Microsoft Research), ICSE 2005. Peer-reviewed.
    - Quote: "while absolute measures of code churn are poor predictors of defect density, our set of relative measures of code churn is highly predictive of defect density ... discriminate between fault and not fault-prone binaries with an accuracy of 89.0 percent."
    - Verification: OpenAlex abstract. The case study is Windows Server 2003.
  - [CodeScene docs: Hotspots](https://codescene.io/docs/guides/technical/hotspots.html). CodeScene, 2026. Official vendor docs.
    - Quote: "Low code health in a development hotspot is expensive. Prioritize improvements here" and "Low code health in stable parts of the codebase, i.e. non-hotspots, has lower priority." Example: 1.2% of code, 12.5% of development effort, 45% of bugs.
    - Verification: fetched; vendor data.
  - [Code Red: The Business Impact of Code Quality](https://arxiv.org/abs/2203.04374). Adam Tornhill (CodeScene, Malmö) and Markus Borg (RISE Research Institutes of Sweden / Lund University), TechDebt 2022. Peer-reviewed, vendor-affiliated first author.
    - Quote: "We analyze 39 proprietary production codebases ... using the CodeScene tool ... low quality code contains 15 times more defects than high quality code. Furthermore, resolving issues in low quality code takes on average 124% more time in development."
    - Verification: arXiv abstract and PDF first page (affiliations).
  - [code-maat README](https://github.com/adamtornhill/code-maat). Adam Tornhill (v1.0.4, 2023-02-20). Official docs.
    - Quote: `git log --all --numstat --date=short --pretty=format:'--%h--%ad--%aN' --no-renames --after=YYYY-MM-DD > logfile.log`; `java -jar code-maat-1.0.4-standalone.jar -l logfile.log -c <vcs>`; analyses include revisions, entity-churn, coupling, age.
    - Verification: fetched; release date via `gh api`.
  - [scc README (hotspots)](https://github.com/boyter/scc/blob/v4.1.0/README.md). Ben Boyter, 2026 (v4.1.0). Official docs.
    - Quote: `--hotspots` "render the hotspots report (files ranked by complexity × change frequency over recent git history)"; `--coupling` "render the change-coupling report".
    - Verification: README at tag v4.1.0 grepped.
- **Detect:**
  1. Churn: `git log --since='12 months ago' --format=format: --name-only | grep -v '^$' | sort | uniq -c | sort -rn | head -50`, or `scc --hotspots --format json`, or the code-maat git2 log.
  2. Complexity: `lizard --csv .`.
  3. Join on path, restricted to non-generated files.
- **Tools:** git log, `scc --hotspots`, code-maat, lizard, CodeScene (commercial).
- **Applies to:** Repos with meaningful history (months, many commits).
- **When not to apply / counterpoints:**
  - Code Red is vendor-authored and measures a proprietary metric.
  - [Lenarduzzi, Saarimäki, Taibi, "Some SonarQube Issues have a Significant but Small Effect on Faults and Changes", JSS 170, 2020 (arXiv 1908.11590)](https://arxiv.org/abs/1908.11590) studied 33 Apache projects and found, for fault-proneness, "no difference between clean and dirty classes". The metric that defines "low quality" matters a lot.
  - Nagappan and Ball validated relative churn on one system, not the churn × complexity product.
  - Churn means nothing for a squashed or single-commit repo, or right after a big reformat; exclude formatting commits (T25-F17).
  - Use the hotspot rank to order work, not as evidence that a file is defective.
- **Fix risk:** low

### T25-F01 — Inventory first, then run the project's own gates, and fill gaps without replacing existing configs
Take inventory of (1) the language mix, using a counter that respects `.gitignore`; (2) what to exclude: generated, vendored, minified or third-party files; (3) the quality tooling the project already declares. Then run the project's own configured gates with its pinned versions. Add outside tools only to fill gaps.
- **Grade:** C · **Verdict:** CORRECTED.
  - The researcher's general claim that MegaLinter gives a repo-root linter config precedence over its defaults is not on the configuration page. It is restored in a narrower, sourced form: each MegaLinter descriptor looks in the workspace for one specific file name and otherwise uses MegaLinter's template.
  - Added that `IGNORE_GENERATED_FILES` defaults to false.
  - Fixed tokei: JSON output needs no features.
  - The link between Beller et al. (configs rarely change) and "a parallel setup gives contradictory findings" is reasoning, not a finding of that study. The second claim rests on the practitioner comment.
- **Rationale:**
  - Existing configs record what the team has accepted.
  - A large study (data up to 2015) shows teams rarely change configs after adoption, and deviate only slightly from defaults.
  - A second, parallel tool setup produces duplicate or contradictory findings ("maintain linter configs in two places").
  - Aggregators skip `.gitignore`d files by default, but not generated files unless configured.
  - MegaLinter looks only for each descriptor's expected config file name (e.g. `.ruff.toml`) before falling back to its own template. A project configured through `pyproject.toml` or `package.json` can be silently linted with MegaLinter's rules instead of its own.
  - Generated or vendored code inflates duplication and complexity counts, and "fixes" to it get overwritten at the next generation.
- **Evidence:**
  - [Analyzing the State of Static Analysis: A Large-Scale Evaluation in Open Source Software](https://doi.org/10.1109/saner.2016.105). Beller, Bholanath, McIntosh, Zaidman, SANER 2016. Peer-reviewed.
    - Quote: "122 and 168,214 open-source projects ... Most ASAT configurations deviate slightly from the default, but hardly any introduce new custom analyses... most ASAT configurations, once introduced, never change."
    - Verification: OpenAlex abstract.
  - [HN comment on super-linter](https://news.ycombinator.com/item?id=23564442). HN user oefrha, 2020-06-18. Practitioner.
    - Quote: "still use whatever linters they've been using so far, but now you have to maintain linter configs in two places."
    - Verification: Firebase API. The comment was later corrected to note that super-linter can run locally in Docker.
  - [MegaLinter configuration](https://megalinter.io/latest/configuration/). OX Security, 2026. Official docs.
    - Quote: IGNORE_GITIGNORED_FILES default `true`, "If set to true, MegaLinter will skip files ignored by git using .gitignore file". IGNORE_GENERATED_FILES default `false`, "skip files containing @generated marker". LINTER_RULES_PATH default `.github/linters`.
    - Verification: raw page grepped. The general precedence claim was not found on this page.
  - [MegaLinter ruff descriptor](https://megalinter.io/latest/descriptors/python_ruff/). OX Security, 2026. Official docs (one example of the per-descriptor pattern).
    - Quote: "If custom `.ruff.toml` config file isn't found, [.ruff.toml](https://github.com/oxsecurity/megalinter/tree/main/TEMPLATES/.ruff.toml) will be used". `PYTHON_RUFF_CONFIG_FILE` defaults to `.ruff.toml`, "Use `LINTER_DEFAULT` to let the linter find it". `PYTHON_RUFF_RULES_PATH`: "Workspace folder, then MegaLinter default rules".
    - Verification: raw descriptor markdown (docs/descriptors/python_ruff.md) grepped in the second pass.
  - [github-linguist/linguist](https://github.com/github-linguist/linguist) and [docs/overrides.md](https://github.com/github-linguist/linguist/blob/main/docs/overrides.md). GitHub, 2026 (v9.7.0). Official docs.
    - Quote: "used on GitHub.com to detect blob languages, ignore binary or vendored files, suppress generated files in diffs, and generate language breakdown graphs"; attributes `linguist-documentation`, `linguist-language`, `linguist-vendored`, `linguist-generated`, `linguist-detectable`; `--breakdown`, `--json`.
    - Verification: raw files grepped.
  - [scc README](https://github.com/boyter/scc). Ben Boyter, 2026 (v4.1.0). Official docs.
    - Quote: `--by-file` "display output for every file"; `--format` "[tabular, wide, json, json2, csv, csv-stream, cloc-yaml, html, html-table, sql, sql-insert, openmetrics]"; `--no-cocomo` "remove COCOMO calculation output".
    - Verification: raw README.
  - [tokei README and source](https://github.com/XAMPPRocky/tokei). XAMPPRocky, 2026 (v15.0.0). Official docs and source.
    - Quote: "supporting over 150 languages"; "Tokei will respect all .gitignore and .ignore files"; `.tokeignore`. Features: `all = ["cbor","yaml"]`; `Format::Json` is unconditional.
    - Verification: corrected; JSON needs no feature flag.
- **Detect:**
  - Language mix: `scc --by-file --format json --no-cocomo .` or `github-linguist --breakdown --json`.
  - Existing tooling: `git ls-files | grep -E '(^|/)(\.pre-commit-config\.yaml|\.golangci\.ya?ml|pyproject\.toml|package\.json|eslint\.config\.(js|mjs|cjs|ts)|\.eslintrc.*|biome\.jsonc?|ruff\.toml|clippy\.toml|\.clang-tidy|\.editorconfig|Makefile|justfile|Taskfile\.ya?ml|\.mega-linter\.ya?ml|\.qlty/qlty\.toml)$'`, plus `ls .github/workflows .gitlab-ci.yml 2>/dev/null`.
  - Exclusions: `git check-attr -a -- <file>` for linguist-generated/vendored, and look for `@generated` markers.
  - Read the CI lint/test/format steps and run them locally first.
  - When MegaLinter is used, set `<LINTER>_CONFIG_FILE=LINTER_DEFAULT` for linters whose project config lives in `pyproject.toml`, `package.json` or a non-default file name. Check the activated config per linter in the MegaLinter log.
- **Tools:** scc, tokei, github-linguist, git, pre-commit.
- **Applies to:** All languages; any finished project, with or without lint configuration.
- **When not to apply / counterpoints:**
  - The existing config may be stale or deliberately weak (Beller et al.). Start from it, but still propose missing rules.
  - A project with no tooling at all needs T25-F02.
- **Fix risk:** low

### T25-F02 — Use a fixed, ordered procedure to pick tools for an unfamiliar language, and vet each candidate
Search in this order:
- (a) analyzers bundled with the toolchain, plus a strict compiler warning level;
- (b) the ecosystem's de-facto linter/formatter;
- (c) curated open-data catalogues: analysis-tools.dev, the trunk-io/plugins table, MegaLinter descriptors and flavors.

Vet every candidate on:
- last release date and archived flag;
- licence;
- SARIF/JSON output;
- safe-vs-unsafe fix classification;
- whether it can run pinned and in a temporary environment.

Do not pick a tool from memory.
- **Grade:** C · **Verdict:** CORRECTED. The analysis-tools.dev blog post is by Matthias Endler, dated 2020-08-19, not 2026. Added that the unauthenticated GitHub API rate-limits almost immediately; use `gh api` or a token.
- **Rationale:**
  - Toolchain analyzers ship with the compiler and are documented officially.
  - Catalogue sites exist because "the loudest voice on the market wins".
  - Maintenance matters: Comby has had no release since June 2022.
  - Release dates are cheap to check through the API.
- **Evidence:**
  - [Static analysis is broken, let's fix it](https://analysis-tools.dev/blog/static-analysis-is-broken-lets-fix-it). Matthias Endler, analysis-tools.dev, 2020-08-19. Engineering blog.
    - Quote: "Is this the best tool for my use-case? Is it still maintained? Is the license acceptable?"; "The loudest voice on the market wins - not the best tool."
    - Verification: fetched; year corrected.
  - [analysis-tools.dev home](https://analysis-tools.dev/). analysis-tools.dev, 2026. Catalogue.
    - Quote: "There are more than 500 static analysis (SAST) tools out there"; "All tools are peer-reviewed by fellow engineers"; data at github.com/analysis-tools-dev/static-analysis.
    - Verification: fetched; the repo was pushed 2026-09-21 and is not archived.
  - [cmd/vet](https://pkg.go.dev/cmd/vet). The Go Authors, 2026. Official docs.
    - Quote: "Vet uses heuristics that do not guarantee all reports are genuine problems, but it can find errors not caught by the compilers." `-json`: "emit analysis diagnostics (and errors) in JSON format".
    - Verification: fetched.
  - [Clippy documentation](https://doc.rust-lang.org/clippy/). Rust project, 2026. Official docs.
    - Quote: the category table (correctness deny; suspicious, style, complexity, perf warn; pedantic, restriction, nursery, cargo allow).
    - Verification: fetched.
  - [dotnet format](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-format). Microsoft Learn, 2026. Official docs.
    - Quote: `--verify-no-changes`: "Terminates with a non zero exit code if any files would have been formatted"; `--report`: "Produces a JSON report"; subcommands whitespace, style, analyzers.
    - Verification: fetched.
  - [trunk-io/plugins README](https://github.com/trunk-io/plugins). Trunk.io, 2026 (v1.11.0). Official docs.
    - Quote: Bash: shellcheck, shfmt. C/C++: clang-format, clang-tidy, include-what-you-use, pragma-once. Go: gofmt, gofumpt, goimports, gokart, golangci-lint, golines, semgrep.
    - Verification: fetched; the repo was pushed 2026-09-23 and is not archived.
  - [GitHub releases API: comby](https://api.github.com/repos/comby-tools/comby/releases/latest). GitHub, 2026. API.
    - Data: 1.8.1, published 2022-06-28. For comparison, ast-grep 0.45.3 (2026-08-31) and Semgrep v1.177.0 (2026-09-10).
    - Verification: `gh api`.
  - [MegaLinter home](https://megalinter.io/latest/). OX Security, 2026. Official docs.
    - Quote: "Supports 67 languages, 23 formats, 22 tooling formats"; flavors include c_cpp, dotnet, go, java, javascript, php, python, ruby, rust, security, swift, terraform.
    - Verification: fetched.
- **Detect:** manual procedure, for each language found in T25-F01:
  1. Check the official docs for bundled vet/lint/format commands.
  2. Search analysis-tools.dev, the trunk-io/plugins row and the MegaLinter descriptor list.
  3. `gh api repos/OWNER/REPO --jq '{pushed_at,archived,license:.license.spdx_id}'` and `gh api repos/OWNER/REPO/releases/latest --jq '{tag_name,published_at}'`.
  4. Reject as primary any tool that is archived or has had no release in about two years.
  5. Confirm a JSON/SARIF output flag.
- **Tools:** GitHub REST API (authenticated), analysis-tools.dev, trunk-io/plugins, MegaLinter descriptors.
- **Applies to:** Any language the agent does not know well; polyglot repos.
- **When not to apply / counterpoints:**
  - Catalogue votes measure popularity, not quality.
  - Last-release date is a weak proxy, since some stable tools rarely release.
  - AGPL/BSL licences matter for redistribution or hosted services, not for local runs. Note Qlty's clause on AI coding services (T25-F13).
- **Fix risk:** low

### T25-F13 — Use meta-linters for a one-off discovery sweep, then move kept rules into native configs
Use MegaLinter, super-linter or Qlty CLI for a pinned, one-off discovery sweep of a polyglot repo or a repo with no tooling. Request SARIF/JSON output and record which linters were activated. Then move the rules worth keeping into the project's native per-language configs. Check licence and runtime cost first. Trunk's code-quality product status is uncertain; do not depend on it.
- **Grade:** C · **Verdict:** CORRECTED.
  - Qlty's licence detail added: BSL 1.1, Change Date 2028-12-10 → GPL-3.0, with an Additional Use Grant that excludes commercial "Code Quality Service" and "Artificial Intelligence Coding Service" offerings to third parties.
  - Trunk status refined with fresh HTTP checks: trunk.io/check redirects to /code-quality, a page showing only Flaky Tests and Merge Queue. docs.trunk.io/code-quality redirects to the docs home. docs.trunk.io/check redirects to a login. The docs index tags 146 pages "Code Quality" and 146 "Legacy", which suggests (but does not prove) legacy status.
  - The super-linter local-run command is in docs/run-linter-locally.md.
- **Rationale:**
  - Meta-linters auto-detect languages and bundle many linters, which is ideal for discovery.
  - But they are heavy (Docker), slow, and hold a second copy of linter configs. Their SARIF covers only SARIF-capable linters.
  - `mega-linter-runner --release` defaults to `latest`, so always pin it.
- **Evidence:**
  - [mega-linter-runner](https://megalinter.io/latest/mega-linter-runner/). OX Security, 2026 (v10.1.0, AGPL-3.0). Official docs.
    - Quote: "You need to have NodeJS and Docker installed on your computer to run MegaLinter locally with MegaLinter Runner"; `--flavor` default `all`; `--release` default `latest`; `--container-engine` docker/podman.
    - Verification: fetched; npm `mega-linter-runner` 10.1.0; licence via `gh api`.
  - [super-linter README](https://github.com/super-linter/super-linter) and [run locally](https://github.com/super-linter/super-linter/blob/main/docs/run-linter-locally.md). super-linter, 2026 (v8.7.0, MIT). Official docs.
    - Quote: slim image "includes all supported linters except: Rustfmt, Rust Clippy, Azure Resource Manager Template Toolkit (arm-ttk), PSScriptAnalyzer, dotnet"; Biome and Trivy ignore VALIDATE_ALL_CODEBASE; with SAVE_SUPER_LINTER_OUTPUT "Most outputs are in JSON format."
    - Verification: raw files grepped.
  - [Qlty CLI README](https://github.com/qltysh/qlty) and [LICENSE.md](https://github.com/qltysh/qlty/blob/main/LICENSE.md). Qlty Software, 2026 (v0.644.0). Official docs.
    - Quote: "support for 70+ static analysis tools for 40+ languages and technologies"; `qlty init`, `qlty check --all`, `qlty smells --all`, `qlty metrics --max-depth=2 --sort complexity --all`.
    - Licence quote: "Business Source License 1.1 ... Additional Use Grant: You may make use of the Licensed Work, provided that you do not use the Licensed Work for a Code Quality Service or to produce ... an Artificial Intelligence Coding Service." Both are defined as commercial offerings to third parties.
    - Verification: raw files.
  - [Trunk code-quality URL](https://trunk.io/code-quality). Trunk.io, 2026. Vendor page.
    - Data: describes only Flaky Tests and Merge Queue; redirect chain as above.
    - Verification: fetched plus curl redirect checks.
  - [HN comment on MegaLinter with coding agents](https://news.ycombinator.com/item?id=48323728). HN user sinansaka, 2026-05-29. Practitioner.
    - Quote: "We use megalinter with our flavour of go and vite rules, plus extensive e2e testing after each agent run. Quality of the spec driven agentic PRs are significantly better than the baseline. Megalinter is quite resource heavy and slow".
    - Verification: Firebase API; thread "Show HN: AISlop".
  - [HN comment on super-linter](https://news.ycombinator.com/item?id=23564442). HN user oefrha, 2020. Practitioner.
    - Quote: "now you have to maintain linter configs in two places."
    - Verification: Firebase API.
- **Detect:**
  - If the repo has more than 3 languages or no lint config, run one of:
    - `npx mega-linter-runner --flavor <closest> --release v10.1.0 -e 'SARIF_REPORTER=true'`;
    - the super-linter image pinned by digest, with `RUN_LOCAL=true` (Git Bash: see T25-F18);
    - `qlty init && qlty check --all`.
  - Record the list of activated linters, then map the useful rules into native configs.
- **Tools:** MegaLinter, super-linter, Qlty CLI, Trunk (status uncertain).
- **Applies to:** Polyglot repos, repos with no tooling, the initial discovery pass.
- **When not to apply / counterpoints:**
  - For single-language projects, the native toolchain is faster and less noisy.
  - Meta-linter defaults may clash with the project's formatter.
  - The positive MegaLinter report is one uncontrolled anecdote.
- **Fix risk:** low

### T25-F19 — Close the loop: before/after tool runs with identical pinned configs, plus tests after every commit
1. Save full SARIF/JSON before changing code.
2. After each batch of fixes, re-run the same pinned tools with the same configs, plus the tests.
3. Diff the results: `sarif diff` for per-rule count and location deltas, and jq on fingerprints for result-level matching.
4. Repeat until only baselined or triaged false positives remain.

The report must include the before/after comparison and account for every new finding.
- **Grade:** C (was B) · **Verdict:** DOWNGRADED, and corrected.
  - The only empirical source is a single preprint on LLM code *generation* (PythonSecurityEval with Bandit/Pylint), not on hardening existing code. The other sources support testing every change, not SARIF diffing.
  - `sarif diff` reports new or resolved issue *types* per severity and changed occurrence counts with new locations. It does not do fingerprint-level "new/resolved/changed issues" as claimed.
  - Preprint authors added: Blyth, Licorish, Treude, Wagner.
- **Rationale:**
  - Evidence that targeted findings are gone and no new ones appeared is objective and checkable.
  - Iterative static-analysis feedback reduced issues in LLM-generated code within ten rounds, in one preprint.
  - Google tests every shard of its large-scale changes.
- **Evidence:**
  - [Static Analysis as a Feedback Loop: Enhancing LLM-Generated Code Beyond Correctness](https://arxiv.org/abs/2508.14419). Blyth, Licorish, Treude, Wagner, arXiv 2025-08-20. Preprint.
    - Quote: "security issues reduced from >40% to 13%, readability violations from >80% to 11%, and reliability warnings from >50% to 11% within ten iterations" (GPT-4o, PythonSecurityEval).
    - Verification: arXiv API.
  - [microsoft/sarif-tools](https://github.com/microsoft/sarif-tools). Microsoft, 2025 (v3.0.5). Official docs.
    - Quote: "'+' indicates new issue types at this severity ... '-' indicates resolved issue types ... 'codes' lists each issue code where the number of occurrences has changed ... new locations indicated by '+@'".
    - Verification: raw README; claim corrected.
  - [Software Engineering at Google, Ch. 22](https://abseil.io/resources/swe-book/html/ch22.html). Google, 2020. Book.
    - Quote: "Each independent shard is tested by running it through TAP, Google's CI framework. We run every test that depends on the files in a given change transitively".
    - Verification: raw HTML grepped.
  - [Lessons from Building Static Analysis Tools at Google](https://storage.googleapis.com/gweb-research2023-media/pubtools/4365.pdf). Sadowski et al., 2018. Peer-reviewed.
    - Quote: "Do not just find bugs, fix them... analysis tools measure their utility by the number of issues they identify, while integration attempts fail due to the low number of bugs actually fixed or prevented."
    - Verification: PDF text.
- **Detect:**
  - Keep `before/*.sarif` and `after/*.sarif` from identical commands and versions.
  - Run `uvx --from sarif-tools sarif diff before/ after/` and inspect every `"+@"` location and every rule whose count rose.
  - For result-level matching, diff on `(ruleId, partialFingerprints or file+normalized message)` with jq.
  - Build and tests must pass after every commit: `git rebase -x '<test cmd>' <base>`.
- **Tools:** sarif-tools, jq, `git rebase -x`, the project's test suite.
- **Applies to:** Every hardening pass; the skill's final deliverable.
- **When not to apply / counterpoints:**
  - Line-based fingerprints shift when code moves, so some "new" findings are relocated old ones.
  - Re-running tools does not prove behaviour is preserved; only tests and review do.
  - The feedback-loop effect sizes do not transfer to hardening existing code.
- **Fix risk:** low

## Practitioner voice
All items were re-checked via the HN Firebase item API (including each thread's root story) or the StackExchange API.
- [Facebook Infer: diff time vs batch](https://news.ycombinator.com/item?id=20844718): sqs (Sourcegraph CEO), 2019, quotes the CACM paper verbatim, and the verifier matched it against the archived primary article. Batch-assigned Infer issues (20–30 of them) were almost never acted on. The same analysis at diff time reached over 70% fix rate.
- [MegaLinter after every agent run](https://news.ycombinator.com/item?id=48323728): 2026, in a "Show HN: AISlop" thread. A team runs MegaLinter plus e2e tests after each agent run and calls agent PRs "significantly better than the baseline". They also call MegaLinter "quite resource heavy and slow".
- [False-positive rates of quality tools](https://news.ycombinator.com/item?id=49727585): 2026, in the ImpactGate thread. An evaluator of qlty, SonarQube and fallow saw 20–80% false positives on their sniff tests, and singles out zizmor. They are reluctant to require such checks to pass, because it would annoy developers and push them toward the anti-pattern the checks target.
- [SonarQube for an audit checkbox](https://news.ycombinator.com/item?id=42739351): 2025. The requirement "came from some check boxes to be ticked for an audit", and the reports were "mostly false positives in our case to work through".
- [Adopt linters incrementally in legacy C++](https://news.ycombinator.com/item?id=39556049): 2024. "Trying to fix all the issues found at once is a quick recipe for madness"; suggests clang-tidy through a meta-linter (Trunk Check at the time).
- [Formatter broke a non-header .h file](https://news.ycombinator.com/item?id=39559307): 2024. While modernising an old C project, the author put mechanical steps (dos2unix, chmod, clang-format) in separate commits. clang-format broke a `.h` file that was really a data list.
- [Every structural replace needs checking](https://news.ycombinator.com/item?id=47853251): 2026. Dozens of replacements can be checked by hand; hundreds are where people hand verification to agents.
- [ast-grep efficient for agent refactors](https://news.ycombinator.com/item?id=48978866): the_mitsuhiko, 2026. Finds ast-grep refactors efficient and "did not find a ton of evidence of LSP helping". The commenter says they have no evals.
- [Models rarely use ast-grep unless steered](https://news.ycombinator.com/item?id=47922896): 2026. "Even with pretty aggressive steering most models just don't seem to use it a lot"; stronger or higher-reasoning models use it more.
- [Linter configs in two places](https://news.ycombinator.com/item?id=23564442): 2020. A super-linter critique; the commenter later noted it can run locally in Docker.
- [.git-blame-ignore-revs confuses IDE users](https://news.ycombinator.com/item?id=43869786): 2025. After adoption, people complained that blame "disappeared completely" until each developer configured their IDE.
- [Global ignoreRevsFile breaks blame elsewhere](https://news.ycombinator.com/item?id=47113680): 2026. "git blame will fail in any repository in which one is not present."
- [Hit by the eslint-config-prettier compromise](https://news.ycombinator.com/item?id=44612743): 2025, in the "eslint-config-prettier npm package compromised" thread. "Disables security in Chrome. I will be wiping everything." This is the victim's own report.
- [Mitigations after the eslint-config-prettier compromise](https://news.ycombinator.com/item?id=44619845): 2025, same thread. Use a package manager that blocks install scripts by default (pnpm), prefer zero-dependency tools (Biome, `deno lint`), or sandbox Node with bubblewrap/firejail.
- [Bugs in the static analyzers' own rules](https://news.ycombinator.com/item?id=28445519): 2021. Quotes Wang et al. (arXiv 2109.02245): differential testing on 2,728 projects found 46 bugs in SonarQube, PMD, SpotBugs and ErrorProne rules (24 fixed or confirmed). The verifier checked the abstract. Tool verdicts are not ground truth.
- [Warnings in a legacy project: two camps](https://softwareengineering.stackexchange.com/questions/193620/how-to-deal-with-warnings-in-a-legacy-project): 2013.
  - The top-voted answer (14) says fix every warning mechanically, then treat warnings as errors at once.
  - The accepted answer (4) says don't touch legacy code: suppress existing warnings and hold new code to zero, because "seemingly innocuous changes ... can introduce bugs".
- [Silencing warnings in working code introduced bugs](https://softwareengineering.stackexchange.com/questions/158535/how-to-avoid-the-pitfalls-of-static-analysis): 2012. The question author reports that pressure to silence every warning from a mandated tool led to casts that hid real type mismatches, off-by-one bugs, and "The bug reports start rolling in ... the original code was working ... whereas the fixes were not."
- [One giant formatting changeset vs lost hand layout](https://softwareengineering.stackexchange.com/questions/92256/advantages-and-disadvantages-of-forced-code-reformat): 2011. Do one "giant" formatting changeset so later diffs are real. The dissenting answer says forced formatting removes useful hand layout and makes later style changes produce "large misleading diff changes".
- [Opengrep fork governance doubts](https://news.ycombinator.com/item?id=42807062): 2025, in the "Opengrep – an Open Source fork of Semgrep" thread. One commenter doubts, conditionally, that the forking companies "understand what they are getting into/what the community wants".

## Contradictions and open questions

**Contradictions**
- **Fix everything vs baseline and hold the line.** Google's SWE book ch. 20, SonarQube new code and ESLint bulk suppressions favour baselining. The top-voted SE 193620 answer favours fixing everything, then enforcing. SE 158535 shows the failure mode of forced fixing: bugs introduced into working code. Proposed resolution: fix high-precision rules with safe autofixes, plus confirmed correctness/security issues and hotspots, wholesale; baseline the rest.
- **How noisy tools are depends on curation.** Google's curated analyzers run just below 5% effective false positives. Off-the-shelf tools show 20–80% (HN anecdote), and the Tencent industrial dataset 76% (328/433). These are not in conflict once curation is accounted for.
- **Does "code quality" predict defects?** Code Red (vendor-affiliated; 39 codebases; CodeScene code health) finds 15× more defects in low-quality code. Lenarduzzi et al. (JSS 2020; 33 Apache projects; SonarQube TD items) find no difference in fault-proneness, and SonarQube "bug" rules generally not fault-prone (SANER 2020). The metric chosen drives the result.
- **Meta-linter vs native tools.** Meta-linters make discovery easy, and one team credits MegaLinter with better agent PRs. Others find them heavy and slow, and they duplicate configs. No study compares outcomes.
- **Semgrep CE vs Opengrep.**
  - The Semgrep Rules License v1.0 (last updated 2024-12-13) limits registry rules to "your own internal business purposes" and forbids redistribution or offering them as a service. The Semgrep engine stays LGPL-2.1.
  - Opengrep (LGPL-2.1) adds `--taint-intrafile` and languages absent from CE. One HN commenter doubts its governance.
  - Both are active: Semgrep v1.177.0 and Opengrep v1.30.0, September 2026.
- **LLM triage vs the third-party premise.** A Tencent preprint reports hybrid LLM plus static analysis removing 94–98% of false positives. The user's premise is that model judgement shares blind spots with the code-writing agent. Tools stay the external ground truth, and any LLM triage must cite code evidence.
- **.git-blame-ignore-revs.** Git and GitHub recommend it. Practitioners report broken blame when it is configured globally, and IDE confusion when it is not configured.
- **Same-page documentation inconsistencies.** Semgrep's CLI help table labels exit 3 "invalid target code" and 7 "missing configuration". Its prose section says 3 = invalid syntax (only with `--strict`) and 7 = "at least one rule in the configuration is invalid". MegaLinter's SARIF reporter page names the output `mega-linter-report.sarif` in prose and `megalinter-report.sarif` in its variable table. The skill should read exit codes and file names from the actual run, not hard-code them.

**Open questions**
- **Trunk Code Quality.** Status is still not definitively confirmed. Public pages redirect away from it, docs.trunk.io/check needs a login, and docs tagging suggests "Legacy". Treat it as not recommended until confirmed.
- **OpenRewrite.** `rewrite-maven-plugin` v6.47.0 and v6.48.0 are tagged on GitHub but absent from Maven Central on 2026-09-23. It is unclear whether this is publication lag or a new distribution channel. Verify resolvability at run time.
- **Christakis & Bird (ASE 2016).** The false-positive tolerance numbers remain unverified; the Microsoft Research PDF was blocked for the researcher and was not re-attempted here.
- **Ruff's non-preview default rule set in 0.16.x.** The fetched docs describe only the preview "categories" default (correctness, suspicious, complexity, performance, style).
- **jscpd v5 features.** `--dead-code` (JS/TS/Python), `--health` and the `ai` reporter ("~79% fewer tokens") are vendor-described only; no independent evaluation.
- **Practitioner coverage.** Reddit and Lobsters were not reachable, so practitioner evidence leans on HN and SE.
- **Missing comparative studies.** No peer-reviewed study compares meta-linters with curated native toolchains on outcomes. None measures how often autofix passes introduce regressions in finished projects.
- **Unfetched install details.** Exact Docker image names and tags for Semgrep/Opengrep, and the golangci-lint v2 CLI flag syntax for SARIF (as opposed to the config-file `output.formats`), were not fetched. Confirm them from the official pages at skill-build time.
- **Hotspot heuristic.** No independent (non-vendor) study was found that validates ranking by churn × complexity, as opposed to churn alone. This is why T25-F10 is grade C.
- **Resolved by these passes:**
  - The Facebook Infer figures are confirmed from the archived primary CACM article.
  - ESLint bulk suppressions were introduced in v9.24.0.
  - MegaLinter's config lookup is per descriptor file name (see T25-F01).

## Dropped findings
None. All 19 findings survived. Claims removed or rewritten inside surviving findings:
- **T25-F01:** the general MegaLinter "repo-root config takes precedence over defaults" claim was not in the configuration docs. It was replaced by the narrower descriptor-level behaviour, which is sourced: specific file name, else MegaLinter template.
- **T25-F10:** "the authors are affiliated with the vendor" was corrected to the first author only. The finding was downgraded B→C.
- **T25-F18:** "the linter sees no files and reports clean" was softened to a possible outcome. A local reproduction showed a silently wrong mount, but a loud error for explicit container paths.
- **Summary:** "12.7–38.8% of real vulnerabilities even when tools are combined" conflated per-tool and combined figures; it now gives the separate ranges.
- **T25-F01 / T25-F06:** "tokei JSON needs `--features all`" and "tokei without features cannot serialise" are false for JSON; rewritten.
- **T25-F06:** Semgrep exit-code labels 7 ("missing config") and 8 ("invalid language") were wrong; replaced with the documented meanings.
- **T25-F11:** clippy `--fix` "machine-applicable" wording is not in the fetched docs; replaced with the documented wording.
- **T25-F12 / summary:** the OpenRewrite `6.48.0` pin does not resolve on Maven Central; replaced.
- **T25-F16:** the SE quote was misattributed to answer 160010; reattributed to the question author.
- **T25-F19:** "sarif diff shows new, resolved and changed issues" overstated its granularity; rewritten.
