# Error handling and reliability
> Code T14 · slug error-handling · verified 2026-09-23 · counts: verified 14 / corrected 8 / downgraded 1 / dropped 0

## Summary

The strongest evidence on this topic is a peer-reviewed failure study. Yuan et al. (OSDI 2014) sampled 198 user-reported failures in Cassandra, HBase, HDFS, Hadoop MapReduce and Redis. 48 of them were catastrophic, and all the percentages below are shares of those 48:
- 92% came from incorrect handling of non-fatal errors that the software had explicitly signalled.
- 35% came from three trivial handler patterns: an empty or log-only handler (25%), an over-broad catch that aborts (8%), and a handler holding TODO/FIXME (2%, a single case).
- In another 23%, the handler was so wrong that 100% statement coverage of the handler would have exposed it.

Gunawi et al. (FAST 2008) found that 1,153 of 9,022 error-propagating calls (13%) in Linux 2.6 file systems and storage drivers drop the error code. de Pádua & Shang (MSR 2018) tested 17 exception-handling anti-patterns in three Java/C# projects. According to their abstract, most of them were not significant in their defect models. A secondary review names Dummy Handler and Generic Catch as strongly related to post-release defects, and Log-and-Throw and Ignoring InterruptedException as related in only one of the three projects. So a hardening pass should look at error-handling bodies first and treat most other exception "smells" as low priority.

The reliability guidance comes from the AWS Builders' Library, the Google SRE book, the Azure Architecture Center (ms.date 2026-02-26), the gRPC, requests and Go docs, and CWE-1088, which is part of the CISQ Reliability measure (CWE-1306) that ISO/IEC 5055:2021 adopted. These sources agree on four points:
- put a finite timeout on every remote call;
- bound retries and add jitter;
- retry at one layer only, under a retry budget;
- retry only operations that are idempotent or carry an idempotency key.

Recent incidents tie these rules to real outages:
- **Cloudflare, 2025-11-18.** A Rust `Result::unwrap()` panicked on an internally generated feature file that had grown past a 200-feature limit. Core traffic was disrupted for about 3 hours (11:28 to 14:30 UTC), and every system was restored by 17:06 UTC, about 5h40 after impact began.
- **Google Cloud, 2025-06-12.** Blank fields in a policy reached an unguarded null dereference. Recovery was slowed because restarting tasks had no randomized exponential backoff.
- **CrowdStrike, 2024.** A template type defined 21 input fields but only 20 values were supplied, and a runtime bounds check was missing.
- **AWS, 2021-12-07.** Clients failed to back off because of a latent issue.

Tool documentation gives a concrete detector for most rules: ESLint (`preserve-caught-error` since v9.35.0, now in `@eslint/js` recommended), typescript-eslint, Ruff, PMD 7.x, SpotBugs, Error Prone, clang-tidy, Clippy, errcheck/golangci-lint, .NET CA rules, PEP 8 and PEP 765 (Python 3.14), the Node v26 docs, and OWASP Top 10:2025 A10.

The sources conflict on several points, which are reported rather than resolved:
- fail-fast versus keep-running;
- fail-open versus fail-closed;
- `unwrap` as a legitimate invariant assertion versus a ban;
- circuit breakers versus token buckets;
- log-and-rethrow;
- linter defaults that exempt some commented or TODO-tagged empty handlers, which the empirical data flags as dangerous. After verification only ESLint `no-empty` and clang-tidy (for `@TODO`/`@FIXME` only) do this; PMD does not.

Method note: coverage of 2024-2026 empirical studies is thin, especially on AI-generated error handling. The web-search budget ran out during both the research and the verification passes. Every source below was opened directly (WebFetch, curl, or PDF text extraction) during verification.

## Findings

### T14-F01 — Treat every empty, pass-only or log-only error handler as a defect until justified
Each handler must do one of three things:
- recover, leaving state consistent;
- propagate or rethrow;
- translate the error into one that fits its context.

Adding only a log line does not count as handling.
- **Grade:** A · **Verdict:** VERIFIED. All quotes were confirmed. Clarification: Yuan's percentages are shares of the 48 catastrophic failures, not of all 198.
- **Rationale:** This is the best-evidenced error-handling rule. In Yuan et al., 25% of the catastrophic failures came from ignoring explicitly signalled errors, and a handler that only logs counted as ignoring. In one example (Figure 7), an HBase region split failed and the handler only logged it. The old region had already been removed and the new ones were never created, so data was lost. de Pádua & Shang (via the review) found that Dummy Handler has a strong statistical relation to post-release defects. CWE-390 (error detected without action) belongs to CWE-1306, the CISQ Reliability measure, and to OWASP A10:2025. CERT ERR00-J requires that each catch block "must ensure that the program continues only with valid invariants".
- **Evidence:**
  - [Simple Testing Can Prevent Most Critical Failures (OSDI '14)](https://www.usenix.org/system/files/conference/osdi14/osdi14-paper-yuan.pdf) — Yuan, Luo, Zhuang, Rodrigues, Zhao, Zhang, Jain, Stumm (University of Toronto), 2014 — peer-reviewed — "almost all (92%) of the catastrophic system failures are the result of incorrect handling of non-fatal errors explicitly signaled in software"; "25% of the catastrophic failures were caused by ignoring explicit errors (an error handler that only logs the error is also considered as ignoring the error)" — both verbatim in the PDF text. The sample is 198 failures, 48 of them catastrophic (Table 1).
  - [Studying the relationship between exception handling practices and post-release defects (review)](https://neverworkintheory.org/2021/09/16/exception-handling-practices-and-post-release-defects.html) — Greg Wilson, It Will Never Work in Theory, 2021 (reviewing de Pádua & Shang, MSR 2018) — secondary review — "The Dummy Handler and Generic Catch anti-patterns have a strong statistical relationship to defects." Covers 3 Java/C# projects and 17 anti-patterns — verified. The original abstract (via Semantic Scholar/Crossref, DOI 10.1145/3196398.3196435) confirms "the majority of the exception handing anti-patterns are not significant in the models". The full paper is paywalled and was not read.
  - [ERR00-J. Do not suppress or ignore checked exceptions](https://cmu-sei.github.io/secure-coding-standards/sei-cert-oracle-coding-standard-for-java/rules/exceptional-behavior-err/err00-j) — SEI CERT Oracle Coding Standard for Java, n.d. (the page shows no date) — standard — catch blocks must recover, rethrow, or "throw an exception that is appropriate to the context of the catch block"; ERR00-J-EX0 allows suppression when "failure to free the resource cannot affect future program behavior" — verified.
  - [CWE-390: Detection of Error Condition Without Action](https://cwe.mitre.org/data/definitions/390.html) — MITRE CWE 4.20, 2026 — standard — "The product detects a specific error, but takes no actions to handle the error." Member of CWE-1306 (CISQ Quality Measures - Reliability) and CWE-1445 (OWASP A10:2025) — verified.
  - [SpotBugs bug descriptions](https://spotbugs.readthedocs.io/en/latest/bugDescriptions.html) — SpotBugs — official docs — DE_MIGHT_IGNORE: "This method might ignore an exception. In general, exceptions should be handled or reported in some way, or they should be thrown out of the method." — verified. DE_MIGHT_DROP exists with the same wording.
  - [try-except-pass (S110)](https://docs.astral.sh/ruff/rules/try-except-pass/) — Astral Ruff docs — official docs — "Suppressing exceptions may hide errors that could otherwise reveal unexpected behavior, security vulnerabilities, or malicious activity. Instead, consider logging the exception." — verified. Its suggested fix is `logging.exception(...)`.
- **Detect:**
  1. Linters:
     - ESLint `no-empty` (in recommended). Do not set `allowEmptyCatch`, and note that it ignores any block containing a comment.
     - Ruff `S110`.
     - PMD `EmptyCatchBlock`. Keep the default `allowCommentedBlocks=false`, and review the default `allowExceptionNameRegex` of `^(ignored|expected)$`.
     - SpotBugs `DE_MIGHT_IGNORE` / `DE_MIGHT_DROP`.
     - clang-tidy `bugprone-empty-catch`.
  2. Log-only handlers, which linters miss, via ast-grep:
     - Java/TS: `catch ($E) { $L.$M($$$) }` where the single statement is a logger or console call.
     - Python: an `except $T:` body that is a single `logger.*` or `print` call.
     - Go: `if err != nil { log.$M($$$) }` with no return.
  3. Manual check for each hit: after the handler, does execution continue as if the operation succeeded? Signs include a later read of an unset variable, a partially mutated collection, or a half-committed multi-step write.
- **Tools:** ESLint no-empty, Ruff S110, PMD EmptyCatchBlock, SpotBugs DE_MIGHT_IGNORE/DE_MIGHT_DROP, clang-tidy bugprone-empty-catch, ast-grep, ripgrep.
- **Applies to:** Every language with exceptions (Java, Kotlin, C#, Python, JS/TS, C++, Scala), plus error-return languages: a Go `if err != nil` that only logs and continues, or an unchecked C return code.
- **When not to apply / counterpoints:**
  - Aspirator, Yuan's checker, had 19% false positives. It skipped FileNotFound and exceptions raised in shutdown, close and cleanup methods.
  - CERT ERR00-J-EX0 allows suppressing cleanup failures that cannot affect later behaviour.
  - Murat Demirbas warns of hindsight bias and says correct handling needs "a lot of context and a holistic understanding of the system".
  - A developer told Yuan's team "I fail to see the reason to handle every exception".
  - Ruff S110's own fix is to log, which Yuan's definition still counts as ignoring the error.
  - An empty handler is acceptable when a comment explains why ignoring is safe, e.g. an optional-feature probe.
- **Fix risk:** medium

### T14-F07 — Consume every error-carrying return value
Every such value must be checked, propagated, or discarded explicitly with a justification. Turn on the language's must-use or nodiscard machinery and the unchecked-error linters, and triage every discard, including `_ =`, `let _ =` and `(void)`.
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - Gunawi et al. (FAST '08) found that in Linux 2.6 file systems and three storage drivers, 1,153 of 9,022 error-propagating calls (13%) drop the error code, and "write errors are neglected more often than read errors".
  - CWE-252 is in CWE-1306 (CISQ Reliability) and OWASP A10:2025.
  - CVE-2006-4447 is an unchecked privilege-drop return.
  - Joe Duffy calls forgetting to check return codes "easily the most vexing and damaging problem with error codes".
  - Ignoring a returned Java Future hides failures in the same way.
- **Evidence:**
  - [EIO: Error Handling is Occasionally Correct (FAST '08)](https://www.usenix.org/legacy/event/fast08/tech/full_papers/gunawi/gunawi.pdf) — Gunawi, Rubio-González, Arpaci-Dusseau, Arpaci-Dusseau, Liblit (UW-Madison), 2008 — peer-reviewed — "out of the 9022 function calls through which the analyzed error codes propagate, we find that 1153 calls (13%) do not correctly save the propagated error codes"; "We confirm that write errors are neglected more often than read errors" — verbatim in the PDF. The paper also says "many violations are not corner-case mistakes, but perhaps intentional choices".
  - [CWE-252: Unchecked Return Value](https://cwe.mitre.org/data/definitions/252.html) — MITRE CWE 4.20 — standard — "The product does not check the return value from a method or function, which can prevent it from detecting unexpected states and conditions." Observed example CVE-2006-4447 (unchecked privilege drop) — verified. Member of CWE-1306 and CWE-1445.
  - [errcheck](https://github.com/kisielk/errcheck) — kisielk — official tool docs — "errcheck finds silently ignored errors in Go code."; `-blank` checks assignments of errors to the blank identifier — verified. The repository is active, not archived.
  - [bugprone-unused-return-value](https://clang.llvm.org/extra/clang-tidy/checks/bugprone/unused-return-value.html) — LLVM clang-tidy — official docs — the `CheckedReturnTypes` default covers std::error_code, std::error_condition, std::errc, std::expected and boost::system::error_code; alias `cert-err33-c` — verified.
  - [FutureReturnValueIgnored](https://errorprone.info/bugpattern/FutureReturnValueIgnored) — Google Error Prone — official docs — "Ignoring returned Futures suppresses exceptions thrown from the code that completes the Future." — verified (severity WARNING). `CheckReturnValue` also exists (severity ERROR).
  - [The Error Model](https://joeduffyblog.com/2016/02/07/the-error-model/) — Joe Duffy, 2016 — engineering blog — "It's easy to forget to check a return code… This is easily the most vexing and damaging problem with error codes." — verified. The quote joins two non-adjacent sentences.
- **Detect:**
  - Go: `errcheck -blank ./...` or golangci-lint `errcheck`, plus `rowserrcheck` and `nilerr` ("Find the code that returns nil even if it checks that the error is not nil").
  - Rust: `unused_must_use` is warn-by-default (confirmed in the rustc lint listing), so make sure it is not allowed. Review each `let _ =` discard.
  - C/C++: `[[nodiscard]]`, `-Wunused-result`, clang-tidy `bugprone-unused-return-value` / `cert-err33-c`.
  - Java: SpotBugs `RV_RETURN_VALUE_IGNORED*`, Error Prone `CheckReturnValue` / `FutureReturnValueIgnored`.
  - JS: promises are covered in T14-F08.
  - Shell: `set -euo pipefail` (not source-verified here).
- **Tools:** errcheck, golangci-lint, rustc unused_must_use, clang-tidy, SpotBugs, Error Prone.
- **Applies to:** Go, Rust, C, C++, Java (Futures, File.delete/mkdir booleans), C#, shell.
- **When not to apply / counterpoints:**
  - errcheck's built-in exclude list covers stdlib functions documented never to return errors.
  - Gunawi suspects many drops are intentional.
  - Some drops are defensible when justified, such as a close error after read-only use. Close errors after writes are not (see T14-F14).
  - Writing `if err != nil { return err }` everywhere adds noise without context (see T14-F09).
- **Fix risk:** medium

### T14-F19 — Test the error paths, not just the happy path
Measure coverage of catch, except and if-err blocks and of throw statements separately. Every handler that makes a recovery decision (retry, fallback, rollback, degrade) needs at least one test that injects the failure. Use fault injection or mutation testing on the handlers of critical modules.
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - Yuan: in 23% of the catastrophic failures the handler was so wrong that statement-coverage testing would have caught it. 77% of all failures could be reproduced by a unit test, and 98% manifest on no more than 3 nodes.
  - Lima et al. studied 27 long-lived Java libraries (preprint). Catch blocks and throw statements are covered significantly less than other code. In the lowest quartile, throw instructions are 25% covered and catch blocks 17%, against a median overall instruction coverage of 82%. BCEL covers 2% of its 143 catch blocks.
  - Surveys that Lima cites: Ebert et al. 2015 found about 70% of companies do not test EH code, and Dalton et al. 2020 found that in 76.02% of 417 projects, exceptional-behaviour tests make up 0-10% of test methods.
  - Azure recommends mocks that return each error type, plus chaos tools.
- **Evidence:**
  - [Simple Testing Can Prevent Most Critical Failures](https://www.usenix.org/system/files/conference/osdi14/osdi14-paper-yuan.pdf) — Yuan et al., 2014 — peer-reviewed — "In another 23% of the catastrophic failures, the error handling logic of a non-fatal error was so wrong that any statement coverage testing or more careful code reviews by the developers would have caught the bugs."; "77% of the failures can be reproduced by a unit test"; "Almost all (98%) of the failures are guaranteed to manifest on no more than 3 nodes" — all verbatim.
  - [Assessing Exception Handling Testing Practices in Open-Source Libraries](https://arxiv.org/abs/2105.00500) — Lima, Rocha, Bezerra, Paixão, 2021 — preprint (arXiv v1 only, "submitted to Empirical Software Engineering"; publication not confirmed) — "instructions and branches within catch blocks and throw instructions are less covered, with statistical significance"; lowest-quartile THROW_IC 25%, CATCH_IC 17%; median IC 82%; BCEL 2% of 143 catch blocks; 68% of 12,331 mutants detected — all verified in the full text. The Ebert (~70%) and Dalton (76.02%, 417 projects) figures are confirmed as Lima's citations; the primaries were not opened.
  - [Transient fault handling (Test your retry strategy)](https://learn.microsoft.com/en-us/azure/architecture/best-practices/transient-faults) — Microsoft Azure Architecture Center, ms.date 2026-02-26 — official docs — "Create a mock version of the resource or service that returns a range of errors that the real service might return. Make sure that it covers all error types that your retry strategy detects." — verbatim.
- **Detect:**
  1. Run coverage: JaCoCo, coverage.py with `branch=True`, c8/istanbul, `go test -coverprofile`, cargo llvm-cov.
  2. Intersect the uncovered lines with handler locations found by ast-grep: `catch ($E) { $$$ }`, `except $T: $$$`, `if err != nil { $$$ }`. Flag uncovered handlers that do more than rethrow.
  3. Run mutation tools on the exception paths: PIT (Java), Stryker (JS/TS/C#), mutmut (Python), cargo-mutants (Rust).
  4. Check that tests assert on error outcomes: `assertThrows`, `pytest.raises`, `expect(...).rejects`, `errors.Is` in Go tests.
- **Tools:** JaCoCo, coverage.py, c8/istanbul, go test -cover, cargo llvm-cov, PIT, Stryker, mutmut, cargo-mutants, ast-grep.
- **Applies to:** All languages. Highest priority for handlers that retry, roll back, fall back or terminate.
- **When not to apply / counterpoints:**
  - Lima et al. is a Java-only preprint.
  - Kochhar et al. 2017 (as cited by Lima, 100 Java projects) found coverage has an "insignificant correlation" with post-release bugs.
  - Demirbas warns that hindsight bias may inflate Yuan's "easily detectable" 23%.
  - Adding tests does not change runtime behaviour, but tests that pin current wrong behaviour can entrench bugs.
- **Fix risk:** low

### T14-F15 — No return, break, continue or throw inside finally blocks
These statements silently discard the in-flight exception or return value. Move control flow out of `finally` and keep `finally` for cleanup only.
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - PEP 765 (Final, Python 3.14) measured this on the 8,000 most popular PyPI packages (120,964,221 lines). Of 203 control-flow statements in finally blocks, 149 (73%) were incorrect and could swallow exceptions. CPython 3.14 now emits a SyntaxWarning.
  - ESLint `no-unsafe-finally` is in the recommended config.
  - .NET: "Don't raise exceptions in finally clauses" (CA2219).
  - PMD `DoNotThrowExceptionInFinally` and `ReturnFromFinallyBlock` ("Avoid returning from a finally block, this can discard exceptions").
- **Evidence:**
  - [PEP 765 – Disallow return/break/continue that exit a finally block](https://peps.python.org/pep-0765/) — Python Software Foundation, created 2024-11-15 — standard — "The projects examined contained a total of 120,964,221 lines of Python code… 203 instances"; "most of the usages were incorrect: 73% in our sample (149 of 203)"; 46 correct (mostly tests), 8 defensible; SyntaxWarning in 3.14 — verified.
  - [no-unsafe-finally](https://eslint.org/docs/latest/rules/no-unsafe-finally) — ESLint — official docs — "when return, throw, break, or continue is used in finally, control flow statements inside try and catch are overwritten" — verbatim. In `@eslint/js` recommended.
  - [jump-statement-in-finally (B012)](https://docs.astral.sh/ruff/rules/jump-statement-in-finally/) — Astral Ruff — official docs — break, continue and return in finally "can cause exceptions to be silenced" — verified.
  - [Best practices for exceptions](https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions) — Microsoft Learn (.NET), ms.date 2025-10-22 — official docs — "Don't raise exceptions in finally clauses. For more information, see code analysis rule CA2219." — verbatim.
  - [PMD Java error-prone rules](https://pmd.github.io/pmd/pmd_rules_java_errorprone.html) — PMD (docs 7.28.0-SNAPSHOT) — official docs — DoNotThrowExceptionInFinally: "Throwing exceptions within a 'finally' block is confusing since they may mask other exceptions or code defects."; ReturnFromFinallyBlock exists — verified.
- **Detect:**
  - Ruff `B012`; on Python 3.14+, `python -W error::SyntaxWarning -m compileall .`.
  - ESLint `no-unsafe-finally`; PMD `DoNotThrowExceptionInFinally` and `ReturnFromFinallyBlock`; .NET `CA2219`.
  - Grep: `rg -n -U --pcre2 'finally\s*:?\s*\{?[^}]*?\b(return|break|continue|throw|raise)\b'`, then confirm each hit manually.
- **Tools:** Ruff B012, ESLint no-unsafe-finally, PMD, CPython 3.14 SyntaxWarning, .NET CA2219.
- **Applies to:** Python, JS/TS, Java, C#, Kotlin. The Go equivalent is a deferred function that overwrites a named error return.
- **When not to apply / counterpoints:**
  - PEP 765 found 46 correct uses (mostly in tests) and 8 defensible ones.
  - Two maintainers closed the report as "works as intended".
  - The fix changes which exception or value propagates. That is the point, but callers may have adapted to the swallowed behaviour.
- **Fix risk:** medium

### T14-F11 — Give every remote or cross-process call an explicit, finite timeout
This covers HTTP, gRPC, DB, cache, queue and subprocess calls. Set both a connect timeout and a request/read timeout, or propagate a deadline. Derive the value from measured downstream latency, e.g. the p99.9 when you accept 0.1% false timeouts. Never rely on library defaults.
- **Grade:** A · **Verdict:** CORRECTED. The Cloudflare/Valsorda quote wording was fixed, and Go's current behaviour was re-confirmed against pkg.go.dev.
- **Rationale:**
  - AWS practice is a timeout on any remote call and generally on any cross-process call, with both a connection and a request timeout.
  - CWE-1088 is in CWE-1306 (CISQ Reliability, ASCRM-RLB-19).
  - Several ecosystems default to no timeout:
    - requests "do not time out unless a timeout value is set explicitly";
    - Go's `http.Get` uses `DefaultClient = &Client{}`, and "A Timeout of zero means no timeout";
    - "By default, gRPC does not set a deadline".
  - Azure: set timeouts on every outbound call before adding retry logic.
- **Evidence:**
  - [Timeouts, retries, and backoff with jitter](https://d1.awsstatic.com/builderslibrary/pdfs/timeouts-retries-and-backoff-with-jitter.pdf) — Marc Brooker, AWS Builders' Library, 2019 — industry report — "A best practice in Amazon is to set a timeout on any remote call, and generally on any call across processes even on the same box. This includes both a connection timeout and a request timeout."; "we choose an acceptable rate of false timeouts (such as 0.1%)… (p99.9 in this example)" — verbatim in the PDF.
  - [CWE-1088](https://cwe.mitre.org/data/definitions/1088.html) — MITRE CWE 4.20 — standard — "The code has a synchronous call to a remote resource, but there is no timeout for the call, or the timeout is set to infinite." Member of CWE-1129 (CISQ 2016) and CWE-1306; maps to ASCRM-RLB-19 — verified.
  - [Requests Advanced Usage: Timeouts](https://requests.readthedocs.io/en/latest/user/advanced/#timeouts) — Python requests — official docs — "By default, requests do not time out unless a timeout value is set explicitly. Without a timeout, your code may hang for minutes or more." — verbatim.
  - [The complete guide to Go net/http timeouts](https://blog.cloudflare.com/the-complete-guide-to-golang-net-http-timeouts/) — Filippo Valsorda, Cloudflare, 2016-06-29 — engineering blog — "the package level functions such as http.Get use a Client without timeouts, so are dangerous to use on the open Internet" — verbatim. **Corrected quote:** the server-side text reads "very slow or disappearing clients might leak file descriptors", not "run out of file descriptors". The 2016 claim is still true per [pkg.go.dev/net/http](https://pkg.go.dev/net/http) ("DefaultClient is the default Client and is used by Get, Head, and Post"; "A Timeout of zero means no timeout").
  - [gRPC Deadlines](https://grpc.io/docs/guides/deadlines/) — gRPC — official docs — "By default, gRPC does not set a deadline which means it is possible for a client to end up waiting for a response effectively forever." — verbatim.
  - [request-without-timeout (S113)](https://docs.astral.sh/ruff/rules/request-without-timeout/) — Astral Ruff — official docs — "By omitting the timeout parameter, the program may hang indefinitely while awaiting a response." Covers `requests` and `httpx` — verified.
  - [Transient fault handling](https://learn.microsoft.com/en-us/azure/architecture/best-practices/transient-faults) — Azure Architecture Center, ms.date 2026-02-26 — official docs — "Set timeouts on every outbound call before you implement retry logic."; "Timeouts that are too long cause threads and connections to accumulate during outages." — verbatim.
- **Detect:**
  - Python: Ruff `S113`; also grep `urlopen(` and `socket.create_connection(` calls without a timeout.
  - Go: golangci-lint `noctx`; `rg -n 'http\.(Get|Post|Head)\(|&http\.Client\{\s*\}|http\.ListenAndServe\('`.
  - JS: `rg -n 'fetch\('` and check for `signal: AbortSignal.timeout(...)`; check axios instances for `timeout`.
  - gRPC: calls without `context.WithTimeout`, `deadline=` or `withDeadlineAfter`.
  - DB/Redis: check pool-acquire and statement timeouts in config.
  - Manual: is each timeout at or below the caller's own deadline (deadline propagation)?
- **Tools:** Ruff S113, golangci-lint noctx, ripgrep, ast-grep.
- **Applies to:** Any networked or multi-process code, in any language.
- **When not to apply / counterpoints:**
  - Timeouts that are too short cause false failures and, with retries, extra load.
  - AWS notes that p99.9 fails when it is close to p50 (add padding) and for clients with large network latency.
  - Streams, uploads and batch jobs need progress- or idle-based timeouts.
  - Adding a timeout to a working system can surface new errors on slow paths, so measure latency first.
- **Fix risk:** medium

### T14-F12 — Bound retries, add jitter, retry at one layer under a budget, and only on transient errors
Every retry must meet all of these conditions:
- bounded: about 3 attempts plus a total deadline;
- exponential backoff with jitter;
- performed at one layer of the stack only;
- limited by a per-client or per-process retry budget: a token bucket, a retry ratio under about 10%, or N per minute;
- applied only to transient errors: 429, 5xx and connection errors, honouring Retry-After, never 4xx validation or auth errors.

Remove endless loops, fixed-interval retries, and retries stacked across library, SDK and application layers.
- **Grade:** A · **Verdict:** CORRECTED. The Brooker 2022 circuit-breaker claim had no URL; the real source is now cited. The "60 retries per minute" example first appears in the Google SRE book. HTTP 408 is not in the cited sources.
- **Rationale:**
  - AWS: a five-deep stack with three retries per layer multiplies load on the database by 243x. AWS limits retries locally with a token bucket, which has been in the AWS SDK since 2016.
  - Google SRE: a per-request budget of three attempts; a per-client retry ratio under 10% "reduces the growth to just 1.1x in the general case"; always use randomized exponential backoff; the example server-wide budget of "60 retries per minute in a process".
  - Azure: three retries on each of two layers gives nine attempts; "Never implement an endless retry mechanism"; implement a retry budget.
  - Brooker (2015): full jitter more than halved the call count with 100 contending clients.
  - Incidents: recovery from GCP 2025-06-12 was prolonged because restarting tasks lacked randomized exponential backoff; in AWS 2021-12-07, clients failed to back off because of a latent issue.
- **Evidence:**
  - [Timeouts, retries, and backoff with jitter](https://d1.awsstatic.com/builderslibrary/pdfs/timeouts-retries-and-backoff-with-jitter.pdf) — AWS Builders' Library, 2019 — industry report — "If each layer retries independently, the load on the database will increase 243x"; "our best practice is to retry at a single point in the stack"; "AWS added this behavior to the AWS SDK in 2016"; "client errors should not be retried with the same request"; circuit breakers "introduce modal behavior into systems that can be difficult to test" — all verbatim.
  - [Handling Overload](https://sre.google/sre-book/handling-overload/) — Alejandro Forero Cuervo, Google SRE book, 2016 — book (free online) — "If a request has already failed three times, we let the failure bubble up to the caller."; per-client retry budget "(a 10% retry ratio) reduces the growth to just 1.1x in the general case" — verbatim.
  - [Addressing Cascading Failures](https://sre.google/sre-book/addressing-cascading-failures/) — Google SRE book, 2016 — book — "Always use randomized exponential backoff when scheduling retries."; "avoid amplifying retries by issuing retries at multiple levels"; "Limit retries per request… only allow 60 retries per minute in a process" — verbatim. Three layers of 3 retries give 64 attempts (4^3).
  - [Transient fault handling](https://learn.microsoft.com/en-us/azure/architecture/best-practices/transient-faults) — Azure Architecture Center, ms.date 2026-02-26 — official docs — "A retry with a count of three on both calls adds up to nine retry attempts in total"; "Never implement an endless retry mechanism."; "no more than 60 retries per minute against a specified dependency"; 429 and 5xx are typical candidates, and 400/401/403/404 are not; follow `Retry-After` — verbatim.
  - [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) — Marc Brooker, AWS Architecture Blog, 2015-03-04 (updated May 2023) — engineering blog — full jitter `sleep = random(0, min(cap, base * 2 ** attempt))`; "In the case with 100 contending clients, we've reduced our call count by more than half." — verified.
  - [Fixing retries with token buckets and circuit breakers](https://brooker.co.za/blog/2022/02/28/retries.html) — Marc Brooker, 2022 — engineering blog — **substituted source.** The researcher cited "Brooker (2022)" without a URL. This post simulates the options: breakers give better load protection at extreme failure rates, but are "either retrying or not retrying, and might switch back and forth between the two", and with many small clients they "trip too early" — verified.
  - [Google Cloud incident report, 12 June 2025](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) — Google Cloud, 2025 — incident report — "Service Control did not have the appropriate randomized exponential backoff implemented to avoid this." — verified.
  - [Summary of the AWS Service Event in us-east-1](https://aws.amazon.com/message/12721/) — AWS, 2021-12-07 — incident report — "Our networking clients have well tested request back-off behaviors… but, a latent issue prevented these clients from adequately backing off during this event." — verbatim.
- **Detect:** First find the retry sites: `rg -n -i 'retry|retries|backoff|attempt|tenacity|@retry|axios-retry|p-retry|Polly|resilience4j|urllib3.util.Retry|max_retries'`, plus `while (true)` / `for {` loops that contain a sleep and a remote call. Then check each site:
  - (a) a maximum number of attempts or a deadline is set;
  - (b) the delay is exponential with a random component;
  - (c) the retryable-error predicate excludes 4xx other than 429, and excludes validation and auth errors. HTTP 408 is a common addition but is not in the cited sources;
  - (d) Retry-After is honoured;
  - (e) whether an SDK underneath already retries (AWS SDK, Azure SDK, gRPC retry policy, requests `HTTPAdapter(max_retries=...)`), which multiplies the layers;
  - (f) whether a process-wide budget or token bucket exists.
- **Tools:** ripgrep, ast-grep, manual review.
- **Applies to:** Any client of remote services, message consumers, schedulers and jobs. AWS also advises jitter on periodic timers.
- **When not to apply / counterpoints:**
  - Circuit breakers are contested. Azure recommends them for operations that fail continually; AWS says they add modal behaviour and prefers token buckets; Brooker 2022 finds a trade-off, not a clear winner.
  - AWS notes that eventual consistency blurs the "never retry 4xx" rule.
  - Retrying at the top layer only can waste work that lower layers already did (AWS).
  - The numbers (3 attempts, 10%, 60 per minute) are illustrative examples, not measured optima.
- **Fix risk:** medium

### T14-F14 — Release every acquired resource on all exit paths, including error paths
This covers files, sockets, HTTP response bodies, DB connections, statements and rows, locks, and temp files. Use the scoped construct (`with`, try-with-resources, `using`, `defer` right after a successful acquire, RAII, `finally`), not a manual close at the end of the happy path.
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - CWE-404 and CWE-459 are in CWE-1306 (CISQ Reliability).
  - CWE-404 says to free resources "at all exit points for that function including error conditions".
  - Yuan's Aspirator found HBase code where a failed lock release was only logged, which "can deadlock all servers accessing the table".
  - Tool docs describe the leak: Ruff SIM115 and SpotBugs OS_OPEN_STREAM.
  - Jim Shore pairs fail-fast with finally/using so the application "will be returned to a fresh, working state".
- **Evidence:**
  - [CWE-404](https://cwe.mitre.org/data/definitions/404.html) — MITRE CWE 4.20 — standard — "you must be sure to free the memory at all exit points for that function including error conditions." — verbatim (the context is memory, but the principle is general). Member of CWE-1306.
  - [CWE-1306: CISQ Quality Measures - Reliability](https://cwe.mitre.org/data/definitions/1306.html) — MITRE CWE / CISQ — standard — members include 252, 390, 404, 459, 476, 672, 703 and 1088; source "CISQ Automated Source Code Quality Measures" (2020) — verified. Its link to ISO/IEC 5055:2021 is confirmed on the [CISQ standards page](https://www.it-cisq.org/standards/code-quality-standards/) ("adopted it as ISO/IEC 5055:2021"), not on the CWE page.
  - [open-file-with-context-handler (SIM115)](https://docs.astral.sh/ruff/rules/open-file-with-context-handler/) — Astral Ruff — official docs — "If a file is opened without a context manager, it is not guaranteed that the file will be closed (e.g., if an exception is raised), which can cause resource leaks." — verbatim.
  - [SpotBugs bug descriptions](https://spotbugs.readthedocs.io/en/latest/bugDescriptions.html) — SpotBugs — official docs — OS_OPEN_STREAM "does not appear to close the stream on all paths out of the method"; ODR_OPEN_DATABASE_RESOURCE says the same for DB resources — verified.
  - [Simple Testing Can Prevent Most Critical Failures](https://www.usenix.org/system/files/conference/osdi14/osdi14-paper-yuan.pdf) — Yuan et al., 2014 — peer-reviewed — "when tableLock cannot be released, HBase only outputs an error message and continues executing, which can deadlock all servers accessing the table." — verbatim.
- **Detect:**
  - Python: Ruff `SIM115`.
  - Java: SpotBugs `OS_OPEN_STREAM`, `ODR_OPEN_DATABASE_RESOURCE`; PMD `CloseResource`.
  - Go: golangci-lint `bodyclose`, `sqlclosecheck`, `rowserrcheck`. Run `rg -n -A3 'os\.(Open|Create)\(|\.Lock\(\)'` and check that a `defer ...Close()` or `Unlock()` follows the err check.
  - C#: `using` or `await using` on IDisposable.
  - JS/TS: `rg -n 'createReadStream|createWriteStream|\.connect\(|getConnection\('` and check for try/finally or `using`.
  - C++: raw new/delete, or `fopen` without an RAII wrapper.
- **Tools:** Ruff SIM115, SpotBugs, PMD CloseResource, golangci-lint bodyclose/sqlclosecheck/rowserrcheck, ripgrep.
- **Applies to:** All languages. Bugs are most common in languages without deterministic destruction (Java, Python, JS, Go, C#).
- **When not to apply / counterpoints:**
  - Scoping is wrong when the resource escapes (returned, yielded, or stored in a field).
  - CERT ERR00-J-EX0 allows ignoring close() failures only when they cannot affect future behaviour.
  - Close, flush and fsync errors on written files must not be ignored.
- **Fix risk:** low

### T14-F03 — Replace over-broad catches with the precise exception types
Over-broad catches include `catch Exception/Throwable/SystemException`, bare `except:`, `except BaseException`, `catch (...)`, and a JS `catch (e)` that swallows. Replace them with the precise types the try body can raise. Keep one deliberate catch-all at a process or request boundary, where it logs with the stack trace and then rethrows, returns a generic error, or exits. Never combine an over-broad catch with exit or abort.
- **Grade:** A · **Verdict:** CORRECTED.
  - CWE-396 belongs to the CISQ **2016** Reliability and Security categories (CWE-1129/1131), not to CWE-1306, the 2020 measure behind ISO 5055.
  - PMD `AvoidCatchingThrowable` is deprecated since 7.18.0 and has been subsumed by the configurable `AvoidCatchingGenericException`.
  - Jim Shore's "Fail Fast" is an IEEE Software magazine column (Sept/Oct 2004), not a book.
- **Rationale:**
  - In Yuan et al., 8% of the catastrophic failures were aborts inside over-broad catches. In HDFS, a `catch (Throwable)` that called exit() was meant only for IncorrectVersionException. It caught a transient RemoteException and "brought down every datanode". The authors conclude: "The safe practice is to catch the precise exception".
  - Generic Catch is one of the two anti-patterns with a strong relation to defects (de Pádua & Shang, via the review).
  - PEP 8, .NET CA1031 and Ruff BLE001 all encode the rule.
  - Jim Shore: once a global handler exists, avoid catch-alls elsewhere because "They'll prevent exceptions from reaching your global handler".
- **Evidence:**
  - [Simple Testing Can Prevent Most Critical Failures](https://www.usenix.org/system/files/conference/osdi14/osdi14-paper-yuan.pdf) — Yuan et al., 2014 — peer-reviewed — "The exit() was intended only for IncorrectVersionException. However, the developers catch a high-level exception: Throwable… brought down every datanode."; "The safe practice is to catch the precise exception" — verbatim. Over-catch aborts are 8% of the catastrophic failures (Figure 5).
  - [CWE-396](https://cwe.mitre.org/data/definitions/396.html) — MITRE CWE 4.20 — standard — "Catching overly broad exceptions promotes complex error handling code that is more likely to contain security vulnerabilities." Member of CWE-1129/CWE-1131 (CISQ 2016) and CWE-1445 (OWASP A10:2025); **not** a member of CWE-1306 — verified against both pages.
  - [PEP 8](https://peps.python.org/pep-0008/) — PSF, last modified 2025-04-04 — standard — "A bare except: clause will catch SystemExit and KeyboardInterrupt exceptions, making it harder to interrupt a program with Control-C, and can disguise other problems." — verbatim.
  - [CA1031](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1031) — Microsoft Learn (updated 2026-04-02) — official docs — "To fix a violation of this rule, catch a more specific exception, or rethrow the general exception as the last statement in the catch block." "Enabled by default in .NET 10: No". The example comment says "For functionally equivalent code, also catch the remaining exceptions that may be thrown by File.Open". The page also says "Do not suppress a warning from this rule." — verified.
  - [blind-except (BLE001)](https://docs.astral.sh/ruff/rules/blind-except/) — Astral Ruff (stable rule) — official docs — flags `except BaseException` and `except Exception`. Re-raised exceptions, and exceptions logged with `exc_info`/`logging.exception`, are not flagged — verified.
  - [Fail Fast](https://www.martinfowler.com/ieeeSoftware/failFast.pdf) — Jim Shore, IEEE Software (Design column, ed. Martin Fowler), Sept/Oct 2004 — magazine column — "If you use a global exception handler, avoid catch-all exception handlers in the rest of your application. They'll prevent exceptions from reaching your global handler." — verbatim.
  - [PMD Java error-prone rules](https://pmd.github.io/pmd/pmd_rules_java_errorprone.html) — PMD — official docs — AvoidCatchingThrowable "Deprecated since PMD 7.18.0", subsumed by AvoidCatchingGenericException (configurable `typesThatShouldNotBeCaught`) — verified (added source).
- **Detect:**
  - Linters: Ruff `BLE001` and `E722`; .NET `CA1031` (off by default in .NET 10, so enable it); PMD `AvoidCatchingGenericException` (configure it to include Throwable).
  - Grep for broad catches:
    - `rg -n 'catch\s*\(\s*(final\s+)?(Exception|Throwable|RuntimeException|SystemException)\b'`
    - `rg -n 'except\s*(Exception|BaseException)?\s*(as\s+\w+)?\s*:'`
    - `rg -n 'catch\s*\(\s*\.\.\.\s*\)'`
  - Highest priority is an over-broad catch combined with termination: `rg -n -U --pcre2 'catch\s*\(\s*(Throwable|Exception)[^)]*\)\s*\{[^}]*(System\.exit|halt\(|abort\(|process\.exit|os\.Exit|sys\.exit)'`.
- **Tools:** Ruff BLE001/E722, .NET CA1031, PMD AvoidCatchingGenericException, ripgrep, ast-grep.
- **Applies to:** Java, Kotlin, C#, Python, C++ and JS/TS. In JS every catch is untyped, so check whether the handler discriminates with instanceof or `code` and rethrows the rest.
- **When not to apply / counterpoints:**
  - A top-level catch-all is required at boundaries: a request handler, a worker loop, or Node's `uncaughtException` hook that logs and exits.
  - Ruff exempts re-raise and `exc_info` logging.
  - Narrowing is hard in Python and JS, where callee exceptions are undocumented. CA1031's example notes that equivalent code must "also catch the remaining exceptions".
- **Fix risk:** medium

### T14-F20 — At trust boundaries, return a generic, stable error and log the details server-side
At HTTP APIs, public CLIs and UIs, return a generic, stable error to the client, e.g. problem details plus a correlation id. Log the full exception, stack and context server-side only. Never put stack traces, SQL, file paths, framework versions or raw exception messages in responses.
- **Grade:** A · **Verdict:** VERIFIED. Note: the OWASP cheat sheet still cites RFC 7807, which [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) obsoletes (verified). Use RFC 9457.
- **Rationale:** OWASP Top 10:2025 added A10 "Mishandling of Exceptional Conditions". It maps 24 CWEs, including CWE-209 (error message with sensitive information) and CWE-636 (failing open). The OWASP Error Handling Cheat Sheet says to return a generic response and log details server-side, because unhandled errors help attackers in the reconnaissance phase. CERT ERR00-J filters sensitive exceptions before reporting.
- **Evidence:**
  - [A10:2025 Mishandling of Exceptional Conditions](https://top10.owasp.org/2025/A10_2025-Mishandling_of_Exceptional_Conditions) — OWASP Top 10:2025 — standard — "Mishandling of Exceptional Conditions is a new category for 2025"; 24 CWEs; notable CWE-209, 234, 274, 476, 636; errors should be handled "in one place, the same way each time" — verified. The site does not state a final or RC status.
  - [Error Handling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html) — OWASP Cheat Sheet Series — standard — "when an unexpected error occurs then a generic response is returned by the application but the error details are logged server side for investigation, and not returned to the user"; recommends RFC 7807 — verified.
  - [ERR00-J](https://cmu-sei.github.io/secure-coding-standards/sei-cert-oracle-coding-standard-for-java/rules/exceptional-behavior-err/err00-j) — SEI CERT — standard — compliant solutions filter sensitive exceptions (whitelisting) before exposing them — verified.
- **Detect:**
  - `rg -n '(res|response)\.(send|json|write)\([^)]*(err|error|e)(\.stack|\.message)?\)'`
  - `rg -n 'traceback\.format_exc\(\)|str\(e\)|repr\(e\)'` inside HTTP handlers.
  - `rg -n 'e\.printStackTrace\(|getStackTrace'` in web layers.
  - Debug flags in production config: `DEBUG = True`, `app.debug`, `UseDeveloperExceptionPage` outside Development, `NODE_ENV` not set to production.
  - Manual: send malformed input to a staging endpoint and inspect the response body.
- **Tools:** ripgrep, Semgrep, manual probing.
- **Applies to:** Web services, APIs and public-facing apps. Less relevant for internal developer CLIs.
- **When not to apply / counterpoints:** Clients may parse the existing error bodies, so changing them is an API change. Internal service-to-service APIs may legitimately return detail, so apply the rule at the external trust boundary.
- **Fix risk:** medium

### T14-F08 — No floating promises or futures (JS/TS and any async runtime)
Every promise must be awaited, returned, combined (Promise.all/allSettled), or given an explicit rejection handler. Never pass async functions to void-returning callbacks (forEach, event emitters, array callbacks) without handling rejections.
- **Grade:** A · **Verdict:** CORRECTED. The Node quote was not verbatim and hid an important nuance: in the default `throw` mode, a rejection is raised as an uncaught exception only when no `'unhandledRejection'` hook is registered. Also added: the typescript-eslint `ignoreVoid` default.
- **Rationale:**
  - typescript-eslint: floating promises cause "improperly sequenced operations, ignored Promise rejections, and more".
  - Since Node v15 the default `--unhandled-rejections=throw` turns an unhandled rejection into an uncaught exception, which crashes the process, unless an `unhandledRejection` listener exists. An unawaited promise is therefore either a process crash, or a silent or log-only failure when a global listener swallows it.
  - `void promise` satisfies the linter (`ignoreVoid` defaults to true) but does not handle the rejection at runtime.
- **Evidence:**
  - [no-floating-promises](https://typescript-eslint.io/rules/no-floating-promises/) — typescript-eslint — official docs — "Floating Promises can cause several issues, such as improperly sequenced operations, ignored Promise rejections, and more." In `recommended-type-checked`, requires type information, `ignoreVoid: true` by default — verified.
  - [no-misused-promises](https://typescript-eslint.io/rules/no-misused-promises/) — typescript-eslint — official docs — `checksVoidReturn` flags a Promise "returned from a function typed as returning void", e.g. `[1, 2, 3].forEach(async value => {...})` — verified.
  - [Node.js CLI: --unhandled-rejections](https://nodejs.org/api/cli.html) — Node.js v26.10.0 docs — official docs — **corrected verbatim text:** "`throw`: Emit `unhandledRejection`. If this hook is not set, raise the unhandled rejection as an uncaught exception. This is the default." The v15.0.0 change note reads "Changed default mode to `throw`" — verified in cli.md.
  - [FutureReturnValueIgnored](https://errorprone.info/bugpattern/FutureReturnValueIgnored) — Google Error Prone — official docs — "Ignoring returned Futures suppresses exceptions thrown from the code that completes the Future." — verified.
- **Detect:**
  - typescript-eslint `@typescript-eslint/no-floating-promises` and `@typescript-eslint/no-misused-promises` (config `recommended-type-checked`).
  - `rg -n '\.forEach\(\s*async'`.
  - `rg -n '^\s*void\s+\w+\('` to review intentional fire-and-forget calls; each needs an explicit `.catch`.
  - Check that any `process.on('unhandledRejection')` handler at the entry point logs and exits rather than swallowing.
  - Java: Error Prone `FutureReturnValueIgnored`.
  - Python asyncio: review `asyncio.create_task(` results that are never awaited or stored.
- **Tools:** typescript-eslint, Error Prone, ripgrep.
- **Applies to:** TypeScript/JavaScript (Node and browser), Java CompletableFuture, C# Task (async void), Python asyncio.
- **When not to apply / counterpoints:**
  - Intentional fire-and-forget is legitimate, e.g. telemetry or cache warm-up. Mark it with `void` plus an explicit `.catch(logAndCount)`, not a bare `void`.
  - Adding `await` changes timing and ordering, and can serialize work that used to run concurrently.
- **Fix risk:** medium

### T14-F09 — Preserve the original error and its stack when translating or rethrowing
Per language:
- Python: `raise New(...) from err`.
- JS: `new Error(msg, { cause: err })`.
- C#: bare `throw;`, or wrap with innerException.
- Go: `fmt.Errorf("...: %w", err)`, compared with `errors.Is`/`errors.As`, never `==`.
- Java: pass the cause to the constructor.

In every language, throw only Error/Exception objects, never strings, and log with the traceback (`logger.exception`, `exc_info`).
- **Grade:** A · **Verdict:** VERIFIED (+ update: ESLint `preserve-caught-error` is now in the `@eslint/js` recommended config)
- **Rationale:**
  - .NET: `throw e` restarts the stack trace (CA2200).
  - ESLint added `preserve-caught-error` in v9.35.0 because developers "forget to preserve the original error".
  - Ruff B904 covers `raise` without `from`, and PEP 8 recommends `raise X from Y`.
  - The Go 1.13 errors blog defines `%w` and errors.Is/As.
  - typescript-eslint `only-throw-error`: non-Error values lack the stack information that Error objects record.
- **Evidence:**
  - [preserve-caught-error](https://eslint.org/docs/latest/rules/preserve-caught-error) — ESLint — official docs — "This rule was introduced in ESLint v9.35.0."; "JavaScript developers often re-throw errors in catch blocks to add context but forget to preserve the original error, resulting in lost debugging information." Now "✅ Recommended" — verified.
  - [Best practices for exceptions](https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions) — Microsoft Learn (.NET), ms.date 2025-10-22 — official docs — "If you rethrow an exception by specifying the exception in the throw statement, for example, throw e, the stack trace is restarted at the current method" (CA2200) — verbatim.
  - [raise-without-from-inside-except (B904)](https://docs.astral.sh/ruff/rules/raise-without-from-inside-except/) — Astral Ruff — official docs — "include a from clause to explicitly set the exception's cause" — verified. PEP 8: `raise X from Y` should "indicate explicit replacement without losing the original traceback".
  - [Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors) — Damien Neil & Jonathan Amsterdam, Go blog, 2019-10-17 — official docs — `errors.Is(err, ErrNotFound)` in place of `==`; `%w` gives the error an Unwrap method — verified.
  - [only-throw-error](https://typescript-eslint.io/rules/only-throw-error/) — typescript-eslint — official docs — "The fundamental benefit of Error objects is that they automatically keep track of where they were built and originated." In `recommended-type-checked` — verified.
  - [error-instead-of-exception (TRY400)](https://docs.astral.sh/ruff/rules/error-instead-of-exception/) — Astral Ruff — official docs — flags `logging.error` inside except handlers; `logging.exception` logs the traceback — verified.
- **Detect:**
  - ESLint `preserve-caught-error`; typescript-eslint `only-throw-error`.
  - Ruff `B904`, `TRY400`; .NET `CA2200`.
  - golangci-lint `errorlint` ("Find code that can cause problems with the error wrapping scheme introduced in Go 1.13").
  - `rg -n 'throw\s+("|`|\x27)'` for thrown strings; `rg -n 'throw\s+(ex|e|err)\s*;'` in C#.
- **Tools:** ESLint, typescript-eslint, Ruff, golangci-lint errorlint, .NET CA2200.
- **Applies to:** All languages.
- **When not to apply / counterpoints:**
  - The Go blog: "There is no single answer to this question"; "Do not wrap an error when doing so would expose implementation details". `%v` is sometimes correct (T14-F23).
  - Error causes can leak internal detail into client responses unless a boundary sanitizes them (T14-F20).
- **Fix risk:** low

### T14-F18 — Don't use compiled-out assertions for runtime validation of inputs, config or security checks
This covers Python `assert` under `-O`, C/C++ `assert` under NDEBUG, and Java `assert`, which is off unless run with `-ea`. Replace these with explicit checks that raise typed errors. Keep assertions only for internal invariants, and prefer an always-on assertion helper there.
- **Grade:** A · **Verdict:** VERIFIED. A primary language-reference source was added. Note: Ruff's claim that `-O` is "a common practice in production" is its own assertion and is unquantified. The Java default was not re-verified here.
- **Rationale:** Python emits no code for `assert` under `-O`, so validation written as asserts disappears in optimized runs. Jim Shore argues assertions should stay enabled in the field ("Don't do that!"), because failures at the customer's site are the hardest to reproduce. Checks that matter in production therefore need a mechanism that cannot be disabled.
- **Evidence:**
  - [assert (S101)](https://docs.astral.sh/ruff/rules/assert/) — Astral Ruff — official docs — "Assertions are removed when Python is run with optimization requested (i.e., when the -O flag is present), which is a common practice in production environments."; fix `if x <= 0: raise ValueError(...)` — verbatim.
  - [The assert statement (Python Language Reference)](https://docs.python.org/3/reference/simple_stmts.html) — Python Software Foundation — official docs — "The current code generator emits no code for an assert statement when optimization is requested at compile time." — verified (added source).
  - [Fail Fast](https://www.martinfowler.com/ieeeSoftware/failFast.pdf) — Jim Shore, IEEE Software, 2004 — magazine column — "One reaction to this fear is to disable assertions in the field. Don't do that!"; example message "can't find [key] property in config file [file]" — verbatim.
- **Detect:**
  - Python: Ruff `S101` (exclude tests); `rg -n '^\s*assert\s' --glob '!**/test*/**'`.
  - C/C++: `rg -n '\bassert\s*\('` in non-test code, checking whether the condition validates external input.
  - Java: `rg -n '^\s*assert\s'`.
  - For each hit, decide whether it validates external data (convert it to an explicit check) or guards an internal invariant (keep it, or use an always-on check).
- **Tools:** Ruff S101, ripgrep.
- **Applies to:** Python, C, C++, Java.
- **When not to apply / counterpoints:** If the process really ran with `-O` or NDEBUG, turning asserts into raises activates checks that were skipped before. Test first. Asserts in test code are fine.
- **Fix risk:** medium

### T14-F06 — Audit every panic, unwrap, expect, force-unwrap and process exit on production paths
Library code and request- or config-handling code must return errors. `unwrap()`/`expect()` is allowed only in three places:
- for a documented, provable invariant (prefer `expect("why this cannot fail")`);
- in tests;
- in startup code that cannot proceed.

`os.Exit`, `log.Fatal`, `sys.exit` and `process.exit` belong only in main or the entry point. Use checked type assertions, e.g. Go's comma-ok form.
- **Grade:** B (was A) · **Verdict:** CORRECTED.
  - The Cloudflare duration was fixed: about 3h of core impact, full recovery about 5h40 after impact began.
  - Grade lowered because the empirical link is one incident, and practitioners (including the incident thread) dispute that `unwrap` rather than config validation was the cause.
- **Rationale:**
  - Cloudflare's 18 Nov 2025 outage was a Rust `Result::unwrap()` panic. A permissions change made a ClickHouse query return duplicate rows, which doubled the feature file past a limit "set to 200, well above our current use of ~60 features".
  - Uber's Go guide: "Panics are a major source of cascading failures"; call `os.Exit` or `log.Fatal*` only in `main()`; always use the comma-ok idiom for type assertions.
  - BurntSushi: a panic means a bug, and "Panicking should not be used for error handling in either applications or libraries."
  - The Rust Book makes `Result` the default and reserves panics for broken invariants.
  - Clippy's `unwrap_used`, `expect_used`, `panic` and `indexing_slicing` are opt-in lints (restriction group, allow by default), with test allowances.
- **Evidence:**
  - [Cloudflare outage on November 18, 2025](https://blog.cloudflare.com/18-november-2025-outage/) — Cloudflare, 2025 — incident report — "thread fl2_worker_thread panicked: called Result::unwrap() on an Err value"; "Currently that limit is set to 200, well above our current use of ~60 features."; remediation "Hardening ingestion of Cloudflare-generated configuration files in the same way we would for user-generated input". Timeline: impact from 11:28 UTC, core traffic "largely flowing as normal by 14:30", all systems restored 17:06 UTC — verified.
  - [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md) — Uber — style guide — "Code running in production must avoid panics. Panics are a major source of cascading failures."; exit only in `main()`; comma-ok idiom — verified.
  - [Using unwrap() in Rust is Okay](https://burntsushi.net/unwrap/) — Andrew Gallant (BurntSushi), 2022-08-08 — engineering blog — "if a panic occurs, then there's a bug somewhere in the program"; "Prefer expect() to unwrap()… But use unwrap() when expect() would lead to noise"; "Panicking should not be used for error handling in either applications or libraries." — verbatim.
  - [Clippy lint configuration](https://doc.rust-lang.org/clippy/lint_configuration.html) — Rust project — official docs — `allow-unwrap-in-tests` false (affects unwrap_used), `allow-expect-in-tests` false, `allow-unwrap-in-consts` true, `allow-panic-in-tests` false, `allow-indexing-slicing-in-tests` false — verified. The [Clippy lint list](https://rust-lang.github.io/rust-clippy/master/index.html#unwrap_used) confirms all four lints are in the restriction group, allow by default.
  - [To panic! or Not to panic!](https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html) — The Rust Programming Language — official docs — "Returning Result is a good default choice when you're defining a function that might fail."; use expect "when you have some other logic that ensures that the Result will have an Ok value" (example `.expect("Hardcoded IP address should be valid")`) — verified.
  - [golangci-lint linters](https://golangci-lint.run/docs/linters/) — golangci-lint — official docs — forcetypeassert: "Find forced type assertions." — verified.
- **Detect:**
  - Rust: `cargo clippy -- -W clippy::unwrap_used -W clippy::expect_used -W clippy::panic -W clippy::indexing_slicing`, with `allow-unwrap-in-tests = true` and `allow-expect-in-tests = true` in clippy.toml. Triage each hit.
  - Go: golangci-lint `forcetypeassert`; `rg -n 'log\.Fatal|os\.Exit\(' --glob '!**/main.go' --glob '!**/cmd/**'`; `rg -n '\bpanic\('`.
  - Python: `rg -n 'sys\.exit\(|os\._exit\(' --glob '!**/__main__.py'`.
  - Node: `rg -n 'process\.exit\('` outside the CLI entry point.
  - Swift/Kotlin: `rg -n '[a-zA-Z)\]]!!|try!|as!'`.
  - TS: `rg -n '[\w)\]]!\.'` (non-null assertions).
- **Tools:** clippy, golangci-lint forcetypeassert, ripgrep.
- **Applies to:** Rust, Go, Swift, Kotlin, TS non-null assertions, and any language where library code can terminate the process.
- **When not to apply / counterpoints:** This contradiction is not resolved.
  - In the HN thread, burntsushi wrote: "I'm on the Rust libs-api team and you're mistaken. I use unwrap() all the time."
  - abalone: it took two hours to identify the config and another hour to roll it back. Visibility and fast rollback matter more.
  - Hackaday commenter Walker: a rewrite in C or Go "would without a doubt have had similar problems".
  - Converting a panic into a returned error can turn a loud crash into silent wrong behaviour if the caller then ignores the error (T14-F07).
  - For bad config, the better fix is to reject it and keep the last-known-good version (T14-F16).
- **Fix risk:** medium

### T14-F16 — Parse and validate all external and semi-external input at the boundary
Parse it into precise types before any side effect. This includes internally generated config, feature files, and data replicated from other services. Enforce explicit size, count and schema limits. On invalid input, reject it and keep the last-known-good config rather than crashing or partially applying it. Remove "shotgun parsing", i.e. validation scattered through the processing code.
- **Grade:** B · **Verdict:** CORRECTED. The Dan Luu post is "Reading postmortems" from 2015 (danluu.com index: 08/15), not "Lessons learned from reading postmortems" from 2017. Luu also says he hasn't done "any kind of formal analysis".
- **Rationale:** Three recent catastrophic incidents came from internally produced data that the code trusted:
  - Cloudflare 2025: an oversized feature file hit `unwrap`.
  - GCP 2025: blank policy fields reached an unguarded null path with no feature flag.
  - CrowdStrike 2024: a template type defined 21 fields but only 20 inputs were supplied, and no runtime bounds check existed.

  Alexis King: get data into the most precise representation at the boundary, because shotgun parsing risks acting on partially valid input. Dan Luu reports configuration as the most common cause of the really bad outages he has seen.
- **Evidence:**
  - [Cloudflare outage on November 18, 2025](https://blog.cloudflare.com/18-november-2025-outage/) — Cloudflare, 2025 — incident report — "Hardening ingestion of Cloudflare-generated configuration files in the same way we would for user-generated input"; "Enabling more global kill switches for features" — verbatim.
  - [Google Cloud incident report (12 June 2025)](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) — Google Cloud, 2025 — incident report — "Without the appropriate error handling, the null pointer caused the binary to crash."; "If this had been flag protected, the issue would have been caught in staging."; policy with "unintended blank fields" — verified.
  - [Channel File 291 Incident Root Cause Analysis](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf) — CrowdStrike, 2024-08-06 — incident report — "The new IPC Template Type defined 21 input parameter fields, but the integration code… supplied only 20 input values"; "A runtime array bounds check was missing for Content Interpreter input fields on Channel File 291" — verbatim in the PDF.
  - [Parse, don't validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) — Alexis King, 2019 — engineering blog — "Get your data into the most precise representation you need as quickly as you can. Ideally, this should happen at the boundary of your system"; "Shotgun parsing is a programming antipattern whereby parsing and input-validating code is mixed with and spread across processing code" — verified.
  - [Reading postmortems](https://danluu.com/postmortem-lessons/) — Dan Luu, 2015 — engineering blog — "Configuration bugs, not code bugs, are the most common cause I've seen of really bad outages."; "Bugs in error handling code are a major cause of bad problems." — verbatim. **Corrected** title and year. The post itself says "I haven't done any kind of formal analysis".
- **Detect:**
  1. Enumerate the deserialization and ingest points: `rg -n 'JSON\.parse\(|json\.loads?\(|yaml\.(safe_)?load\(|serde_json::from_|toml::from_str|Unmarshal\(|ObjectMapper|pickle\.load|protobuf.*Parse'`.
  2. For each one, check:
     - (a) the result goes through a schema or typed parser (zod/valibot, pydantic, typed serde structs, JSON Schema) before use;
     - (b) explicit bounds on sizes, counts and lengths;
     - (c) the failure path rejects and keeps the previous config (hot reload) or refuses to start (cold start), never applies it partially;
     - (d) no `as`, `cast` or `any`, and no unchecked index into parsed arrays;
     - (e) validation buried deep in business logic is a candidate to move to the boundary.
  3. For array access with external indices, use bounds-checked accessors (e.g. `.get(i)` in Rust).
- **Tools:** ripgrep, ast-grep, schema libraries (zod, pydantic, serde), manual review.
- **Applies to:** Services, agents and CLIs that load config, feature flags, ML feature files, templates or replicated data; any trust boundary.
- **When not to apply / counterpoints:**
  - The evidence is incident reports and essays, not controlled studies.
  - Stricter parsing can reject inputs that were silently accepted before, so roll it out in log-only or shadow mode first.
  - Keeping the last-known-good config can mask a broken generator unless each rejection raises an alert.
  - Jacob Voytko (clientserver.dev) argues that incident reports leave out organisational pressures, so "add validation" may not be the real root cause.
- **Fix risk:** medium

### T14-F17 — Fail fast inside the smallest isolation unit, never the whole node or cluster
The isolation unit is the request, task, goroutine, worker, or a process under a supervisor. Each entry point gets exactly one top-level handler. It logs with the stack, then fails that unit: a generic 5xx, or an exit so the supervisor restarts it. It must never resume normal work in a state it cannot trust after an unknown exception. Remove catch-alls below that boundary.
- **Grade:** B · **Verdict:** CORRECTED. Jim Shore is **not** on the "crash the process" side. He writes "a crash is never appropriate" for deployed software, and his global handler reports the error and, in a batch system, "continue[s] with the next transaction". He supports failing the unit, not the process. The source type is also corrected from book to magazine column.
- **Rationale:** The sources agree once you separate the scope of the failure:
  - Shore: fail "immediately and visibly", report through one global handler, and remove catch-alls elsewhere.
  - Node.js: "It is not safe to resume normal operation after 'uncaughtException'"; use an external monitor to restart.
  - Candea & Fox: crash-only software.
  - Duffy: abandonment on bugs.
  - Effective Go: prefer to keep running, and use recover to stop one goroutine.
  - Uber: panics cause cascading failures.

  Yuan's over-catch abort and Cloudflare's proxy-wide panic show the cost of too large a blast radius.
- **Evidence:**
  - [Fail Fast](https://www.martinfowler.com/ieeeSoftware/failFast.pdf) — Jim Shore, IEEE Software, Sept/Oct 2004 — magazine column — "when a problem occurs, it fails immediately and visibly"; "Search your existing code for catch-all exception handlers and either remove or refactor them."; "On the other hand, a crash is never appropriate… You can create a global exception handler to gracefully handle unexpected exceptions" — verbatim.
  - [Node.js process: Using 'uncaughtException' correctly](https://nodejs.org/api/process.html) — Node.js v26.10.0 docs — official docs — "It is not safe to resume normal operation after 'uncaughtException'."; "an external monitor should be employed in a separate process to detect application failures and recover or restart as needed." — verbatim.
  - [Crash-Only Software (HotOS IX)](https://www.usenix.org/legacy/events/hotos03/tech/full_papers/candea/candea.pdf) — George Candea, Armando Fox (Stanford), 2003 — peer-reviewed workshop paper — "Crash-only programs crash safely and recover quickly. There is only one way to stop such software--by crashing it--and only one way to bring it up--by initiating recovery." — verbatim.
  - [Effective Go (Panic / Recover)](https://go.dev/doc/effective_go) — Go team — official docs — "If the problem can be masked or worked around, it's always better to let things continue to run rather than taking down the whole program."; recover can "shut down a failing goroutine inside a server without killing the other executing goroutines" — verified.
  - [The Error Model](https://joeduffyblog.com/2016/02/07/the-error-model/) — Joe Duffy, 2016 — engineering blog — "Abandonment unapologetically tore down the entire process in an instant, refusing to run any user code while doing so."; "Proceeding in the face of a bug is dangerous when you're trying to build a robust system." — verified (full sentences restored).
- **Detect:**
  1. Find the entry points (main, HTTP/RPC handler registration, queue consumers, cron jobs, thread and goroutine spawns). Check that each has exactly one boundary handler: Express/Fastify error middleware, ASP.NET exception middleware, `sys.excepthook` or a framework handler, `Thread.setDefaultUncaughtExceptionHandler`, or goroutine `defer recover()` wrappers in worker pools.
  2. `rg -n "process\.on\(['\"]uncaughtException"` and check that the handler exits after logging.
  3. Goroutines started with `go func` in servers without recover: an unrecovered panic in any goroutine terminates the process.
  4. Termination calls outside entry points (T14-F06).
- **Tools:** ripgrep, ast-grep, manual review.
- **Applies to:** Servers, workers, CLIs, and desktop or mobile apps (where the global handler reports, then restarts or shows an error).
- **When not to apply / counterpoints:**
  - The tension is real between Duffy, Node and .NET ("a crashed app is more reliable and diagnosable than an app with undefined behavior") on one side and Effective Go, Uber and the Cloudflare outage on the other.
  - For a single process with no supervisor, exit-on-unknown-error means downtime.
  - Crash-only design assumes cheap restarts and durable state.
  - Restart loops without backoff can create thundering herds (GCP 2025).
- **Fix risk:** medium

### T14-F13 — Retry only idempotent operations, or ones made idempotent with a client-generated key
The server deduplicates on the key. It stores the key with the original request's parameters, returns the original result on a replay, and rejects the same key sent with different parameters. Flag any automatic retry around POST, payment, email, order or "create" calls that has no key.
- **Grade:** B · **Verdict:** VERIFIED (AWS article year not shown on the page; the researcher's "2021" is unconfirmed)
- **Rationale:**
  - AWS: "APIs with side effects aren't safe to retry unless they provide idempotency", and a timeout does not mean the side effect did not happen. The AWS idempotent-API article stores the client request identifier with the parameters and returns a validation error on a mismatch.
  - Stripe: after a network failure, success "is ambiguous from the perspective of the client".
  - Azure: a repeated increment produces a wrong result.
  - The official requests retry example sets `allowed_methods={'POST'}` without an idempotency caveat, so copy-pasted configs can retry non-idempotent calls.
- **Evidence:**
  - [Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) — Malcolm Featonby, AWS Builders' Library, n.d. — industry report — "it would be undesirable for the EC2 instance launch workflow to retry a failed call to create an EBS volume and end up with two EBS volumes"; a parameter mismatch on the same client token returns a validation error — verified.
  - [Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency) — Brandur Leach, Stripe, 2017-02-22 — engineering blog — "the success of the operation is ambiguous from the perspective of the client, and it doesn't knows [sic] whether retrying the operation is safe"; "a client generates a unique ID to identify just that operation" — verified.
  - [Timeouts, retries, and backoff with jitter](https://d1.awsstatic.com/builderslibrary/pdfs/timeouts-retries-and-backoff-with-jitter.pdf) — AWS Builders' Library, 2019 — industry report — "A timeout or failure doesn't necessarily mean that side effects haven't happened."; "APIs with side effects aren't safe to retry unless they provide idempotency." — verbatim.
  - [Requests Advanced Usage: Automatic Retries](https://requests.readthedocs.io/en/latest/user/advanced/) — Python requests — official docs — the official example is `Retry(total=3, backoff_factor=0.1, status_forcelist=[502, 503, 504], allowed_methods={'POST'})` with no idempotency caveat — verified verbatim.
  - [Transient fault handling](https://learn.microsoft.com/en-us/azure/architecture/best-practices/transient-faults) — Azure, ms.date 2026-02-26 — official docs — "if an operation that increments a value repeats, it produces an incorrect result… design each step as an idempotent operation." — verbatim.
- **Detect:**
  - Cross-reference the T14-F12 retry sites with HTTP method and operation semantics.
  - Grep `allowed_methods=.*POST|method_whitelist|retryOn.*POST|retryCondition`, and retry decorators on functions named `create*`, `send*`, `charge*`, `place*`, `insert*`, `publish*`.
  - Check that an `Idempotency-Key`, `ClientToken` or dedupe id is generated once per logical operation, outside the retry loop, and that the server persists and checks it.
  - Queue consumers: check for deduplication on message id.
- **Tools:** ripgrep, manual review.
- **Applies to:** HTTP and gRPC clients and servers, payment and notification integrations, queue consumers, and DB writes retried after timeouts.
- **When not to apply / counterpoints:**
  - Idempotency keys need server-side storage, a TTL and concurrency control. That is a design change, not a local refactor.
  - The finding does not apply to naturally idempotent operations.
  - Removing a retry from a non-idempotent call can lower success rates if nothing replaces it.
- **Fix risk:** high

### T14-F21 — Make multi-step state changes atomic or compensating on failure, and fail closed on security checks
Operations that mutate state in several steps need a DB transaction or write-then-rename. In the catch, roll back or compensate, then rethrow. After an exception, callers must be able to assume there were no partial side effects. When a security or authorization check fails, deny (fail closed).
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - .NET: "Callers should be able to assume that there are no side effects when an exception is thrown from a method". Its example rolls back a withdrawal when the deposit fails, then calls `throw;`.
  - OWASP A10:2025: "Roll back every part of the transaction and start again".
  - CERT ERR00-J: continue only with valid invariants.
  - Yuan's HBase data loss (Figure 7) is exactly this failure: the old region was removed, the new ones were never created, and the handler only logged.
- **Evidence:**
  - [Best practices for exceptions (Restore state when methods don't complete)](https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions) — Microsoft Learn (.NET), ms.date 2025-10-22 — official docs — "Callers should be able to assume that there are no side effects when an exception is thrown from a method." (TransferFunds rollback example) — verbatim.
  - [A10:2025 Mishandling of Exceptional Conditions](https://top10.owasp.org/2025/A10_2025-Mishandling_of_Exceptional_Conditions) — OWASP — standard — "Roll back every part of the transaction and start again" (fail closed); "rate limiting, resource quotas, throttling, and other limits wherever possible" — verified.
  - [Simple Testing Can Prevent Most Critical Failures](https://www.usenix.org/system/files/conference/osdi14/osdi14-paper-yuan.pdf) — Yuan et al., 2014 — peer-reviewed — Figure 7: "Region split failed: old region removed but new regions not created --- Data loss!", where the handler was `LOG.error("split failed..")` — verbatim.
- **Detect:** Manual review, guided by grep.
  - Find functions with two or more writes (`\.(save|insert|update|delete|put|write|publish|send|charge)\(`) that are not wrapped in a transaction (`BEGIN|transaction|@Transactional|atomic|session.begin|TransactionScope`).
  - Check each catch in those functions for compensation plus rethrow.
  - Look for writes directly to the target path instead of temp-then-rename.
  - Look for auth checks inside try blocks whose catch lets the request proceed (fail-open).
- **Tools:** ripgrep, ast-grep, manual review.
- **Applies to:** Data-modifying services, financial and trading code, file-writing tools, distributed workflows (sagas).
- **When not to apply / counterpoints:**
  - Fail-closed conflicts with fail-open. Google's GCP remediation makes Service Control "fail open", and Jamie Lord argues quota checks should proceed with default policies.
  - Rule of thumb: fail closed for security or authorization decisions; consider fail-open for non-security availability gates; document the choice.
  - Transactions change locking, isolation and performance.
- **Fix risk:** high

### T14-F05 — Separate bugs from recoverable conditions
Do not catch exceptions that signal programming errors (null dereference, index out of range, class cast, TypeError/AttributeError, assertion failure) in order to continue. Fix the cause or add a precondition, and let these errors reach the top-level handler. Catch only exogenous failures (I/O, network, parsing of external data) and "vexing" ones where no Try-style API exists.
- **Grade:** B · **Verdict:** VERIFIED. Duffy's quotes were slightly trimmed. PMD `AvoidCatchingNPE` is deprecated since 7.18.0; its replacement is `AvoidCatchingGenericException`.
- **Rationale:**
  - Duffy: bugs are errors the programmer did not expect, and the distinction is "paramount".
  - Lippert: don't catch fatal exceptions; fix boneheaded ones; avoid vexing ones through Try methods; handle exogenous ones.
  - .NET: "When your code can't recover from an exception, don't catch that exception" and "a crashed app is more reliable and diagnosable than an app with undefined behavior".
  - Rust Book: panic on a broken contract or invariant; return `Result` for expected failure.
- **Evidence:**
  - [The Error Model](https://joeduffyblog.com/2016/02/07/the-error-model/) — Joe Duffy, 2016 — engineering blog — "A recoverable error is usually the result of programmatic data validation."; "A bug is a kind of error the programmer didn't expect."; "This distinction is paramount. Surprisingly, most systems don't make one, at least not in a principled way!" — verified (full sentence restored).
  - [Vexing exceptions](https://ericlippert.com/2008/09/10/vexing-exceptions/) — Eric Lippert, 2008-09-10 — engineering blog — "Don't catch fatal exceptions; nothing you can do about them anyway"; "Fix your code so that it never triggers a boneheaded exception"; "calling the 'Try' versions of those vexing methods" — verified.
  - [Best practices for exceptions](https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions) — Microsoft Learn (.NET), ms.date 2025-10-22 — official docs — both quotes verbatim. It also points to CA2201 (don't raise reserved exception types).
  - [To panic! or Not to panic!](https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html) — Rust Book — official docs — `Result` as the default; panic on a "bad state" where an assumption, guarantee, contract or invariant is broken — verified.
  - [PMD Java error-prone rules](https://pmd.github.io/pmd/pmd_rules_java_errorprone.html) — PMD — official docs — AvoidCatchingNPE: "Code should never throw NullPointerExceptions under normal circumstances. A catch block may hide the original error." Deprecated since 7.18.0, subsumed by AvoidCatchingGenericException — verified.
- **Detect:**
  - `rg -n 'catch\s*\(\s*(NullPointerException|NullReferenceException|IndexOutOfRangeException|ArrayIndexOutOfBoundsException|ClassCastException|IllegalStateException|AssertionError)'`
  - Python: `rg -n 'except\s*\(?\s*(TypeError|AttributeError|NameError|AssertionError|IndexError)'`.
  - JS: catch blocks that wrap only property access or JSON shape access.
  - PMD `AvoidCatchingGenericException` configured with the NPE types.
  - For each hit, decide whether the cause is external input (parse it at the boundary, T14-F16) or a code defect (fix it).
- **Tools:** ripgrep, PMD, ast-grep, .NET analyzers.
- **Applies to:** All languages. In Rust and Go, the equivalent is recovering from panics (`recover()`, `catch_unwind`) and then continuing normal work.
- **When not to apply / counterpoints:**
  - Effective Go endorses `recover()` at an isolation boundary.
  - Python EAFP legitimately catches KeyError/IndexError for lookups, which falls in Lippert's "vexing" category.
  - This rule needs judgement, not a mechanical ban.
- **Fix risk:** medium

### T14-F22 — Propagate interruption and cancellation instead of swallowing them
Treat them as signals, not as errors.
- Java: on InterruptedException, restore the interrupt flag (`Thread.currentThread().interrupt()`) or rethrow.
- .NET: catch OperationCanceledException rather than TaskCanceledException, and let cancellation unwind.
- Go: check `ctx.Done()`/`ctx.Err()` in long loops and pass the incoming context to outbound calls.
- Servers: stop work once the caller's deadline has passed.
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - CERT ERR00-J's compliant solution restores the interrupted status.
  - de Pádua & Shang (via the review): Ignoring InterruptedException correlated with post-release defects in only one of three projects.
  - .NET recommends catching OperationCanceledException, which lets "the callstack to be unwound".
  - gRPC: the server application is responsible for stopping activity it spawned.
  - Google SRE: check the remaining deadline before each stage.
- **Evidence:**
  - [ERR00-J](https://cmu-sei.github.io/secure-coding-standards/sei-cert-oracle-coding-standard-for-java/rules/exceptional-behavior-err/err00-j) — SEI CERT — standard — the compliant solution calls `Thread.currentThread().interrupt()` so that callers "can determine that an interrupt was issued" — verified.
  - [Exception handling practices and post-release defects (review)](https://neverworkintheory.org/2021/09/16/exception-handling-practices-and-post-release-defects.html) — Greg Wilson, 2021 — secondary review — "Ignoring Interrupted Exception and Log and Throw patterns correlated with post-release defects in one of the projects they studied, but not all." — verbatim.
  - [Best practices for exceptions (Catch cancellation and asynchronous exceptions)](https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions) — Microsoft Learn — official docs — "It's better to catch OperationCanceledException instead of TaskCanceledException… These exceptions enable execution to be efficiently halted and the callstack to be unwound" — verified (source added; it was cited only in the rationale).
  - [gRPC Deadlines](https://grpc.io/docs/guides/deadlines/) — gRPC — official docs — "The server application is responsible for stopping any activity it has spawned to service the RPC"; servers should "periodically check if the RPC that initiated it has been cancelled" — verified.
  - [Addressing Cascading Failures](https://sre.google/sre-book/addressing-cascading-failures/) — Google SRE book, 2016 — book — "the server should check the deadline left at each stage before attempting to perform any more work on the request" — verbatim.
  - [golangci-lint linters](https://golangci-lint.run/docs/linters/) — golangci-lint — official docs — contextcheck: "Check whether the function uses a non-inherited context."; noctx: "Detects function and method with missing usage of context.Context." — verified.
- **Detect:**
  - Java: `rg -n -U --pcre2 'catch\s*\(\s*(final\s+)?InterruptedException\s+\w+\s*\)\s*\{(?![^}]*(interrupt\(\)|throw))'`.
  - Go: golangci-lint `contextcheck`, `noctx`; `rg -n 'context\.Background\(\)|context\.TODO\(\)'` outside main and tests.
  - .NET: `catch (Exception)` blocks that would swallow OperationCanceledException; async methods that do not accept or forward a CancellationToken.
  - Python asyncio: `except BaseException` or a bare `except` around awaits (they swallow CancelledError).
- **Tools:** ripgrep, golangci-lint contextcheck/noctx, ast-grep.
- **Applies to:** Java/Kotlin concurrency, Go services, .NET async, Python asyncio, gRPC servers.
- **When not to apply / counterpoints:**
  - Evidence of defect impact is weak (one project, one study).
  - Propagating cancellation can surface new error types to callers that previously saw slow success.
  - Top-level thread loops that end on interrupt need not restore the flag.
- **Fix risk:** low

### T14-F02 — Grep for TODO, FIXME, XXX, "should never happen" and "can't happen" inside catch, except and if-err blocks
Resolve each hit. Some linter defaults exempt these handlers, so a clean lint run does not prove they are fine.
- **Grade:** C (was B) · **Verdict:** CORRECTED.
  - PMD `EmptyCatchBlock` defaults to `allowCommentedBlocks=false`, so by default PMD **does** flag commented empty catches. Its default exemption is exception variables named `ignored` or `expected`.
  - clang-tidy exempts only catches containing the literal keywords `@TODO` or `@FIXME`, not every TODO comment.
  - ESLint `no-empty` does exempt any commented block.
  - Grade lowered: the TODO category in Yuan is 2% of 48 catastrophic failures, a single case.
- **Rationale:**
  - In Yuan et al., a MapReduce handler holding only a TODO and a log line forced the operators of a 4,000-node cluster to kill application managers by hand. That is 2% of the catastrophic failures.
  - Yuan also found empty handlers commented "Will never happen" whose assumption was wrong, and argues that such errors "should be handled defensively".
  - Linter defaults vary: ESLint ignores any commented block; clang-tidy ignores `@TODO`/`@FIXME`; PMD flags commented blocks unless you opt out.
- **Evidence:**
  - [Simple Testing Can Prevent Most Critical Failures](https://www.usenix.org/system/files/conference/osdi14/osdi14-paper-yuan.pdf) — Yuan et al., 2014 — peer-reviewed — "the developers only left a comment 'TODO' in the handler logic in addition to a logging statement. While this error would only occur rarely, it took down a production cluster of 4,000 nodes." (Figure 9: MapReduce); "We argue that errors that 'can never happen' should be handled defensively to prevent them from propagating." — verbatim.
  - [no-empty](https://eslint.org/docs/latest/rules/no-empty) — ESLint — official docs — "This rule ignores block statements which contain a comment (for example, in an empty catch or finally block of a try statement to indicate that execution should continue regardless of errors)." — verbatim. In recommended.
  - [bugprone-empty-catch](https://clang.llvm.org/extra/clang-tidy/checks/bugprone/empty-catch.html) — LLVM clang-tidy — official docs — `IgnoreCatchWithKeywords` default `@TODO;@FIXME` (case-insensitive) — verified. **Precision:** plain `// TODO` without `@` is not exempted.
  - [PMD Java error-prone rules](https://pmd.github.io/pmd/pmd_rules_java_errorprone.html) — PMD — official docs — **corrected:** `allowCommentedBlocks` default **false** ("Empty blocks containing comments will be skipped" applies only when it is set to true); `allowExceptionNameRegex` default `^(ignored|expected)$` — verified in the rule's property table and XPath.
- **Detect:**
  - JS/TS/Java/C#/C++: `rg -n -U --pcre2 'catch\s*(\([^)]*\))?\s*\{[^}]*?(TODO|FIXME|XXX|HACK|never happen|can.?t happen|impossible)'`.
  - Python: `rg -n -U --pcre2 'except[^\n]*:\n(?:[ \t]*#[^\n]*\n|[ \t]*(pass|\.\.\.|log\w*\.[a-z]+\([^\n]*\))\n)*?[ \t]*#[^\n]*(TODO|FIXME|XXX|never happen)'`.
  - Go: `rg -n -U --pcre2 'if err != nil \{[^}]*?(TODO|FIXME|XXX)'`.
  - Tool config: keep PMD's `allowCommentedBlocks=false` default and review catches whose variable is named `ignored` or `expected`; set clang-tidy `bugprone-empty-catch.IgnoreCatchWithKeywords: ''`.
  - Every hit needs a decision (recover, propagate or translate), or a comment explaining why ignoring is safe with no TODO left.
- **Tools:** ripgrep, PMD, clang-tidy, ESLint.
- **Applies to:** All languages. Highest value in services, daemons and data pipelines, where a silent handler can corrupt persisted state.
- **When not to apply / counterpoints:**
  - A comment explaining why an error is safe to ignore is legitimate; this is ESLint's stated reason for the exemption.
  - The empirical base is one failure in one study.
- **Fix risk:** medium

### T14-F04 — Shrink try blocks to the smallest statement that can raise the handled exception
Move success-path code out of the try (after it, or into `else`), so the handler cannot catch errors it was not written for.
- **Grade:** C (was B) · **Verdict:** DOWNGRADED.
  - PEP 8 is normative only for Python.
  - The defect correlation comes solely from a secondary summary of a three-project correlational study. The paper's abstract does not mention handler-block length, and the full text was not accessible.
  - The Yuan quote concerns over-catching, not try length.
- **Rationale:**
  - PEP 8: limit the try clause "to the absolute minimum amount of code necessary. Again, this avoids masking bugs."
  - de Pádua & Shang, as summarized by the review: longer exception-handling blocks go with more post-release defects.
  - Yuan's over-catch cases show the mechanism: as code evolves, a broad handler absorbs failures it was not written for.
- **Evidence:**
  - [PEP 8 – Programming Recommendations](https://peps.python.org/pep-0008/) — PSF, last modified 2025-04-04 — standard — "limit the try clause to the absolute minimum amount of code necessary. Again, this avoids masking bugs." — verbatim.
  - [Exception handling practices and post-release defects (review)](https://neverworkintheory.org/2021/09/16/exception-handling-practices-and-post-release-defects.html) — Greg Wilson, 2021 — secondary review — "The longer the exception handling blocks in a file, the more likely the file is to contain bugs." — verbatim in the review; not confirmed in the primary paper.
  - [Simple Testing Can Prevent Most Critical Failures](https://www.usenix.org/system/files/conference/osdi14/osdi14-paper-yuan.pdf) — Yuan et al., 2014 — peer-reviewed — "this is still bad practice since later when the code evolves, some other exceptions may be over-caught again." — verbatim (supports the mechanism indirectly).
- **Detect:**
  - Manual or AST review: flag try blocks with more than about 5 statements, or with more than one call that can raise the handled type.
  - ast-grep: `try { $$$BODY } catch ($E) { $$$ }` where BODY exceeds N statements.
  - Python: `try:` bodies that span several unrelated calls with a single except.
  - In each flagged block, work out which statement the handler was written for, from the exception type or the log message.
- **Tools:** ast-grep, manual review.
- **Applies to:** All languages with exceptions, especially Python and JS, where exception types are undeclared.
- **When not to apply / counterpoints:**
  - The correlation comes from 3 projects and is not causal.
  - Transactional code may legitimately wrap several statements that must roll back together (T14-F21).
  - The size threshold is a heuristic.
- **Fix risk:** low

### T14-F10 — Handle each error once
Each layer either handles the error (log and recover, or degrade) or returns or rethrows it with added context, not both. Remove log-and-rethrow pairs and log at the boundary that finally handles the error.
- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:**
  - Dave Cheney: handling means inspecting the error and making a decision. Logging and also returning produces duplicate log lines.
  - Uber: the caller should not log the error and then return it; also avoid "failed to" prefixes that pile up.
  - de Pádua & Shang (via the review): Log-and-Throw correlated with defects in only one of three projects.
- **Evidence:**
  - [Don't just check errors, handle them gracefully](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully) — Dave Cheney, 2016 — engineering blog — "Handling an error means inspecting the error value, and making a decision."; logging and returning gives "a stack of duplicate lines in your log file" — verified. The post (2016) recommends the third-party `github.com/pkg/errors` for wrapping. That predates the standard-library `%w` wrapping described in the Go 1.13 blog (2019), so prefer the stdlib mechanism when applying this rule.
  - [Uber Go Style Guide (Handle Errors Once)](https://github.com/uber-go/guide/blob/master/style.md) — Uber — style guide — "The caller should not, for example, log the error and then return it, because its callers may handle the error as well." — verbatim.
  - [Exception handling practices and post-release defects (review)](https://neverworkintheory.org/2021/09/16/exception-handling-practices-and-post-release-defects.html) — Greg Wilson, 2021 — secondary review — correlation in one of three projects only — verbatim.
- **Detect:**
  - ast-grep, Java/TS: `catch ($E) { $$$A; $LOG.$M($$$); $$$B; throw $X; }`.
  - Python: an except body that contains both `logger.`/`logging.` and `raise`.
  - Go: `if err != nil { log.$M($$$); return $$$, err }`.
  - Also look for the same error logged more than once per request.
- **Tools:** ast-grep, ripgrep.
- **Applies to:** All languages; most visible in Go and in layered Java/.NET services.
- **When not to apply / counterpoints:**
  - The evidence is practitioner consensus plus a weak, non-replicated correlation.
  - OWASP's advice to log server-side at the boundary is compatible with this rule.
  - Some teams log at subsystem boundaries on purpose, because callers may drop context.
  - Removing logs reduces observability if the top-level handler does not log.
- **Fix risk:** low

### T14-F23 — Match the error type design to the code's role
- Libraries return typed, inspectable errors: enums or classes, Rust thiserror, Go sentinel or typed errors, wrapped only where callers need them.
- Applications may use opaque, context-rich errors (Rust anyhow, Go `%v` wrapping) and decide at the boundary.
- Do not expose implementation-detail errors (e.g. `sql.ErrNoRows`, a driver exception) through a public API.
- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:**
  - thiserror README: use thiserror for library-like code and anyhow for application-like code.
  - Go team: "wrapping an error makes that error part of your API" and "Do not wrap an error when doing so would expose implementation details".
  - Cheney: sentinel errors create a source-code dependency between packages.
  - BurntSushi and the Rust Book: libraries return `Result` and let callers decide.
- **Evidence:**
  - [thiserror README (Comparison to anyhow)](https://github.com/dtolnay/thiserror) — David Tolnay — official docs — "Use thiserror if you care about designing your own dedicated error type(s) so that the caller receives exactly the information that you choose in the event of failure. This most often applies to library-like code. Use Anyhow if you don't care what error type your functions return… This is common in application-like code." — verbatim.
  - [Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors) — Neil & Amsterdam, Go blog, 2019 — official docs — "wrapping an error makes that error part of your API. If you don't want to commit to supporting that error as part of your API in the future, you shouldn't wrap the error."; "There is no single answer to this question" — verbatim.
  - [Don't just check errors, handle them gracefully](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully) — Dave Cheney, 2016 — engineering blog — "By far the worst problem with sentinel error values is they create a source code dependency between two packages." — verified.
  - [golangci-lint linters](https://golangci-lint.run/docs/linters/) — golangci-lint — official docs — wrapcheck: "Checks that errors returned from external packages are wrapped."; err113: "Check errors handling expressions." — verified.
- **Detect:**
  - Rust library crates: `rg -n 'anyhow::(Result|Error)|Box<dyn (std::error::)?Error'` in pub signatures.
  - Go: golangci-lint `wrapcheck`, `err113`, `errorlint`; review exported functions that return `database/sql` or driver errors via `%w`.
  - Java/C#: public methods that declare or throw vendor exceptions across module boundaries.
  - TS: libraries that throw plain objects or strings (`only-throw-error`).
- **Tools:** golangci-lint wrapcheck/err113/errorlint, clippy, ripgrep, typescript-eslint.
- **Applies to:** Libraries, SDKs, and internal modules with several consumers.
- **When not to apply / counterpoints:**
  - This is maintainers' design guidance, with no empirical defect data.
  - Wrap-everything (wrapcheck) versus hide-everything is itself contested.
  - Changing error types in a published library is a breaking change.
- **Fix risk:** medium

## Practitioner voice

- [HN: "This is the multi-million dollar .unwrap() story" (Nov 2025)](https://news.ycombinator.com/item?id=45974052) — Discussion of the Cloudflare unwrap outage.
  - ojosilva: unwrap means "this can never fail, and if it does, crash the thread immediately".
  - wrs: "every unwrap in production code needs an INFALLIBILITY comment", reviewed like `unsafe`.
  - burntsushi: "I'm on the Rust libs-api team and you're mistaken. I use unwrap() all the time."
  - abalone: it took 2 hours to identify the config and another hour to roll it back; he argues for change visibility and fast rollback.
- [Hackaday: How one uncaught Rust exception took out Cloudflare](https://hackaday.com/2025/11/20/how-one-uncaught-rust-exception-took-out-cloudflare/) — Maya Posch: memory safety does not let you "skip due diligence on input validation". Commenters split:
  - Dylan: unwrap was a deliberate choice to crash.
  - Walker: a rewrite in C or Go "would without a doubt have had similar problems, because it's an untested codebase".
  - LDM: "Clippy should have issued a warning".
- [Lobsters: Disallow code usage with custom clippy.toml (Nov 2025)](https://lobste.rs/s/amboaj/disallow_code_usage_with_custom_clippy)
  - CobaltCause points to the built-in `unwrap_used` lint.
  - magikid prefers a descriptive failure message ("Unable to parse features file…") over a bare unwrap panic.
  - justinpombrio: unwrap is fine where invariants make failure logically impossible.
  - athaller: roll the ban out with a workspace-level `[lints]` table.
- [Murat Demirbas: review of Yuan et al. (2015)](https://muratbuffalo.blogspot.com/2015/03/paper-review-simple-testing-can-prevent.html)
  - Yuan's definition is overly broad; he compares it to calling every catastrophic plane failure "an incorrect landing problem".
  - The "easily detectable" 23% may reflect hindsight bias.
  - Correct handling needs "a lot of context and a holistic understanding of the system".
  - "features are sexy, but fault-tolerance is not".
- [Yuan et al., OSDI '14, §7](https://www.usenix.org/system/files/conference/osdi14/osdi14-paper-yuan.pdf) — Developer reactions to Aspirator's reports were mixed: "ignoring exceptions is bad precisely for this reason" and "catching Throwable… is bad, we should fix these", against "I fail to see the reason to handle every exception". The authors found 5 empty handlers in Aspirator's own code, "put there only so that the code would compile".
- [PEP 765](https://peps.python.org/pep-0765/) — Reactions to bug reports about return-in-finally: of 40 responses within two weeks, 35 acknowledged the issue and 15 opened fix PRs; 3 packages were unmaintained; 2 issues were closed as "works as intended". The authors call the response "overwhelmingly positive".
- [Jamie Lord: When giants fall (June 2025)](https://lord.technology/2025/06/14/when-giants-fall-the-anatomy-of-googles-june-2025-outage.html) — On the GCP outage:
  - letting a null pointer crash infrastructure is "a fundamental failure of defensive programming";
  - quota checks should degrade gracefully with default policies;
  - restarts without randomized backoff created a thundering herd.
- [Jacob Voytko: There's a lot missing from the Google Cloud outage incident report (2025-06-16)](https://www.clientserver.dev/p/theres-a-lot-missing-from-the-google) — Incident reports leave out executive pressure, deadlines and organisational stress, so blaming a missing null check or flag may mislead teams about the root cause.
- [Dan Luu: Reading postmortems (2015)](https://danluu.com/postmortem-lessons/) — "Bugs in error handling code are a major cause of bad problems"; configuration, not code, is the most common cause of the really bad outages he has seen. This is informal: he says he hasn't done "any kind of formal analysis".
- [AWS us-east-1 event, 7 Dec 2021](https://aws.amazon.com/message/12721/) — Clients with "well tested request back-off behaviors" still failed to back off because of a latent issue. Having backoff code is not the same as having backoff that works.
- [Stripe: Designing robust and predictable APIs with idempotency (2017)](https://stripe.com/blog/idempotency) — Network failures make outcomes ambiguous. Use idempotency keys, plus exponential backoff with jitter.
- [Cloudflare: 18 Nov 2025 postmortem](https://blog.cloudflare.com/18-november-2025-outage/) — Remediations:
  - treat internally generated config like user input;
  - add more global kill switches;
  - stop core dumps and error reports from overwhelming resources;
  - review failure modes across all core proxy modules.

## Contradictions and open questions

**Contradictions:**

- **Fail fast versus keep running.**
  - Process-level abandonment: Joe Duffy (Midori abandonment), Node.js ("not safe to resume" after uncaughtException) and .NET ("a crashed app is more reliable and diagnosable than an app with undefined behavior").
  - Keep running: Effective Go ("always better to let things continue to run rather than taking down the whole program") and Uber (panics are "a major source of cascading failures").
  - **Correction:** Jim Shore belongs with neither camp as the researcher framed it. He wants errors to surface immediately and visibly, but says "a crash is never appropriate" for deployed software; his global handler reports and continues with the next transaction.
  - Cloudflare 2025 shows a panic in a shared proxy becoming a multi-hour global outage.
  - The sources reconcile only once the scope of the failure is specified: fail the smallest unit, supervise it, and reject bad config while keeping the last-known-good version.
- **Fail open versus fail closed.** OWASP A10:2025 prescribes rollback and fail-closed. Google's June 2025 remediation makes Service Control "fail open", and Jamie Lord argues quota checks should proceed with default policies. The answer depends on whether the check is a security control or an availability gate.
- **unwrap/panic in Rust.** burntsushi, the Rust Book and Lobsters commenters accept unwrap/expect for invariant violations. Other HN and Hackaday commenters want it banned in production or want an INFALLIBILITY comment on each use. Clippy's `unwrap_used` is in the opt-in restriction group (allow by default).
- **Circuit breakers.** Azure recommends the Circuit Breaker pattern for operations that fail continually. AWS says breakers "introduce modal behavior into systems that can be difficult to test" and prefers token buckets. Brooker's 2022 simulation finds breakers protect better at extreme failure rates but can flip between on and off and trip too early when there are many small clients.
- **Log-only handlers.** Yuan counts a log-only handler as ignoring the error (25% of catastrophic failures), yet Ruff S110's documented remedy for try-except-pass is "consider logging the exception" (`logging.exception`).
- **Commented or TODO empty handlers (corrected).** ESLint `no-empty` exempts any commented block, and clang-tidy exempts catches tagged `@TODO`/`@FIXME` by default. PMD `EmptyCatchBlock` does **not** exempt commented blocks by default (`allowCommentedBlocks=false`), but does exempt variables named `ignored` or `expected`. Yuan found a TODO-plus-log handler behind a 4,000-node cluster incident.
- **Strength of anti-pattern lists.** The de Pádua & Shang abstract says most of the 17 anti-patterns were not significant. The review names two strong ones (Dummy Handler, Generic Catch) and two that hold in only one of three projects (Log-and-Throw, Ignoring InterruptedException). Style guides such as Uber and Dave Cheney present "don't log and return" as a firm rule.
- **Assertions in production.** Jim Shore: never disable assertions in the field. Yet Python strips `assert` under `-O` (per the language reference) and C strips it under NDEBUG, so assertion-based safety depends on the build.

**Open questions:**

- No peer-reviewed 2024-2026 study with numbers on the error-handling quality of AI-generated code was found. Seeker (arXiv 2412.11713, Dec 2024, preprint) describes an agent framework for exception-safe generation, and its abstract gives no measurements. Web-search budgets were exhausted in both passes, so this gap is unconfirmed, not a confirmed absence.
- No replicated empirical comparison exists of defect rates between exception-based and Result/error-value styles.
- For non-RPC operations (DB queries, disk I/O, lock waits, subprocesses), there is no evidenced method for choosing timeouts comparable to AWS's "p99.9 for 0.1% false timeouts".
- No standard cross-language detector exists for log-only handlers. Aspirator was Java-bytecode only, with 19% false positives. The precision of ast-grep or Semgrep rules for unattended runs is untested.
- No study measures whether converting panics or swallowed errors into propagated errors in a finished system reduces incidents or mainly exposes latent failures. The skill should require tests or shadow logging before changing propagation.
- The retry thresholds (3 attempts, 10% ratio, 60 per minute) are illustrative examples from Google SRE and Azure, not optimized values.
- The de Pádua & Shang full text is paywalled (ACM, 403). The per-anti-pattern effect sizes and the block-length finding rest on the abstract and one secondary review.
- Sources not used as evidence: SonarSource rules, SE StackExchange, several Medium posts, the C++ Core Guidelines E-section, and the ISO/IEC 5055 page itself (iso.org returned 403; the CISQ page confirms the adoption instead).

## Dropped findings

None. All 23 findings survived: 14 verified, 8 corrected, 1 downgraded.
