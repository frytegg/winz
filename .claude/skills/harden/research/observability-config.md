# Logging, observability, configuration and operational hygiene
> Code T28 · slug observability-config · verified 2026-09-23 · counts: verified 12 / corrected 10 / downgraded 0 / dropped 0

## Summary

This dossier covers 22 rules a reviewer can check on a finished service, CLI or bot:
- **What must not reach logs:** secrets and PII (F01), log injection (F02).
- **Error paths:** swallowed errors (F03), the last-resort handler and exit codes (F12), resource cleanup (F13).
- **Calls to other systems:** timeouts (F04), retries (F05), idempotency (F06).
- **Configuration:** startup validation (F07), runtime-loaded config treated as untrusted input (F08), secrets in source and git history (F09).
- **Process lifecycle:** graceful shutdown (F10), health probes (F11).
- **Logging mechanics:** structured logs (F14), lazy formatting (F15), level meaning (F16), logging an error once (F17), correlation IDs (F18), logging code that cannot crash (F19), log volume (F20).
- **Monitoring:** security-event logging (F21), the four golden signals (F22).

**Strongest evidence (each passage re-read in this pass: PDF text, the raw page or the official API):**
- **Yuan et al., OSDI 2014.** 198 randomly sampled, user-reported failures in Cassandra, HBase, HDFS, Hadoop MapReduce and Redis. Of these, 48 were catastrophic, and:
  - 92% came from incorrect handling of non-fatal errors that the software had explicitly signaled;
  - in 35%, the handler was empty or only logged, aborted on an overly general exception, or contained FIXME/TODO;
  - in 58%, simple testing of the error-handling code would have exposed the fault.
- **Xu et al., OSDI 2016.** Across six mature systems, 14.0–93.2% of critical RAS (reliability, availability, serviceability) config parameters had no special check at initialization. Their checker, PCheck, caught 75+% of real-world latent config errors at startup.
- **Dai et al., IC2E 2018** (11 cloud systems). "Missing timeout" is one root cause of timeout bugs. 60% of timeout bugs print no error message, and 12% print a misleading one.
- **Chen & Jiang, ICSE 2017.** Six anti-patterns in logging code. Of the 64 instances they filed, 46 (72%) were confirmed or fixed.
- **Standards and official docs:**
  - OWASP ASVS 5.0 (V13, V16);
  - CWE 4.20 (CWE-117, CWE-532);
  - OpenTelemetry Logs Data Model (Stable, spec 1.61.0);
  - W3C Trace Context (Recommendation, 23 Nov 2021);
  - AWS Well-Architected;
  - the Google SRE book and workbook;
  - language and tool documentation.
- **Incident reports:** Cloudflare (18 Nov 2025), Google Cloud (12 Jun 2025) and CrowdStrike (Jul 2024; RCA published 6 Aug 2024). All three show that config and data files generated inside a company still need to be validated like user input.

**Corrections made in this verification pass:**
- **ASVS 16.5.4 (F12)** is Level 3. Its stated purpose includes "to ensure that an error does not take down the entire application process", which pulls against exit-on-crash. The rule is reworded and its grade lowered to B.
- **Log4j (F02).** The researcher's "2.17.1" floor comes from CISA's December 2021 guidance and is outdated. Apache's security page now lists CVEs from 2025–2026 against Log4j Core/API. One of them is a CRLF **log-injection** bug in `Rfc5424Layout` (CVE-2026-34478, fixed in 2.25.4). The latest fixes are 2.25.5 / 2.26.1 (CVE-2026-49844).
- **`requests` timeouts (F04)** are not wall-clock totals.
- **Meta 2019 (F01).** The original post says "internal data storage systems". Its 18 Apr 2019 update explicitly mentions "additional logs of Instagram passwords being stored in a readable format".
- **Attribution fixes:**
  - The Henning Jacobs post title (F11).
  - The HN "log and throw" quote (F17) was by lmilcin; gwbas1c only quoted it.
  - The zbentley link (F09) pointed to tptacek's comment.
- **Unsupported sources replaced:**
  - Probe defaults (F11) come from the concepts page, not the task page cited.
  - A real source was added for SecretStr (F01).
- **Morrell's storage example (F20)** already assumes 1% sampling. It supports sampling rather than arguing against it.
- **GitGuardian's 64% figure (F09)** is 64% of the *valid* secrets detected in 2022.
- **Practitioner voice:**
  - Dropped: arnaelena ("Datadog spend 60%"). The comment does not contain the claim.
  - Rewritten gists: nirui, KallDrexx and scottlamb.

**Research limits:**
- Not read: Reddit, the Amazon Builders' Library (it renders only with JavaScript; error-handling T14-F11 and T14-F13 did verify the timeouts/retries PDF and the idempotency article) and the full de Pádua & Shang paper (only its abstract and a secondary review).
- Dai et al., Yin et al. and Li et al. were read as abstracts only, via OpenAlex.
- Several rules are graded C because the only support is practitioner consensus.
- Disputed points are listed, not resolved: env-var secrets, log levels, log-and-rethrow, fail-fast vs fail-open, exit vs contain on uncaught errors, and wide events vs log lines.

## Findings

### T28-F03 — Never swallow errors silently
Every catch, except or error-return path must do one of three things:
- handle the error;
- propagate it with added context;
- log it with the full stack trace or cause, and only when continuing is provably correct.

These are defects: empty handlers, handlers that print a message but drop the exception, overly broad catches that abort or carry on blindly, and handlers containing TODO/FIXME. Logging alone is not handling.

- **Grade:** A · **Verdict:** VERIFIED. The de Pádua & Shang source is a secondary review (Never Work In Theory), not the paper. It is labelled as such below.
- **Rationale:**
  - Yuan et al. studied 198 randomly sampled, user-reported failures (tickets from 2010 onward) in five distributed data-intensive systems.
    - 92% of catastrophic failures came from incorrect handling of non-fatal errors that the software had explicitly signaled.
    - In 35%, the handler followed one of three trivial patterns.
    - In 58%, simple testing of the error-handling code would have exposed the fault.
  - De Pádua & Shang (MSR 2018) studied three Java and C# projects and 17 exception-handling anti-patterns. Dummy Handler and Generic Catch had a strong statistical relationship with post-release defects.
- **Evidence:**
  - [Simple Testing Can Prevent Most Critical Failures (OSDI 2014)](https://www.usenix.org/system/files/conference/osdi14/osdi14-paper-yuan.pdf) — Yuan, Luo, Zhuang, Rodrigues, Zhao, Zhang, Jain, Stumm (University of Toronto), 2014 — peer_reviewed.
    - Quotes: "almost all (92%) of the catastrophic system failures are the result of incorrect handling of non-fatal errors explicitly signaled in software"; "in 35% of the catastrophic failures ... (i) the error handler is simply empty or only contains a log printing statement, (ii) the error handler aborts the cluster on an overly-general exception, and (iii) the error handler contains expressions like 'FIXME' or 'TODO'"; "in 58% of the catastrophic failures, the underlying faults could easily have been detected through simple testing of error handling code".
    - Verification: the PDF text was extracted and all three passages confirmed. The authors state a 6.9% margin of error at 95% confidence for the 198 samples.
  - [Studying the relationship between exception handling practices and post-release defects (review)](https://neverworkintheory.org/2021/09/16/exception-handling-practices-and-post-release-defects.html) — Greg Wilson, Never Work In Theory, 16 Sep 2021, reviewing de Pádua & Shang, MSR 2018 (DOI 10.1145/3196398.3196435) — secondary review of a peer-reviewed paper.
    - Quote: "The Dummy Handler and Generic Catch anti-patterns have a strong statistical relationship to defects."
    - Verification: confirmed. The paper's abstract is reproduced on the page ("three Java and C# open-source projects", "17 exception handling anti-patterns"). The full paper was not read.
  - Ruff rules [S110 try-except-pass](https://docs.astral.sh/ruff/rules/try-except-pass/), [BLE001 blind-except](https://docs.astral.sh/ruff/rules/blind-except/) and [TRY400 error-instead-of-exception](https://docs.astral.sh/ruff/rules/error-instead-of-exception/) — Astral, 2026 — official_docs.
    - Quotes: S110: "Suppressing exceptions may hide errors that could otherwise reveal unexpected behavior, security vulnerabilities, or malicious activity." TRY400: "logging.exception logs the exception and the traceback, while logging.error only logs the exception." BLE001 does not flag an except that re-raises, or one that is "logged with exc_info enabled".
    - Verification: all confirmed on the pages.
- **Detect:**
  - Python: Ruff S110, BLE001, TRY400. Go: golangci-lint `errcheck` (confirmed in the linter list). JS/TS: ESLint `no-empty` (page exists).
  - Heuristic greps (not validated on real repos):
    - empty handlers: `rg -n -U 'catch ?[(][^)]*[)] ?[{][[:space:]]*[}]'` and `rg -n -U 'except[^:]*:[[:space:]]*(pass|[.][.][.])'`;
    - TODO handlers: `rg -n -A4 'catch|except' | rg 'TODO|FIXME|XXX'`.
  - For each handler that only logs, decide whether continuing is really correct, and check that the stack trace or cause is recorded.
  - Add fault-injection tests for the main external calls. Yuan et al. recommend testing error-handling code.
- **Tools:** Ruff (S110, BLE001, TRY400), golangci-lint errcheck, ESLint no-empty, ripgrep, CodeQL.
- **Applies to:** All languages with exceptions or error returns.
- **When not to apply / counterpoints:**
  - Some errors really can be ignored, such as best-effort cleanup or a cache miss. Narrow the exception type and document why, for example `contextlib.suppress(SpecificError)`.
  - The 92% figure comes from five distributed Java/C data systems. It is strong evidence about error handlers in that class of software, not a measured rate for all code.
  - Full stack traces on hot paths are costly, and logging at every layer creates duplicates (F17).
- **Fix risk:** medium

### T28-F07 — Validate all configuration at startup, in one typed module, and fail fast
Load all configuration in one module at process start and parse it into a typed object. If anything is missing or invalid, fail immediately with a message that names every bad key. Include settings used only on rare paths (failover, retry, shutdown, alerting). Do not read environment variables ad hoc deep in the code, and never replace a required value with a silent default.

- **Grade:** A · **Verdict:** VERIFIED. One metadata fix: Shore's "Fail Fast" is an IEEE Software magazine design column (Sep/Oct 2004), not a book.
- **Rationale:**
  - Xu et al. (OSDI 2016) studied HDFS, YARN, HBase, Apache, MySQL and Squid.
    - Many (14.0–93.2%) of the critically important RAS parameters had no special code checking them at initialization. Errors in those settings stay latent until the failure path runs.
    - Latent configuration errors made up 75% of high-severity configuration issues at a commercial company.
    - PCheck detected 75+% of real-world latent config errors at initialization.
  - Yin et al. (SOSP 2011): misconfigurations are "among the dominant causes of system failures".
  - Shore (2004): returning a default for a missing key led to "mysterious slowdowns", while failing fast pointed straight to the typo.
- **Evidence:**
  - [Early Detection of Configuration Errors to Reduce Failure Damage](https://www.usenix.org/system/files/conference/osdi16/osdi16-xu.pdf) — Xu, Jin, Huang, Zhou, Lu, Jin, Pasupathy, OSDI 2016 — peer_reviewed.
    - Quotes: "many (14.0%–93.2%) of these configurations do not have any special code for checking the correctness of their settings at the system's initialization time"; "help systems detect 75+% of real-world LC errors at the initialization phase".
    - Verification: confirmed from the PDF text.
  - [An empirical study on configuration errors in commercial and open source systems](https://doi.org/10.1145/2043556.2043572) — Yin, Ma, Zheng, Zhou, Bairavasundaram, Pasupathy, SOSP 2011 — peer_reviewed.
    - Quote: "Configuration errors (i.e., misconfigurations) are among the dominant causes of system failures."
    - Verification: confirmed from the abstract via OpenAlex.
  - [Fail Fast](https://www.martinfowler.com/ieeeSoftware/failFast.pdf) — Jim Shore, IEEE Software, Sep/Oct 2004 (Design column) — practitioner column.
    - Quotes: "encounter mysterious slowdowns. Figuring it out could take days"; "maxConnections property not found in c:\projects\..."; "30 seconds fixing the problem".
    - Verification: confirmed from the PDF text.
  - [The Twelve-Factor App: III. Config](https://12factor.net/config) — 12factor.net.
    - Quote: "An app's config is everything that is likely to vary between deploys".
    - Verification: confirmed.
  - [Pydantic Settings](https://pydantic.dev/docs/validation/latest/concepts/pydantic_settings/) — Pydantic, 2026 — official_docs.
    - Quote: "Settings are validated from environment variables and secrets files, so a ValidationError here points at an environment value that didn't match its field."
    - Verification: confirmed.
- **Detect:**
  - Count the files that read config: `rg -n 'os[.]environ|os[.]getenv[(]|process[.]env[.]|System[.]getenv[(]|os[.]Getenv[(]|std::env::var'`. Reads spread across more than one or two config modules are a finding.
  - Silent defaults: `rg -n 'process[.]env[.][A-Z_]+ *([|][|]|[?][?])'` and `rg -n 'getenv[(][^)]*,[^)]+[)]|environ[.]get[(][^)]*,'`.
  - Parsing at the point of use: `int()`, `parseInt()`, duration parsing.
  - Smoke test: run the app with an empty environment (`env -i <cmd>`). It must exit non-zero and list every missing key.
- **Tools:** ripgrep, ast-grep; pydantic-settings, zod or envconfig as the fix.
- **Applies to:** All services, bots and CLIs with configuration.
- **When not to apply / counterpoints:**
  - Optional settings can legitimately have defaults.
  - Checking at startup that a dependency is reachable is a different matter and can cause crash loops during short outages. Validate syntax and meaning at startup, and leave connectivity to readiness checks (F11).
- **Fix risk:** medium

### T28-F01 — Never log secrets or sensitive data; redact centrally
Never write any of the following into logs, error reports or crash dumps: credentials, session IDs, access tokens, connection strings, encryption keys, payment data or raw PII. Enforce this in one place:
- configure redaction in the logger;
- give secret config values a type that masks itself when printed.

Logging a whole request, all headers, a whole config object or the process environment counts as a violation.

- **Grade:** A · **Verdict:** CORRECTED
  - The Meta incident is described as the source describes it. The March 2019 post says "internal data storage systems". Its update of 18 Apr 2019 adds that Meta "discovered additional logs of Instagram passwords being stored in a readable format". The count refers to users notified, not to passwords.
  - "Practitioners report" becomes "one practitioner reports" (a single HN comment).
  - A real source was added for SecretStr, which the researcher had left uncited.
  - OWASP's list also includes "Application source code" and non-sensitive personal data.
- **Rationale:**
  - OWASP names these data classes as ones to remove, mask, sanitize, hash or encrypt before logging. CWE-532 and ASVS 5.0 16.2.5 (L2) make this a requirement.
  - Incidents:
    - 2018: GitHub's password-reset bug wrote plaintext passwords to internal logs.
    - 2019: Meta found passwords stored readably in internal storage, including logs, per its own update.
  - One practitioner names two leak routes: `{ meta: process.env }` in log calls, and crash reporters that dump the environment.
  - Central redaction is cheap for explicit paths; pino measures about 2%.
  - pydantic's SecretStr prints as asterisks in `repr()`/`str()`.
- **Evidence:**
  - [Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) — OWASP Cheat Sheet Series, living document — standard.
    - Quote: "should usually not be recorded directly in the logs, but instead should be removed, masked, sanitized, hashed, or encrypted". The list includes session identification values, access tokens, sensitive personal data and some PII, authentication passwords, database connection strings, encryption keys and other primary secrets, and bank account or payment card holder data.
    - Verification: confirmed.
  - [CWE-532: Insertion of Sensitive Information into Log File](https://cwe.mitre.org/data/definitions/532.html) — MITRE, CWE 4.20 (page updated 30 Apr 2026) — standard.
    - Quotes: "Do not write secrets into the log files"; observed example CVE-2017-9615: "verbose logging stores admin credentials in a world-readable log file".
    - Verification: confirmed.
  - [ASVS 5.0 V16](https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md) — OWASP, 2025 — standard.
    - Quote: 16.2.5 (L2): "...it may not be allowed to log certain data, such as credentials or payment details. Other data, such as session tokens, may only be logged by being hashed or masked, either in full or partially."
    - Verification: confirmed in the raw file.
  - [GitHub Accidentally Recorded Some Plaintext Passwords in Its Internal Logs](https://www.bleepingcomputer.com/news/security/github-accidentally-recorded-some-plaintext-passwords-in-its-internal-logs/) — BleepingComputer, 1 May 2018 — incident_report.
    - Quote from GitHub's notice: "this recently introduced bug resulted in our secure internal logs recording plaintext user passwords when users initiated a password reset".
    - Verification: confirmed.
  - [Keeping Passwords Secure](https://about.fb.com/news/2019/03/keeping-passwords-secure/) — Pedro Canahuati, Facebook (now Meta) Newsroom, 21 Mar 2019, updated 18 Apr 2019 — incident_report.
    - Quotes: "some user passwords were being stored in a readable format within our internal data storage systems"; notifications to "hundreds of millions of Facebook Lite users, tens of millions of other Facebook users, and tens of thousands of Instagram users"; update: "we discovered additional logs of Instagram passwords being stored in a readable format".
    - Verification: confirmed.
  - [CodeQL: Clear-text logging of sensitive information (py/clear-text-logging-sensitive-data)](https://codeql.github.com/codeql-query-help/python/py-clear-text-logging-sensitive-data/) — GitHub CodeQL, 2026 — official_docs.
    - Quote: "If sensitive data is written to a log entry it could be exposed to an attacker who gains access to the logs." Security severity 7.5; CWE-312, CWE-359, CWE-532.
    - Verification: confirmed.
    - The equivalent query-help pages for other languages exist: `js/clear-text-logging`, `java/sensitive-log` and `go/clear-text-logging`.
  - [Pino redaction docs](https://raw.githubusercontent.com/pinojs/pino/main/docs/redaction.md) — pino, 2026 — official_docs.
    - Quotes: "adds about 2% overhead to JSON.stringify when using paths without wildcards"; wildcard redaction costs "50% in a case where four keys are redacted across two objects".
    - Verification: confirmed.
  - [pydantic types: SecretStr](https://pydantic.dev/docs/validation/latest/api/pydantic/types/) — Pydantic, 2026 — official_docs.
    - Quote: "do not want to be visible in logging or tracebacks"; nonempty values are displayed as '**********'.
    - Verification: substituted source, confirmed.
  - [HN comment on "The Twelve-Factor App (2025)"](https://news.ycombinator.com/item?id=49481549) — nebezb, 28 Aug 2026 — practitioner_forum.
    - Quote: "Devs adding `{ meta: process.env }` to logs. Instrumentation/reporting libraries dumping the process (and the env) for crash reports."
    - Verification: confirmed via the HN Algolia API.
- **Detect:**
  - Run the CodeQL clear-text-logging query for each language.
  - `rg -n -i '(log|logger|logging|console|slog|zap|pino|winston)[.][a-z]+[(].*(passw|secret|token|api_?key|authorization|cookie|session|private_?key|dsn|connection_?string)'`
  - `rg -n -i 'process[.]env|os[.]environ|getenv'`, then flag any place that logs or serializes the whole environment, request, headers or config.
  - Scan a sample of real log output with `gitleaks dir <log-dir>`.
  - Check that redaction is configured centrally (pino `redact`, a structlog processor, logback masking) and that secret config fields use a masking type.
- **Tools:** CodeQL, ripgrep, gitleaks, pino redact, pydantic SecretStr.
- **Applies to:** All languages; services, CLIs, bots, and crash/error reporters.
- **When not to apply / counterpoints:**
  - OWASP allows masked, hashed or encrypted values, and audit logs still need to record who acted (a user ID).
  - Redacting by key name gives false positives (`token_count`) and misses secrets stored under generic keys.
  - Wildcard redaction in pino can cost about 50%.
  - SecretStr masks `repr()`/`str()`. Its behaviour in every serializer was not verified.
- **Fix risk:** low

### T28-F02 — Treat external input in logs as hostile, and keep logging libraries patched
Put external values into separate structured fields so the encoder escapes them, or strip/encode CR, LF and delimiters before writing plain-text logs. Never use external input as the format string. Keep logging libraries on a currently patched release, and do not enable lookups or templating on message content.

- **Grade:** A · **Verdict:** CORRECTED — the Log4j version floor was outdated.
  - The researcher cited CISA's December 2021 advice (2.17.1 / 2.12.4 / 2.3.2) as the target.
  - Apache's security page now lists 2025–2026 CVEs against Log4j Core/API:
    - CVE-2025-68161 (Socket appender TLS hostname verification), fixed in 2.25.3;
    - CVE-2026-34478, a **CRLF log injection** in `Rfc5424Layout` affecting 2.21.0–2.25.3, fixed in 2.25.4;
    - CVE-2026-34480 (XmlLayout), fixed in 2.25.4;
    - CVE-2026-49844 (log4j-api), fixed in 2.25.5 and 2.26.1.
  - Apache's page also now gives 2.17.0 (Java 8+), 2.12.3 (Java 7) and 2.3.1 (Java 6) as the fixed versions for the December 2021 follow-up CVEs, not CISA's numbers.
  - "At least 2.17.1" is therefore no longer a safe target. Check the Apache page at review time.
- **Rationale:**
  - CWE-117 describes log neutralization failures (log forging).
  - OWASP and ASVS 16.4.1 (L2) require encoding.
  - Log4Shell (CVE-2021-44228, CVSS 10.0) showed that the logger itself can be attack surface.
  - CVE-2026-34478 shows a logging library shipping a CRLF-injection bug of its own. Relying on the library to escape output only works if the library is patched.
- **Evidence:**
  - [CWE-117: Improper Output Neutralization for Logs](https://cwe.mitre.org/data/definitions/117.html) — MITRE, CWE 4.20 (page updated 30 Apr 2026) — standard.
    - Quote: "The product constructs a log message from external input, but it does not neutralize or incorrectly neutralizes special elements when the message is written to a log file."
    - Verification: confirmed.
  - [Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) — OWASP — standard.
    - Quote: "Perform sanitization on all event data to prevent log injection attacks e.g. carriage return (CR), line feed (LF) and delimiter characters".
    - Verification: confirmed.
  - [ASVS 5.0 V16](https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md) — OWASP, 2025 — standard.
    - Quote: 16.4.1 (L2): "Verify that all logging components appropriately encode data to prevent log injection."
    - Verification: confirmed.
  - [CodeQL: Log Injection (py/log-injection)](https://codeql.github.com/codeql-query-help/python/py-log-injection/) — GitHub CodeQL, 2026 — official_docs.
    - Quote: "If unsanitized user input is written to a log entry, a malicious user may be able to forge new log entries." Severity 6.1; CWE-117.
    - Verification: confirmed.
    - Pages for other languages exist, and their titles were checked: `js/log-injection`, `java/log-injection`, `go/log-injection`, `rb/log-injection`, `cs/log-forging`.
  - [Apache Logging Services security page](https://logging.apache.org/security.html) — Apache Software Foundation, live page — official_docs.
    - Quotes: CVE-2021-44228: "An attacker who can control log messages or log message parameters can execute arbitrary code loaded from LDAP servers.", CVSS 10.0 CRITICAL. CVE-2026-34478: "Rfc5424Layout, in versions 2.21.0 through 2.25.3, is vulnerable to log injection via CRLF sequences"; fixed in 2.25.4.
    - Verification: confirmed in the page text fetched on 2026-09-23.
  - [Apache Log4j Vulnerability Guidance](https://www.cisa.gov/news-events/news/apache-log4j-vulnerability-guidance) — CISA, updated 28 Dec 2021 (page last updated 8 Apr 2022) — standard.
    - Quote: "upgrade to Log4j 2.17.1 (Java 8), 2.12.4 (Java 7) and 2.3.2 (Java 6)".
    - Verification: confirmed (read via WebFetch, since a direct fetch returned 403). This is historical guidance.
- **Detect:**
  - Run the CodeQL log-injection query for each language.
  - Heuristic grep: `rg -n '(log|logger)[.](debug|info|warn|warning|error)[(][^,)]*[+].*(req|request|params|query|body|headers|input|args)'`.
  - Check that request-derived data goes through a structured/JSON logger.
  - Java: `mvn dependency:tree | rg log4j` or `gradle dependencies`. Compare log4j-core and log4j-api with the fixed versions on the Apache security page (2.25.5 / 2.26.1 as of Sep 2026).
  - Run an SCA/OSV scanner for other logging libraries.
  - Look for logger features that interpret message content (lookups, templating).
- **Tools:** CodeQL, ripgrep, dependency-tree tools (mvn/gradle/npm ls/pip freeze), an SCA/OSV scanner.
- **Applies to:** All languages. Highest priority for internet-facing services and for bots that log chat or user messages.
- **When not to apply / counterpoints:**
  - If the logger already JSON-encodes fields, stripping CR/LF by hand double-encodes and loses fidelity.
  - HTML encoding only matters when logs are shown in a web viewer.
- **Fix risk:** low

### T28-F04 — Explicit timeouts on every network or IPC call, with deadline propagation
Every network or IPC call needs an explicit connect timeout and a request (or overall) timeout: HTTP, RPC, database, cache, queue, SMTP and subprocess calls. Do not rely on library defaults. Pass the caller's remaining deadline down to downstream calls, and set read, write and idle timeouts on server listeners.

- **Grade:** A · **Verdict:** CORRECTED
  - Python `requests` timeouts are *not* wall-clock totals. The docs say "Neither the connect nor read timeouts are wall clock". A server with both IPv4 and IPv6 addresses can double the effective connect timeout. A true total deadline needs another mechanism.
  - Go's `Client.Timeout` does cover connection, redirects and reading the body.
  - The nirui practitioner item was about missing retry/resume on unreliable networks, not about overly aggressive timeouts. It is reworded.
  - Vitillo's post, mentioned without a link in the researcher's contradictions, was located and verified.
- **Rationale:**
  - AWS REL05-BP05 (risk if not established: High) warns that some libraries default to infinite timeouts.
  - `requests` never times out unless told to. In Go, a zero `Client.Timeout` means none, and `http.Get` uses `DefaultClient`, which has no timeout.
  - Dai et al. list "missing timeout" among the root causes of timeout bugs, and 60% of timeout bugs produce no error message.
  - The SRE book: set one deadline high in the stack and propagate what remains of it.
- **Evidence:**
  - [REL05-BP05 Set client timeouts](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_mitigate_interaction_failure_client_timeouts.html) — AWS Well-Architected, Reliability Pillar — official_docs.
    - Quotes: "Set both a connection timeout and a request timeout on any service dependency call"; "some have default values that are infinite or higher than acceptable for your service goals"; risk: High. Anti-pattern: "Setting timeouts too low, resulting in artificial failures".
    - Verification: confirmed.
  - [Requests: Advanced Usage — Timeouts](https://requests.readthedocs.io/en/latest/user/advanced/#timeouts) — requests, 2026 — official_docs.
    - Quotes: "Most requests to external servers should have a timeout attached"; "By default, requests do not time out unless a timeout value is set explicitly. Without a timeout, your code may hang for minutes or more."; "Neither the connect nor read timeouts are wall clock."
    - Verification: confirmed.
  - [net/http package](https://pkg.go.dev/net/http) — The Go Authors, 2026 — official_docs.
    - Quotes: `Client.Timeout`: "The timeout includes connection time, any redirects, and reading the response body"; "A Timeout of zero means no timeout."; "DefaultClient is the default Client and is used by Get, Head, and Post."
    - Verification: confirmed.
  - [The complete guide to Go net/http timeouts](https://blog.cloudflare.com/the-complete-guide-to-golang-net-http-timeouts/) — Filippo Valsorda (Cloudflare), 2016 — engineering_blog.
    - Quote: "the package level functions such as http.Get use a Client without timeouts, so are dangerous to use on the open Internet".
    - Verification: confirmed.
  - [Understanding Real-World Timeout Problems in Cloud Server Systems](https://doi.org/10.1109/ic2e.2018.00022) — Ting Dai, Jingzhu He, Xiaohui Gu, Shan Lu, IC2E 2018 — peer_reviewed.
    - Quotes: 11 cloud server systems; root causes "misused timeout, missing timeout, improper timeout handling, unnecessary timeout, and clock drifting"; "60% of the bugs do not produce any error messages and 12% bugs produce misleading error messages".
    - Verification: confirmed from the abstract only (OpenAlex).
  - [Addressing Cascading Failures](https://sre.google/sre-book/addressing-cascading-failures/) — Google, SRE book, 2016 — book (free online).
    - Quotes: "Setting either no deadline or an extremely high deadline may cause short-term problems that have long since passed to continue to consume server resources"; server A picks a 30-second deadline and spends 7 seconds, so its RPC to B gets "a 23-second deadline".
    - Verification: confirmed.
  - [Bandit B113 request_without_timeout](https://bandit.readthedocs.io/en/latest/plugins/b113_request_without_timeout.html) — PyCQA, 2026 — official_docs.
    - Quotes: checks "for requests or httpx calls without a timeout specified"; the example output also flags "timeout set to None" (MEDIUM severity, LOW confidence).
    - Verification: confirmed.
  - [Pylint W3101 missing-timeout](https://pylint.readthedocs.io/en/stable/user_guide/messages/warning/missing-timeout.html) — PyCQA — official_docs.
    - Quote: "Missing timeout argument for method '%s' can cause your program to hang indefinitely". Configurable via `timeout-methods`.
    - Verification: confirmed.
  - [Don't trust default timeouts](https://robertovitillo.com/default-timeouts/) — Roberto Vitillo, 3 May 2020 — engineering_blog.
    - Quote: "As a rule of thumb, always set timeouts when making network calls. And if you build libraries, always set reasonable default timeouts and make them configurable for your clients."
    - Verification: added and confirmed.
- **Detect:**
  - Python: `bandit -r . -t B113`, and Pylint W3101 with other clients added to `timeout-methods`.
  - Go: golangci-lint `noctx` and `contextcheck` (both confirmed in the linter list), plus `rg -n 'http[.](Get|Post|Head|PostForm)[(]|http[.]DefaultClient|&http[.]Client[{][}]|http[.]ListenAndServe[(]'`.
  - JS/TS: for each `fetch(`, check for a `signal:` (for example `AbortSignal.timeout`), and check the timeout options on axios/got/undici instances.
  - Databases: check connect and statement timeouts on the driver or pool.
  - Build a table of every outbound dependency with its configured timeout and its observed p99 latency.
- **Tools:** Bandit B113, Pylint W3101, golangci-lint noctx/contextcheck, ripgrep.
- **Applies to:** Services, workers, bots and CLIs that make network calls; all languages.
- **When not to apply / counterpoints:**
  - Timeouts that are too low create artificial failures and retry storms (an AWS anti-pattern).
  - Streams and large downloads need idle or progress timeouts plus resume, not a short total timeout.
  - hodgesrm (HN) argues that forcing callers to pick timeouts pushes a hard problem onto the party with the least information.
  - Long-running jobs need cancellation rather than a short timeout.
- **Fix risk:** medium

### T28-F05 — Retries: bounded, jittered backoff, only transient errors, only idempotent operations, one layer
Retries must meet all of these conditions:
- they are bounded, by a maximum number of attempts or a total elapsed time;
- they use exponential backoff with jitter (for example full jitter: `sleep = random_between(0, min(cap, base * 2 ** attempt))`);
- they retry only transient errors, never auth, permission or validation errors;
- they wrap only idempotent operations, or operations protected by an idempotency key;
- they happen at exactly one layer of the stack.

Prefer the SDK's or a vetted library's retry to a hand-written loop.

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - AWS REL05-BP03 (risk: High) lists every one of these violations as an anti-pattern. It also lists "Developing custom retry mechanisms when built-in or third-party retry capabilities suffice".
  - The SRE book shows how retries multiply. With 4 attempts at each of the backend, frontend and JavaScript layers, one user action makes 64 attempts on the database. It suggests a server-wide retry budget.
  - Brooker: exponential backoff without jitter is "the clear loser". The post carries a May 2023 update saying the approach still holds.
  - In the June 2025 Google Cloud incident, the missing randomized exponential backoff created a herd effect on a Spanner table. Recovery in us-central-1 took up to about 2 h 40 min.
- **Evidence:**
  - [REL05-BP03 Control and limit retry calls](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_mitigate_interaction_failure_limit_retries.html) — AWS Well-Architected — official_docs.
    - Quotes: "Implementing retries without adding exponential backoff, jitter, and maximum retry values"; "implement retries at only one level"; "Retrying service calls that are not idempotent"; "custom retry mechanisms"; risk: High.
    - Verification: confirmed.
  - [Addressing Cascading Failures](https://sre.google/sre-book/addressing-cascading-failures/) — Google, SRE book, 2016 — book.
    - Quotes: "Always use randomized exponential backoff when scheduling retries."; "only allow 60 retries per minute in a process"; "a single user action may create 64 attempts (4^3) on the database".
    - Verification: confirmed.
  - [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) — Marc Brooker, AWS Architecture Blog, 4 Mar 2015 (updated May 2023) — engineering_blog.
    - Quote: "The no-jitter exponential backoff approach is the clear loser. It not only takes more work, but also takes more time than the jittered approaches."
    - Verification: confirmed. The Full Jitter formula is an image (figure 6), viewed directly: `sleep = random_between(0, min(cap, base * 2 ** attempt))`.
  - [Google Cloud Service Health incident report](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) — Google Cloud, 12 Jun 2025 — incident_report.
    - Quotes: "it created a herd effect on the underlying infrastructure it depends on (i.e. that Spanner table)"; "Service Control did not have the appropriate randomized exponential backoff implemented to avoid this"; "It took up to ~2h 40 mins to fully resolve in us-central-1".
    - Verification: confirmed.
- **Detect:**
  - List every retry site: `rg -n -i 'retry|retries|backoff|tenacity|p-retry|resilience4j|urllib3.*Retry|retry_on'`.
  - Hand-written loops: `rg -n -A12 'while (True|true)|for .*(attempt|retry)' | rg 'sleep|setTimeout|time[.]Sleep'`. Look for a constant sleep, no maximum, or no jitter.
  - For each site, check which errors trigger a retry (4xx should not) and whether the operation is idempotent.
  - Check whether the SDK already retries by default (AWS SDK, gRPC, urllib3) while the app wraps it in another retry.
- **Tools:** ripgrep, semgrep/ast-grep custom patterns, manual review.
- **Applies to:** Any code that calls remote services, exchanges or APIs; bots and workers especially.
- **When not to apply / counterpoints:**
  - Retrying a non-idempotent call without an idempotency key is unsafe (F06).
  - For interactive requests, failing fast can beat a slow retried success.
  - Retry budgets and circuit breakers may be more than a small single-tenant bot needs, but bounded, jittered backoff still applies.
- **Fix risk:** medium

### T28-F09 — No secrets in source, artifacts, images or git history; scan history and rotate
No secret may appear in source code, build artifacts, container images or git history. Scan the full history, and rotate every secret found: deleting it from HEAD is not enough. Load secrets from a secret manager or a mounted file. Environment variables are an acceptable fallback, but they leak easily. CLIs should not take secrets through flags.

- **Grade:** A · **Verdict:** CORRECTED
  - **ASVS 13.3.1** is quoted in full context. Its main clause requires "a secrets management solution, such as a key vault", with a hardware-backed solution (HSM) at L3. The "must not be included in source code or build artifacts" sentence sits inside that requirement.
  - **GitGuardian's 64%** is the share of *valid* secrets detected in 2022 that were still active four years later. It is not 64% of all detected secrets. All GitGuardian figures are vendor data.
  - **gitleaks:** the README's pre-commit example pins v8.24.2, but the latest release is v8.30.1. Do not copy the pin. `gitleaks git` runs `git log -p -U0 --full-history --all` by default (checked in `sources/git.go`), so it covers every ref.
  - **zbentley link:** corrected from 49483591 (which is tptacek's comment) to 49484011.
- **Rationale:**
  - The twelve-factor litmus test: the code could be made open source "at any moment, without compromising any credentials".
  - GitGuardian's 2026 report:
    - 28,649,024 new secrets on public GitHub in 2025 (+34%);
    - 64% of the valid secrets found in 2022 still active in 2026;
    - 32.2% of internal repositories (vs 5.6% of public) contain at least one secret;
    - commits co-authored by Claude Code leak secrets at about twice the baseline rate.
  - OWASP and clig.dev warn that environment variables reach child processes, logs and dumps.
- **Evidence:**
  - [The Twelve-Factor App: III. Config](https://12factor.net/config) — 12factor.net.
    - Quote: "whether the codebase could be made open source at any moment, without compromising any credentials".
    - Verification: confirmed.
  - [ASVS 5.0 V13 Configuration](https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x22-V13-Configuration.md) — OWASP, 2025 — standard.
    - Quote: 13.3.1 (L2): "Verify that a secrets management solution, such as a key vault, is used to securely create, store, control access to, and destroy backend secrets. ... Secrets must not be included in application source code or included in build artifacts. For an L3 application, this must involve a hardware-backed solution such as an HSM."
    - Verification: confirmed in the raw file.
  - [State of Secrets Sprawl 2026](https://www.gitguardian.com/state-of-secrets-sprawl-report-2026) — GitGuardian, 2026 — industry_report.
    - Quotes: "28,649,024" and "34%" new secrets in public GitHub commits in 2025; "We tracked valid secrets detected in 2022. Four years later, 64% are still active and exploitable"; 32.2% of internal vs 5.6% of public repositories; "Claude Code co-authored commits leak secrets at ~2× the baseline across all public GitHub commits".
    - Verification: confirmed on the landing page. The method was not examined.
  - [Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) — OWASP — standard.
    - Quote: "environment variables are generally accessible to all processes and may be included in logs or system dumps".
    - Verification: confirmed.
  - [Command Line Interface Guidelines](https://clig.dev/) — Prasad, Firshman, Tashian, Parish — practitioner guide.
    - Quotes: "Do not read secrets directly from flags. ... the flag value will leak the secret into ps output and potentially shell history."; "Do not read secrets from environment variables. While environment variables may be convenient for storing secrets, they have proven too prone to leakage: Exported environment variables are sent to every process, and from there can easily leak into logs or be exfiltrated".
    - Verification: confirmed.
  - [gitleaks](https://github.com/gitleaks/gitleaks) — gitleaks, 2026 — official_docs.
    - Quotes: "gitleaks uses the `git log -p` command to scan patches"; `gitleaks dir` scans directories and files; `--redact`.
    - Verification: confirmed. Latest release v8.30.1; the repo is active.
  - [TruffleHog](https://github.com/trufflesecurity/trufflehog) — Truffle Security, 2026 — official_docs.
    - Quotes: "it can also log in to confirm if that secret is live or not"; `--results=verified`.
    - Verification: confirmed. Latest release v3.97.6; the repo is active.
- **Detect:**
  - `gitleaks git -v --redact` on the full history (all refs by default); `gitleaks dir .` on the working tree, including untracked files.
  - `trufflehog git <repo-url> --results=verified` to rank live credentials first.
  - `git ls-files | rg '(^|/)[.]env($|[.])'`, and check `.gitignore`.
  - Literal-secret grep: `rg -n -i '(api_?key|secret|passw(or)?d|token)[[:space:]]*[:=][[:space:]]*[A-Za-z0-9/+_-]{16,}'`.
  - Dockerfile `ARG`/`ENV` lines that carry secrets; CLI `--password`/`--token` flags.
- **Tools:** gitleaks, trufflehog, ripgrep, GitHub secret scanning / push protection.
- **Applies to:** Every repository; all languages.
- **When not to apply / counterpoints:**
  - Environment variables remain the pragmatic standard on PaaS and in twelve-factor apps.
  - tptacek calls in-memory secret encryption "saffron-grade security" and says `unsetenv(3)` is probably enough.
  - zbentley replies that `unsetenv` does not modify the process environment block, so it stays readable through `/proc/self/environ`. He agrees the risk does not justify encrypting runtime secret stores.
  - Test fixtures cause false positives; use allowlists.
  - Rewriting history is destructive and needs explicit owner approval. Rotation is the actual fix.
- **Fix risk:** high

### T28-F13 — Scope every closeable resource (with / try-with-resources / using / defer / RAII)
Acquire every closeable resource in a construct tied to a scope, so it is released on every path, exceptions included. This covers files, sockets, HTTP response bodies, DB connections/cursors/rows, locks, temp directories and subprocesses. Long-lived shared clients and pools are the exception: create them once and close them at shutdown.

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** The official docs for Java, Go and `requests` all require this, and linters detect it.
- **Evidence:**
  - [The try-with-resources Statement](https://docs.oracle.com/javase/tutorial/essential/exceptions/tryResourceClose.html) — Oracle Java Tutorials — official_docs.
    - Quote: "The try-with-resources statement ensures that each resource is closed at the end of the statement."
    - Verification: confirmed.
  - [Pylint R1732 consider-using-with](https://pylint.readthedocs.io/en/stable/user_guide/messages/refactor/consider-using-with.html) — PyCQA — official_docs.
    - Quote: "Consider using 'with' for resource-allocating operations".
    - Verification: confirmed.
  - [net/http package](https://pkg.go.dev/net/http) — The Go Authors — official_docs.
    - Quotes: "The caller must close the response body when finished with it"; if the Body is not both read to EOF and closed, the transport "may not be able to re-use a persistent TCP connection".
    - Verification: confirmed.
  - [golangci-lint linters](https://golangci-lint.run/docs/linters/) — golangci-lint — official_docs.
    - Quotes: bodyclose: "Checks whether HTTP response body is closed successfully."; `sqlclosecheck` and `rowserrcheck` are listed.
    - Verification: confirmed.
  - [Requests: Body Content Workflow](https://requests.readthedocs.io/en/latest/user/advanced/) — requests — official_docs.
    - Quote: "Requests cannot release the connection back to the pool unless you consume all the data or call Response.close."
    - Verification: confirmed.
- **Detect:**
  - Python: Pylint R1732; `rg -n 'stream=True'` and check each has a `with` block.
  - Go: golangci-lint bodyclose, sqlclosecheck, rowserrcheck.
  - Java: `rg -n 'new (FileInputStream|FileOutputStream|FileReader|BufferedReader|Socket|RandomAccessFile)[(]'` outside try-with-resources.
  - C++: raw `fopen`/`malloc`/`new` where an RAII wrapper belongs.
- **Tools:** Pylint R1732, golangci-lint bodyclose/sqlclosecheck/rowserrcheck, ripgrep.
- **Applies to:** All languages.
- **When not to apply / counterpoints:**
  - Do not wrap long-lived shared clients or pools per call; closing them each time defeats pooling.
  - A function that returns an open stream and hands ownership to the caller is fine if documented.
- **Fix risk:** low

### T28-F14 — Route operational output through one configured logging library; emit structured records
Services, bots and libraries send operational output through a logging library configured once, at the entrypoint. It emits structured key-value records (machine-parseable in production, readable in development) to stdout/stderr. That means:
- no `print`, `console.log` or `fmt.Println` for diagnostics;
- no handlers installed by libraries;
- one named logger per module.

- **Grade:** A · **Verdict:** CORRECTED — the scottlamb counterpoint is reworded.
  - He was describing one log viewer, lnav: its JSON format definitions did not display or filter attributes the definition had not anticipated.
  - He partly retracted after finding `"hide-extra": false`.
  - It is not evidence of a general cost of structured logs.
- **Rationale:**
  - Go's slog announcement: key-value logs can be parsed, filtered, searched and analyzed reliably.
  - The Python HOWTO: libraries add only NullHandler and never log to the root logger.
  - Twelve-factor: each process writes an unbuffered event stream to stdout and leaves routing to the environment.
  - ASVS 16.2.4 (L2): use a format the log processor can read and correlate.
  - Ruff T201: print statements can leak sensitive data, and clients cannot configure them.
- **Evidence:**
  - [Structured Logging with slog](https://go.dev/blog/slog) — Jonathan Amsterdam, Go blog, 22 Aug 2023 — official_docs.
    - Quote: "Structured logs use key-value pairs so they can be parsed, filtered, searched, and analyzed quickly and reliably."
    - Verification: confirmed.
  - [Logging HOWTO](https://docs.python.org/3/howto/logging.html) — Python Software Foundation — official_docs.
    - Quotes: "It is strongly advised that you do not add any handlers other than NullHandler to your library's loggers."; "it is strongly advised that you do not log to the root logger in your library".
    - Verification: confirmed.
  - [The Twelve-Factor App: XI. Logs](https://12factor.net/logs) — 12factor.net.
    - Quotes: "A twelve-factor app never concerns itself with routing or storage of its output stream."; "each running process writes its event stream, unbuffered, to stdout".
    - Verification: confirmed.
  - [ASVS 5.0 V16](https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md) — OWASP, 2025 — standard.
    - Quote: 16.2.4 (L2): "Verify that logs can be read and correlated by the log processor that is in use, preferably by using a common logging format."
    - Verification: confirmed.
  - [Ruff T201 print](https://docs.astral.sh/ruff/rules/print/) — Astral — official_docs.
    - Quotes: "They can lead the accidental inclusion of sensitive information in logs, and are not configurable by clients"; "print statements used to produce output as a part of a command-line interface program are not typically a problem". The autofix is unsafe.
    - Verification: confirmed.
  - [ESLint no-console](https://eslint.org/docs/latest/rules/no-console) — ESLint — official_docs.
    - Quote: "If you are developing for Node.js then you most likely do not want this rule enabled."
    - Verification: confirmed. The rule is browser-oriented.
- **Detect:**
  - Python: Ruff T201. JS/TS browser or library code: ESLint no-console.
  - Go: golangci-lint `forbidigo` (forbid `fmt.Print*`/`log.Print*` outside CLI packages) and `sloglint`. Both are confirmed in the linter list.
  - Any language: `rg -n '^[[:space:]]*(print[(]|console[.](log|debug|info)[(]|fmt[.]Print|System[.](out|err)[.]print)'`, excluding modules that produce CLI output.
  - Python libraries: `rg -n 'logging[.]basicConfig|addHandler[(]'` outside the entrypoint, and `rg -n 'logging[.](debug|info|warning|error)[(]'` to find root-logger use.
- **Tools:** Ruff T201, ESLint no-console, golangci-lint forbidigo/sloglint, ripgrep.
- **Applies to:** Services, bots and libraries in all languages. For CLIs, only diagnostic output, not primary output.
- **When not to apply / counterpoints:**
  - CLI primary output legitimately uses stdout and print.
  - JSON logs are harder to read locally; use a development renderer. Some viewers need configuration to show attributes they did not anticipate.
  - The benefit of structured logs is argued by standards and practice, not measured (see open questions).
- **Fix risk:** medium

### T28-F15 — Pass log data as arguments or fields; don't pre-format; guard expensive arguments
Pass log data as arguments or fields, not as a pre-formatted message: no f-strings, concatenation or template literals inside log calls. Wrap genuinely expensive argument computation in an is-enabled check, and use the allocation-light API on hot paths.

- **Grade:** A · **Verdict:** VERIFIED. The side claim that a fixed template "groups better in log search" is reasoning with no source.
- **Rationale:**
  - Python defers formatting until it cannot be avoided, and documents `isEnabledFor()` for expensive arguments.
  - Ruff G004: an f-string forces eager formatting even when the record is never emitted.
  - slog's `LogAttrs` and `Attr` minimize allocations.
- **Evidence:**
  - [Logging HOWTO: Optimization](https://docs.python.org/3/howto/logging.html) — Python Software Foundation — official_docs.
    - Quote: "Formatting of message arguments is deferred until it cannot be avoided. However, computing the arguments passed to the logging method can also be expensive"; `isEnabledFor()`.
    - Verification: confirmed.
  - [Ruff G004 logging-f-string](https://docs.astral.sh/ruff/rules/logging-f-string/) — Astral — official_docs.
    - Quote: "using f-strings to format a logging message requires that Python eagerly format the string, even if the logging statement is never executed".
    - Verification: confirmed. Sibling rules G001, G002 and G003 exist.
  - [Structured Logging with slog](https://go.dev/blog/slog) — Go blog, 2023 — official_docs.
    - Quote: "These work together to minimize memory allocations."
    - Verification: confirmed.
- **Detect:**
  - Python: Ruff G001–G004, or `rg -n 'log(ger)?[.](debug|info|warning|error|exception|critical)[(]f.'`.
  - JS: ``rg -n 'logger?[.](debug|info|warn|error)[(]`'``.
  - Java: `rg -n 'LOG(GER)?[.](debug|trace)[(][^)]*[+]'`.
  - Review debug statements inside loops for expensive arguments.
- **Tools:** Ruff G00x, ripgrep.
- **Applies to:** Python, Java and Go; JS loggers that accept objects (pino, winston).
- **When not to apply / counterpoints:**
  - Lazy formatting still evaluates the arguments; only the formatting is deferred.
  - At always-on levels the gain is consistency, not speed.
- **Fix risk:** low

### T28-F18 — Put correlation context on every log record and propagate traceparent
Every log record emitted while handling a request, job or message must carry:
- a trace_id/span_id (W3C Trace Context) or a request ID;
- the service name, version and instance;
- a UTC or explicit-offset timestamp.

Outbound calls must propagate `traceparent`.

- **Grade:** A · **Verdict:** VERIFIED. service.name's *Required* level is confirmed; its stability badge could not be read as text.
- **Rationale:**
  - W3C Trace Context is a Recommendation (23 Nov 2021; it includes editorial updates since the 6 Feb 2020 Recommendation).
  - The OpenTelemetry LogRecord (Stable) defines TraceId, SpanId and Resource.
  - The semantic conventions make service.name Required.
  - ASVS 16.2.1 and 16.2.2 (L2) require when/where/who/what metadata and UTC or explicit-offset timestamps.
- **Evidence:**
  - [Trace Context](https://www.w3.org/TR/trace-context/) — W3C Recommendation, 23 Nov 2021 — standard.
    - Quote: "This specification defines standard HTTP headers and a value format to propagate context information that enables distributed tracing scenarios."
    - Verification: confirmed.
  - [OpenTelemetry Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/) — OpenTelemetry, spec 1.61.0 — standard.
    - Quotes: "Status: Stable"; TraceId: "Request trace ID as defined in W3C Trace Context".
    - Verification: confirmed.
  - [Semantic conventions: Service](https://opentelemetry.io/docs/specs/semconv/resource/service/) — OpenTelemetry — standard.
    - Quote: "service.name required string Logical name of the service"; service.version is Recommended.
    - Verification: confirmed.
  - [ASVS 5.0 V16](https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md) — OWASP, 2025 — standard.
    - Quotes: 16.2.1: "each log entry includes necessary metadata (such as when, where, who, what)"; 16.2.2: "timestamps in security event metadata use UTC or include an explicit time zone offset".
    - Verification: confirmed.
  - [A Practitioner's Guide to Wide Events](https://jeremymorrell.dev/blog/a-practitioners-guide-to-wide-events/) — Jeremy Morrell, 22 Oct 2024 — engineering_blog.
    - Content: recommends fields including service.version, service.build.git_hash, http.route, user.id, feature_flag.* and sample_rate.
    - Verification: confirmed.
- **Detect:**
  - Trace one request end to end. Every log line it produces should carry the same trace or request ID plus the service name and version.
  - `rg -n -i 'traceparent|trace_id|request_id|correlation|MDC[.]put|contextvars|AsyncLocalStorage|opentelemetry'`. No mechanism at all in a multi-service or async system is a finding.
  - Check the timestamp format (ISO 8601 with Z or an offset).
  - Check that outbound HTTP/gRPC clients are instrumented or forward `traceparent`.
- **Tools:** OpenTelemetry SDK/instrumentation, ripgrep, manual request trace.
- **Applies to:** Services and workers, especially multi-service or async ones.
- **When not to apply / counterpoints:**
  - For a small single-process CLI this adds little.
  - A request-ID field carried in context covers most of the value without adopting full OpenTelemetry.
- **Fix risk:** low

### T28-F21 — Log security-relevant events (who/what/when/where), never their credentials
Log authentication successes and failures, authorization failures, input-validation failures and changes to security configuration, with who/what/when/where. Never log the credentials involved (F01).

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - OWASP says to "always log" these events "where possible".
  - ASVS 5.0 16.3.1 and 16.3.2 (L2) make them requirements. At L3, every authorization decision must be logged.
  - ASVS treats security logs as distinct from error and performance logs.
- **Evidence:**
  - [Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) — OWASP — standard.
    - Quotes: "Where possible, always log" input validation failures and "Authentication successes and failures"; "The application logs must record 'when, where, who and what' for each event."
    - Verification: confirmed.
  - [ASVS 5.0 V16](https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md) — OWASP, 2025 — standard.
    - Quotes: 16.3.1: "Verify that all authentication operations are logged, including successful and unsuccessful attempts."; 16.3.2: "Verify that failed authorization attempts are logged. For L3, this must include logging all authorization decisions"; "Security logs are distinct from error or performance logs".
    - Verification: confirmed.
- **Detect:** `rg -n -i 'login|authenticate|sign_?in|verify_password|check_password|jwt[.]verify|forbidden|unauthori[sz]ed|permission|authorize|40[13]'`. Then confirm that every success and failure branch logs the actor or key ID, source, outcome and time, and does not log the secret.
- **Tools:** ripgrep, manual review.
- **Applies to:** Services with authentication or authorization; bots that hold API keys (log the key ID, not the key).
- **When not to apply / counterpoints:**
  - Does not apply to single-user local CLIs without authentication.
  - On public endpoints, rate-limit validation-failure logs to prevent log flooding.
- **Fix risk:** low

### T28-F10 — Graceful shutdown on SIGTERM/SIGINT, and make sure the signal reaches the app
Long-running processes (servers, workers, bots) must handle SIGTERM and SIGINT in this order:
1. Stop taking new work and fail readiness.
2. Drain in-flight work within a bounded timeout shorter than the platform's grace period (the Kubernetes default is 30 s).
3. Return unfinished jobs to the queue.
4. Flush logs and telemetry, and close connections.
5. Exit with the right code.

Use exec-form ENTRYPOINT/CMD, or an init process, so the application actually receives the signal.

- **Grade:** A · **Verdict:** CORRECTED
  - Kubernetes sends TERM unless the image defines a different STOPSIGNAL, which many container runtimes honour.
  - The "about 15 s" pre-shutdown delay is learnkube's recommendation and one HN report, not a measured value.
  - A Node.js source was added for the claim that installing a signal listener removes the default exit.
- **Rationale:**
  - Kubernetes sends TERM, waits the grace period (30 s by default), then sends KILL.
  - Endpoint removal and pod deletion happen in parallel, so traffic can keep arriving after SIGTERM.
  - A shell-form ENTRYPOINT runs under `/bin/sh -c`, which does not pass signals on.
  - When Go's `Server.Shutdown` is called, `ListenAndServe` returns `ErrServerClosed` immediately, so `main` must wait for `Shutdown` to return.
  - Twelve-factor requires graceful shutdown on SIGTERM, and a worker must return its current job to the queue.
- **Evidence:**
  - [Pod Lifecycle (source)](https://raw.githubusercontent.com/kubernetes/website/main/content/en/docs/concepts/workloads/pods/pod-lifecycle.md) — Kubernetes documentation, 2026 — official_docs.
    - Quotes: "first sending a TERM (aka. SIGTERM) signal, with a grace period timeout, to the main process in each container"; "many container runtimes respect the `STOPSIGNAL` value defined in the container image and, if different, send the container image configured STOPSIGNAL instead of TERM"; "the KILL signal is sent to any remaining processes"; the default grace period is 30 seconds; "Terminating endpoints always have their `ready` status as `false`".
    - Verification: confirmed.
  - [Dockerfile reference](https://docs.docker.com/reference/dockerfile/) — Docker, 2026 — official_docs.
    - Quote: shell form "starts your ENTRYPOINT as a subcommand of /bin/sh -c, which does not pass signals. This means that the executable will not be the container's PID 1, and will not receive Unix signals."
    - Verification: confirmed.
  - [The Twelve-Factor App: IX. Disposability](https://12factor.net/disposability) — 12factor.net.
    - Quotes: "Processes shut down gracefully when they receive a SIGTERM signal"; "For a worker process, graceful shutdown is achieved by returning the current job to the work queue"; "robust against sudden death".
    - Verification: confirmed.
  - [Graceful shutdown in Kubernetes](https://learnkube.com/graceful-shutdown) — Daniele Polencic, learnkube, April 2024 — engineering_blog.
    - Quote: "the events start in parallel. And this could cause quite a few race conditions". Suggests a wait of about 15 seconds or a preStop hook.
    - Verification: confirmed.
  - [net/http Server.Shutdown](https://pkg.go.dev/net/http) — The Go Authors — official_docs.
    - Quote: "When Shutdown is called, Serve, ListenAndServe, and ListenAndServeTLS immediately return ErrServerClosed. Make sure the program doesn't exit and waits instead for Shutdown to return."
    - Verification: confirmed.
  - [Node.js process: signal events](https://nodejs.org/api/process.html) — Node.js, 2026 — official_docs.
    - Quote: "If one of these signals has a listener installed, its default behavior will be removed."
    - Verification: added source, confirmed.
  - [Command Line Interface Guidelines](https://clig.dev/) — clig.dev — practitioner guide.
    - Quote: "If a user hits Ctrl-C (the INT signal), exit as soon as possible ... Add a timeout to any clean-up code so it can't hang forever."
    - Verification: confirmed.
- **Detect:**
  - Shutdown handlers: `rg -n 'SIGTERM|SIGINT|signal[.]Notify|signal[.]NotifyContext|signal[.]signal[(]|process[.]on[(].SIG|addShutdownHook|on_shutdown|lifespan|Shutdown[(]ctx'`. A long-running process with no match is a finding.
  - Shell-form entrypoints: `rg -n '^(CMD|ENTRYPOINT) +[^[]' --glob 'Dockerfile*'`, or hadolint DL3025 ("Use arguments JSON notation for CMD and ENTRYPOINT arguments", confirmed in the hadolint README).
  - Go: find `ListenAndServe(` without `Server.Shutdown`.
  - Compare the drain timeout with `terminationGracePeriodSeconds` or systemd `TimeoutStopSec`.
  - Manual test: start a slow request, run `kill -TERM <pid>`, then check that the request completes, jobs are re-queued, logs are flushed, and the process exits in time.
- **Tools:** ripgrep, hadolint DL3025, a manual `kill -TERM` test.
- **Applies to:** Servers, queue workers, trading/chat bots and daemons, whether containerized or managed by systemd.
- **When not to apply / counterpoints:**
  - Graceful shutdown does not replace idempotency. Twelve-factor also requires robustness against sudden death.
  - Short CLIs should exit quickly on Ctrl-C rather than drain.
  - A preStop sleep makes rollouts longer.
- **Fix risk:** medium

### T28-F12 — Last-resort handler for uncaught errors; correct exit codes and output streams
Install a last-resort handler for uncaught exceptions, unhandled rejections and thread panics. It must log the error with its stack trace and flush.
- **At process level:** where the runtime says state is unknown after an uncaught error (Node.js `uncaughtException`), exit non-zero and let a supervisor restart the process. Do not resume.
- **At request or job boundaries:** frameworks may contain the error and keep serving.

CLIs and batch jobs must return non-zero on failure, send diagnostics to stderr, and keep primary output on stdout.

- **Grade:** B (was A) · **Verdict:** CORRECTED
  - ASVS 16.5.4 is Level 3, and its stated purpose includes "to ensure that an error does not take down the entire application process, leading to a loss of availability". It supports *having* a last-resort handler, not exiting.
  - The exit-on-crash part rests on Node.js documentation, which covers only Node. The grade is lowered because the cross-language generalization comes from one runtime.
- **Rationale:**
  - ASVS 16.5.4: a last-resort handler must exist so error details reach the logs.
  - Node.js: it is not safe to resume after `uncaughtException`, and unhandled rejections are raised as uncaught exceptions in the default `throw` mode.
  - clig.dev: exit codes are how scripts detect failure, and diagnostics go to stderr.
- **Evidence:**
  - [ASVS 5.0 V16](https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md) — OWASP, 2025 — standard.
    - Quote: 16.5.4 (L3): "Verify that a 'last resort' error handler is defined which will catch all unhandled exceptions. This is both to avoid losing error details that must go to log files and to ensure that an error does not take down the entire application process, leading to a loss of availability."
    - Verification: confirmed in the raw file. It pulls against exit-on-crash.
  - [Node.js process documentation](https://nodejs.org/api/process.html) — Node.js, 2026 — official_docs.
    - Quotes: "The correct use of 'uncaughtException' is to perform synchronous cleanup of allocated resources ... before shutting down the process. It is not safe to resume normal operation after 'uncaughtException'."; "--unhandled-rejections flag set to strict or throw (which is the default)".
    - Verification: confirmed.
  - [Command Line Interface Guidelines](https://clig.dev/) — clig.dev — practitioner guide.
    - Quotes: "Return zero exit code on success, non-zero on failure."; "Log messages, errors, and so on should all be sent to stderr."
    - Verification: confirmed.
- **Detect:**
  - Find the handlers: `rg -n 'uncaughtException|unhandledRejection|sys[.]excepthook|threading[.]excepthook|setDefaultUncaughtExceptionHandler|set_exception_handler|recover[(][)]'`. Check what each does after logging.
  - Error branches that report success: `rg -n '(process[.]exit|sys[.]exit|os[.]Exit)[(]0[)]'` inside error handling.
  - Modes that weaken rejection handling: `rg -n -- '--unhandled-rejections'` (flag warn/none).
  - CLIs: trigger a failure and check that `echo $?` is non-zero and that `cmd 2>/dev/null` hides the diagnostics.
- **Tools:** ripgrep, shell exit-code tests.
- **Applies to:** Node/TS, Python, Java, Go and Rust services; CLIs; bots.
- **When not to apply / counterpoints:**
  - Handlers that contain errors per request or per job are what ASVS describes, and are fine.
  - Exit-on-crash assumes a supervisor (systemd, Kubernetes, pm2). Add one first.
  - For languages other than Node, check the runtime's own guidance on whether state is safe after an uncaught error.
- **Fix risk:** medium

### T28-F06 — Make retryable or redeliverable mutations idempotent
Any mutating operation that can be retried or delivered twice must be idempotent. This covers POST/PATCH handlers called by retrying clients, webhook receivers, queue consumers, scheduled jobs, and order/payment/trade submissions. Each such operation should:
- accept or derive a stable idempotency key (never a timestamp);
- record the key atomically with the side effect;
- return the stored result when a duplicate arrives.

Outbound mutating calls should carry a client-generated ID where the provider supports one.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - Stripe explains why a client cannot know whether a failed call took effect.
  - AWS REL04-BP04 (risk: Medium) prescribes idempotency tokens. It lists timestamp keys and applying idempotency "indiscriminately" as anti-patterns, and notes that a message published once may be delivered more than once.
  - Twelve-factor requires jobs to be reentrant.
  - The IETF Idempotency-Key header is an expired draft (draft-07, 15 Oct 2025), so provider behaviour varies.
- **Evidence:**
  - [Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency) — Brandur Leach (Stripe), 22 Feb 2017 — engineering_blog.
    - Quote: "The call could succeed, but the connection break before the server can tell its client about it."
    - Verification: confirmed.
  - [REL04-BP04 Make mutating operations idempotent](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_prevent_interaction_failure_idempotent.html) — AWS Well-Architected — official_docs.
    - Quotes: "You apply idempotency indiscriminately, even when not needed"; "You use timestamps as keys for idempotency"; "a message that was published only once may be accidentally delivered more than once"; risk: Medium.
    - Verification: confirmed.
  - [The Twelve-Factor App: IX. Disposability](https://12factor.net/disposability) — 12factor.net.
    - Quote: "All jobs are reentrant, which typically is achieved by wrapping the results in a transaction, or making the operation idempotent."
    - Verification: confirmed.
  - [draft-ietf-httpapi-idempotency-key-header](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/) — IETF HTTPAPI WG (Jena, Dalal) — standard (draft).
    - Status: "Expired Internet-Draft", latest revision 2025-10-15 (draft-07).
    - Quote: "can be used to make non-idempotent HTTP methods such as POST or PATCH fault-tolerant".
    - Verification: confirmed.
- **Detect:**
  - List mutating entrypoints: `rg -n -i '[.](post|put|patch|delete)[(]|@(app|router)[.](post|put|patch)|webhook|consumer|subscribe|on_message|handle_message|cron|schedule|create_order|place_order|charge'`.
  - For each one, check three things:
    - Is there a dedupe key backed by a unique constraint?
    - What happens on duplicate processing? Write a replay test.
    - Do outbound mutating calls carry a client ID?
- **Tools:** ripgrep, replay/duplicate-delivery tests, manual review.
- **Applies to:** Services, queue workers, webhook handlers, trading and payment bots.
- **When not to apply / counterpoints:**
  - AWS warns against applying idempotency where it is not needed.
  - Read-only and naturally idempotent operations (full-replace PUT, set-state) need no key.
  - Stored keys need a TTL and add storage and latency.
- **Fix risk:** high

### T28-F08 — Validate runtime-loaded config and data like untrusted input; keep last-known-good
Validate anything loaded or changed at runtime before activating it: feature files, rules, flags, remote config, allow/deny lists. Check schema, sizes, counts and bounds against hard-coded capacities. Rejecting a bad version must keep the last-known-good one. The parse path must never panic (no `unwrap`/`expect`, no unchecked indexing). Add kill switches and roll changes out in stages.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Three large incidents followed this pattern:
  - **Cloudflare, Nov 2025:** a generated feature file doubled in size and exceeded a 200-feature limit that had preallocated memory, and a Rust `unwrap()` panicked.
  - **CrowdStrike, Jul 2024:** the template type defined 21 input fields but only 20 were supplied, and the Content Validator had a logic error.
  - **Google Cloud, Jun 2025:** a policy with blank fields hit a code path with no error handling and no feature flag, and a null pointer crashed the binary.
- **Evidence:**
  - [Cloudflare outage on November 18, 2025](https://blog.cloudflare.com/18-november-2025-outage/) — Cloudflare, 2025 — incident_report.
    - Quotes: "That feature file, in turn, doubled in size"; the module has "a limit on the number of machine learning features" with memory preallocation; "called Result::unwrap() on an Err value"; remediation "Hardening ingestion of Cloudflare-generated configuration files in the same way we would for user-generated input" and "Enabling more global kill switches for features".
    - Verification: confirmed.
  - [Channel File 291 Incident Root Cause Analysis](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf) — CrowdStrike, 6 Aug 2024 — incident_report.
    - Quotes: "The new IPC Template Type defined 21 input parameter fields, but the integration code ... supplied only 20 input values"; "The Content Validator contained a logic error"; "Add runtime input array bounds checks to the Content Interpreter"; "Template Instances should have staged deployment".
    - Verification: confirmed from the PDF text.
  - [Google Cloud incident report](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) — Google Cloud, 12 Jun 2025 — incident_report.
    - Quotes: "it did not have appropriate error handling nor was it feature flag protected"; "the null pointer caused the binary to crash"; the policy "contained unintended blank fields"; remediation: changes "feature flag protected and disabled by default", and Service Control "is isolated and fails open".
    - Verification: confirmed.
  - [ASVS 5.0 V16](https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md) — OWASP, 2025 — standard.
    - Quote: 16.5.3 (L2): "Verify that the application fails gracefully and securely, including when an exception occurs, preventing fail-open conditions such as processing a transaction despite errors resulting from validation logic."
    - Verification: confirmed.
- **Detect:**
  - Find reload paths: `rg -n -i 'reload|watch|fsnotify|inotify|chokidar|poll.*config|refresh.*(config|rules|flags)|feature.?flag|remote.?config'`.
  - For each path, check five things:
    - (a) schema and bounds are validated before the swap;
    - (b) capacity constants (`rg -n 'MAX_|LIMIT|capacity|prealloc'`) are compared with incoming sizes;
    - (c) Rust: `.unwrap()`/`.expect()` on the parse path (clippy `unwrap_used`/`expect_used` exist in the *restriction* group and are allow-by-default, so they must be enabled); JS/Python: `JSON.parse`/`json.loads`/`yaml.safe_load` with no schema check after it;
    - (d) there are tests with empty, oversized and malformed files;
    - (e) last-known-good is kept and an alert fires on rejection.
- **Tools:** ripgrep, ast-grep, clippy `unwrap_used`/`expect_used`, JSON Schema/zod/pydantic.
- **Applies to:** Services and bots with hot-reloaded config, rules, flags, models or data files.
- **When not to apply / counterpoints:**
  - Fail-open vs fail-closed depends on context. Google chose fail-open for an API-management check, while ASVS 16.5.3 forbids fail-open on validation logic.
  - A single-process bot may not need staged rollout, but validation and last-known-good still apply.
  - These are three incidents from very large platforms. They illustrate the failure mode; they do not measure how often it happens.
- **Fix risk:** medium

### T28-F11 — Separate liveness from readiness; liveness must not call dependencies
Keep liveness and readiness separate:
- **Liveness** only detects that the process is irrecoverably stuck (a deadlock or wedged event loop). It makes no calls to databases, caches or other services.
- **Readiness** reflects whether the instance can serve traffic now.
- **Slow starters** use a startup probe instead of a long initial delay.
- **Probe handlers** are cheap and bounded, and liveness is more tolerant than readiness.

- **Grade:** B · **Verdict:** CORRECTED
  - Henning Jacobs' post is titled "Liveness Probes are Dangerous" (srcco.de, posted 28 Sep 2019). "How to Avoid Shooting Yourself in the Foot" does not appear on the page.
  - Probe defaults come from the concepts page, not the task page the researcher cited. The task page only mentions timeoutSeconds' 1 s default in a gRPC note.
- **Rationale:**
  - Kubernetes docs: incorrect liveness probes cause cascading failures.
  - Jacobs: do not depend on external dependencies in probes; "a single DB hiccup will restart all your containers"; do not give liveness and readiness the same spec.
  - jrockway (HN) describes the same load-driven cascade.
- **Evidence:**
  - [Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/) — Kubernetes documentation, 2026 — official_docs.
    - Quote: "Incorrect implementation of liveness probes can lead to cascading failures. This results in restarting of container under high load; failed client requests as your application became less scalable; and increased workload on remaining pods due to some failed pods."
    - Defaults on this page: initialDelaySeconds 0 s, periodSeconds 10 s, timeoutSeconds 1 s, failureThreshold 3.
    - Verification: confirmed (corrected URL).
  - [Liveness Probes are Dangerous](https://srcco.de/posts/kubernetes-liveness-probes-are-dangerous.html) — Henning Jacobs, 28 Sep 2019 — engineering_blog.
    - Quotes: "do not depend on external dependencies (like data stores) for your Readiness/Liveness checks as this might lead to cascading failures"; "a single DB hiccup will restart all your containers"; "don't set the same specification for Liveness and Readiness Probe".
    - Verification: confirmed; title corrected.
- **Detect:**
  - `rg -n -i '/(health|healthz|livez|readyz|ready|alive|ping)'`, then read each handler for DB, cache or HTTP calls.
  - In manifests or Helm charts: `rg -n -A12 'livenessProbe|readinessProbe|startupProbe'`. Flag identical liveness and readiness specs, heavy handlers left at the 1 s default timeout, and a large initialDelaySeconds where a startupProbe belongs.
- **Tools:** ripgrep, kubectl describe / manifest review.
- **Applies to:** Kubernetes services. The same idea applies to ECS, load-balancer and systemd health checks.
- **When not to apply / counterpoints:**
  - Jacobs also advises against dependency checks in readiness; others use them on purpose. Decide per dependency.
  - jrockway: liveness makes sense for a single-threaded event loop that can wedge, but "neither practice can be blindly applied to every workload".
- **Fix risk:** medium

### T28-F16 — Give each log level one meaning and apply it consistently
Use the levels as follows:
- **ERROR:** an operation failed and someone may need to act.
- **WARNING:** something unexpected happened but was handled.
- **INFO:** significant lifecycle or business events.
- **DEBUG:** diagnostic detail, off in production.

Expected outcomes (validation rejections, 404s, retries that will be retried) are not ERROR. Debug content must not go out at INFO, and debug modes must be off in production.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - The Python docs define the levels. OpenTelemetry defines severity ranges: ERROR is 17–20, and WARN is "Not an error".
  - Chen & Jiang (ICSE 2017) list "wrong verbosity level" as an anti-pattern that causes overhead and redundant logs.
  - ASVS 13.4.2 (L2) requires debug modes off in production.
  - The SRE book requires every page to be actionable.
- **Evidence:**
  - [Logging HOWTO](https://docs.python.org/3/howto/logging.html) — Python Software Foundation — official_docs.
    - Quotes: ERROR: "Due to a more serious problem, the software has not been able to perform some function." WARNING: "...The software is still working as expected."
    - Verification: confirmed.
  - [OpenTelemetry Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/) — OpenTelemetry, Stable — standard.
    - Content: "13-16 WARN ... Not an error"; "17-20 ERROR".
    - Verification: confirmed.
  - [Characterizing and Detecting Anti-patterns in the Logging Code](https://www.eecs.yorku.ca/~zmjiang/publications/icse2017_chen.pdf) — Boyuan Chen, Zhen Ming (Jack) Jiang, York University, ICSE 2017 — peer_reviewed.
    - Quote: the example `LOG.info("DEBUG --- Container FINISHED: " + containerId)`; the anti-pattern may cause "overhead and large volumes of redundant logs".
    - Verification: confirmed from the PDF text.
  - [ASVS 5.0 V13](https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x22-V13-Configuration.md) — OWASP, 2025 — standard.
    - Quote: 13.4.2 (L2): "Verify that debug modes are disabled for all components in production environments".
    - Verification: confirmed.
  - [Let's talk about logging](https://dave.cheney.net/2015/11/05/lets-talk-about-logging) — Dave Cheney, 2015 — engineering_blog (dissent).
    - Quote: "Nobody reads warnings, because by definition nothing went wrong."
    - Verification: confirmed.
  - [Logs vs Structured Events](https://charity.wtf/2019/02/05/logs-vs-structured-events/) — Charity Majors, 2019 — engineering_blog (dissent).
    - Quote: "Log levels are another confusing and unnecessary artifact of yesteryear that you no longer really need."
    - Verification: confirmed.
- **Detect:**
  - Debug text at higher levels: `rg -n '[.](info|warn|warning)[(] *.(DEBUG|TRACE)'`.
  - Review `.error(` call sites whose branch then returns normally.
  - Production level settings: `rg -n -i 'LOG_LEVEL|log_level|setLevel[(]|DEBUG *= *True|debug: *true|app[.]debug'`.
  - In production samples, ERROR lines that nobody acted on are candidates for demotion.
- **Tools:** ripgrep, log sample analysis.
- **Applies to:** All languages with leveled loggers.
- **When not to apply / counterpoints:**
  - The rule is contested (Cheney, Majors).
  - Chen & Jiang's EMSE 2016 replication found that developers of Java ASF projects understand verbosity levels better than the original C/C++ study suggested.
  - Changing levels can break alerts and dashboards keyed on ERROR counts.
- **Fix risk:** low

### T28-F19 — Logging statements must have no side effects and must not be able to throw
Log arguments must not:
- dereference possibly-null objects;
- use explicit casts;
- call anything that mutates state or does I/O;
- heavily serialize large objects or byte arrays.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - Chen & Jiang manually examined 352 pairs of independently changed logging code from ActiveMQ, Hadoop and Maven. They found six anti-patterns: nullable objects, explicit casts, wrong verbosity level, and three logging code smells (two kinds of duplication and malformed output).
  - An HBase server crashed on a NullPointerException inside a debug logging statement.
  - Their tool, LCAnalyzer, reached 95% recall and 60% precision.
  - They filed 64 instances across ten projects; 46 (72%) were confirmed or fixed.
- **Evidence:**
  - [Characterizing and Detecting Anti-patterns in the Logging Code (ICSE 2017)](https://www.eecs.yorku.ca/~zmjiang/publications/icse2017_chen.pdf) — Boyuan Chen, Zhen Ming (Jack) Jiang — peer_reviewed.
    - Quotes: "LCAnalyzer has an average recall of 95% and precision of 60%"; "we have filed 64 representative instances ... from the most recent releases of ten open source software systems. Among them, 46 instances (72%) have already been accepted"; "crash of the HBase server due to a NullPointerException"; "manually gone through 352 pairs".
    - Verification: confirmed from the PDF text.
  - [Characterizing logging practices in Java-based open source software projects: a replication study](https://www.eecs.yorku.ca/~zmjiang/publications/emse2016_chen.pdf) — Chen, Jiang, Empirical Software Engineering, 2016 — peer_reviewed.
    - Quotes: 21 Java ASF projects; "all projects contain logging code, which is actively maintained"; "A significantly higher portion of log updates are for enhancing the quality of logs".
    - Verification: confirmed from the PDF text.
- **Detect:** heuristic greps (not validated):
  - casts: `rg -n '(LOG|log|logger)[.](trace|debug|info|warn|error)[(].*[(][A-Z][A-Za-z]*[)]'`;
  - chained calls that can dereference null: `rg -n '(LOG|log|logger)[.][a-z]+[(].*[.][a-zA-Z]+[(][)][.][a-zA-Z]+[(]'`;
  - side effects: `rg -n '(log|logger)[.][a-z]+[(].*([.]pop[(]|next[(]|[.]commit[(]|[+][+])'`.

  LCAnalyzer (Java) is a research tool.
- **Tools:** ripgrep, LCAnalyzer (research tool), manual review.
- **Applies to:** All languages; the evidence is from Java systems.
- **When not to apply / counterpoints:**
  - Placeholder APIs format null safely.
  - At 60% precision, review the hits rather than bulk-fixing them.
  - The anti-patterns were characterized from three Java projects.
- **Fix risk:** low

### T28-F22 — Long-running services expose the four golden signals; pages are symptom-based and actionable
Expose the four golden signals:
- **Latency,** with successes and failures measured separately.
- **Traffic.**
- **Errors,** explicit and implicit.
- **Saturation:** the most constrained resource (queue depth, pool usage, memory).

Pages must be actionable; alerts on SLO burn rate are preferred.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - SRE book: if you can measure only four metrics, measure these. A slow error is worse than a fast one, so track error latency separately.
  - SRE workbook: page on 2% of the error budget consumed in 1 h (burn rate 14.4) or 5% in 6 h (burn rate 6); raise a ticket on 10% in 3 days. The short window is 1/12 of the long one.
- **Evidence:**
  - [Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) — Google, SRE book, 2016 — book.
    - Quotes: "If you can only measure four metrics of your user-facing system, focus on these four."; "a slow error is even worse than a fast error!"; "Every page should be actionable."
    - Verification: confirmed.
  - [Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/) — Google, SRE workbook, 2018 — book.
    - Content: 2% budget consumption / 1 hour / burn rate 14.4 / page; 5% / 6 hours / 6 / page; 10% / 3 days / ticket; the short window is 1/12 of the long window.
    - Verification: confirmed.
- **Detect:** `rg -n -i 'prometheus|histogram|counter|gauge|statsd|meter[.]|metrics'`. Then check:
  - latency is split by outcome;
  - the error counter includes implicit errors (for example a 200 with wrong content);
  - a saturation gauge exists;
  - a traffic counter exists;
  - each existing alert is a user-visible symptom and actionable.
- **Tools:** Prometheus client / OpenTelemetry metrics, manual review.
- **Applies to:** Long-running services, workers and bots; not short-lived CLIs.
- **When not to apply / counterpoints:**
  - This is overkill for scripts, where exit codes and logs suffice.
  - Wide-event advocates derive metrics from events.
  - Low-traffic bots produce noisy burn rates.
- **Fix risk:** low

### T28-F20 — Keep log volume proportional to its value; bound what error reporting can consume
- No per-iteration logging in hot loops.
- Rate-limit or sample repetitive success events, and record the sample rate.
- Always keep errors and slow requests.
- Cap the CPU, memory and disk that error reporting, stack enrichment and core dumps can use.
- Never sample security or audit events.

- **Grade:** C · **Verdict:** CORRECTED
  - The researcher cited Morrell's figure (about US$0.0012/month for 1M events) as a counterpoint to volume control.
  - His example assumes a service at 1000 req/s that is **already sampling 1%** of traffic, and it prices storage only (R2) on generated fake events.
  - So it illustrates cheap storage *after* sampling, not an argument against sampling.
- **Rationale:**
  - During Cloudflare's November 2025 outage, debugging and observability systems consumed large amounts of CPU. The remediation includes capping error reports and core dumps.
  - Li et al. (TSE 2020; 66 developers, 223 issue reports): developers weigh a wide range of logging costs and balance them with ad hoc strategies.
  - Practitioner tail sampling keeps 100% of errors and slow requests and 1–5% of the rest.
- **Evidence:**
  - [Cloudflare outage on November 18, 2025](https://blog.cloudflare.com/18-november-2025-outage/) — Cloudflare, 2025 — incident_report.
    - Quotes: "large amounts of CPU being consumed by our debugging and observability systems, which automatically enhance uncaught errors with additional debugging information"; "Eliminating the ability for core dumps or other error reports to overwhelm system resources".
    - Verification: confirmed.
  - [A Qualitative Study of the Benefits and Costs of Logging From Developers' Perspectives](https://doi.org/10.1109/tse.2020.2970422) — Heng Li, Weiyi Shang, Bram Adams, Mohammed Sayagh, Ahmed E. Hassan, TSE 2020 — peer_reviewed.
    - Quotes: "a survey of 66 developers and a case study of 223 logging-related issue reports"; "developers use ad hoc strategies to balance the benefits and costs of logging".
    - Verification: confirmed from the abstract only (OpenAlex). It supports "logging has costs that need managing", not the specific thresholds.
  - [Logging sucks](https://loggingsucks.com/) — Boris Tane, undated page (HN discussion 21 Dec 2025) — engineering_blog.
    - Quote: keep errors and slow requests; "Randomly sample the rest. Happy, fast requests? Keep 1-5%."
    - Verification: confirmed.
  - [A Practitioner's Guide to Wide Events](https://jeremymorrell.dev/blog/a-practitioners-guide-to-wide-events/) — Jeremy Morrell, 22 Oct 2024 — engineering_blog.
    - Quotes: "Let's say our service is serving 1000 req/s all day and sampling 1% of that traffic ... about a million events"; stored in DuckDB at about 80 MB; "Storing this on Cloudflare's R2 for a month would cost US$ 0.0012".
    - Verification: confirmed. The context was added.
  - [HN comment on "Logging sucks"](https://news.ycombinator.com/item?id=46348131) — dexwiz, 21 Dec 2025 — practitioner_forum.
    - Quote: "Either you end up sampling traces at low rates to save on costs, or your observability bill is more than your infrastructure bill."
    - Verification: confirmed.
- **Detect:**
  - ast-grep for log calls inside loop bodies (Python pattern: `for $X in $Y: $$$ $L.$M($$$)`).
  - A load or replay test that counts log lines and bytes per request, and finds the top 10 templates by volume.
  - The error reporter's rate limits and sampling.
  - Core-dump limits (`ulimit -c`, systemd-coredump).
- **Tools:** ast-grep, log volume analysis, load test.
- **Applies to:** Services and bots with sustained traffic; less relevant for CLIs.
- **When not to apply / counterpoints:**
  - Sampling hurts forensics on rare bugs.
  - Security and audit logs (ASVS 16.3) must not be sampled.
  - Wide-event advocates argue that storage is cheap (Morrell, after 1% sampling) and that cost problems come from vendor pricing (dexwiz).
- **Fix risk:** medium

### T28-F17 — Log an error once, where it is handled or at a boundary; wrap, don't log-and-rethrow
Log an error where it is finally handled, or at a module or service boundary. Lower layers should wrap it with context and propagate it (`raise ... from err`, `fmt.Errorf("...: %w", err)`, `new Error(msg, { cause })`) rather than log and rethrow.

- **Grade:** C · **Verdict:** CORRECTED
  - The HN quote "Log and throw can be a legitimate pattern. It makes sense when the exception travels outside some kind of boundary like module/library boundary" was written by **lmilcin** ([28573004](https://news.ycombinator.com/item?id=28573004)).
  - gwbas1c ([28573271](https://news.ycombinator.com/item?id=28573271)) quoted it and added only: "Of course it's going to correlate with a bug. The whole point of log and throw is to make bugs easier to find!"
  - The Never Work In Theory page has the typo "corelated"; the quote is reproduced faithfully.
- **Rationale:**
  - Logging at every layer duplicates stack traces and inflates error counts.
  - Cheney: handle the error or pass it back, never both.
  - The empirical evidence is weak: de Pádua & Shang found Log and Throw correlated with defects in only one of the three projects studied.
  - Practitioners defend log-and-throw at boundaries and at the top layer.
- **Evidence:**
  - [Studying the relationship between exception handling practices and post-release defects (review)](https://neverworkintheory.org/2021/09/16/exception-handling-practices-and-post-release-defects.html) — Greg Wilson, Never Work In Theory, 2021, on de Pádua & Shang (MSR 2018) — secondary review.
    - Quote: "The Ignoring Interrupted Exception and Log and Throw patterns corelated [sic] with post-release defects in one of the projects they studied, but not all."
    - Verification: confirmed.
  - [Let's talk about logging](https://dave.cheney.net/2015/11/05/lets-talk-about-logging) — Dave Cheney, 2015 — engineering_blog.
    - Quote: "You should never be logging anything at error level because you should either handle the error, or pass it back to the caller."
    - Verification: confirmed.
  - [HN comment: log and throw at boundaries](https://news.ycombinator.com/item?id=28573004) — lmilcin, 18 Sep 2021 — practitioner_forum.
    - Quote: "Log and throw can be a legitimate pattern. It makes sense when the exception travels outside some kind of boundary like module/library boundary. A REST API is an example of boundary".
    - Verification: confirmed via the HN API; attribution corrected.
- **Detect:**
  - semgrep (Python): `try: ... except $E as $X: ... $L.$M(...) ... raise`.
  - ast-grep (JS/TS): `catch ($E) { $$$ $L.error($$$) $$$ throw $$$ }`.
  - Java: catch blocks containing both `LOG.*` and `throw`.
  - Check whether callers log the same error again. The symptom in a log sample is the same stack trace appearing several times per request.
- **Tools:** semgrep, ast-grep, log sample analysis.
- **Applies to:** Exception-based languages; Go (log-and-return).
- **When not to apply / counterpoints:**
  - Log-and-throw is defensible at library, API, thread and queue boundaries, where context would otherwise be lost.
  - The evidence against it is weak (grade C).
- **Fix risk:** low

## Practitioner voice
Every item below was read via the HN Algolia API or the page itself.
- [jrockway, HN 2023](https://news.ycombinator.com/item?id=35533599) — A common cascading failure:
  - latency rises until liveness probes fail;
  - restarts shrink the fleet and overload the other replicas;
  - "soon enough, everything is dead".

  Liveness is useful for a single-threaded event loop that can wedge, but "neither practice can be blindly applied to every workload".
- [zdc1, HN 2025](https://news.ycombinator.com/item?id=43891977) — "Adding a global preStop hook with a 15 second sleep did wonders for our HTTP 503 rates."
- [paranoidrobot, HN 2025](https://news.ycombinator.com/item?id=43326437) — Learned the hard way that the ALB kept sending traffic to terminating pods. Fix sequence:
  1. preStop sends SIGUSR1;
  2. the app fails readiness;
  3. preStop waits N seconds;
  4. SIGTERM arrives.
- [nebezb, HN 2026](https://news.ycombinator.com/item?id=49481549) — Env-var secrets leak through "Devs adding `{ meta: process.env }` to logs" and through crash-report libraries that dump the environment.
- [tptacek, HN 2026](https://news.ycombinator.com/item?id=49483591) — Encrypting secrets in resident memory is "saffron-grade security"; `unsetenv(3)` is probably enough.
- [zbentley, reply to tptacek, HN 2026](https://news.ycombinator.com/item?id=49484011) — `unsetenv` "doesn't modify the environment block of the process", so a path-traversal bug can read startup secrets from `/proc/self/environ`. He agrees the risk does not justify "caching + encrypting runtime secret stores". *(URL corrected from 49483591.)*
- [physicles, HN 2023](https://news.ycombinator.com/item?id=36427454) — On Go's default infinite network timeouts: "your code works perfectly for 1-N months and then suddenly breaks in production. I always set timeouts now; there's basically no downside".
- [hodgesrm, HN 2020](https://news.ycombinator.com/item?id=24320469) — "Forcing clients to pick timeouts amounts to punting a hard problem over to somebody who has even less idea how to solve it than you do". Suggests keepalives, queues, idempotence and cancellation instead.
- [nirui, HN 2020](https://news.ycombinator.com/item?id=24320599) — *(gist corrected)*
  - On a network with random disconnects, many apps hang forever for lack of a timeout strategy.
  - He uses separate dial (about 20 s) and read (about 120 s) timeouts.
  - He complains about downloaders with no retry/resume that restart a 600 MB file after 99%.
- [KallDrexx, HN 2020](https://news.ycombinator.com/item?id=24320345) — *(gist narrowed)* "If there is a real risk that a timeout can happen (and there always is) then the payment system should be implementing a two phase commit."
- [lmilcin, HN 2021](https://news.ycombinator.com/item?id=28573004) — Log-and-throw is legitimate when the exception crosses a module or library boundary such as a REST API. (This was attributed to gwbas1c, who [quoted it](https://news.ycombinator.com/item?id=28573271).)
- [groestl, HN 2024](https://news.ycombinator.com/item?id=39808367) — Stay in fail-early territory by bubbling errors up, and use log-and-throw plus resilience only at the top layer. The most stable systems he saw produced "the most horrible stacktraces" but cleaned up resources properly.
- [dexwiz, HN 2025](https://news.ycombinator.com/item?id=46348131) — Teams either sample traces at low rates or pay an observability bill larger than the infrastructure bill.
- [Veserv, HN 2025](https://news.ycombinator.com/item?id=46347945) — "The only distinction between logs, traces, and metrics is literally what to do when fidelity is lost."
- [scottlamb, HN 2023](https://news.ycombinator.com/item?id=37238042) — *(gist corrected)* lnav's JSON format definitions did not show or filter attributes the definition had not anticipated. He partly retracted after finding `"hide-extra": false`, but still could not query those attributes from lnav's SQLite table. This is a viewer limitation.
- [Cloudflare postmortem, 18 Nov 2025](https://blog.cloudflare.com/18-november-2025-outage/) — A generated feature file doubled, exceeded a 200-feature preallocated limit, and hit an `unwrap()` panic. Error-enrichment systems consumed CPU during the outage. Remediations:
  - treat internal config like user input;
  - add kill switches;
  - cap error reports and core dumps.
- [Google Cloud incident, 12 Jun 2025](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) — A policy with blank fields hit an unflagged null-pointer path. The missing randomized backoff then created a herd on a Spanner table, and us-central-1 took up to about 2 h 40 min to recover.

## Contradictions and open questions

**Contradictions**
- **Secrets in environment variables.**
  - Twelve-factor stores credentials in env vars.
  - OWASP's Secrets Management Cheat Sheet and clig.dev advise against it.
  - tptacek considers further hardening overkill; zbentley notes that `unsetenv` leaves `/proc/self/environ` intact.
  - The skill should report env-var secrets as a risk to note, not as a defect.
- **Exit vs contain on uncaught errors** *(new)*.
  - The Node.js docs: it is "not safe to resume normal operation" after `uncaughtException`.
  - ASVS 5.0 16.5.4 (L3): the last-resort handler should "ensure that an error does not take down the entire application process".
  - Workable resolution: contain errors at request or job boundaries. At process level, when state is unknown, log, flush and exit under a supervisor.
- **Log levels.**
  - The Python docs, OpenTelemetry and Chen & Jiang (ICSE 2017) treat levels as meaningful.
  - Cheney: only info and debug are needed. Majors: levels are obsolete once you emit wide events.
  - Chen & Jiang's EMSE 2016 replication found Java developers understand levels better than the original C/C++ study suggested.
- **Log-and-rethrow.**
  - Cheney: handle or return, never both.
  - The only empirical study found here links Log and Throw to defects in just one of three projects. Dummy Handler and Generic Catch were strongly linked.
  - lmilcin and groestl defend log-and-throw at boundaries or the top layer.
- **Fail fast vs fail open.**
  - Shore and Xu et al.: fail at startup on bad config.
  - Google's remediation makes Service Control "fail open"; ASVS 16.5.3 forbids fail-open on validation logic.
  - Cloudflare's outage was a fail-fast panic on bad runtime data.
  - Workable resolution: fail fast at startup or deploy time. At runtime, reject a bad new version and keep the last-known-good. Choose open or closed per check, depending on whether it guards security.
- **Do logs help debugging?**
  - Chen & Jiang (EMSE 2016, 21 Java ASF projects) report that "contrary to the original study", bug reports containing log messages take longer to resolve.
  - Per project the result is mixed: 8 projects had longer median resolution times for reports without logs, 10 shorter, and 2 had no reports containing log messages.
  - It is a correlation: bugs that come with logs may simply be harder.
- **Log lines vs wide events.**
  - Tane, Majors and Morrell favour one wide event per request.
  - Veserv: logs, traces and metrics differ only in what is dropped when fidelity must be lost.
  - dexwiz: vendor cost forces sampling. Structured JSON is harder to read raw in development.
- **Timeouts.**
  - AWS, the requests docs, Vitillo ("always set timeouts when making network calls") and physicles say always set them.
  - AWS also lists "too low" as an anti-pattern.
  - hodgesrm: forcing callers to pick timeouts punts the problem.
  - Total timeouts break large transfers unless resume exists.
- **Liveness probes.**
  - Some Kubernetes best-practice lists require a liveness probe on every app (jrockway reports running into this).
  - The Kubernetes docs, Jacobs and jrockway warn that this causes cascades.
  - Jacobs also advises against dependency checks in readiness, which others use on purpose.
- **Log4j fixed versions.**
  - CISA (2021) recommended 2.17.1 / 2.12.4 / 2.3.2. Apache's page now gives 2.17.0 / 2.12.3 / 2.3.1 for the December 2021 follow-up CVEs.
  - Both are superseded by 2025–2026 CVEs, fixed up to 2.25.5 / 2.26.1.
  - The skill should point to the live Apache page, not to a pinned version.
- **Where logs go.** Services write logs to stdout (twelve-factor). CLIs send logs to stderr and keep stdout for primary output (clig.dev). This is a difference of scope, not a real conflict.

**Open questions**
- **Structured logging benefit:** no peer-reviewed study was found showing that structured or wide-event logging shortens diagnosis compared with plain text. The benefit rests on standards and practitioner consensus.
- **Amazon Builders' Library:** this dossier's researcher could not render the articles (JavaScript only), but two of them were verified elsewhere. error-handling T14-F11 verified Brooker's "Timeouts, retries, and backoff with jitter" through its PDF, including the percentile-based timeout guidance ("we choose an acceptable rate of false timeouts (such as 0.1%)… (p99.9 in this example)"), and error-handling T14-F13 verified "Making retries safe with idempotent APIs". Use those for T28-F04 and T28-F06. Only the health-check article remains unverified.
- **Abstract-only sources:**
  - Yuan et al., ICSE 2012 (logging practices): only reachable as an abstract, and the EMSE 2016 replication contradicts at least one of its findings.
  - Dai et al., Yin et al. and Li et al. were also verified from abstracts only.
- **Idempotency-Key header:** an expired draft (draft-07, Oct 2025). There is no standard key format, retention period or conflict status code.
- **Shutdown and probes:** no standard automated check exists for graceful shutdown or probe correctness. Both need a manual or integration test.
- **GitGuardian's "~2× for Claude Code" figure:** vendor data; the method was not examined. Whether AI-written code shows other systematic logging or config anti-patterns remains unstudied in the sources found.
- **Detection heuristics:** all grep, semgrep and ast-grep patterns in this dossier were written by the researcher and not tested on real repositories. Expect false positives and false negatives.

## Dropped findings
None of the 22 findings was dropped.

Practitioner-voice item dropped:
- **arnaelena, HN 2026** ([49534292](https://news.ycombinator.com/item?id=49534292)) — the claim "cut Datadog spend 60% by fixing what we were logging" does not appear in the comment. The full text, read via the HN API, is a "Who wants to be hired" profile with no such figure.
