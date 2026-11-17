# Quality standards and formal models
> Code T01 · slug standards · verified 2026-09-23 · counts: verified 8 / corrected 16 / downgraded 0 / dropped 0

**How this was checked.**

*PDFs.* Every PDF was downloaded and searched as full text with `pdftotext`, and the relevant pages were rendered to images where the data sat in figures:
- the CISQ June 2019 weakness list
- OMG ASCQM v1.1, formal/2022-07-01. The researcher had not reached this spec. It is the OMG specification behind ISO/IEC 5055.
- NIST SP 500-235
- JPL D-60411
- SIG/TÜV NORD CERT Guidance v17.0. Its risk-band figures were rendered to images.
- SonarSource Cognitive Complexity v1.7
- Yuan et al. OSDI'14
- Tricorder ICSE'15
- Juergens et al. ICSE'09
- Esposito et al. (arXiv)
- Holzmann's *Power of Ten* article in its original IEEE Computer web version, via a University of Michigan course mirror at `web.eecs.umich.edu/~imarkov/10rules.pdf`. The researcher had only Wikipedia for this.

*HTML pages.* Read with WebFetch, or with curl plus text extraction when an exact quote mattered.

*Publication metadata.* Checked through Crossref, Semantic Scholar and the arXiv pages.

*Repositories.* Status checked with `gh api` (none are archived).

*Search quota.* The session's WebSearch quota was already used up, so every source was reached by direct URL.

## Summary

**What the sources are.**

| Source | Version and status |
|---|---|
| ISO/IEC 25010:2023 | Not accessed; iso.org is behind a paywall. Its structure was taken from iso25000.com and arc42 (both reproduce the 2023 model), plus TIOBE/TÜViT and Codacy. |
| ISO/IEC 5055:2021 thresholds | Taken from the CISQ June 2019 list and the OMG ASCQM v1.1 specification (July 2022). Both have the same default thresholds. The ISO text itself was not accessed. |
| ASCQM's reference model | ISO/IEC 25010:**2011**, which is why CISQ says "4 of the 8" characteristics. The four measured characteristics (Maintainability, Reliability, Security, Performance Efficiency) still exist under those names in the 2023 model. |
| CWE category pages | CWE 4.20 (30 April 2026) |
| SIG/TÜV NORD CERT Guidance for Producers | v17.0, 12 March 2025 |
| SonarSource Cognitive Complexity white paper | v1.7, 29 August 2023 |
| SonarQube Server docs | 2025.1 to 2025.3 |
| JPL D-60411 | v1.0, 3 March 2009, the version edited for external distribution |
| Holzmann, "The Power of 10" | *IEEE Computer* 39(6), June 2006 |
| SEI CERT C | MSC00-C and MSC12-C. MSC07-C is **deprecated** and has been merged into MSC12-C; the researcher cited it as current. |
| MISRA C:2025 | Vendor summary only (Perforce) |
| NIST SP 500-235 | 1996 |

**Main result.** The formal models agree on a small core that can be checked in any language.

1. **The ISO 5055/CISQ weakness list is a finite checklist with default thresholds.** All of them can be tuned "prior to analysis".
   - Size and complexity limits:
     - cyclomatic complexity: 20
     - parameters per function: 7
     - lines per file: 1,000
     - fan-out per function: 5 references
   - Share limits:
     - logically dead code: 5%
     - structurally dead code: 0%
     - commented-out code: 2%
     - copy-paste: 10% of a function's instructions
   - Weaknesses with no threshold: empty handlers, unchecked return values, unreleased resources, circular dependencies, always-true and always-false conditions, infinite loops, remote calls with no timeout, and I/O or queries inside loops.
2. **SIG v17.0 gives risk bands and 4-star limits based on its benchmark.** The v17.0 guidance does not describe how the thresholds were calibrated.

   | Metric | Risk bands (low / moderate / high / very high) | 4-star limit |
   |---|---|---|
   | Unit size | 1–15 / 16–30 / 31–60 / 61+ LOC | — |
   | McCabe complexity | 1–5 / 6–10 / 11–25 / 26+ | — |
   | Parameters | 0–2 / 3–4 / 5–6 / 7+ | — |
   | Fan-in | thresholds at 10, 20 and 50 | — |
   | Clones | a clone is 6 or more lines | redundant lines ≤ 5.6% |
3. **Power of Ten: some rules carry over and some do not.**
   - Carry over to ordinary code: bounded loops, short functions, smallest scope, checking every return value, and zero warnings.
   - Do not carry over as written: the recursion ban, no heap after initialisation, the pointer rules and the preprocessor rules. TigerBeetle, a non-aerospace database, is a counter-example: it still bans recursion.
   - Assertion density: the evidence conflicts. JPL wants a failed assertion to trigger recovery, while TigerBeetle crashes.
4. **Every standard handles limits the same way.** NIST, JPL, MISRA and CERT all say: exceed a limit only with a written reason, and never game the metric.

**How strong the empirical evidence is.** It supports the direction of these rules but only modestly supports specific thresholds.
- **Understandability.** For 216 early-career developers, cyclomatic and cognitive complexity correlate only modestly with how understandable they found code (Spearman ρ −0.38 and −0.33). This is an arXiv preprint.
- **CC and size.** Cyclomatic complexity is not redundant with lines of code (17.6M Java methods, JSEP).
- **Method length.** Maintenance cost favours Java methods under 24 lines (MSR 2022).
- **Clones.** Inconsistently changed clones produced 107 faults that developers confirmed (ICSE 2009).
- **Error handling.** Yuan et al. sampled 198 failures, of which 48 were catastrophic.
  - 92% of the catastrophic failures came from mishandling errors that had been signalled.
  - 35% came from trivial handlers: empty or log-only, an abort on an over-broad catch, or TODO/FIXME.
- **Which analyzer checks get acted on.** At Google, only near-zero-false-positive checks are allowed to break the build.
- **SonarQube rules.** Most of SonarQube's 202 Java rules (2019 set) showed little link to faults (Lenarduzzi et al.).

**Dissent.** Practitioners dispute function-length limits (Ousterhout, Carmack, HN). They also argue that the bans on recursion and dynamic allocation belong to hard-real-time code.

**Coverage.** Coverage of Reddit and StackExchange remains thin.

## Findings

### T01-F10 — Every error handler must do something that changes the outcome; empty, log-only, TODO-only and over-broad catch-and-abort handlers are defects
- **Grade:** A · **Verdict:** CORRECTED
  - **The rule had to change: a log-only handler counts as ignoring.** The researcher's rule treated "log the exception with its stack trace" as acceptable handling, but Yuan et al. say explicitly that "an error handler that only logs the error is also considered as ignoring the error". Logging alone is now acceptable only when continuing is deliberately safe and a comment says why.
  - **The over-broad-catch pattern was mis-stated.** Yuan's pattern is catching a general exception *and then aborting or exiting the process*. It is not "a catch-all that fails to re-raise".
  - **The denominator was missing.** 92% and 35% are shares of 48 catastrophic failures, out of 198 failures sampled.
- **Rationale:** Each handler must do one of these:
  - recover correctly;
  - propagate the error with added context;
  - fail the operation in a way the caller can see.

  Logging is necessary but not sufficient. The defects to flag are:
  - `catch {}`, `except: pass`, and handlers whose only statement is a log or print call;
  - handlers whose only content is a TODO/FIXME;
  - catching Exception, Throwable or BaseException and then calling abort, exit or `System.exit`, or shutting the node down;
  - catch-alls that swallow the stack trace.

  Yuan et al. note that every one of these patterns is "easily detectable by tools or code reviews without a deep understanding of the runtime context". ISO 5055 lists this weakness as CWE-390 (Reliability).
- **Evidence:**
  - [Simple Testing Can Prevent Most Critical Failures (OSDI 2014)](https://www.usenix.org/system/files/conference/osdi14/osdi14-paper-yuan.pdf) — Yuan, Luo, Zhuang, Rodrigues, Zhao, Zhang, Jain, Stumm (Univ. of Toronto), 2014 — peer_reviewed — "almost all (92%) of the catastrophic system failures are the result of incorrect handling of non-fatal errors explicitly signaled in software"; "in 35% of the catastrophic failures … (i) the error handler is simply empty or only contains a log printing statement, (ii) the error handler aborts the cluster on an overly-general exception, and (iii) the error handler contains expressions like 'FIXME' or 'TODO'"; Fig. 5 splits these into 25% ignored, 8% abort on over-catch and 2% TODO; "(an error handler that only logs the error is also considered as ignoring the error)"; Aspirator "identified 121 new bugs and 379 bad practices … Of these, 143 have been fixed or confirmed" — Checked in the full PDF text.
    - The catastrophic subset is 48 of 198 (Table 2).
    - Aspirator works on Java bytecode only. It deliberately ignored exceptions raised in shutdown, close and cleanup methods, and FileNotFound.
  - [List of Weaknesses Included in the CISQ Automated Source Code Quality Measures — CWE-390](https://www.it-cisq.org/pdf/cisq-weaknesses-in-ascqm.pdf) — CISQ, June 2019 — standard — "The software detects a specific error, but takes no actions to handle the error. For instance, where an exception handling block (such as Catch and Finally blocks) do not contain any instruction…" — Checked in the PDF text (Reliability table).
  - [CWE-390 (CWE 4.20)](https://cwe.mitre.org/data/definitions/390.html) — MITRE, 2026 (page updated 30 April 2026) — standard — "Properly handle each exception. This is the recommended solution." — Verified. Member of CWE-1306 (CISQ Reliability).
  - [Ruff BLE001 blind-except](https://docs.astral.sh/ruff/rules/blind-except/) — Astral, 2026 docs — official_docs — flags `except BaseException` and `except Exception`, but not when the exception is re-raised or logged with `exc_info` — Verified. Derived from flake8-blind-except.
  - [Ruff S110 try-except-pass](https://docs.astral.sh/ruff/rules/try-except-pass/) — Astral, 2026 docs — official_docs — "Suppressing exceptions may hide errors that could otherwise reveal unexpected behavior, security vulnerabilities, or malicious activity. Instead, consider logging the exception." — Verified. The advice to "consider logging" falls short of the Yuan finding; see Contradictions.
  - [ESLint no-empty](https://eslint.org/docs/latest/rules/no-empty) — ESLint — official_docs — flags empty catch blocks by default; "This rule ignores block statements which contain a comment"; `allowEmptyCatch` turns the check off — Verified. Part of `@eslint/js` recommended.
  - [TIGER_STYLE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md) — TigerBeetle, 2026 (main) — engineering_blog — "All errors must be handled." It quotes the 92% finding — Verified in the raw file.
- **Detect:**
  - **Python:** Ruff S110, BLE001 and E722 (bare-except; the page exists and was verified).
  - **JS/TS:** ESLint no-empty with `allowEmptyCatch` left unset.
  - **Grep patterns:**
    - empty catch blocks: `rg -nU 'catch\s*(\([^)]*\))?\s*\{\s*\}'`
    - except/pass: `rg -nU 'except[^:]*:\s*\n\s*pass\b'`
    - TODO or FIXME within four lines after a handler: `rg -n -A4 '\bcatch\b|\bexcept\b' | rg 'TODO|FIXME|XXX'`
  - **By hand:** read every handler whose only statement is a log or print call and decide whether continuing is really safe.
  - **Java/C#:** `catch (Exception|Throwable)` blocks that call `System.exit`, abort or shutdown.
  - **Go:** `if err != nil {}` blocks that are empty or only log.
- **Tools:** Ruff (S110, BLE001, E722), ESLint no-empty, ripgrep, SonarQube (CWE-390 family).
- **Applies to:** All languages with exceptions or error returns. Yuan's systems were Java, plus Redis in C.
- **When not to apply / counterpoints:**
  - Ignoring an error is sometimes intentional: best-effort cleanup (Aspirator itself skipped close and cleanup methods) or optional telemetry. Such handlers need a comment explaining why. ESLint accepts a comment for this purpose.
  - High-availability systems prefer to degrade gracefully (Lobsters, zesterer), so "handle" does not always mean "propagate".
  - Changing a handler's behaviour in a finished product changes failure semantics, so tests must cover the error path.
- **Fix risk:** high

### T01-F14 — Build with the strictest practical warning level and all configured linters, and reach zero warnings; fix the code rather than silencing the tool
- **Grade:** A · **Verdict:** VERIFIED
  - The researcher had used Wikipedia for Power of Ten rule 10. It has been replaced by Holzmann's original article.
- **Rationale:**
  - JPL Rule 2 calls this "routine practice, even for non-critical code development". It is also Power of Ten rule 10 and CERT MSC00-C.
  - Google found that "warnings shown when building are often ignored".
  - Developers were "twice as likely to say the error represented a significant bug when encountered as a compiler error".
  - A zero-warning baseline is what keeps new warnings visible.
  - Any suppression that remains is scoped to one line, names the specific rule, and gives a reason.
- **Evidence:**
  - [JPL Institutional Coding Standard for C, D-60411 v1.0 — Rule 2](https://yurichev.com/mirrors/C/JPL_Coding_Standard_C.pdf) — NASA JPL, 3 March 2009 — standard — "All code shall always be compiled with all compiler warnings enabled at the highest warning level available, with no errors or warnings resulting." "This rule should be considered routine practice, even for non-critical code development." "The rule of zero warnings applies even in cases where the compiler or the static analyzer gives an erroneous warning." — Checked in the PDF text. The URL is a third-party mirror of the version edited for external distribution.
  - [The Power of 10: Rules for Developing Safety-Critical Code](https://web.eecs.umich.edu/~imarkov/10rules.pdf) — G. J. Holzmann, *IEEE Computer* 39(6), June 2006 — peer_reviewed (magazine column) — Rule 10: "All code must be compiled, from the first day of development, with all compiler warnings enabled at the most pedantic setting available. All code must compile without warnings." — Checked in the full text of the course-mirror copy of the computer.org web version. spinroot.com returns 403.
  - [MSC00-C. Compile cleanly at high warning levels](https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/miscellaneous-msc/msc00-c) — SEI CERT — standard — "Do not simply quiet warnings by adding type casts or other means." "if the code is correct, it is sufficient to provide a comment explaining why the warning message does not apply." — Verified.
  - [Tricorder: Building a Program Analysis Ecosystem (ICSE 2015)](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43322.pdf) — Sadowski, van Gogh, Jaspan, Söderberg, Winter (Google), 2015 — peer_reviewed — "warnings shown when building are often ignored"; build-breaking analyses need an "effective false positive rate [that] must be essentially zero"; "Developers were twice as likely to say the error represented a significant bug when encountered as a compiler error." — Checked in the PDF text. Venue confirmed via Crossref.
  - [TIGER_STYLE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md) — TigerBeetle — engineering_blog — "Appreciate, from day one, all compiler warnings at the compiler's strictest setting." — Verified.
- **Detect:**
  - **Build:** run the full build and the type-check with strict settings and record the warning count.
    - C: JPL's minimum is `gcc -Wall -pedantic -std=iso9899:1999`. JPL also suggests -Wshadow, -Wpointer-arith, -Wcast-qual, -Wconversion and others.
    - TS: `tsc --strict`.
  - **List all suppressions:** `rg -n 'eslint-disable|noqa|@SuppressWarnings|#pragma warning|@ts-ignore|@ts-expect-error|type:\s*ignore|nolint|#\[allow\('`
  - **Flag these suppressions:**
    - file-wide ones: `/* eslint-disable */` at the top of a file, a bare `# noqa`, or `# type: ignore` with no error code;
    - any suppression that gives no reason.
- **Tools:** Compiler with strict flags, `tsc --strict`, ESLint, Ruff, ripgrep.
- **Applies to:** All compiled, type-checked or linted languages.
- **When not to apply / counterpoints:**
  - The sources conflict on false positives:
    - JPL and Holzmann say to rewrite the code even when the warning is wrong;
    - CERT allows a commented suppression;
    - Google lets only near-zero-false-positive checks break the build (see F15).
  - Turning on every rule floods a finished codebase with noise. Reach zero on the configured set, then widen it one rule at a time.
- **Fix risk:** medium

### T01-F08 — Remove code that can never run or whose results are never used, but keep defensive branches and anything reachable by reflection or by an exported API
- **Grade:** A · **Verdict:** CORRECTED
  - **CERT reference.** MSC07-C is deprecated ("merged with MSC12-C"). The current CERT reference is MSC12-C, which also has an exception for exported libraries.
  - **Tooling.** GCC's `-Wunreachable-code`, which CERT listed on its 2014 page, is not documented in current GCC warning options. Clang's `-Wunreachable-code` is documented and replaces it.
  - **Romano et al.** Their findings come from interviews and university-based experiments.
- **Rationale:**
  - **Standards.** Dead code is an ISO 5055 maintainability weakness (CWE-561) with thresholds of "5% logically dead code or 0% for code that is structurally dead". CERT MSC12-C says code that has no effect or is never executed "is typically the result of a coding error and can cause unexpected behavior".
  - **Research.** Romano et al. ran interviews and four experiments and concluded that dead code is harmful during maintenance.
  - **Known false positives.** Tools report code as unused when it is only called implicitly, and exported library APIs are legitimately unused inside their own repository.
- **Evidence:**
  - [CISQ weakness list — CWE-561](https://www.it-cisq.org/pdf/cisq-weaknesses-in-ascqm.pdf) — CISQ, June 2019 — standard — "(Thresholds are set at 5% logically dead code or 0% for code that is structurally dead. Code that exists in the source but not in the object does not count.)" — Checked in the PDF. The same wording appears in [OMG ASCQM v1.1](https://www.omg.org/spec/ASCQM/1.1/PDF) (formal/2022-07-01).
  - [CWE-561: Dead Code (CWE 4.20)](https://cwe.mitre.org/data/definitions/561.html) — MITRE, 2026 — standard — "Remove dead code before deploying the application." — Verified. Member of CWE-1307.
  - [MSC12-C. Detect and remove code that has no effect or is never executed](https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/miscellaneous-msc/msc12-c) — SEI CERT — standard — "Code that has no effect or is never executed (that is, dead or unreachable code) is typically the result of a coding error and can cause unexpected behavior." The three exceptions:
    - "MSC12-EX1: In some situations, seemingly dead code may make software resilient. An example is the default label in a switch statement whose controlling expression has an enumerated type…"
    - "MSC12-EX2: It is permissible to temporarily remove code that may be needed later."
    - "MSC12-EX3: Unused functions and variables that are part of an exported library do not violate this guideline."

    Risk: Low severity, Unlikely likelihood, P2/L3 — Verified. It replaces the deprecated [MSC07-C](https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/miscellaneous-msc/msc07-c), whose page reads "This rule has been deprecated… merged with: MSC12-C".
  - [A Multi-Study Investigation into Dead Code (IEEE TSE)](https://api.semanticscholar.org/graph/v1/paper/DOI:10.1109/TSE.2018.2842781?fields=title,abstract,year,authors,venue) — Romano, Vendome, Scanniello, Poshyvanyk, 2020 (DOI 10.1109/TSE.2018.2842781) — peer_reviewed — "semi-structured interviews with software professionals and four experiments at the University of Basilicata and the College of William & Mary … in the maintenance and evolution phases, where our results suggest that dead code is harmful"; "developers should avoid this smell" — Verified, abstract only (paper closed access).
  - [Vulture](https://github.com/jendrikseipp/vulture) — Jendrik Seipp — official_docs — confidence levels: 100% for arguments and unreachable code, 90% for imports, 60% for attributes, classes, functions, methods, properties and variables; "Code that is only called implicitly may be reported as unused." "Use `--min-confidence 100` to only report code that is guaranteed to be unused within the analyzed files." — Verified. The repository is active (last push 2026-09-16) and not archived.
  - [Knip](https://knip.dev/) — Knip project (webpro-nl) — official_docs — "Knip finds and fixes unused dependencies, exports and files"; "150+ plugins"; testimonials include "~300k lines of unused code at Vercel", "over 41k lines of code in legacy codebase" and "Had just one false positive" — Verified. These are vendor-page testimonials, not measurements. The repository is active (2026-09-23) and not archived.
- **Detect:**
  - **JS/TS:** `npx knip`. Configure framework plugins and entry points first, and review the report before running `--fix`.
  - **Python:**
    - Run `vulture src/ --min-confidence 100`.
    - Review the 60–90% items by hand.
    - Keep a whitelist of confirmed false positives.
  - **C/C++:** Clang `-Wunreachable-code`, or GCC `-Wunused-value` and `-Wunused-parameter` (these two are listed on MSC12-C).
  - **All languages:**
    - SonarQube unused-code rules.
    - Lines the full test suite never executes. Treat them as candidates to examine, not as proof.
  - **Before any delete:** grep the symbol name as a string, to catch reflection, dynamic import, route tables and DI registration: `rg -n "'symbolName'|\"symbolName\""`.
- **Tools:** Knip, Vulture, Clang -Wunreachable-code, SonarQube, coverage report, ripgrep.
- **Applies to:** All languages. Take extra care with libraries whose exported API is used by third parties (MSC12-EX3).
- **When not to apply / counterpoints:**
  - CERT rates the severity as low.
  - Seemingly unreachable defensive defaults are kept on purpose (MSC12-EX1).
  - Feature-flagged or `#ifdef`'d code can look dead (MSC12-EX3).
  - Static tools miss dynamic use.
- **Fix risk:** medium

### T01-F11 — Every status, error value, Result/Option or Promise/Future returned by a call must be used, awaited or explicitly discarded with an intent marker
- **Grade:** A · **Verdict:** VERIFIED
  - Holzmann's original text was added, including his own caveat on this rule.
  - The tool names were checked: typescript-eslint no-misused-promises, Go errcheck, Rust unused_must_use, GCC -Wunused-result and C++ `[[nodiscard]]` all exist.
- **Rationale:**
  - **Standards.** Unchecked return values are an ISO 5055 reliability weakness (CWE-252). Power of Ten rule 7 and JPL Rule 14 both require the check.
  - **Holzmann's caveat.** He calls rule 7 "possibly the most frequently violated rule, and therefore … somewhat more suspect for inclusion as a general rule". Where the response to an error would not differ from the response to success, he accepts an explicit `(void)` cast.
  - **Async code.** typescript-eslint warns that `void` only signals intent, so rejections are still unhandled.
- **Evidence:**
  - [CISQ weakness list — CWE-252](https://www.it-cisq.org/pdf/cisq-weaknesses-in-ascqm.pdf) — CISQ, 2019 — standard — "The software does not check the return value from a method or function, which can prevent it from detecting unexpected states and conditions." — Checked in the PDF (Reliability table).
  - [JPL D-60411 Rule 14](https://yurichev.com/mirrors/C/JPL_Coding_Standard_C.pdf) — NASA JPL, 2009 — standard — "The return value of non-void functions shall be checked or used by each calling function, or explicitly cast to (void) if irrelevant." — Checked in the PDF.
  - [The Power of 10, rule 7](https://web.eecs.umich.edu/~imarkov/10rules.pdf) — Holzmann, *IEEE Computer*, 2006 — peer_reviewed — "Each calling function must check the return value of nonvoid functions, and each called function must check the validity of all parameters provided by the caller." "if the response to an error would be no different than the response to success, there is little point in explicitly checking a return value … explicitly casting the function return value to (void) can be acceptable" — Checked in the full text.
  - [typescript-eslint no-floating-promises](https://typescript-eslint.io/rules/no-floating-promises/) — typescript-eslint — official_docs — "Floating Promises can cause several issues, such as improperly sequenced operations, ignored Promise rejections, and more." "Voiding a Promise doesn't handle it or change the runtime behavior … Such Promise rejections will still be unhandled." — Verified. The rule needs type information and is in `recommended-type-checked`.
- **Detect:**
  - **TS:** `@typescript-eslint/no-floating-promises` and `no-misused-promises`.
  - **C/C++:** `-Wunused-result` (the GCC default, which only covers functions marked `warn_unused_result`) and `[[nodiscard]]`.
  - **Go:** errcheck.
  - **Rust:** the `unused_must_use` lint, which warns by default.
  - **Other languages:** SonarQube's CWE-252 rules.
  - **By hand:** grep for calls to fallible APIs (write, close, fsync, send, commit) whose result is dropped.
- **Tools:** typescript-eslint, SonarQube, compiler unused-result warnings, errcheck, rustc lints.
- **Applies to:** All languages. The intent marker differs: `(void)` in C, `.catch(...)` handling or `void` plus a handler in TS, `_ =` in Go, `let _ =` in Rust.
- **When not to apply / counterpoints:**
  - Checking every printf or close call is noise, which is why Holzmann and JPL allow `(void)`.
  - Fire-and-forget telemetry is legitimate if it has a rejection handler. Voiding a promise only silences the linter; it does not handle the error.
- **Fix risk:** medium

### T01-F12 — Release every acquired resource on all paths, including exception paths, using the language's scoped construct; keep a lock and its unlock in the same function
- **Grade:** A · **Verdict:** CORRECTED
  - The researcher implied every listed CWE sits in both the Reliability and Performance Efficiency measures. Only CWE-404, 401, 772 and 775 are in both. CWE-459 (incomplete cleanup), CWE-667 (improper locking) and CWE-833 (deadlock) are in Reliability only.
- **Rationale:**
  - **What to cover:** files, sockets, DB connections and cursors, locks, temp files, subscriptions, timers and listeners.
  - **How:** use `with`, `using`, try-with-resources, `defer`, RAII or `finally`.
  - **Locks:** JPL requires that "Unlock operations shall always appear within the body of the same function that performs the matching lock operation", and that nested locks be taken "in a single predetermined, and documented, order".
- **Evidence:**
  - [CISQ weakness list — Reliability and Performance Efficiency tables](https://www.it-cisq.org/pdf/cisq-weaknesses-in-ascqm.pdf) — CISQ, 2019 — standard — CWE-775: "When a file descriptor or handle is not released after use (typically by explicitly closing it), attackers can cause a denial of service…"; CWE-667: "does not properly acquire a lock on a resource, or it does not properly release a lock on a resource"; CWE-833: "multiple threads or executable segments that are waiting for each other to release a necessary lock" — Checked in the PDF. CWE-404, 401, 772 and 775 appear in both tables; CWE-459, 667 and 833 only in Reliability.
  - [JPL D-60411 Rule 9](https://yurichev.com/mirrors/C/JPL_Coding_Standard_C.pdf) — NASA JPL, 2009 — standard — "If used, nested use of semaphores or locks should be avoided. If such use is unavoidable, calls shall always occur in a single predetermined, and documented, order. Unlock operations shall always appear within the body of the same function that performs the matching lock operation." — Checked in the PDF.
  - [Ruff SIM115](https://docs.astral.sh/ruff/rules/open-file-with-context-handler/) — Astral — official_docs — "If a file is opened without a context manager, it is not guaranteed that the file will be closed (e.g., if an exception is raised), which can cause resource leaks." — Verified. Stable; derived from flake8-simplify.
- **Detect:**
  - **Python:** Ruff SIM115.
  - **Java/C#:** resources created outside try-with-resources or `using` (SonarQube resource-leak rules).
  - **JS:** run `rg -n 'setInterval\(|addEventListener\(|\.subscribe\('` and check that each hit has a matching `clearInterval`, `removeEventListener` or `unsubscribe` on teardown.
  - **Locks:** run `rg -n 'lock\(|acquire\('` and check that the matching release sits in the same function, in `finally` or `defer`.
- **Tools:** Ruff SIM115, SonarQube, ripgrep.
- **Applies to:** All languages, garbage-collected ones included, because GC does not close OS handles promptly.
- **When not to apply / counterpoints:**
  - Pools, singletons and process-wide clients are held for the process lifetime on purpose, so do not scope them.
  - GC can hide leaks in short test runs.
- **Fix risk:** medium

### T01-F16 — Declare data at the smallest scope, prefer immutable bindings, forbid shadowing, and remove shared mutable global or static state
- **Grade:** A · **Verdict:** VERIFIED
  - Holzmann's original text was added.
  - ESLint no-shadow, prefer-const and no-var were checked and exist.
- **Rationale:**
  - This is Power of Ten rule 6 and JPL Rule 13: "If an object is not in scope, its value cannot be referenced or corrupted." JPL adds: "prefer the use of immutable data objects and references".
  - ISO 5055 covers non-final static data:
    - CWE-1058 and CWE-567 in Reliability, both concerning multithreaded contexts;
    - CWE-1042 in Performance Efficiency: a static, non-final member outside a singleton class.
  - Pylint and Ruff call global mutable state "a common source of bugs and confusing behavior".
- **Evidence:**
  - [JPL D-60411 Rule 13](https://yurichev.com/mirrors/C/JPL_Coding_Standard_C.pdf) — NASA JPL, 2009 — standard — "Data objects shall be declared at the smallest possible level of scope. No declaration in an inner scope shall hide a declaration in an outer scope." "Good programming practice is further to prefer the use of immutable data objects and references." — Checked in the PDF.
  - [CISQ weakness list — CWE-1058, CWE-567, CWE-1042](https://www.it-cisq.org/pdf/cisq-weaknesses-in-ascqm.pdf) — CISQ, 2019 — standard — CWE-1058: "a function or method that operates in a multi-threaded environment but owns an unsafe non-final static storable or member data element"; CWE-567: "does not properly synchronize shared data, such as static variables across threads" — Checked in the PDF.
  - [Ruff PLW0603 global-statement](https://docs.astral.sh/ruff/rules/global-statement/) — Astral — official_docs — "Pylint discourages the use of global variables as global mutable state is a common source of bugs and confusing behavior." — Verified.
  - [The Power of 10, rule 6](https://web.eecs.umich.edu/~imarkov/10rules.pdf) — Holzmann, 2006 — peer_reviewed — "Declare all data objects at the smallest possible level of scope." — Checked in the full text.
- **Detect:**
  - **Python:** Ruff PLW0603, plus `rg -n '^\s*global\s'`.
  - **JS/TS:**
    - ESLint no-shadow, prefer-const and no-var;
    - `rg -n '^(export\s+)?(let|var)\s'` to find top-level mutable bindings.
  - **Java/C#:** non-final static fields (SonarQube's CWE-1058 and CWE-1042 rules).
  - **By hand:** check whether each remaining piece of shared mutable state is reachable from concurrent code.
- **Tools:** Ruff PLW0603, ESLint no-shadow/prefer-const/no-var, SonarQube, ripgrep.
- **Applies to:** All languages. Give it higher priority in multithreaded and async servers.
- **When not to apply / counterpoints:**
  - Module-level constants, loggers, connection pools and memo caches are legitimate if they are immutable or synchronised.
  - Moving state changes its lifetime (for example, cache hit rates) and its initialisation order.
- **Fix risk:** medium

### T01-F19 — Flag the ISO 5055 performance weaknesses that occur inside loops, and flag algorithms that are quadratic or worse; batch, hoist or index them only after checking ordering and rate limits
- **Grade:** A · **Verdict:** CORRECTED
  - **CWE-407 is filed under Maintainability.** The researcher placed CWE-407 (algorithmic complexity) in the ISO 5055 Performance Efficiency measure. Both the CISQ list and MITRE's CWE-1309 put it in Maintainability, and CWE-1309 does not list it.
  - **CWE-1050 has no numeric default.** Its threshold "should be set based on the system architecture prior to analysis".
- **Rationale:**
  - **Performance Efficiency weaknesses in ISO 5055:**
    - CWE-1050: a loop body or loop condition that consumes platform resources.
    - CWE-1060: too many server-side data accesses; default threshold 5.
    - CWE-1073: a non-SQL element with too many data accesses; default threshold 2.
    - CWE-1046: building immutable text by string concatenation.
  - **Maintainability weakness:** CWE-407, "inefficient worst-case computational complexity".
  - **Legitimate exceptions:** ESLint's no-await-in-loop lists the cases where sequential awaits are correct.
- **Evidence:**
  - [CISQ weakness list — Performance Efficiency and Maintainability tables](https://www.it-cisq.org/pdf/cisq-weaknesses-in-ascqm.pdf) — CISQ, 2019 — standard — CWE-1050: "a loop body or loop condition that contains a control element that directly or indirectly consumes platform resources, e.g. messaging, sessions, locks, or file descriptors. (default threshold for resource consumption should be set based on the system architecture prior to analysis)"; CWE-1060: "(default threshold for maximum number of data queries is 5…)"; CWE-1073: "(default threshold for the maximum number of data queries is 2…)"; CWE-407 (Maintainability table): "An algorithm in a product has an inefficient worst-case computational complexity" — Checked in the PDF.
  - [CWE-1309: CISQ Quality Measures — Efficiency (CWE 4.20)](https://cwe.mitre.org/data/definitions/1309.html) — MITRE, 2026 — standard — members are 404, 424, 1042, 1043, 1046, 1049, 1050, 1057, 1060, 1067, 1072, 1073, 1089, 1091 and 1094; CWE-407 is not a member — Verified.
  - [ESLint no-await-in-loop](https://eslint.org/docs/latest/rules/no-await-in-loop) — ESLint — official_docs — "each successive operation will not start until the previous one has completed". Exceptions include:
    - rate limits: "we'll exceed our rate limit if we make all the network calls in parallel";
    - file writes: "Doing this in parallel would interleave (garble) the resulting file contents";
    - inter-iteration dependencies, bounded resources and retry loops.

    Verified.
- **Detect:**
  - **JS/TS:** ESLint no-await-in-loop, triaged against its documented exceptions.
  - **Grep:** query, fetch, open and connect calls inside for, while, forEach and map bodies.
  - **Quadratic patterns:** nested iteration over the same collection, such as `.find`, `.includes`, `.indexOf` or `x in list` inside a loop.
  - **ORMs:** lazy-loaded relations accessed inside loops.
  - **Measure:** profile before and after any change.
- **Tools:** ESLint no-await-in-loop, SonarQube, profiler.
- **Applies to:** All languages. Most important for DB-backed services and API clients.
- **When not to apply / counterpoints:**
  - Sequential processing is sometimes required by ordering, rate limits, back-pressure or bounded handles.
  - Micro-optimising without measurements adds complexity.
- **Fix risk:** high

### T01-F20 — Treat constant conditions, missing or non-exhaustive switch defaults, unintended fall-through, precedence-dependent expressions and side effects in boolean conditions as defects to investigate
- **Grade:** A · **Verdict:** CORRECTED
  - **CERT reference.** MSC07-C was replaced by MSC12-C (EX1).
  - **ESLint rule status.** `no-mixed-operators` was deprecated in ESLint v8.53.0 and will be removed in v11; use `@stylistic/no-mixed-operators`. The other ESLint core rules named were checked and exist.
  - **typescript-eslint support.** The typescript-eslint docs back the "default can hide new union members" counterpoint.
- **Rationale:** Establish the intended behaviour before changing anything. The patterns come from these standards:
  - **ISO 5055 Maintainability measure:**
    - CWE-570 and CWE-571: expression always false or always true;
    - CWE-478: missing default case;
    - CWE-484: omitted break;
    - CWE-480: incorrect operator;
    - CWE-783: operator precedence error.
  - **JPL:** Rule 18 requires explicit parentheses and Rule 19 requires no side effects in Boolean expressions.
  - **CERT:** a default on an exhaustive enum switch is defensive, not dead.
- **Evidence:**
  - [CISQ weakness list — CWE-478, 480, 484, 570, 571, 783](https://www.it-cisq.org/pdf/cisq-weaknesses-in-ascqm.pdf) — CISQ, 2019 — standard — CWE-478: "does not have a default case in a switch statement, which might lead to complex logical errors"; CWE-783: "operator precedence causes incorrect logic to be used"; CWE-570: "an expression that will always evaluate to false" — Checked in the PDF.
  - [JPL D-60411 Rules 18 and 19](https://yurichev.com/mirrors/C/JPL_Coding_Standard_C.pdf) — NASA JPL, 2009 — standard — "the intended order of evaluation shall be made explicit with parentheses"; "The evaluation of a Boolean expression shall have no side effects." — Checked in the PDF.
  - [MSC12-C, MSC12-EX1](https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/miscellaneous-msc/msc12-c) — SEI CERT — standard — "seemingly dead code may make software resilient. An example is the default label in a switch statement whose controlling expression has an enumerated type and that specifies labels for all enumerations of the type." — Verified.
  - [typescript-eslint switch-exhaustiveness-check](https://typescript-eslint.io/rules/switch-exhaustiveness-check/) — typescript-eslint — official_docs — with `considerDefaultExhaustiveForUnions`, "a `default` would prevent the `switch-exhaustiveness-check` rule from reporting on the new case not being handled" — Verified. Needs type information.
- **Detect:**
  - **JS/TS:**
    - ESLint no-constant-condition, default-case and no-fallthrough;
    - `@stylistic/no-mixed-operators`;
    - typescript-eslint switch-exhaustiveness-check.
  - **C/C++:** `-Wimplicit-fallthrough` (listed in the GCC docs).
  - **All languages:** SonarQube's CWE-570/571/478/484/783 rules.
  - **By hand:** `rg -n 'if\s*\((true|false|0|1)\)'`, and conditions that contain `=` or `++`.
- **Tools:** ESLint core rules, @stylistic/eslint-plugin, typescript-eslint, compiler warnings, SonarQube.
- **Applies to:** All languages.
- **When not to apply / counterpoints:**
  - In TypeScript, adding a `default` to a switch that is already exhaustive over a union can hide future variants from the type checker. This conflicts with "always add default"; prefer an exhaustiveness check.
  - Constant conditions are sometimes deliberate debug or feature-flag scaffolding.
- **Fix risk:** medium

### T01-F01 — Organise the hardening pass on ISO/IEC 25010 as vocabulary and the ISO/IEC 5055 (CISQ/OMG ASCQM) weakness list as the checklist; never claim "ISO compliance" from an agent review
- **Grade:** A · **Verdict:** CORRECTED
  - **ISO 5055 is anchored to ISO 25010:2011, not 2023.** The OMG ASCQM specification behind it references ISO/IEC 25010:2011, and CISQ's "4 of the 8" is the 2011 count. The four characteristic names are unchanged in 2023, so the filing works.
  - **Testability sits under Maintainability.** iso25000.com, which reproduces the 2023 structure including Flexibility and Safety, puts Testability under Maintainability, as do TIOBE and Codacy. arc42 is the outlier that puts it under Flexibility.
  - **The ASCQM counts moved in the 2022 revision.**

    | Source | Performance Efficiency | Security |
    |---|---|---|
    | CISQ 2019 list | 15 parents + 3 contributing | 36 parents + 38 contributing |
    | OMG ASCQM v1.1 (2022) | 16 parents + 3 contributing | 36 parents + 37 contributing |

    Maintainability (29 parents) and Reliability (35 parents + 39 contributing) did not change.
  - **MITRE's Maintainability category omits CWE-1121.** CWE-1307 lists 28 members. It leaves out CWE-1121 (McCabe complexity), which both CISQ 2019 and ASCQM v1.1 include.
  - **Codacy page date.** It is 16 May 2026, not 2024.
- **Rationale:**
  - **What each standard does.** ISO 25010 names qualities but does not measure them. ISO 5055 measures four of them (Maintainability, Reliability, Security, Performance Efficiency) by counting CWE weaknesses that static analysis can detect, then turns the counts into densities.
  - **Why use them.** Together they give the review an external vocabulary and a finite list to check.
  - **How to file findings.** File each finding under one of the four characteristics and tag it with the CWE id. The CWE categories are 1306 Reliability, 1307 Maintainability, 1308 Security and 1309 Efficiency.
  - **SonarSource's Clean Code taxonomy.** Use it only as a secondary tag. Its four attributes are consistency, intentionality, adaptability and responsibility. SonarQube 2025 still ships a Standard Experience mode with the older bug, vulnerability and code smell types next to MQR mode.
- **Evidence:**
  - [List of Weaknesses Included in the CISQ Automated Source Code Quality Measures](https://www.it-cisq.org/pdf/cisq-weaknesses-in-ascqm.pdf) — CISQ, June 2019 — standard — "This specification provides automated measures for four structural quality characteristics listed in the ISO/IEC 25010 software quality model that can be calculated from source code—Reliability, Security, Performance Efficiency, and Maintainability." "This measure contains 29 parent weaknesses and no contributing weaknesses." — Checked in the PDF.
  - [Automated Source Code Quality Measures v1.1 (formal/2022-07-01)](https://www.omg.org/spec/ASCQM/1.1/PDF) — Object Management Group, July 2022 — standard — Maintainability: "29 parent weaknesses and no contributing weaknesses"; Performance Efficiency: "16 parent weaknesses and 3" contributing; Reliability: 35 + 39; Security: 36 + 37. The default thresholds (CC 20, parameters 7, file LOC 1000, dead code 5%/0%, commented-out 2%, copy-paste 10%, fan-out 5) match the 2019 list word for word. The normative reference is ISO/IEC 25010:2011 — Downloaded and checked in the PDF. Added by the verifier.
  - [ISO 5055: Automated Source Code Quality Measures — The First Standard of its Kind](https://www.it-cisq.org/2021/09/iso-5055-automated-source-code-quality-measures-the-first-standard-of-its-kind/) — Bill Curtis & Katie Hart (CISQ), 1 September 2021 — industry_report — "The four measures in ISO 5055 evaluate 4 of the 8 quality characteristics specified in ISO/IEC 25010"; "Counts of the weaknesses are calculated for each of the four factors that may then be transformed into comparative measures such as the density of weaknesses" — Verified.
  - [CWE-1307: CISQ Quality Measures — Maintainability (CWE 4.20)](https://cwe.mitre.org/data/definitions/1307.html) — MITRE, 2026 — standard — "Weaknesses in this category are related to the CISQ Quality Measures for Maintainability." It has 28 members: 407, 478, 480, 484, 561, 570, 571, 783, 1041, 1045, 1047, 1048, 1051, 1052, 1054, 1055, 1062, 1064, 1074, 1075, 1079, 1080, 1084, 1085, 1086, 1087, 1090 and 1095 — Verified with curl. CWE-1121 is absent here; it is only a member of the 2016 CISQ category.
  - [ISO/IEC 25010 (iso25000.com)](https://iso25000.com/index.php/en/iso-25000-standards/iso-25010?start=5) — iso25000.com portal — other — Maintainability has the sub-characteristics "Modularity … Reusability … Analysability … Modifiability … Testability". Flexibility has "Adaptability … Scalability … Installability … Replaceability" — Verified. Added by the verifier to settle the Testability question.
  - [ISO/IEC 25010 — arc42 Quality Model](https://quality.arc42.org/standards/iso-25010) — Gernot Starke (arc42), undated — other — lists 9 top-level characteristics and places Testability under Flexibility — Verified that it says this. It conflicts with iso25000.com, TIOBE and Codacy.
  - [Trusted Product Maintainability Quality Model](https://www.tiobe.com/quality-models/trusted-product-maintainability/) — TIOBE / TÜViT, model v1.2 — industry_report — "Following ISO/IEC 25010, the quality model drills down from the quality characteristic maintainability towards the sub-characteristics modularity, reusability, analyzability, modifiability and testability." Metrics: cyclomatic complexity, compiler warnings, coding standards, duplication, fan out — Verified.
  - [The Quamoco Product Quality Modelling and Assessment Approach (ICSE 2012)](https://arxiv.org/abs/1611.04433) — Wagner, Lochmann, Heinemann, Kläs, Trendowicz, Plösch, Seidl, Goeb, Streit, 2012 — peer_reviewed — "Published software quality models either provide abstract quality attributes or concrete quality assessments." The model has "200 factors and 600 measures for Java and C# systems" — Verified.
  - [An Exploration of the ISO/IEC 25010 Software Quality Model](https://blog.codacy.com/iso-25010-software-quality-model) — Codacy, 16 May 2026 — engineering_blog — "ISO/IEC 25010 does not provide a comprehensive and systematic mapping of sub-characteristics to software metrics." "This is deliberate: quality is contextual…" — Verified. Vendor blog.
  - [SonarQube glossary (Server 2025.1)](https://docs.sonarsource.com/sonarqube-server/2025.1/glossary) — SonarSource, 2025 — official_docs — consistency: "written in a uniform and conventional way"; intentionality: "precise and purposeful"; adaptability: "structured to be easy to evolve"; responsibility: "takes into account its ethical obligations on data, as well as societal norms"; MQR: "a rule measures the impact on one or several software qualities" — Verified.
- **Detect:**
  - **Build one table.** Put one row per CWE id from CWE-1306/1307/1308/1309 plus the ASCQM v1.1 list, with its default threshold.
  - **Columns:**
    - the analyzer rule that detects the weakness in each project language;
    - the manual check to use when no rule exists;
    - the hit count;
    - the density per KLOC, which is how ISO 5055 turns counts into comparable measures.
  - **Mark impossible rows N/A.** Examples: the virtual-destructor CWEs (1045, 1079, 1087) outside C++, and the CWE-119 buffer family in memory-safe languages.
- **Tools:** CWE category pages, CISQ 2019 list, OMG ASCQM v1.1, SonarQube in MQR mode.
- **Applies to:** All languages. Rows specific to OO or to C/C++ become N/A elsewhere.
- **When not to apply / counterpoints:**
  - The ISO texts themselves were not read.
  - Weakness counts are proxies: Lenarduzzi et al. found SonarQube's rule-based model had "extremely low" fault-prediction power.
  - No peer-reviewed link from ISO 5055 weakness density to defects or effort was found.
  - The mapping sources disagree: MITRE's CWE-1307 omits CWE-1121, which ASCQM includes.
- **Fix risk:** low

### T01-F02 — Treat every numeric limit as a trigger for review, never a target; each unit over a limit is either refactored or carries a written justification; never game the metric
- **Grade:** A · **Verdict:** VERIFIED
  - The JPL "should" convention was added. It matches the per-unit justification more closely than the waiver board does.
- **Rationale:**
  - **The shared mechanism.** Written deviations are the one mechanism that every formal standard shares. NIST's policy: "For each module, either limit cyclomatic complexity to 10 … or provide a written explanation of why the limit was exceeded."
  - **A recorded gaming failure.** NIST describes a developer who could reduce a module "with complexity 90 … to 'modified' complexity 10 simply by adding a ten-branch multiway decision statement to it that did nothing".
  - **JPL.** "Should" rules allow deviations "provided that an adequate justification is given for each deviation". "Shall" rules need a written waiver reviewed by experts outside the project.
  - **MISRA.** Every deviation must be documented.
  - **Coverage.** Coverage targets are gamed the same way (Fowler).
- **Evidence:**
  - [NIST SP 500-235 Structured Testing, §2.5](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf) — A. H. Watson & T. J. McCabe (D. R. Wallace, ed.), NIST, September 1996 — standard — "For each module, either limit cyclomatic complexity to 10 (as discussed earlier, an organization can substitute a similar number), or provide a written explanation of why the limit was exceeded."; "the developer could take a module with complexity 90 and reduce it to 'modified' complexity 10 simply by adding a ten-branch multiway decision statement to it that did nothing"; "constructing 'modified' complexity measures is not recommended" — Checked in the PDF text.
  - [JPL D-60411 v1.0 — Conventions](https://yurichev.com/mirrors/C/JPL_Coding_Standard_C.pdf) — NASA JPL, 2009 — standard — "Should indicates a preference that must be addressed, but with deviations allowed, provided that an adequate justification is given for each deviation." "If a deviation from a shall rule is sought, substantial supporting evidence must be provided in a written waiver request. Such waiver requests must be evaluated by a team of software experts from across JPL, not associated with the project seeking the waiver." — Checked in the PDF.
  - [MISRA C and MISRA C++ (overview)](https://www.perforce.com/resources/qac/misra-c-cpp) — Perforce, 2025 — engineering_blog (vendor) — "MISRA C:2025, published in March 2025 … for a total of 225 active guidelines." "every rule deviation needs to be well-documented." — Verified on the vendor page. The MISRA document itself was not accessed.
  - [TestCoverage (bliki)](https://martinfowler.com/bliki/TestCoverage.html) — Martin Fowler, 17 April 2012 — engineering_blog — "If you make a certain level of coverage a target, people will try to attain it. The trouble is that high coverage numbers are too easy to reach with low quality testing." "it helps you find which bits of your code aren't being tested." "I would be suspicious of anything like 100%" — Checked with curl.
  - [ESLint complexity](https://eslint.org/docs/latest/rules/complexity) — ESLint — official_docs — default 20; the `"modified"` variant makes "each `switch` statement only increase the complexity value by `1`, regardless of how many `case` statements it contains"; "If you can't determine an appropriate complexity limit for your code, then it's best to disable this rule." — Verified.
- **Detect:**
  - **Match exceedances to justifications.** Take the list of units over each limit from the tool output. Check that every one was either refactored or carries a justification.
  - **Find suppressions with no stated reason:**
    - `rg -n 'eslint-disable(-next-line)?\s*[a-z/@-]*\s*$'`
    - `rg -n '#\s*noqa(:\s*[A-Z0-9, ]+)?\s*$'`
    - `rg -n '(@ts-ignore|@ts-expect-error|type:\s*ignore)\s*$'`
  - **Check config history.** Look at `git log -p` on lint and analyzer configs for limits raised globally, or a switch to discounted variants such as ESLint `complexity {variant: "modified"}`, where no rationale was recorded.
- **Tools:** ripgrep, ESLint, Ruff, SonarQube, `git log -p`.
- **Applies to:** All languages and all metric-based rules.
- **When not to apply / counterpoints:**
  - Justification comments can turn into boilerplate.
  - A solo developer cannot reproduce JPL's independent waiver board. The nearest equivalent is a deviations file that gets reviewed.
  - NIST allows limits up to 15 "if it is sure it knows what it is doing", and it exempts modules that consist of a single multiway decision.
- **Fix risk:** low

### T01-F03 — Flag functions with McCabe cyclomatic complexity above 10 for review; treat above 20 as refactor-or-justify; report the SIG band distribution
- **Grade:** A · **Verdict:** CORRECTED
  - **SIG wording.** "Calibrated" was replaced with "benchmark-based", because the v17.0 guidance does not describe how its thresholds were calibrated. The SIG bands were checked in the rendered figures.
  - **Landman et al. venue.** JSEP 28(7), published online December 2015.
  - **Esposito et al. are internally inconsistent.** The text says neither metric correlates with problem severity, while its Table 10 reports small significant correlations of −0.27 (CC) and −0.17 (cognitive).
  - **Ruff default.** Ruff's `max-complexity` default is 10.
- **Rationale:** Three formal sources set limits:
  - McCabe/NIST: 10, with 15 tolerated for strong teams;
  - ISO 5055/CISQ CWE-1121: default 20, also ESLint's default;
  - SIG bands (1–5, 6–10, 11–25, 26+) with 4-star limits on the share of LOC above 5, 10 and 25.

  Across 17.6M Java methods and 6.3M C functions, CC is not redundant with size. It is only a modest predictor of how hard juniors find code to understand.

  A function that is a single flat switch or dispatch table with trivial branches may be exempted by name, per NIST.
- **Evidence:**
  - [NIST SP 500-235, §2.5](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf) — Watson & McCabe / NIST, 1996 — standard — "The original limit of 10 as proposed by McCabe has significant supporting evidence, but limits as high as 15 have been used successfully as well. Limits over 10 should be reserved for projects that have several operational advantages…"; "it is reasonable to exempt modules consisting of a single multiway decision statement from a complexity limit. Note that if the branches of the decision statement contain complexity themselves, the rationale and thus the exemption does not automatically apply." — Checked in the PDF.
  - [CISQ weakness list — CWE-1121](https://www.it-cisq.org/pdf/cisq-weaknesses-in-ascqm.pdf) — CISQ, 2019 — standard — "(default threshold for Cyclomatic Complexity is 20, alternate threshold can be set prior to analysis)" — Checked in the PDF. The same wording is in OMG ASCQM v1.1 §7.1.10.
  - [SIG/TÜV NORD CERT Evaluation Criteria Trusted Product Maintainability: Guidance for Producers v17.0](https://www.softwareimprovementgroup.com/wp-content/uploads/SIG-TUViT-Evaluation-Criteria-Trusted-Product-Maintainability-Guidance-for-producers.pdf) — Software Improvement Group, 12 March 2025 — industry_report — "The percentage of lines of code residing in units with McCabe complexity number higher than 5 should not exceed 20.2% … higher than 10 should not exceed 7.3% … higher than 25 should not exceed 1.1%." Figure 5 bands: "1-5 McCabe low risk, 6-10 moderate risk, 11-25 high risk, 26+ very high risk" — Checked in the text and the rendered figure.
  - [Empirical analysis of the relationship between CC and SLOC in a large corpus of Java methods and C functions](https://www.rascal-mpl.org/blog/2016/01/01/empirical-analysis-of-the-relationship-between-CC-and-SLOC/) — Landman, Serebrenik, Bouwers, Vinju, *JSEP* 28(7), 2016 (online December 2015; DOI 10.1002/smr.1760) — peer_reviewed — "the observed linear correlation between CC and SLOC of Java methods or C functions is not strong enough to conclude that CC is redundant with SLOC"; the corpus is 17.6M Java methods and 6.3M C functions — Verified. Venue checked via Crossref.
  - [Early Career Developers' Perceptions of Code Understandability. A Study of Complexity Metrics](https://arxiv.org/abs/2303.07722) — Esposito, Janes, Kilamo, Lenarduzzi, arXiv v2 July 2024 — preprint (not peer-reviewed) — 216 early-career developers and 12 Java classes. Table 8 gives Spearman ρ of −0.3819 for CC and −0.3282 for cognitive complexity against perceived understandability. The abstract calls both "modest predictors" — Checked in the full PDF. See the internal-inconsistency note above.
  - [ESLint complexity](https://eslint.org/docs/latest/rules/complexity) — ESLint — official_docs — default threshold 20 — Verified.
  - [Ruff C901 complex-structure](https://docs.astral.sh/ruff/rules/complex-structure/) — Astral — official_docs — "Checks for functions with a high McCabe complexity." The setting is `lint.mccabe.max-complexity`, default 10 per the [Ruff settings page](https://docs.astral.sh/ruff/settings/) — Verified.
- **Detect:**
  - **JS/TS:** ESLint `complexity: ["warn", 10]`, then a second pass at 20 for must-fix.
  - **Python:** Ruff C901; the default `max-complexity` of 10 already matches.
  - **Other languages:** SonarQube's CWE-1121 mapping.
  - **Report:** sort functions by CC and compute the share of LOC in each SIG band.
  - **Review each flagged unit by hand.** Is it a flat dispatch, which can be exempted with the reason documented, or real branching logic, which should be refactored?
- **Tools:** ESLint complexity, Ruff C901, SonarQube.
- **Applies to:** Imperative and OO languages. In functional code, pattern matching inflates CC, so read the results with care.
- **When not to apply / counterpoints:**
  - The link between CC and understandability is modest (ρ ≈ −0.38 for juniors, in a preprint).
  - SonarSource argues CC measures testability rather than understandability (F04).
  - ESLint says to disable the rule if no suitable limit can be determined.
  - The thresholds disagree: 10, 15, 20 and the SIG bands.
- **Fix risk:** medium

### T01-F21 — Move hard-coded network resource identifiers and non-trivial initialisation literals into validated configuration
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - **Standards.** CWE-1051 (hard-coded network resource identifiers) and CWE-1052 (non-trivial hard-coded initialisation literals) are ISO 5055 maintainability weaknesses. CWE-1051 also appears in the Reliability table.
  - **Why it matters.** Hard-coded endpoints stop the environment from being changed without a code change, and they spread copies of the same value.
  - **Support is thin.** The standard backs the rule directly, but it is the only source; no empirical study of harm was found.
- **Evidence:**
  - [CISQ weakness list — CWE-1051, CWE-1052](https://www.it-cisq.org/pdf/cisq-weaknesses-in-ascqm.pdf) — CISQ, 2019 — standard — CWE-1051: "The software initializes data using hard-coded values that act as network resource identifiers." CWE-1052: "The software initializes a data element using a hard-coded literal that is not a simple integer or static constant element." — Checked in the PDF (Maintainability; CWE-1051 also in Reliability).
- **Detect:** Run the grep below, then decide for each hit whether it is a legitimate constant (for example, the documented default base URL of a public API) or environment-specific configuration.

  ```
  rg -n 'https?://|\b\d{1,3}(\.\d{1,3}){3}\b|localhost:\d+|jdbc:|mongodb(\+srv)?://|redis://' --glob '!**/test*/**' --glob '!**/*.md'
  ```
- **Tools:** ripgrep, SonarQube.
- **Applies to:** All languages and services.
- **When not to apply / counterpoints:**
  - Only one formal source was found.
  - Well-known public constants and test fixtures are fine.
  - Over-configuring adds indirection and failure modes at startup.
- **Fix risk:** low

### T01-F22 — Flag source files over 1,000 lines and OO structural outliers: inheritance deeper than 7, more than 10 direct subclasses, parents referring to children, multiple inheritance from concrete classes
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - These are the ISO 5055 maintainability weaknesses that concern structure and size: CWE-1080 (file size), CWE-1074 (inheritance depth), CWE-1086 (number of children), CWE-1062 (parent refers to child) and CWE-1055 (multiple inheritance from concrete classes).
  - The thresholds are defaults and can be tuned "prior to analysis".
  - SIG measures size as system volume, so it has no per-file rule.
- **Evidence:**
  - [CISQ weakness list — CWE-1080, 1074, 1086, 1062, 1055](https://www.it-cisq.org/pdf/cisq-weaknesses-in-ascqm.pdf) — CISQ, 2019 — standard — "(default threshold for the maximum lines of code is 1000…)"; "(default threshold for maximum Inheritance levels is 7…)"; "(default threshold for the maximum number of children of a class is 10…)" — Checked in the PDF and in ASCQM v1.1.
  - [SIG/TÜV NORD CERT Guidance v17.0 — Volume](https://www.softwareimprovementgroup.com/wp-content/uploads/SIG-TUViT-Evaluation-Criteria-Trusted-Product-Maintainability-Guidance-for-producers.pdf) — SIG, 2025 — industry_report — "the total rebuild value of the product should not exceed 3.9 person-years". The table gives TypeScript 31,600 LOC, Python 25,000, Java 35,100 and JavaScript 36,300 — Checked in the PDF.
- **Detect:**
  - List the 30 longest files, excluding generated and vendored files: `git ls-files '*.ts' '*.py' '*.java' | xargs wc -l | sort -rn | head -30`.
  - Get inheritance depth from the IDE or the analyzer.
  - Grep each base-class body for the names of its subclasses (CWE-1062).
- **Tools:** wc or cloc, SonarQube, IDE type hierarchy.
- **Applies to:** The inheritance rules apply to OO languages; the file-size rule applies to all languages.
- **When not to apply / counterpoints:**
  - Generated code, data tables and fixtures are often legitimately large.
  - Splitting files changes import paths and can create cycles (see F18).
  - Changing a class hierarchy is high-risk in a finished product.
- **Fix risk:** medium

### T01-F15 — Act first on high-precision correctness findings; sample each rule's true-positive rate before mass-fixing; never present raw smell counts or "debt minutes" as a quality score
- **Grade:** B · **Verdict:** CORRECTED
  - The researcher's detection step made rules with at least about 90% true positives "blocking". That conflates two separate Google thresholds:
    - build-breaking (blocking) checks need an "essentially zero" false-positive rate, and Error Prone ERROR checks need "no false positives";
    - under 10% false positives (Tricorder) or at least 90% correct (Error Prone WARNING) is the bar for *showing* a finding at review time.

    The detection step now separates "act on" from "gate".
- **Rationale:**
  - **SonarQube's rules.** Companies that did not trust SonarQube's rules contracted researchers to test them. Of 202 Java rules on 21 open-source projects, only 25 showed even relatively low fault-proneness. The "bug" category was generally not fault-prone.
  - **Google's rule for keeping analyzers.** Analyzers survive only if developers act on them. They are removed when "No one is fixing bugs filed against the analyzer" or the results "are annoying developers".
- **Evidence:**
  - [Are SonarQube Rules Inducing Bugs? (SANER 2020)](https://arxiv.org/abs/1907.00376) — Lenarduzzi, Lomio, Huttunen, Taibi, 2020 — peer_reviewed — "our local companies were not confident in the usefulness of the rules proposed by SonarQube and contracted us to investigate"; "21 well-known mature open-source projects"; "We applied the SZZ algorithm"; "Among the 202 rules defined for Java by SonarQube, only 25 can be considered to have relatively low fault-proneness. Moreover, violations considered as 'bugs' by SonarQube were generally not fault-prone and, consequently, the fault-prediction power of the model proposed by SonarQube is extremely low."; "companies should carefully consider which rules they really need to apply" — Verified, full abstract.
  - [Tricorder (ICSE 2015)](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43322.pdf) — Sadowski et al. (Google), 2015 — peer_reviewed — "We still enforce a very low effective false positive rate here (< 10%)"; removal criteria include "No one is fixing bugs filed against the analyzer" and "The analyzer results are annoying developers"; "developers will decide whether an analysis tool has high impact, and what a false positive is." — Checked in the PDF.
  - [Error Prone: Criteria for new checks](https://errorprone.info/docs/criteria) — Google Error Prone — official_docs — ERROR: "The bug pattern should have no false positives"; "We want to fix impactful bugs, not enforce best practices or style rules." WARNING: "Developers should feel that we are pointing out an actual issue at least 90% of the time." — Verified.
  - [SonarQube Server 2025.3 — rules overview](https://docs.sonarsource.com/sonarqube-server/2025.3/user-guide/rules/overview) — SonarSource, 2025 — official_docs — Bug: "code that is demonstrably wrong, or more likely wrong than not"; Code Smell: "neither a bug nor a vulnerability"; MQR: "rules are categorized by software qualities: security, reliability, and maintainability." — Verified.
- **Detect:**
  - **Sample.** For each enabled rule with hits, sample 10–20 findings and label each as a true or false positive.
  - **Decide by true-positive rate:**
    - about 90% or more: fix in the hardening pass;
    - essentially 100% (no false positives in the sample): make it a CI gate;
    - below that: report the counts but do not mass-fix.
  - **Record.** Keep a table of rule, hits, TP rate and decision, and put it in the report.
- **Tools:** SonarQube (type or software-quality filters), ESLint and Ruff rule-level reports, a spreadsheet.
- **Applies to:** All languages and all analyzers.
- **When not to apply / counterpoints:**
  - Lenarduzzi et al. cover Java only, with SZZ labelling (a noisy method), open-source projects, and a circa-2019 rule set.
  - Maintainability rules aim at change effort rather than faults, so low fault-proneness does not make them useless.
- **Fix risk:** low

### T01-F07 — Detect clones of 6 or more lines and keep redundant lines at or below about 5.6%; before merging a clone group, diff every copy and treat inconsistent fixes or checks as probable latent bugs
- **Grade:** B · **Verdict:** CORRECTED
  - **Juergens et al. systems.** Three commercial C# systems, one commercial COBOL system, and one **open-source** Java system. The researcher had called the Java system commercial.
  - **Their clone definition.** At least 10 statements (20 for COBOL), not 6 lines.
  - **Tool options.** jscpd has `--min-lines` (default 5). PMD CPD is configured with `--minimum-tokens`, not lines.
- **Rationale:**
  - **Standards.** Duplication is ISO 5055 CWE-1041 and a SIG property. SIG notes "Bugfixes in pieces of duplicated code are especially risky".
  - **Evidence of harm.** The strongest evidence concerns *inconsistent* changes, not duplication itself. Juergens et al. made about 1,800 clone-group assessments and found 107 faults that the developers confirmed. Their example is a null check retrofitted into only one copy.
- **Evidence:**
  - [SIG/TÜV NORD CERT Guidance v17.0 — Duplication](https://www.softwareimprovementgroup.com/wp-content/uploads/SIG-TUViT-Evaluation-Criteria-Trusted-Product-Maintainability-Guidance-for-producers.pdf) — SIG, 2025 — industry_report — "A code fragment is considered duplicated if it is at least 6 lines of code long and repeated literally (modulo white-space) in at least one other location"; "Bugfixes in pieces of duplicated code are especially risky"; "the percentage of redundant lines of code for each programming language used should not exceed 5.6%." — Checked in the PDF.
  - [CISQ weakness list — CWE-1041](https://www.it-cisq.org/pdf/cisq-weaknesses-in-ascqm.pdf) — CISQ, 2019 — standard — "(The default threshold for each instance of copy-pasted code sets the maximum number of allowable copy-pasted instructions at 10% of the total instructions in the instance, alternate thresholds can be set prior to analysis)." — Checked in the PDF.
  - [Do Code Clones Matter? (ICSE 2009)](https://arxiv.org/abs/1701.05472) — Juergens, Deissenboeck, Hummel, Wagner, 2009 — peer_reviewed — "inconsistent changes to clones are very frequent"; "a missing null-check was retrofitted in only one clone instance"; "Altogether, around 1800 individual clone group assessments were manually performed … The study lead to the identification of 107 faults that have been confirmed by the systems' developers." The systems were "3 systems written in C#, a Java system as well as a long-lived Cobol system", with the Java system being open source — Checked in the full PDF.
- **Detect:**
  - **Run a clone detector.** SonarQube duplications, `jscpd --min-lines 6`, or PMD CPD with a token threshold.
  - **Report** the percentage of redundant lines.
  - **Compare copies.** For each clone group, open the copies side by side with `git diff --no-index a b`. Pay special attention to copied validation, error handling and cleanup.
  - **Record** each inconsistency as a finding in its own right.
- **Tools:** SonarQube duplication metric, jscpd (active, not archived), PMD CPD, git diff --no-index.
- **Applies to:** All languages. Exclude generated and vendored code.
- **When not to apply / counterpoints:**
  - Juergens et al. themselves note that "some researchers even started to doubt the harmfulness of cloning at all". Their ref. [17] was not accessed.
  - Copies that diverged on purpose, test fixtures, and code that will be deleted soon can stay.
  - Premature abstraction couples modules that are otherwise independent.
- **Fix risk:** high

### T01-F05 — Mandatory review for functions over 60 lines; report the share of code in units over 15, 30 and 60 lines; split only along a real sub-task boundary, never into entangled single-use helpers
- **Grade:** B · **Verdict:** CORRECTED
  - **Primary source.** Wikipedia was replaced by Holzmann's original article.
  - **Chowdhury et al. venue.** MSR 2022 (peer-reviewed; DOI 10.1145/3524842.3527975).
  - **JPL Rule 25 is a "should" rule.** Deviations are allowed with justification.
  - **HN quote attribution.** The "readability is not always improved by limiting function length" quote is by the user Farmadupe.
- **Rationale:**
  - **Evidence for short units.** Safety standards, the SIG benchmark and a large mining study all point this way. The study (about 785K Java methods) favours methods under 24 lines and found that decomposing larger methods reduces overall maintenance effort.
  - **Where to aim.** Strong practitioner dissent means the rule should target big, multi-purpose functions, not "as short as possible".
- **Evidence:**
  - [The Power of 10, rule 4](https://web.eecs.umich.edu/~imarkov/10rules.pdf) — Holzmann, *IEEE Computer*, June 2006 — peer_reviewed — "No function should be longer than what can be printed on a single sheet of paper in a standard format with one line per statement and one line per declaration. Typically, this means no more than about 60 lines of code per function." — Checked in the full text.
  - [JPL D-60411 Rule 25](https://yurichev.com/mirrors/C/JPL_Coding_Standard_C.pdf) — NASA JPL, 2009 — standard — "Functions should be no longer than 60 lines of text and define no more than 6 parameters." "Excessively long functions are often a sign of poorly structured code." — Checked in the PDF.
  - [SIG/TÜV NORD CERT Guidance v17.0 — Unit size](https://www.softwareimprovementgroup.com/wp-content/uploads/SIG-TUViT-Evaluation-Criteria-Trusted-Product-Maintainability-Guidance-for-producers.pdf) — SIG, 2025 — industry_report — "The percentage of lines of code residing in units with more than 15 lines of code should not exceed 47.1%. The percentage in units with more than 30 lines of code should not exceed 23.1%. The percentage in units with more than 60 lines should not exceed 8.3%." Figure 4 bands: 1–15 low, 16–30 moderate, 31–60 high, 61+ very high — Checked in the text and the rendered figure.
  - [An Empirical Study on Maintainable Method Size in Java](https://arxiv.org/abs/2205.01842) — Chowdhury, Uddin, Holmes, MSR 2022 — peer_reviewed — "we examine the evolution of around 785K Java methods and show that developers should strive to keep their Java methods under 24 lines in length. Additionally, we show that decomposing larger methods to smaller methods also decreases overall maintenance efforts." — Verified. Venue via Crossref.
  - [A Philosophy of Software Design vs Clean Code](https://github.com/johnousterhout/aposd-vs-clean-code) — John Ousterhout & Robert C. Martin, discussions September 2024 – February 2025 — practitioner_forum — Ousterhout: methods are entangled when "in order to understand how one of them works internally, you also need to read the code of the other"; "constantly flipping back and forth between the methods". Martin: "I'd rather err on the side of decomposition"; decomposed methods "can always be inlined" — Verified.
  - [John Carmack on Inlined Code](https://cbarrete.com/carmack.html) — John Carmack (email of 13 March 2007, archived by a third party) — engineering_blog — "The function that is least likely to cause a problem is one that doesn't exist, which is the benefit of inlining it." About PartialUpdate helpers: "Lots and lots of bugs stem from this." — Verified.
  - [TIGER_STYLE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md) — TigerBeetle — engineering_blog — "we enforce a **hard limit of 70 lines per function**" — Verified in the raw file.
  - [ESLint max-lines-per-function](https://eslint.org/docs/latest/rules/max-lines-per-function) — ESLint — official_docs — default max 50; options `skipBlankLines`, `skipComments`, `IIFEs` — Verified; the rule is not deprecated.
  - [HN: The Power of 10 rules](https://news.ycombinator.com/item?id=36506013) — HN user Farmadupe, 28 June 2023 — practitioner_forum — "readability is not always improved by limiting function length." — Verified.
- **Detect:**
  - **JS/TS:** ESLint `max-lines-per-function {max: 60, skipBlankLines: true, skipComments: true}`.
  - **Other languages:** SonarQube, or a per-function line count.
  - **Report** the share of LOC in each SIG band.
  - **Review each unit over 60 lines by hand.**
    - Does it hold two or more separable sub-tasks? Look for comment headers such as `// step 2`, or blank-line-separated phases that use disjoint variables. If so, extract them.
    - Is it a linear sequence that reads top to bottom? If so, document it and leave it.
- **Tools:** ESLint max-lines-per-function, SonarQube, a SIG-style LOC-per-unit report.
- **Applies to:** All languages. The 24-line figure comes from Java only.
- **When not to apply / counterpoints:**
  - The thresholds disagree: 24 (Java study), 50 (ESLint default), 60 (Power of Ten and JPL), 70 (TigerBeetle).
  - Ousterhout and Carmack argue that over-decomposition hides state changes and call order.
- **Fix risk:** medium

### T01-F06 — Flag functions with 5 or more parameters; treat 7 or more as fix-or-justify; prefer parameter objects or splitting responsibilities; prioritise same-type adjacent parameters
- **Grade:** B · **Verdict:** VERIFIED
  - The SIG risk bands were checked in the rendered figure: 0–2 low, 3–4 moderate, 5–6 high, 7+ very high.
- **Rationale:**
  - **Why it matters.** Long parameter lists signal several responsibilities, and they are error-prone because arguments of the same type can be swapped silently.
  - **Thresholds converge on 5–7:**
    - SIG: 5–6 high risk, 7+ very high;
    - JPL: at most 6;
    - CISQ: default 7.
- **Evidence:**
  - [SIG/TÜV NORD CERT Guidance v17.0 — Unit interfacing](https://www.softwareimprovementgroup.com/wp-content/uploads/SIG-TUViT-Evaluation-Criteria-Trusted-Product-Maintainability-Guidance-for-producers.pdf) — SIG, 2025 — industry_report — "Large interfaces are also error prone, especially if multiple parameters have the same type and can thus be accidentally supplied in the wrong order." 4 stars: 3+ parameters ≤ 15.0%, 5+ ≤ 3.3%, 7+ ≤ 0.9% — Checked in the PDF and the figure.
  - [CISQ weakness list — CWE-1064](https://www.it-cisq.org/pdf/cisq-weaknesses-in-ascqm.pdf) — CISQ, 2019 — standard — "(default threshold for the maximum number of parameters is 7, alternate threshold can be set prior to analysis)" — Checked in the PDF.
  - [JPL D-60411 Rule 25](https://yurichev.com/mirrors/C/JPL_Coding_Standard_C.pdf) — NASA JPL, 2009 — standard — "define no more than 6 parameters"; "Long lists of function parameters similarly compromise code clarity and should be avoided." — Checked in the PDF.
  - [Ruff PLR0913 too-many-arguments](https://docs.astral.sh/ruff/rules/too-many-arguments/) — Astral — official_docs — "Functions with many arguments are harder to understand, maintain, and call." The setting is `lint.pylint.max-args`, default 5 — Verified.
  - [ESLint max-params](https://eslint.org/docs/latest/rules/max-params) — ESLint — official_docs — default 3; "it requires the memorization of what each parameter is, its type, and the order they should appear in" — Verified.
- **Detect:**
  - **Python:** Ruff PLR0913 (default 5).
  - **JS/TS:** ESLint max-params set to 4 or 5, because the default of 3 is noisy on a finished codebase.
  - **Other languages:** SonarQube's CWE-1064 rule.
  - **By hand:** adjacent parameters of the same primitive type.
- **Tools:** Ruff PLR0913, ESLint max-params, SonarQube.
- **Applies to:** All languages. Keyword-only or named arguments reduce the risk of swapped arguments but not the responsibility signal.
- **When not to apply / counterpoints:**
  - The thresholds run from 3 (ESLint) to 7 (CISQ).
  - DI constructors and record constructors legitimately take many parameters.
  - Changing the signature of an exported function breaks callers.
- **Fix risk:** medium

### T01-F18 — No import or dependency cycles between modules or top-level components; no parent-to-child references or layer-skipping calls; keep per-module fan-in low and most code hidden
- **Grade:** B · **Verdict:** VERIFIED
  - Scope clarification: SIG measures cycles between *top-level components*, while CISQ CWE-1047 measures cycles between modules.
- **Rationale:**
  - **Standards.** Cycles and layer-skipping are ISO 5055 maintainability weaknesses: CWE-1047, CWE-1054, CWE-1062, and CWE-1048 for fan-out, which has a default of 5 references.
  - **SIG.** Cycles make "it harder to maintain components in isolation". SIG's entanglement measure counts direct cycles, indirect cycles and transitive dependencies between components.
- **Evidence:**
  - [CISQ weakness list — CWE-1047, 1048, 1054, 1062](https://www.it-cisq.org/pdf/cisq-weaknesses-in-ascqm.pdf) — CISQ, 2019 — standard — CWE-1047: "modules in which one module has references that cycle back to itself"; CWE-1048: "(default threshold for the maximum number of references is 5…)"; CWE-1054: "the invocation skips at least one layer, and the invoked code is not part of a vertical utility layer" — Checked in the PDF.
  - [SIG/TÜV NORD CERT Guidance v17.0 — Module coupling, Component entanglement, Component independence](https://www.softwareimprovementgroup.com/wp-content/uploads/SIG-TUViT-Evaluation-Criteria-Trusted-Product-Maintainability-Guidance-for-producers.pdf) — SIG, 2025 — industry_report — 4-star limits:
    - LOC in modules with more than 10 incoming dependencies ≤ 10.0%, more than 20 ≤ 5.6%, more than 50 ≤ 1.9%;
    - component entanglement ≤ 0.077;
    - hidden code "should not drop below 93.7%".

    It also says: "This makes it harder to maintain components in isolation." — Checked in the PDF.
  - [madge](https://github.com/pahen/madge) — pahen — official_docs — `madge --circular path/src/app.js`. For TypeScript, set `"detectiveOptions": {"ts": {"skipTypeImports": true}}` — Checked in the README. The repository is not archived; last push 2026-01-21.
- **Detect:**
  - **JS/TS:** `npx madge --circular --extensions ts,tsx src` with `skipTypeImports`, or dependency-cruiser.
  - **Python:** Pylint cyclic-import (R0401), or import-linter contracts.
  - **Graph:** build the module import graph and compute fan-in per module.
  - **Parent-to-child references (CWE-1062):** grep base classes for the names of their subclasses.
  - **Layer skipping (CWE-1054):** check that UI and handler layers do not import persistence directly when a service layer exists.
- **Tools:** madge, dependency-cruiser, import-linter, Pylint R0401 (all pages checked and existing), SonarQube.
- **Applies to:** All languages with modules or packages.
- **When not to apply / counterpoints:**
  - The CISQ fan-out default of 5 per function is strict and noisy.
  - Type-only cycles are harmless at runtime.
  - Breaking cycles in a finished product can grow into a large restructuring. When test coverage is weak, record the cycle and defer the fix.
- **Fix risk:** high

### T01-F13 — Bound every externally driven loop, retry/poll loop, queue, buffer and remote call with a limit or timeout and a defined failure path; bound recursion depth on untrusted input
- **Grade:** B · **Verdict:** CORRECTED
  - **Primary text added.** Holzmann's original rule 2 carries its own exemption for non-terminating schedulers.
  - **Two more ISO 5055 Reliability weaknesses added, both checked in the CISQ list.** CWE-835 (infinite loop) and CWE-1088 (a synchronous remote call with no timeout or an infinite one). These support the rule more directly than CWE-1095.
  - **Lobsters thread date.** It is 2025-08-20, not 2023.
  - **TigerBeetle keeps the recursion ban** ("Do not use recursion"). The claim that the ban "does not carry over" is therefore a judgement, not a consensus.
- **Rationale:**
  - **Standards.** Power of Ten rule 2 and JPL Rule 3 require statically bounded loops, with one annotated server or event loop per task as the exception. ISO 5055 flags infinite loops (CWE-835) and remote calls without a timeout (CWE-1088).
  - **Outside space flight.** TigerBeetle applies the rule to a production database and extends it to queues.
  - **What to bound in practice:** max attempts, a deadline or timeout, or a max size.
  - **Recursion.** Recursion over structures that are bounded by construction is accepted outside hard-real-time code by the practitioners cited below, though TigerBeetle disagrees.
- **Evidence:**
  - [JPL D-60411 Rules 3 and 4](https://yurichev.com/mirrors/C/JPL_Coding_Standard_C.pdf) — NASA JPL, 2009 — standard — "All loops shall have a statically determinable upper-bound on the maximum number of loop iterations … An exception is allowed for the use of a single non-terminating loop per task or thread where requests are received and processed. Such a server loop shall be annotated…"; "When the upper-bound is exceeded an assertion failure and error exit can be triggered." — Checked in the PDF.
  - [The Power of 10, rules 1 and 2](https://web.eecs.umich.edu/~imarkov/10rules.pdf) — Holzmann, 2006 — peer_reviewed — "Give all loops a fixed upper bound." "This rule does not, of course, apply to iterations that are meant to be nonterminating—for example, in a process scheduler." Rule 1 bans "direct or indirect recursion" — Checked in the full text.
  - [CISQ weakness list — CWE-835, CWE-1088, CWE-1095](https://www.it-cisq.org/pdf/cisq-weaknesses-in-ascqm.pdf) — CISQ, 2019 — standard — CWE-835: "an iteration or loop with an exit condition that cannot be reached, i.e., an infinite loop"; CWE-1088: "a synchronous call to a remote resource, but there is no timeout for the call, or the timeout is set to infinite"; CWE-1095 (Maintainability): "a loop with a control flow condition based on a value that is updated within the body of the loop" — Checked in the PDF. CWE-835 and CWE-1088 were added by the verifier.
  - [TIGER_STYLE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md) — TigerBeetle — engineering_blog — "all loops and all queues must have a fixed upper bound to prevent infinite loops or tail latency spikes"; "Where a loop cannot terminate (e.g. an event loop), this must be asserted."; "Do not use recursion to ensure that all executions that should be bounded are bounded." — Verified in the raw file.
  - [HN: The Power of 10 rules](https://news.ycombinator.com/item?id=36506013) — HN users AlotOfReading and AnimalMuppet, 28 June 2023 — practitioner_forum — AlotOfReading: "unbounded loops are situationally fine. The key distinction is that the program has to make forward progress regardless"; "the complete prohibition on 'dynamic allocation' is a lot more flexible now" — Verified.
  - [Lobsters: NASA's 10 Rules for Safety-Critical Code](https://lobste.rs/s/3bsfgs/nasa_s_10_rules_for_safety_critical_code) — Lobsters user zesterer, 20 August 2025 — practitioner_forum — "A lot of algorithms that one could absolutely want to implement for some real-time safety-critical system are substantially easier to implement and debug when written in a recursive style." — Verified.
- **Detect:**
  - **Unbounded loops:** `rg -n 'while\s*\(\s*true\s*\)|while True:|for\s*\(\s*;\s*;\s*\)|^\s*loop\s*\{'`, then check each hit for a max-iteration count, a deadline or a break on timeout.
  - **Retry and backoff helpers:** check for a max-attempts parameter.
  - **HTTP, DB and RPC clients:** check for a timeout (CWE-1088).
  - **Collections fed from outside:** arrays, maps and queues filled from network or user input with no size cap.
  - **Recursion:** find self-recursive functions with a call-graph tool or by grepping a function's name inside its own body, and check whether input controls the depth.
- **Tools:** ripgrep, call-graph or IDE analysis, SonarQube (CWE-835, CWE-1088, CWE-1095).
- **Applies to:** All languages. Most important for network services, workers, parsers and anything that processes external input.
- **When not to apply / counterpoints:**
  - HN and Lobsters practitioners see the full recursion and heap bans as fitting stack-bounded embedded code.
  - A bound that is too low turns legitimate long work into errors, so derive bounds from observed maxima.
- **Fix risk:** medium

### T01-F04 — Measure nesting-weighted Cognitive Complexity alongside cyclomatic complexity and use it to prioritise which complex functions to flatten; do not use it as the only gate
- **Grade:** B · **Verdict:** CORRECTED
  - **The default threshold is now verified.** The researcher had left it open. sonar-java's `CognitiveComplexityMethodCheck` uses `DEFAULT_MAX = 15`. Other language analyzers were not checked.
  - **Lavazza et al. could not be read.** Existence is confirmed via Crossref (*JSS* 197, March 2023, article 111561), but the publisher page and the open-access preprint both returned 403. Its finding is confirmed only indirectly: Esposito et al. write that Lavazza's "achieved results are not proposed for a particular metric". The researcher's snippet wording ("extremely close") is **not verified**.
  - **Esposito et al. contradict themselves.** Their text says understandability "seems to be somewhat more correlated with CoC", while Table 8 shows a larger magnitude for CC.
- **Rationale:**
  - **Why the metric exists.** Cyclomatic complexity "is not a satisfactory measure of understandability": two methods with equal CC can differ sharply in readability.
  - **What it rewards.** Cognitive Complexity adds nothing for extracting a method or for null-coalescing shorthand. It penalises nesting, breaks in linear flow, mixed boolean-operator sequences, recursion, and jumps to labels. That rewards guard clauses, early returns and well-named helpers.
  - **Validation.** Mixed:
    - one meta-analysis (ESEM 2020) supports it for comprehension time and subjective ratings;
    - independent studies find it no better than CC.
- **Evidence:**
  - [Cognitive Complexity: a new way of measuring understandability, v1.7](https://www.sonarsource.com/docs/CognitiveComplexity.pdf) — G. Ann Campbell / SonarSource, 29 August 2023 — industry_report (vendor) — "while it accurately calculates the minimum number of test cases required to fully cover a method, it is not a satisfactory measure of understandability"; "Increment (add one) for each break in the linear flow of the code"; "Increment when flow-breaking structures are nested"; "Cognitive Complexity does not increment for methods." It also notes: "it is widely acknowledged that the Cyclomatic Complexity scores of applications correlate to their lines of code totals" — Checked in the PDF.
  - [sonar-java CognitiveComplexityMethodCheck](https://raw.githubusercontent.com/SonarSource/sonar-java/master/java-checks/src/main/java/org/sonar/java/checks/CognitiveComplexityMethodCheck.java) — SonarSource (open source) — official_docs (source code) — `private static final int DEFAULT_MAX = 15;` — Verified with curl. Added by the verifier.
  - [An Empirical Validation of Cognitive Complexity as a Measure of Source Code Understandability (ESEM 2020)](https://arxiv.org/abs/2007.12520) — Muñoz Barón, Wyrich, Wagner, 2020 — peer_reviewed — "approximately 24,000 understandability evaluations of 427 code snippets"; "Cognitive Complexity positively correlates with comprehension time and subjective ratings of understandability", with "mixed results for the correlation with the correctness of comprehension tasks and with physiological measures" — Verified.
  - [An empirical evaluation of the "Cognitive Complexity" measure as a predictor of code understandability](https://www.sciencedirect.com/science/article/abs/pii/S0164121222002370) — Lavazza, Abualkishik, Liu, Morasca, *JSS* 197, 2023 — peer_reviewed — The article exists (DOI 10.1016/j.jss.2022.111561), but its content was **not read**. Its finding is confirmed only through Esposito et al.'s citation. The quote is not verified.
  - [Early Career Developers' Perceptions of Code Understandability](https://arxiv.org/abs/2303.07722) — Esposito, Janes, Kilamo, Lenarduzzi, arXiv 2023/2024 — preprint — CoC ρ = −0.3282 vs CyC ρ = −0.3819 (Table 8); both "modest predictors" — Checked in the PDF.
  - [SonarQube glossary 2025.1](https://docs.sonarsource.com/sonarqube-server/2025.1/glossary) — SonarSource — official_docs — "A Sonar exclusive metric formulated to more accurately measure the relative understandability of methods." — Verified.
- **Detect:**
  - **SonarQube/SonarLint:** rule S3776, default 15 in the Java analyzer.
  - **By hand:** any function with control structures nested four or more deep, or containing labelled break/continue or goto.
  - **Elsewhere:** the algorithm is published in full, so it can be computed by hand in other languages.
- **Tools:** SonarQube / SonarLint (S3776).
- **Applies to:** All languages SonarSource supports; elsewhere by hand.
- **When not to apply / counterpoints:**
  - This is a single-vendor metric.
  - Independent studies find it no better than CC or LOC, and for juniors slightly worse.
  - Validation is mixed for whether readers actually understand the code correctly.
- **Fix risk:** medium

### T01-F23 — Spend the hardening budget first on hotspots (frequently changed and low quality); gate new and changed code; fix legacy code opportunistically
- **Grade:** B · **Verdict:** CORRECTED
  - **SonarQube wording.** The 2025.2 page does not use the term "Clean as You Code". It talks about focusing on and cleaning new code, so the rationale now uses that wording.
  - **Borg et al. 2024 data.** The study used two public datasets, not only proprietary code.
  - **The CISQ 2022 cost report was removed as evidence.** It is a macro-economic estimate, it was sponsored by Synopsys and Undo, and it does not support prioritising hotspots.
- **Rationale:**
  - **Code Red.** In 39 proprietary codebases (30,737 files), low-quality code had 15 times more defects, took 124% longer to resolve issues in, and had 9 times longer maximum cycle times.
  - **The 2024 follow-up by the same authors.** It reports "amplified returns on investment in the upper end" and recommends preventing code smells "in files with high churn".
  - **Tooling that applies the same principle:**
    - SonarQube's built-in gate "defines conditions applying to new code only";
    - Google shows most analysis results only on changed lines.
- **Evidence:**
  - [Code Red: The Business Impact of Code Quality — A Quantitative Study of 39 Proprietary Production Codebases (TechDebt 2022)](https://arxiv.org/abs/2203.04374) — Tornhill, Borg (CodeScene), 2022 — peer_reviewed — "By analyzing activity in 30,737 files, we find that low quality code contains 15 times more defects than high quality code. Furthermore, resolving issues in low quality code takes on average 124% more time in development. Finally … 9 times longer maximum cycle times." The analysis used CodeScene — Verified.
  - [Increasing, not Diminishing: Investigating the Returns of Highly Maintainable Code (TechDebt 2024)](https://arxiv.org/abs/2401.13407) — Borg, Pruvost, Mones, Tornhill, 2024 — peer_reviewed (accepted at TechDebt 2024) — "we combine two publicly available datasets"; "amplified returns on investment in the upper end"; "recommend organizations to diligently prevent the introduction of code smells in files with high churn" — Verified.
  - [Quality standards and new code (SonarQube Server 2025.2)](https://docs.sonarsource.com/sonarqube-server/2025.2/user-guide/about-new-code) — SonarSource — official_docs — "analyzing and cleaning new code allows you to fix issues in your old code and gradually improve the overall quality of your codebase"; "the built-in Sonar Way defines conditions applying to new code only" — Verified.
  - [Tricorder (ICSE 2015)](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43322.pdf) — Sadowski et al. (Google) — peer_reviewed — "we only display results for most analyses on changed lines by default; this keeps analysis results relevant to the code review at hand." — Checked in the PDF.
- **Detect:**
  - **Rank files by change frequency** with the command below, and intersect the list with the complexity, size, duplication and error-handling findings. Fix the intersection first.

    ```
    git log --since=12.months --format=format: --name-only | grep -v '^$' | sort | uniq -c | sort -rn | head -50
    ```
  - **For a young repository with little history,** rank by complexity multiplied by business criticality: money, auth, persistence and external I/O.
- **Tools:** git log, SonarQube's new-code period, any complexity report.
- **Applies to:** All repositories with version history.
- **When not to apply / counterpoints:**
  - Both studies come from CodeScene-affiliated authors using CodeScene's metric; no independent replication was found.
  - A project that was just finished may have too little history for hotspot analysis to work.
- **Fix risk:** low

### T01-F09 — Delete blocks of commented-out code; keep one only with an explicit reason and a reference; in C, temporarily removed code goes behind conditional compilation, not comment delimiters
- **Grade:** B · **Verdict:** CORRECTED
  - **CERT reference.** MSC07-C is deprecated ("merged with: MSC12-C", 10 July 2014). The current reference is MSC12-EX2.
  - **The CERT exception was overstated.** The researcher wrote that CERT accepts "temporarily commenting out code for potential future use … when properly documented". MSC12-EX2 actually says "It is permissible to temporarily remove code that may be needed later", and it points to MSC04-C for how to do that. MSC04-C says: "Instead of using `/*` and `*/` to comment out blocks of code, use conditional compilation (for example, `#if`, `#ifdef`, or `#ifndef`)". So CERT does not endorse commented-out code. It endorses code that is compiled out in a visible way. Neither page mentions "properly documented".
  - **SonarQube rule verified.** The researcher's "SonarQube's commented-out-code rule" is S125, "Sections of code should not be commented out" (Maintainability impact MEDIUM, tag `unused`). It was checked in the sonar-java source and metadata.
- **Rationale:**
  - **Standards.** ISO 5055 lists excessive commented-out code as a maintainability weakness: CWE-1085, "Invokable Control Element with Excessive Volume of Commented-out Code". Its default threshold is 2% of a function's instructions, and it can be tuned "prior to analysis". MITRE's CWE-1085 page repeats the 2% default and puts the weakness in CWE-1307 (CISQ Maintainability).
  - **Tools.** Ruff calls commented-out code "dead code" that "is often included inadvertently". SonarQube ships S125 for the same pattern.
  - **Support is normative only.** No empirical study of the harm of commented-out code was found in this topic. Deleted code can be recovered from version control, which is a practical argument rather than a cited one.
- **Evidence:**
  - [List of Weaknesses Included in the CISQ Automated Source Code Quality Measures — CWE-1085](https://www.it-cisq.org/pdf/cisq-weaknesses-in-ascqm.pdf) — CISQ, June 2019 — standard — "A function, method, procedure, etc. contains an excessive amount of code that has been commented out within its body. (default threshold for the maximum percent of commented-out instructions is 2%, alternate threshold can be set prior to analysis)." — Checked in the PDF text (Maintainability table). The same wording is in [OMG ASCQM v1.1](https://www.omg.org/spec/ASCQM/1.1/PDF) §7.1.24.
  - [CWE-1085 (CWE 4.20)](https://cwe.mitre.org/data/definitions/1085.html) — MITRE, 2026 (page updated 30 April 2026) — standard — "While the interpretation of 'excessive volume' may vary for each product or developer, CISQ recommends a default threshold of 2% of commented code." It is a member of CWE-1307 — Verified. MITRE marks it as prohibited for vulnerability mapping because it is a quality issue, not a vulnerability.
  - [Ruff ERA001 commented-out-code](https://docs.astral.sh/ruff/rules/commented-out-code/) — Astral — official_docs — "Commented-out code is dead code, and is often included inadvertently. It should be removed." It is "prone to false positives when checking comments that resemble Python code, but are not actually Python code." Derived from eradicate; stable since v0.0.145 — Verified.
  - [sonar-java S125 metadata](https://raw.githubusercontent.com/SonarSource/sonar-java/master/sonar-java-plugin/src/main/resources/org/sonar/l10n/java/rules/java/S125.json) — SonarSource (open source) — official_docs (source code) — "title": "Sections of code should not be commented out"; type CODE_SMELL; impact MAINTAINABILITY MEDIUM; tag "unused" — Verified with curl. Added by the verifier.
  - [MSC12-C, MSC12-EX2](https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/miscellaneous-msc/msc12-c) — SEI CERT — standard — "It is permissible to temporarily remove code that may be needed later. (See MSC04-C for an illustration.)" — Verified. It replaces the deprecated MSC07-C that the researcher cited.
  - [MSC04-C. Use comments consistently and in a readable fashion](https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/miscellaneous-msc/msc04-c) — SEI CERT — standard — "Instead of using `/*` and `*/` to comment out blocks of code, use conditional compilation (for example, `#if`, `#ifdef`, or `#ifndef`)". The page also accepts an `if (0)` block — Verified. Added by the verifier.
- **Detect:**
  - **Python:** Ruff ERA001.
  - **Java and other SonarSource languages:** SonarQube S125.
  - **Heuristic grep for other languages:** `rg -n '^\s*(//|#)\s*(if|for|while|return|const|let|var|def|class|import|await)\b'`. Check each hit by hand: prose and documentation examples are not commented-out code.
  - **Per function:** estimate the share of commented-out instructions against the 2% CWE-1085 default when reporting.
- **Tools:** Ruff ERA001, SonarQube S125, ripgrep.
- **Applies to:** All languages. The conditional-compilation alternative is specific to C and C++.
- **When not to apply / counterpoints:**
  - ERA001 and similar heuristics flag prose and doc examples that look like code.
  - CERT allows code to be removed temporarily, but through conditional compilation rather than comments. A block that must stay should carry a reason and a reference (issue link or date).
  - Code in documentation comments (usage examples) is not dead code.
- **Fix risk:** low

### T01-F17 — Check internal invariants with side-effect-free assertions, but never rely on strippable assertions for input validation, authorisation or anything that must hold in production
- **Grade:** C · **Verdict:** CORRECTED
  - **Primary text added.** Holzmann's original replaces Wikipedia.
  - **Java and C semantics checked.** In Java, "By default, assertions are disabled at runtime" (Oracle). In C, `assert` expands to `((void)0)` under NDEBUG (cppreference).
  - **Lobsters date.** 2025-08-20.
  - **The sources disagree on what a failed assertion should do:**
    - JPL and Holzmann: "an explicit recovery action should be taken, e.g., by returning an error condition to the caller";
    - TigerBeetle: "The only correct way to handle corrupt code is to crash."
- **Rationale:**
  - **What the standards want.** Assertions are central to the Power of Ten and JPL. TigerBeetle uses them in a non-space product: at least two per function on average. JPL asks for at least one in every function over 10 lines, as a "should" rule.
  - **Assertions can be stripped.** Python's `-O` removes them, Java disables them by default, and C's NDEBUG compiles them out. So they must never carry production checks.
  - **What a failure should do depends on the system:**
    - JPL's flight software recovers by returning an error;
    - TigerBeetle crashes;
    - high-availability systems prefer to degrade gracefully.

    Density targets therefore do not carry over as they are.
- **Evidence:**
  - [JPL D-60411 Rule 16](https://yurichev.com/mirrors/C/JPL_Coding_Standard_C.pdf) — NASA JPL, 2009 — standard — "All functions of more than 10 lines should have at least one assertion." "Assertions must be side-effect free…"; "When an assertion fails, an explicit recovery action should be taken, e.g., by returning an error condition to the caller of the function." "No assertion should be used for which a static checking tool can prove that it can never fail or never hold." — Checked in the PDF.
  - [The Power of 10, rule 5](https://web.eecs.umich.edu/~imarkov/10rules.pdf) — Holzmann, 2006 — peer_reviewed — "The code's assertion density should average to minimally two assertions per function." "When an assertion fails, an explicit recovery action must be taken such as returning an error condition to the caller" — Checked in the full text.
  - [TIGER_STYLE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md) — TigerBeetle — engineering_blog — "The assertion density of the code must average a minimum of two assertions per function."; "The only correct way to handle corrupt code is to crash." — Verified in the raw file.
  - [Ruff S101 assert](https://docs.astral.sh/ruff/rules/assert/) — Astral (flake8-bandit) — official_docs — "Assertions are removed when Python is run with optimization requested (i.e., when the `-O` flag is present), which is a common practice in production environments." — Verified.
  - [Lobsters: NASA's 10 Rules for Safety-Critical Code](https://lobste.rs/s/3bsfgs/nasa_s_10_rules_for_safety_critical_code) — zesterer, 20 August 2025 — practitioner_forum — "Safety-critical systems favour crashing when error conditions are encountered (i.e: terminate immediately and reset). High-availability systems favour graceful handling…" — Verified.
  - [Programming With Assertions](https://docs.oracle.com/javase/8/docs/technotes/guides/language/assert.html) — Oracle — official_docs — "By default, assertions are disabled at runtime." — Verified. Added by the verifier.
- **Detect:**
  - **Where invariants are missing:** count assertions per function and look at long functions with none.
  - **Assertions with side effects:** an assignment, `++`, or a mutating call inside `assert(...)`.
  - **Python:** run Ruff S101 on non-test code and check every assert that touches request, user or file input.
  - **Any language:** make sure external input is not validated only by `assert` or debug-only macros.
- **Tools:** Ruff S101, ripgrep, manual review.
- **Applies to:** All languages, keeping in mind the stripping semantics in Python, C/C++ and Java.
- **When not to apply / counterpoints:**
  - No empirical study of assertion density in general-purpose software was found.
  - Adding production-active assertions creates new crash paths in a product that already works.
  - Bandit/Ruff S101 directly conflicts with density targets in Python.
- **Fix risk:** high

### T01-F24 — Apply the Power of Ten outside safety-critical C selectively: adopt the checking and bounding rules, adapt recursion, assertion and preprocessor rules, and do not adopt the heap and pointer rules as written
- **Grade:** C · **Verdict:** CORRECTED
  - **Primary text added.** Holzmann's original article was added.
  - **Lobsters thread date.** 1llv4p is 2023-04-26, not 2022.
  - **Counter-evidence added.** TigerBeetle keeps the recursion ban, and a Lobsters practitioner (gpanders) uses all ten rules in flight software.
  - **Holzmann's own evidence.** He calls the rules "somewhat strict—some might even say draconian". His evidence is experimental use at JPL "with encouraging results", which is anecdotal.
- **Rationale:**
  - **What JPL itself says.** The standard separates tool-checkable "shall" rules from "should" rules. It calls Rule 2 "routine practice, even for non-critical code development". For newly written code it expects compliance through level 4 to have no measurable schedule or cost impact, but "This trade-off can be different for heritage code". That caveat matters for a pass over a finished project.
  - **What practitioners say.** They accept the checking and bounding principles and dispute the heap and recursion bans outside hard-real-time work.
  - **The mapping:**

    | Treatment | Rules |
    |---|---|
    | Adopt | bounded loops and queues (F13), functions of about 60 lines or fewer (F05), smallest scope (F16), return-value and public-boundary parameter checks (F11), zero warnings plus static analysis (F14) |
    | Adapt | assertions become explicit invariant checks (F17); the recursion ban becomes a depth bound on untrusted input; the preprocessor rule becomes "no macros or metaprogramming that hide control flow or generate unreviewable variants" |
    | Do not adopt as written | no heap after initialisation; pointer and function-pointer restrictions (C and embedded specific) |
- **Evidence:**
  - [JPL D-60411 v1.0 — Scope, Levels of Compliance, Rule 20](https://yurichev.com/mirrors/C/JPL_Coding_Standard_C.pdf) — NASA JPL, 2009 — standard — "The coding rules defined here primarily target the development of mission critical flight software written in the C programming language"; "For newly written code, achieving full compliance with this standard – at least through level 4, is not expected to have a measurable impact on schedule or cost. This trade-off can be different for heritage code…"; "with just ten conditional compilation directives, there could be up to 2^10 (i.e., 1024) possible versions of the code" — Checked in the PDF.
  - [The Power of 10: Rules for Developing Safety-Critical Code](https://web.eecs.umich.edu/~imarkov/10rules.pdf) — Holzmann, *IEEE Computer* 39(6):95–99, June 2006 — peer_reviewed — Rule 3: "Do not use dynamic memory allocation after initialization." Rule 9: "no more than one level of dereferencing should be used … Function pointers are not permitted." "the following 10 rules primarily target C"; "Developers are currently using this rule set experimentally at JPL to write mission-critical software, with encouraging results." — Checked in the full text. [Wikipedia's summary](https://en.wikipedia.org/wiki/The_Power_of_10:_Rules_for_Developing_Safety-Critical_Code) agrees with it.
  - [HN: The Power of 10 rules](https://news.ycombinator.com/item?id=36506013) — hedora and AnimalMuppet, 28 June 2023 — practitioner_forum — hedora: "Rust solves the pointer escape problem via static analysis and annotations, so that's feeling pretty dated too." AnimalMuppet: "If you're the programmer who has to provably meet hard real time constraints, the difference matters quite a bit." — Verified.
  - [Lobsters: The Power of Ten](https://lobste.rs/s/1llv4p/power_ten_rules_for_developing_safety) — l0b0, david_chisnall and gpanders, 26 April 2023 — practitioner_forum — l0b0 asks how the rules map to Rust. david_chisnall: universal return-value checking would be "very useful for safety-critical things" and is "fairly easy to add to clang". gpanders: "We use all of them in my current job which involves writing flight software." — Verified.
  - [TIGER_STYLE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md) — TigerBeetle — engineering_blog — cites "NASA's Power of Ten — Rules for Developing Safety Critical Code" as the basis for bounded loops, no recursion, assertion density, the 70-line limit and strictest warnings in a Zig database — Verified.
- **Detect:**
  - **Use it as the skill's mapping table.** Route the adopted rules through F05, F11, F13, F14 and F16.
  - **For the adapted rules:**
    - find recursion that runs on external input;
    - find macros, decorators or codegen that hide control flow, for example `rg -n '#define .*\b(return|goto|if)\b'` in C, and heavy metaprogramming in dynamic languages;
    - count build-time conditional variants (`#ifdef`, feature flags), as JPL Rule 20 suggests.
- **Tools:** see F05, F11, F13, F14, F16 and F17.
- **Applies to:** The mapping applies to all languages. The rules that are not adopted apply only to embedded or hard-real-time C and C++.
- **When not to apply / counterpoints:**
  - The only evidence that these rules work beyond flight software is anecdotal: TigerBeetle, and Holzmann's own report of JPL use. No controlled study was found.
  - The heap and pointer rules remain relevant on embedded targets.
- **Fix risk:** medium

## Practitioner voice
- [NIST SP 500-235 §2.5](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf) — A documented case of gaming a metric. A developer divided CC by the number of switch branches and "could take a module with complexity 90 and reduce it to 'modified' complexity 10 simply by adding a ten-branch multiway decision statement to it that did nothing". NIST's resulting policy: limit CC to 10, or write down why the limit was exceeded.
- [Yuan et al., OSDI 2014](https://www.usenix.org/system/files/conference/osdi14/osdi14-paper-yuan.pdf) — 198 sampled failures from Cassandra, HBase, HDFS, MapReduce and Redis, 48 of them catastrophic.
  - 92% of the catastrophic failures came from mishandled non-fatal errors that had been signalled.
  - 35% came from trivial handlers: empty or log-only, abort on an over-general exception, or TODO/FIXME.
  - A simple checker (Aspirator) found 121 new bugs and 379 bad practices, and developers fixed or confirmed 143 of them.
- [Juergens et al., ICSE 2009](https://arxiv.org/abs/1701.05472) — Three commercial C# systems, one commercial COBOL system and one open-source Java system. Developers confirmed 107 faults caused by inconsistent changes to clones, for example a null check added to only one copy.
- [Lenarduzzi et al., SANER 2020](https://arxiv.org/abs/1907.00376) — Local companies "were not confident in the usefulness of the rules proposed by SonarQube and contracted us". The researchers found most of the 202 Java rules had little link to faults, and advised teams to choose their rules deliberately.
- [Tricorder, ICSE 2015](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43322.pdf) — Google. FindBugs as a standalone command-line tool "was used by only 35 developers in 2014 (and by 20 of those only once)". Warnings shown at build time are often ignored. Code-review analyses must stay under 10% effective false positives, and analyzers that nobody acts on are removed.
- [Ousterhout vs Martin (2024–2025)](https://github.com/johnousterhout/aposd-vs-clean-code) — Ousterhout reports "constantly flipping back and forth between the methods" of over-decomposed code. Martin would "rather err on the side of decomposition" because helpers "can always be inlined".
- [Carmack on inlined code (2007 email)](https://cbarrete.com/carmack.html) — Argues for inlining single-use code. Calling a PartialUpdate helper out of context caused many bugs: "Lots and lots of bugs stem from this."
- [HN on the Power of Ten (June 2023)](https://news.ycombinator.com/item?id=36506013) — Several points:
  - AlotOfReading: unbounded loops are "situationally fine" if the program makes forward progress, and the dynamic-allocation ban "is a lot more flexible now";
  - Farmadupe: limiting function length does not always improve readability;
  - hedora: Rust's static analysis makes the pointer rules "feel pretty dated".
- [Lobsters, NASA's 10 rules (August 2025)](https://lobste.rs/s/3bsfgs/nasa_s_10_rules_for_safety_critical_code) — Recursion fits tree and graph algorithms. Safety-critical systems crash and reset, while high-availability systems degrade gracefully, so assertion and abort rules do not transfer directly.
- [Lobsters, Power of Ten (April 2023)](https://lobste.rs/s/1llv4p/power_ten_rules_for_developing_safety) — A flight-software developer uses all ten rules. Universal return-value checking "would be fairly easy to add to clang".
- [TigerBeetle TIGER_STYLE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md) — A production financial database written in Zig that adopted the Power of Ten outside aerospace:
  - no recursion;
  - at least 2 assertions per function on average, with a crash when one fails;
  - a hard limit of 70 lines per function;
  - bounds on all loops and queues;
  - strictest warnings;
  - a "zero technical debt" policy.
- [Knip](https://knip.dev/) — Testimonials on the tool's own page report deleting "~300k lines of unused code at Vercel" and "over 41k lines of code in legacy codebase". One notes "just one false positive" and that a good configuration matters.
- [Fowler, TestCoverage (2012)](https://martinfowler.com/bliki/TestCoverage.html) — "If you make a certain level of coverage a target, people will try to attain it." Fowler would expect "the upper 80s or 90s" from thoughtful testing and "would be suspicious of anything like 100%".

## Contradictions and open questions

**Thresholds disagree**
- **Function length.** SIG treats 1–15 LOC as low risk; Chowdhury et al. recommend under 24 lines for Java; ESLint's `max-lines-per-function` defaults to 50; Power of Ten and JPL use about 60; TigerBeetle has a hard 70. Ousterhout, Carmack and an HN commenter argue that length limits can hurt readability.
- **Cyclomatic complexity.** NIST uses 10, with 15 only for teams with "operational advantages". SIG uses bands at 5, 10 and 25. CISQ/ASCQM CWE-1121 and ESLint default to 20. Ruff's C901 defaults to 10.
- **Parameters.** ESLint `max-params` defaults to 3; SIG rates 3–4 as moderate risk; Ruff/Pylint default to 5; JPL allows at most 6; CISQ CWE-1064 defaults to 7.

**Rules that pull in different directions**
- **Multiway decisions.** NIST allows exempting a module that is a single switch but advises against "modified" complexity measures. ESLint's `complexity` rule offers exactly such a `"modified"` variant.
- **Warnings.**
  - JPL and Holzmann: zero warnings even when the tool is wrong; rewrite the code.
  - CERT MSC00-C: a commented suppression is enough when the code is correct.
  - Google: only near-zero-false-positive checks may break the build; under 10% false positives is the bar for code review.
- **What a failed assertion should do.**
  - JPL and Holzmann: explicit recovery, such as returning an error.
  - TigerBeetle: crash.
  - Lobsters practitioners: high-availability systems should degrade gracefully.
  - Density targets: Power of Ten and TigerBeetle want 2 or more per function on average, JPL at least 1 per function over 10 lines. In Python, Bandit/Ruff S101 flags every assert because `-O` removes them.
- **Log-only error handlers.** Yuan et al. count a handler that only logs as *ignoring* the error, which was 25% of catastrophic failures. Ruff S110's own advice for `try-except-pass` is to "consider logging the exception", and Ruff BLE001 accepts `logging.exception` as sufficient. Logging satisfies the linters but not the empirical finding.
- **Commented-out code.** CISQ CWE-1085 (2% threshold), SonarQube S125 and Ruff ERA001 say remove it. CERT MSC12-EX2 allows code to be temporarily removed when it "may be needed later". Its illustration, MSC04-C, says to do that with conditional compilation rather than comment delimiters. The conflict is therefore smaller than the researcher suggested: CERT does not endorse commented-out code either.
- **Dead code.** CWE-561 says "Remove dead code before deploying", and Romano et al. find it harmful. CERT MSC12-C rates its severity Low and its likelihood Unlikely, and keeps defensive defaults and exported-library code on purpose.
- **Recursion.** Practitioners on HN and Lobsters reject the ban outside hard-real-time code. TigerBeetle, a production database, keeps it.

**Research results disagree**
- **Cognitive Complexity.**
  - Muñoz Barón et al. (2020) validate it against comprehension time and ratings.
  - Lavazza et al. (2023), as cited by Esposito et al. only (not read directly), found no clear advantage.
  - Esposito et al. (2023/24 preprint) find it slightly weaker than CC by ρ but say in their text that it is "somewhat more correlated".
- **CC versus lines of code.** SonarSource says application-level CC scores "correlate to their lines of code totals". Landman et al. find only moderate correlation at method level and conclude CC is not redundant with SLOC. The two statements work at different levels of aggregation.
- **Clones.** Juergens et al. show that inconsistent changes to clones cause confirmed faults. They also cite prior work that doubts cloning is harmful at all (ref. [17]; not accessed).

**Standards and their mappings disagree**
- **ISO 25010:2023 structure.** arc42 lists Testability under Flexibility. iso25000.com (2023 structure), TIOBE/TÜViT and Codacy list it under Maintainability. The ISO text was not accessed, but the weight of sources favours Maintainability.
- **Which ISO 25010.** ISO 5055/ASCQM is anchored to ISO/IEC 25010:**2011** ("4 of the 8" characteristics). The 2023 model has 9, including Flexibility and Safety, which no ISO 5055 measure covers.
- **CWE-1121.** MITRE's CWE-1307 lists 28 Maintainability members and omits CWE-1121. CISQ 2019 and OMG ASCQM v1.1 list 29 parents including CWE-1121. A tool that maps findings through CWE-1307 will miss the complexity weakness.
- **Performance measure size.** The CISQ 2019 list has 15 Performance Efficiency parents; OMG ASCQM v1.1 (2022) has 16.
- **SonarSource classifications.** SonarQube 2025 offers MQR mode (software qualities) and a Standard Experience mode with the older bug, vulnerability and code smell types.

**Open questions**
- **The ISO texts themselves.** ISO/IEC 25010:2023 and ISO/IEC 5055:2021 were not read. Thresholds were confirmed in CISQ 2019 and OMG ASCQM v1.1, which is the OMG specification the ISO standard is built on. Whether ISO 5055:2021 matches ASCQM 1.0 or 1.1 exactly, and whether an ISO revision is under way, is unverified.
- **Outcome evidence for ISO 5055.** No peer-reviewed study linking ISO 5055 weakness density to real outcomes (defects, effort) was found.
- **Lavazza et al. 2023.** The paper's content (abstract and numbers) remains unread: both the publisher page and the open-access preprint returned 403.
- **The ISO/IEC website.** It stays behind a paywall.
- **Power of Ten beyond flight software.** No controlled evidence was found that its assertion-density or bounded-loop rules improve outcomes in general-purpose software.
- **Practitioner coverage.** Reddit and StackExchange coverage remains thin. The WebSearch budget was exhausted before this verification started.

## Dropped findings
(none) No finding was dropped. One source was removed from F23: the CISQ 2022 "Cost of Poor Software Quality" report. It is real (H. Krasner, November 2022, sponsored by Synopsys and Undo), but it is a macro-economic estimate that does not support hotspot prioritisation. The deprecated CERT MSC07-C was replaced by MSC12-C wherever it was cited.
