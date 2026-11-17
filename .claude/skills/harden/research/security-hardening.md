# Security hardening pass for any codebase
> Code T15 · slug security-hardening · verified 2026-09-23 · counts: verified 10 / corrected 13 / downgraded 0 / dropped 0

## Summary

This pass applies to any language, runs after the code is finished, and is not a pentest. Every standard version below was checked online on 2026-09-23:

- **OWASP Top 10:2025.** The OWASP/Top10 README says "OWASP Top 10 2025 - RELEASED" and "We have released the OWASP Top 10:2025 (Final)". Neither the README nor the category pages give a release date. A03 Software Supply Chain Failures and A10 Mishandling of Exceptional Conditions are new categories.
- **OWASP ASVS 5.0.0.** Requirement IDs and levels were checked against the raw v5.0.0 markdown.
- **2025 CWE Top 25.** Released 15 Dec 2025. It is built from 39,080 CVE records published between 1 June 2024 and 1 June 2025.
- **NIST SSDF SP 800-218 v1.1.** v1.2 (SP 800-218 Rev. 1) exists only as an Initial Public Draft, released 17 Dec 2025, with comments closed 30 Jan 2026.
- **OpenSSF.** The current Scorecard checks and the Best Practices "passing" criteria.
- **OpenSSF Concise Guide.** Its cooldown item was added on 2026-09-19 (commit #1136), even though the page still shows 2023-06-14.

The evidence supports a hardening pass in six parts:

1. **Read-only scans first.** Scan the working tree and the full git history for secrets. Run SCA over every lockfile, SAST, and a CI-workflow audit.
2. **Triage every alert before touching code.** Peer-reviewed and preprint data show SAST has low recall and heavy noise:
   - Charoenwet et al. (ISSTA 2024): a single SAST tool warned in the vulnerable function for only 52% of vulnerability-contributing commits (VCCs), and at least 76% of warnings in vulnerable functions were irrelevant.
   - A 2026 longitudinal study: CodeQL detected 171 of 3,993 CVEs.
   - SCA tools disagree by an order of magnitude on the same application.
3. **Manual review where tools are blind.** This covers object-level authorization (CWE-862 is #4), business logic, mass assignment and fail-open error paths.
4. **Supply-chain hygiene.**
   - Commit lockfiles and use frozen installs.
   - Turn off dependency install scripts by default.
   - Add release-age cooldowns for version updates only.
   - Check that every dependency is real and comes from the expected registry. LLMs invent package names at least 5.2% of the time for commercial models and 21.7% for open-source ones (USENIX Security 2025).
   - Remove unused dependencies.
   - Pin CI actions to a SHA and use least-privilege tokens.
5. **Fix in small, test-backed commits.** Use the smallest upgrade that clears the advisory. Anything destructive or owned by the user goes to a human: secret rotation, history rewrites, major upgrades and authorization-policy changes.
6. **Every reported finding needs proof.** The evidence that AI-assisted code is less secure is real but mixed in quality:
   - A peer-reviewed user study (CCS 2023) used a 2022-era Codex model.
   - Two vendors report: Veracode found 45% of AI-generated samples failed security tests. GitGuardian found Claude Code-assisted commits leaked secrets at 3.2% against a 1.5% baseline. GitGuardian itself says this "should not be read as a simple tool failure".
   - curl ended its bug bounty on 31 Jan 2026 after an "explosion in AI slop reports". Its confirmed-vulnerability rate fell from above 15% of submissions in earlier years to below 5% in 2025.

Several conflicts remain unresolved (see below): cooldown length and free-riding, reachability triage versus compliance, how often upgrades break things, and verified-only secret triage.

**Verification notes.** WebSearch was out of budget during this check, so every source was opened directly: official sites, arXiv abstract pages and API, raw GitHub files, the HN Algolia items API, and curl plus grep over page text. Reddit, Lobsters and Security StackExchange were not reachable, so practitioner voice still leans on Hacker News and engineering blogs.

## Findings

### T15-F15 — Manually audit authorization (object-level, function-level, deny-by-default); scanners cannot
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:** Manually audit authorization, because scanners cannot.
  - List every route, handler, RPC and GraphQL resolver.
  - For each one that takes a client-supplied identifier, confirm a server-side check ties the record to the caller (ownership, tenant or role) before any read, update or delete.
  - Confirm deny-by-default for anything that is not public.
  - Add negative tests: user A cannot read or modify user B's object, and a non-admin cannot call admin functions.
  - Report proposed policy changes to a human rather than inventing a policy.
- **Rationale:**
  - Broken access control is A01 in the OWASP Top 10:2025, with 40 mapped CWEs, 1,839,701 occurrences and 32,654 CVEs. SSRF (CWE-918) now sits inside it.
  - 2025 CWE Top 25 ranks: CWE-862 Missing Authorization #4, CWE-863 #17, CWE-284 #19, CWE-306 #21, CWE-639 (user-controlled key) #24.
  - ASVS 5.0: 8.2.2 (L1) requires data-specific access control to mitigate IDOR and BOLA, and 8.3.1 (L1) requires enforcement at a trusted service layer.
  - OWASP API1:2023 asks for a check "in every function that uses an input from the client to access a record" and for tests that block deployment when they fail.
  - Real failure: First American exposed about 885 million documents with no authentication and sequential IDs. The SEC found that security staff had identified the flaw months earlier ($487,616 penalty).
- **Evidence:**
  - [OWASP Top 10:2025 A01 Broken Access Control](https://top10.owasp.org/2025/A01_2025-Broken_Access_Control/) — OWASP, 2025 — standard — "40 CWEs mapped / 1,839,701 occurrences / 32,654 CVEs"; "Deny by default"; "enforce record ownership rather than allowing users to create, read, update, or delete any record"; CWE-918 is in the mapped list — confirmed on page.
  - [OWASP ASVS 5.0.0 V8 Authorization](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/en/0x17-V8-Authorization.md) — OWASP, 2025 — standard — 8.2.2 (L1) "...to mitigate insecure direct object reference (IDOR) and broken object level authorization (BOLA)"; 8.3.1 (L1) "enforces authorization rules at a trusted service layer" — confirmed verbatim with levels.
  - [API1:2023 Broken Object Level Authorization](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization) — OWASP API Security Project, 2023 — standard — "...in every function that uses an input from the client to access a record in the database"; "Write tests to evaluate the vulnerability of the authorization mechanism. Do not deploy changes that make the tests fail."; Detectability: Easy — confirmed.
  - [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html) — MITRE/CISA, 15 Dec 2025 — standard — ranks #4, #17, #19, #21, #24 as above — confirmed against the full list.
  - [First American Financial Corp. Leaked Hundreds of Millions of Title Insurance Records](https://krebsonsecurity.com/2019/05/first-american-financial-corp-leaked-hundreds-of-millions-of-title-insurance-records/) — KrebsOnSecurity, 2019 — incident report — "anyone who knew the URL for a valid document ... could view other documents just by modifying a single digit"; "No authentication was required"; ~885 million files — confirmed.
  - [SEC press release 2021-102](https://www.sec.gov/newsroom/press-releases/2021-102) — U.S. SEC, 15 Jun 2021 — incident report — "$487,616 penalty"; "information security personnel had identified the vulnerability several months earlier, but had failed to remediate it" — confirmed.
- **Detect:**
  - Build the route inventory from the framework's route list, or by grepping route decorators and registrations.
  - For each handler, grep for identifier inputs (`req.params`, `request.args`, `@PathVariable`, `params[:id]`, GraphQL `args.id`) followed by a data access (`findById`, `get(`, `SELECT ... WHERE id =`) with no owner or tenant filter (`user_id`, `owner`, `tenant_id`) and no policy call nearby.
  - Custom Semgrep rules can encode "fetch-by-id without owner filter" for the project's ORM.
  - Write negative tests with two users and one admin.
  - Check that client-side checks (hidden buttons, frontend role flags) have a server-side counterpart.
- **Tools:** manual review, semgrep (custom rules), test framework.
- **Applies to:** Any multi-user application or API, in any language.
- **When not to apply / counterpoints:**
  - OWASP API1 rates detectability "Easy" in testing, yet generic tools cannot detect it because it depends on business rules.
  - New checks can lock out legitimate flows: admins, shared resources, background jobs, service-to-service calls.
  - Random GUIDs make enumeration harder, but they are not authorization.
- **Fix risk:** high

### T15-F12 — Parameterize every path from untrusted data to an interpreter (SQL/NoSQL, shell, eval, templates)
- **Grade:** A · **Verdict:** VERIFIED (minor: Bandit B307 is documented on the blacklist-calls page, not the plugins index)
- **Rule:** Find every place where untrusted data reaches an interpreter: SQL and NoSQL queries, shell commands, `eval`/`exec`/`new Function`, and template engines.
  - Convert them to parameterized queries, argument-vector process calls without a shell, or built-in library functions.
  - Identifiers that cannot be parameterized (table or column names, sort order) must be checked against a hard-coded allowlist.
  - Escaping is only a fallback.
- **Rationale:**
  - 2025 CWE Top 25: SQL injection #2, OS command injection #9, code injection #10, command injection #23. Injection is A05 in the OWASP Top 10:2025.
  - OWASP says "SQL Injection is best prevented through the use of parameterized queries" and that parameterization must happen server-side.
  - For OS commands, "The primary defense is to avoid calling OS commands directly".
  - Input validation "should not be used as the primary method" against injection.
- **Evidence:**
  - [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html) — MITRE/CISA, 2025 — standard — #2 CWE-89, #9 CWE-78, #10 CWE-94, #23 CWE-77 — confirmed.
  - [2025 CWE Top 25 methodology](https://cwe.mitre.org/top25/archive/2025/2025_methodology.html) — MITRE, 2025 — standard — "39,080 CVE Records for vulnerabilities published between June 1, 2024 and June 1, 2025" — confirmed verbatim.
  - [Query Parameterization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Query_Parameterization_Cheat_Sheet.html) — OWASP — standard — "SQL Injection is best prevented through the use of parameterized queries"; client-side libraries "often just build queries with string concatenation ... Please ensure that query parameterization is done server-side!" — confirmed verbatim.
  - [OS Command Injection Defense Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html) — OWASP — standard — "The primary defense is to avoid calling OS commands directly. Built-in library functions are a very good alternative"; option 3 is "Parameterization in conjunction with Input Validation" — confirmed.
  - [Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html) — OWASP — standard — "Input Validation should not be used as the primary method of preventing XSS, SQL Injection and other attacks" — confirmed verbatim.
  - [Bandit plugins](https://bandit.readthedocs.io/en/latest/plugins/index.html) and [Bandit blacklist calls](https://bandit.readthedocs.io/en/latest/blacklists/blacklist_calls.html) — PyCQA — official docs — B602 subprocess_popen_with_shell_equals_true, B608 hardcoded_sql_expressions and B102 exec_used on the plugins page; B307 eval ("consider using safer ast.literal_eval") on the blacklist page — confirmed.
- **Detect:**
  - Scanners: Semgrep `p/owasp-top-ten`; CodeQL security-extended (sql-injection and command-injection queries); Bandit B602, B608, B102 and B307.
  - Grep sweeps, then review each hit by hand:
    - SQL built with f-strings, concatenation or `.format(`: `rg -n "(execute|query|raw|executemany)\s*\(\s*(f[\"']|[\"'][^\"']*[\"']\s*(\+|%)|.*\.format\()"`
    - Shell calls: `rg -n 'shell\s*=\s*True|os\.system\(|os\.popen\(|child_process\.(exec|execSync)\(|Runtime\.getRuntime\(\)\.exec|\bsystem\(|popen\('`
    - Dynamic code: `rg -n '\beval\(|new Function\(|\bexec\(|vm\.runIn'`
  - For ORMs, look for raw-query escape hatches: `$queryRawUnsafe`, `.raw(`, `text(` with f-strings, `extra(`.
- **Tools:** semgrep, codeql, bandit, ripgrep.
- **Applies to:** Every language that talks to databases, shells or interpreters.
- **When not to apply / counterpoints:**
  - A query built only from constants is safe, so such hits are false positives.
  - Identifiers need allowlists, because they cannot be parameterized.
  - Replacing `shell=True` with an argv list changes behaviour: no globbing, pipes or `$VAR` expansion.
- **Fix risk:** medium

### T15-F13 — Inventory every HTML escape hatch and dangerous DOM sink; sanitize or switch to text sinks
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:** Inventory every HTML-output escape hatch and dangerous DOM sink:
  - React `dangerouslySetInnerHTML`, Vue `v-html`, Angular `bypassSecurityTrustAs*`, Lit `unsafeHTML`.
  - Server templates: `|safe`, `mark_safe`, unescaped `{{{ }}}`.
  - DOM: `innerHTML`, `outerHTML`, `document.write`, `insertAdjacentHTML`.

  For each one, either switch to a text sink (`textContent`) or sanitize with DOMPurify right before insertion. Validate user-supplied URLs used in `href`/`src` so they cannot use `javascript:` or `data:` schemes.
- **Rationale:**
  - XSS (CWE-79) is #1 in the 2025 CWE Top 25.
  - OWASP says modern frameworks are safe by default and that holes come from escape hatches. React also "cannot handle javascript: or data: URLs without specialized validation".
  - Veracode (vendor, 2025) found AI tools failed to defend against XSS (CWE-80) in 86% of relevant samples.
- **Evidence:**
  - [Cross Site Scripting Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html) — OWASP — standard — escape hatches confirmed verbatim: "React's dangerouslySetInnerHTML without sanitizing the HTML", "React cannot handle javascript: or data: URLs without specialized validation", "Angular's bypassSecurityTrustAs* functions", "Lit's unsafeHTML function". Also: "elem.textContent = dangerVariable;", "let clean = DOMPurify.sanitize(dirty);" and "If you sanitize content and then modify it afterwards, you can easily void your security efforts."
  - [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html) — MITRE/CISA, 2025 — standard — #1 CWE-79 — confirmed.
  - [2025 GenAI Code Security Report](https://www.veracode.com/blog/genai-code-security-report/) — Veracode, 30 Jul 2025 — industry report (vendor) — "45% of code samples failed security tests"; XSS (CWE-80) failure in 86% of relevant samples; 100+ LLMs — confirmed.
- **Detect:**
  - Escape hatches: `rg -n 'dangerouslySetInnerHTML|v-html|bypassSecurityTrust|unsafeHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\(|\|\s*safe\b|mark_safe\(|\{\{\{'`
  - For each hit, trace whether the value can hold user or third-party data, and whether a sanitizer (`DOMPurify.sanitize` or server-side) runs immediately before insertion with nothing changing the output afterwards.
  - URL sinks: `rg -n 'href=\{|:href=|\[href\]|window\.location\s*=|location\.href\s*='`, then check for a scheme allowlist.
  - Semgrep `p/owasp-top-ten` and CodeQL `js/xss` cover part of this.
- **Tools:** semgrep, codeql, ripgrep, DOMPurify.
- **Applies to:** Web front-ends and server-rendered templates in any language.
- **When not to apply / counterpoints:**
  - Trusted, developer-authored HTML (static content in the repo) is acceptable through an escape hatch.
  - Sanitizing can strip formatting that users rely on.
  - Switching to `textContent` changes rendering: tags appear literally.
- **Fix risk:** medium

### T15-F17 — Make security-relevant failure paths fail closed; generic client errors; last-resort handler
- **Grade:** A · **Verdict:** CORRECTED. The A10 quote is replaced with the page's actual wording ("failing closed"). The ASVS levels are added: 16.5.1 and 16.5.3 are L2, and 16.5.4 is L3.
- **Rule:** Make failure paths that matter for security fail closed.
  - Find empty or over-broad catch blocks around authentication, authorization, validation, payment and crypto code.
  - Make sure an exception leads to deny, rollback or an error, never to allow or continue.
  - Return generic error messages to clients: no stack traces, SQL, file paths or tokens.
  - Make sure a last-resort handler logs unhandled exceptions on the server.
- **Rationale:**
  - A10:2025 Mishandling of Exceptional Conditions is new: 24 CWEs, 769,581 occurrences, 3,416 CVEs. It maps CWE-209, CWE-636 (failing open) and CWE-703, and says to roll back every part of a failed transaction ("also known as failing closed").
  - ASVS 5.0 16.5.3 (L2) forbids fail-open conditions. 16.5.1 (L2) requires generic messages. 16.5.4 (L3) requires a "last resort" handler. 13.4.2 (L2) requires debug modes off in production.
- **Evidence:**
  - [OWASP Top 10:2025 A10 Mishandling of Exceptional Conditions](https://top10.owasp.org/2025/A10_2025-Mishandling_of_Exceptional_Conditions/) — OWASP, 2025 — standard — "24 CWEs", "769,581" occurrences, "3,416" CVEs; "If you are part way through a transaction of any kind, it is extremely important that you roll back every part of the transaction and start again (also known as failing closed). Attempting to recover a transaction part way through is often where we create unrecoverable mistakes." — confirmed verbatim via page text. The exact heading "Fail Closed, Not Open" was not confirmed.
  - [OWASP ASVS 5.0.0 V16](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md) — OWASP, 2025 — standard — 16.5.1 (L2) "no exposure of sensitive internal system data such as stack traces, queries, secret keys, and tokens"; 16.5.3 (L2) "preventing fail-open conditions such as processing a transaction despite errors resulting from validation logic"; 16.5.4 (L3) "a 'last resort' error handler is defined which will catch all unhandled exceptions" — confirmed verbatim with levels.
  - [OWASP ASVS 5.0.0 V13](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/en/0x22-V13-Configuration.md) — OWASP, 2025 — standard — 13.4.2 (L2) "debug modes are disabled for all components in production environments" — confirmed.
- **Detect:**
  - Empty or swallowing handlers: `rg -n 'catch\s*(\([^)]*\))?\s*\{\s*\}|except(\s+\w+)?\s*:\s*pass|except\s*:\s*$|rescue\s*=>\s*\w+\s*$|_ = err'`. Read each one in auth, validation or payment code and look for `return true`, `next()` or `allow` in the catch branch.
  - Leaks: `rg -n '(res\.(send|json)|return|Response)\(.*(err\.stack|traceback|e\.message|exception)'`
  - Debug flags: `rg -n 'DEBUG\s*=\s*True|app\.run\(.*debug\s*=\s*True|app\.debug\s*=\s*true|showStackError|display_errors'`
  - Check that a global handler exists: Express error middleware, `process.on('unhandledRejection')`, Django or Flask error handlers, Spring `@ControllerAdvice`.
  - Linters: `no-empty`, `bare-except`.
- **Tools:** ripgrep, semgrep, eslint (no-empty), ruff/pylint (bare-except).
- **Applies to:** All languages; especially auth, payment and validation paths.
- **When not to apply / counterpoints:**
  - Some components fail open on purpose for availability (feature flags, rate limiters, optional telemetry). That is fine when documented, and flipping them to fail closed can cause outages.
  - Generic client errors make support harder unless there are correlation IDs in the logs.
  - The last-resort handler is an L3 requirement in ASVS.
- **Fix risk:** medium

### T15-F19 — Fix cryptographic misuse: CSPRNG tokens, proper password hashing, no ECB/MD5/SHA-1 for security, constant-time compares
- **Grade:** A · **Verdict:** CORRECTED. Four changes:
  1. `crypto.randomUUID()` is removed as a token source. ASVS 11.5.1 says "UUIDs do not respect this condition" (UUIDv4 carries 122 random bits).
  2. The password algorithms now follow OWASP's preference order instead of being listed as equals.
  3. ASVS levels are added: 11.5.1 and 11.4.2 are L2, 11.3.1 is L1, 11.2.4 is L3.
  4. The Node CSPRNG list comes from the OWASP Cryptographic Storage cheat sheet.
- **Rule:**
  1. Security tokens, IDs, nonces and keys come from a CSPRNG with at least 128 bits of entropy: Python `secrets`, Java `SecureRandom`, Node `crypto.randomBytes(16+)`. Never use `Math.random`/`random`. Do not rely on UUIDs as secret tokens.
  2. Store passwords with a password hashing function, in OWASP's order of preference:
     - Argon2id, minimum m=19 MiB, t=2, p=1.
     - scrypt if Argon2id is unavailable: N=2^17, r=8, p=1.
     - bcrypt for legacy systems: work factor at least 10, and mind the 72-byte limit.
     - PBKDF2-HMAC-SHA256 with 600,000 iterations when FIPS-140 is required.
  3. No ECB mode, no MD5 or SHA-1 for security, no homemade crypto. Prefer authenticated modes (GCM/CCM) and Curve25519.
  4. Compare MACs and tokens in constant time.
- **Rationale:** ASVS 5.0 sets the requirements:
  - 11.5.1 (L2): CSPRNG plus at least 128 bits.
  - 11.3.1 (L1): no ECB.
  - 11.4.2 (L2): a password hashing function with parameters "based on current guidance".
  - 11.2.4 (L3): constant-time operations.

  The OWASP Password Storage Cheat Sheet supplies the parameters. The OpenSSF badge's `crypto_random` says keys and nonces MUST come from a CSPRNG. Bandit B311, B324 and B303 detect the Python cases.
- **Evidence:**
  - [OWASP ASVS 5.0.0 V11 Cryptography](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/en/0x20-V11-Cryptography.md) — OWASP, 2025 — standard — 11.5.1 (L2) "...cryptographically secure pseudo-random number generator (CSPRNG) and have at least 128 bits of entropy. Note that UUIDs do not respect this condition."; 11.3.1 (L1) "insecure block modes (e.g., ECB) and weak padding schemes (e.g., PKCS#1 v1.5) are not used"; 11.4.2 (L2); 11.2.4 (L3) constant-time — confirmed verbatim with levels.
  - [Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) — OWASP — standard — "Use Argon2id with a minimum configuration of 19 MiB of memory, an iteration count of 2, and 1 degree of parallelism"; "If Argon2id is not available, use scrypt ..."; "For legacy systems using bcrypt, use a work factor of 10 or more and with a password limit of 72 bytes"; "If FIPS-140 compliance is required, use PBKDF2 ... 600,000 or more"; hash layering for legacy upgrades — confirmed verbatim.
  - [Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) — OWASP — standard — Node: "crypto.randomBytes(), crypto.randomInt(), crypto.randomUUID()" listed as secure versus "Math.random()"; "ECB should not be used outside of very specific circumstances"; custom crypto: "Don't do this."; GCM/CCM "first preference"; Curve25519 preferred — confirmed. Note that this cheat sheet lists randomUUID as CSPRNG-backed, while ASVS 11.5.1 excludes UUIDs for the 128-bit requirement.
  - [OpenSSF Best Practices Badge criteria](https://www.bestpractices.dev/en/criteria/0) — OpenSSF — standard — crypto_random: "MUST generate all cryptographic keys and nonces using a cryptographically secure random number generator" — confirmed.
  - [Bandit blacklist calls](https://bandit.readthedocs.io/en/latest/blacklists/blacklist_calls.html) — PyCQA — official docs — B311 "Standard pseudo-random generators are not suitable for security/cryptographic purposes"; B303 md5; B324 hashlib on the plugins page — confirmed.
- **Detect:**
  - Weak RNG near token, reset, invite, session, OTP or key code: `rg -n 'Math\.random\(|random\.(random|randint|choice|getrandbits)\(|\brand\(\)|mt_rand\(|new Random\('`
  - Weak algorithms and modes: `rg -n -i 'md5|sha1\b|sha-1|DES\b|RC4|AES/ECB|MODE_ECB|createCipher\('`
  - Password hashing: `rg -n -i 'hash.*password|password.*hash'`, then check the algorithm and its parameters.
  - Timing: `rg -n '(token|signature|hmac|digest|secret)\s*(===?|!==?)\s*'`. Fix with `hmac.compare_digest`, `crypto.timingSafeEqual` or `MessageDigest.isEqual`.
  - Scanners: Bandit B311, B324, B303; Semgrep and CodeQL crypto queries.
- **Tools:** bandit, semgrep, codeql, ripgrep.
- **Applies to:** All languages.
- **When not to apply / counterpoints:**
  - MD5, SHA-1 and non-crypto RNGs are fine for non-security uses (cache keys, corruption checksums, UI shuffles). These produce many false positives.
  - Changing the password-hash algorithm without a migration locks users out, so rehash on next login or layer hashes as OWASP describes.
  - Stronger KDF parameters add login latency and server cost.
- **Fix risk:** high

### T15-F02 — Scan the tree, full git history and built artifacts for secrets; high-recall scanner, then triage
- **Grade:** A · **Verdict:** VERIFIED. Note that the Gitleaks README's pre-commit example pins v8.24.2, while the latest release is v8.30.1 (21 Mar 2026).
- **Rule:** Scan the working tree, the entire git history (all branches and tags) and any built artifacts or images for secrets.
  - Use a high-recall pattern scanner, then a verifying scanner to prioritise.
  - Treat unverified hits in non-test code as real until a human confirms otherwise, because verification-only triage misses many critical secrets.
  - Put accepted false positives (test fixtures) in a baseline or an inline allow comment. Do not disable rules.
- **Rationale:**
  - Standards: ASVS 5.0 13.3.1 (L2) says "Secrets must not be included in application source code or included in build artifacts". The OpenSSF badge says public repos "MUST NOT leak a valid private credential".
  - Scale (GitGuardian, vendor): 23.8M secrets leaked on public GitHub in 2024, and 28.65M hardcoded secrets added in 2025 (+34%). 35% of private repositories contain plaintext secrets, against 4.6% of public ones.
  - Tool accuracy (ESEM 2023, 9 tools on a benchmark): Gitleaks had the highest recall (88%) but 46% precision. GitHub Secret Scanner had the best precision (75%). No single tool is enough, and output needs triage.
- **Evidence:**
  - [A Comparative Study of Software Secrets Reporting by Secret Detection Tools](https://arxiv.org/abs/2307.00714) — Basak, Cox, Reaves, Williams (ESEM 2023) — peer reviewed — 5 open-source and 4 proprietary tools; precision: GitHub Secret Scanner 75%, Gitleaks 46%; recall: Gitleaks 88%, SpectralOps 67%, TruffleHog 52%; false positives from "generic regular expressions and ineffective entropy calculation" — confirmed verbatim in the abstract.
  - [The State of Secrets Sprawl 2026](https://blog.gitguardian.com/the-state-of-secrets-sprawl-2026/) — GitGuardian, 2026 — industry report (vendor) — "28.65 million new hardcoded secrets were added to public GitHub commits in 2025 alone, a 34% increase"; "46% of critical secrets are missed by validation-only prioritization" — confirmed.
  - [The State of Secrets Sprawl 2025](https://blog.gitguardian.com/the-state-of-secrets-sprawl-2025/) — GitGuardian, 2025 — industry report (vendor) — "23.8 million secrets leaked on public GitHub repositories in 2024"; 35% of private and 4.6% of public repos contain secrets; generic secrets 58% — confirmed.
  - [OWASP ASVS 5.0.0 V13](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/en/0x22-V13-Configuration.md) — OWASP, 2025 — standard — 13.3.1 (L2), last sentences: "Secrets must not be included in application source code or included in build artifacts. For an L3 application, this must involve a hardware-backed solution such as an HSM." — confirmed verbatim.
  - [OpenSSF Best Practices criteria](https://www.bestpractices.dev/en/criteria/0) — OpenSSF — standard — no_leaked_credentials: "The public repositories MUST NOT leak a valid private credential" — confirmed.
  - [gitleaks README](https://github.com/gitleaks/gitleaks) — gitleaks project — official docs — `gitleaks git -v`, `gitleaks dir -v`, `--baseline-path`, `#gitleaks:allow`; "Gitleaks is feature complete. I'm not merging new features into Gitleaks. Future releases will be security patches only. I'm shifting my focus to Betterleaks". The repo is not archived — confirmed.
  - [trufflehog README](https://github.com/trufflesecurity/trufflehog) — Truffle Security — official docs — `--results=verified`; verified = "Credential confirmed as valid and active by API testing"; statuses verified, unverified and unknown. The README says 800+ secret types classified and 700+ with active verification — confirmed.
  - [Vulnerabilities, Secrets and Misconfiguration in the Highest-Exposure Docker Hub Images](https://arxiv.org/abs/2608.02669) — Kapelinski, Machado, Kreutz, Aug 2026 — preprint — "TruffleHog flags a secret in 76.9% of images, yet hand-labeling 1,100 random detections finds 99.7% are non-credentials" — confirmed verbatim.
- **Detect:**
  - History: `gitleaks git -v --report-path gitleaks-report.json`
  - Working tree: `gitleaks dir -v .`
  - Later passes, new findings only: `gitleaks git --baseline-path gitleaks-report.json --report-path findings.json`
  - Verification: `trufflehog git <repo-url> --results=verified`, then also review the unverified and unknown results.
  - Semgrep: `semgrep scan --config p/secrets`
  - Env files ever committed: `git log --all --full-history --oneline -- '*.env' '**/.env' '.env*'` and `git ls-files | grep -iE '(^|/)\.env($|\.)' | grep -v example`
  - Never paste secret values into shell commands or chat.
- **Tools:** gitleaks, betterleaks, trufflehog, semgrep.
- **Applies to:** Every repository in any language. The history scan matters most for repos that are or were public, forked or mirrored.
- **When not to apply / counterpoints:**
  - False-positive rates are high: Gitleaks precision is 46%, and 99.7% of TruffleHog hits on images were non-credentials.
  - Verified-only mode cuts noise but misses services it cannot verify (GitGuardian: 46% of critical secrets).
  - Tool status: Gitleaks' author, Zach Rice, launched Betterleaks as a drop-in successor. The announcement is hosted by a vendor (Aikido), so pin versions and name both tools.
- **Fix risk:** low (scanning is read-only)

### T15-F03 — A real leaked secret is fixed by rotation (human-owned), not by deleting the line; history rewrite only with approval
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:** When a real secret turns up in HEAD or in history:
  1. The owner revokes and rotates it.
  2. The value moves to a secret store or runtime injection.
  3. Only then, optionally and with explicit approval, the history is rewritten.

  Deleting the line in a new commit is never a fix. An agent running this pass stops and hands rotation to a human. It never rewrites or force-pushes history on its own.
- **Rationale:**
  - GitHub says "as a first step you need to revoke and/or rotate that secret".
  - Rewriting changes every later commit hash. The data survives in forks, PR refs, SHA lookups and other clones, and collaborators can re-push it.
  - OWASP lists revocation, rotation and deletion, and warns that squashing history "may introduce other problems".
  - Leaked secrets stay usable for years: nearly 70% of credentials confirmed valid in 2022 were still valid in January 2025, and more than 64% in January 2026.
  - In the tj-actions incident, CISA's first mitigation was to rotate every exposed secret.
- **Evidence:**
  - [Removing sensitive data from a repository](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) — GitHub Docs — official docs — "as a first step you need to revoke and/or rotate that secret"; rewriting changes hashes of the commit and all later ones; "You cannot remove sensitive data from other users' clones"; data stays reachable via forks, SHA lookups and PR refs; old clones can reintroduce it on `git pull` + `git push`; GitHub Support removes cached views only when rotation cannot mitigate the risk — confirmed.
  - [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) — OWASP — standard — "1. Revocation ... 2. Rotation ... 3. Deletion"; "Secrets in code could have commit history for the exposure squashed to before the introduction of the secret, however, this may introduce other problems as it rewrites git history and will break any other links to a given commit." — confirmed.
  - [The State of Secrets Sprawl 2026](https://blog.gitguardian.com/the-state-of-secrets-sprawl-2026/) — GitGuardian, 2026 — industry report (vendor) — "In the 2025 report, we found that nearly 70% of credentials confirmed as valid in 2022 were still valid in January 2025 ... When we retested that same dataset in January 2026, the validity rate was still above 64%" — confirmed.
  - [Supply Chain Compromise of tj-actions/changed-files (CVE-2025-30066)](https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-tj-actionschanged-files-cve-2025-30066-and-reviewdogaction) — CISA, 18 Mar 2025 — incident report — exposure of "valid access keys, GitHub Personal Access Tokens (PATs), npm tokens, and private RSA keys"; "Rotate all identified secrets immediately as they should be considered compromised" — confirmed.
- **Detect:**
  - For each confirmed hit, record: the file, the commit, whether it is still in HEAD, and whether the repo is or was public, forked or mirrored.
  - Check whether the secret is live via trufflehog's verified status or the provider console.
  - Also check CI logs, because the tj-actions exfiltration went through workflow logs.
  - The output is a rotation ticket for the human owner, not a code change.
- **Tools:** gitleaks, trufflehog, git-filter-repo (only with human approval).
- **Applies to:** Any repository where a real credential is found.
- **When not to apply / counterpoints:**
  - For a private repo whose key has been rotated, rewriting history may be unnecessary and harmful (broken SHAs and PR links).
  - Test or dummy keys go on an allowlist; they are not rotated.
  - OWASP presents squashing as a legitimate option. GitHub treats it as secondary to rotation.
- **Fix risk:** high

### T15-F05 — SCA over every lockfile with more than one tool; triage by shipped → reachable → exploitable; recorded ignores
- **Grade:** A · **Verdict:** CORRECTED. Three changes:
  1. The SCA disagreement figure comes from one application (OpenMRS, with Maven and npm parts) scanned by 9 tools, not from "the same Maven projects" in general.
  2. The Scorecard ignore-file wording is replaced with the page's actual text.
  3. The Endor Labs figures are flagged as vendor data.
- **Rule:** Scan every lockfile and manifest with OSV-Scanner plus the ecosystem's native auditor. Triage each advisory in order:
  1. Is the package in the production artifact?
  2. Is the vulnerable symbol reachable? Use govulncheck or OSV-Scanner call analysis where supported; otherwise grep for the affected API named in the advisory.
  3. Is it exploitable?

  Fix what is reachable or shipped. Record non-applicable advisories in the tool's ignore file with a reason and a review date. Never silence the whole scanner.
- **Rationale:**
  - CWE-1395 is mapped in OWASP A03:2025, which says to continuously monitor CVE, NVD and OSV.
  - ASVS 15.1.1 and 15.2.1 (L1) require documented remediation time frames. The OpenSSF badge forbids unpatched medium+ vulnerabilities that have been public for more than 60 days.
  - Tools disagree widely. On one large application, reported vulnerable dependencies ranged from 17 to 332 (Maven) and from 32 to 239 (npm) across 9 SCA tools (ESEM 2021).
  - Reachability cuts noise. govulncheck marks "no call stacks" cases as informational. Endor Labs (vendor) reports that fewer than 9.5% of vulnerabilities are exploitable at the function level.
  - Critical vulnerabilities persist for over a year on average and are mostly transitive (about 1,000 OSS projects, 2025 preprint).
- **Evidence:**
  - [A Comparative Study of Vulnerability Reporting by Software Composition Analysis Tools](https://arxiv.org/abs/2108.12078) — Imtiaz, Thorne, Williams (ESEM 2021, DOI 10.1145/3475716.3475769) — peer reviewed — "The count of reported vulnerable dependencies ranges from 17 to 332 for Maven and from 32 to 239 for npm projects across the studied tools"; 9 tools, one large web application (OpenMRS); "practitioners should not rely on any single tool" — confirmed.
  - [Tutorial: Find and fix vulnerable dependencies with govulncheck](https://go.dev/doc/tutorial/govulncheck) — Go team — official docs — "identifying any direct or indirect calls to those vulnerabilities in your code"; "there are no call stacks leading to the use of this vulnerability. You may not need to take any action." — confirmed verbatim.
  - [OSV-Scanner: Project source scanning](https://google.github.io/osv-scanner/usage/scan-source) — Google/OSV — official docs — `osv-scanner scan source -r /path/to/your/dir`; Go call analysis on by default; "Call analysis in Rust is still considered experimental"; `--call-analysis=all` — confirmed. The same OSV-Scanner documentation warns that "Running call analysis for Rust will execute build scripts (`build.rs`) in your dependencies", so run it only in a sandbox (verified in dependency-hygiene T16-F08; added here after review).
  - [2024 Dependency Management Report](https://www.endorlabs.com/lp/2024-dependency-management-report) — Endor Labs, 2024 — industry report (vendor) — "Less than 9.5% of vulnerabilities are exploitable at the function level"; reachability plus EPSS gives "noise reduction of 98%"; advisories: "only 2% contain information about affected functions" — confirmed on page.
  - [A Comprehensive Study on the Impact of Vulnerable Dependencies on Open-Source Software](https://arxiv.org/abs/2512.03868) — Bittugondanahalli Indra Kumar et al., Dec 2025 — preprint — "over 1k open-source software projects with about 50k releases" across Java, Python, Rust, Go, Ruby, PHP and JavaScript; "a critical vulnerability persists in average for over a year before being fixed"; "for most programming languages, vulnerable dependencies are transitive" — confirmed.
  - [OpenSSF Best Practices criteria](https://www.bestpractices.dev/en/criteria/0) — OpenSSF — standard — "There MUST be no unpatched vulnerabilities of medium or higher severity that have been publicly known for more than 60 days" — confirmed verbatim.
  - [OWASP ASVS 5.0.0 V15](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/en/0x24-V15-Secure-Coding-and-Architecture.md) — OWASP, 2025 — standard — 15.1.1 (L1) "defines risk based remediation time frames for 3rd party component versions with vulnerabilities"; 15.2.1 (L1) "only contains components which have not breached the documented update and remediation time frames" — confirmed.
  - [OpenSSF Scorecard checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md) — OpenSSF — standard — Vulnerabilities (High risk) uses OSV; "To ignore, create an `osv-scanner.toml` file next to the dependency manifest (e.g. package-lock.json) and specify the ID to ignore and reason" — confirmed verbatim. The earlier wording "formally ignore non-applicable vulnerabilities" was not on the page.
  - [OWASP Top 10:2025 A03](https://top10.owasp.org/2025/A03_2025-Software_Supply_Chain_Failures/) — OWASP, 2025 — standard — CWE-1395 mapped; "Continuously monitor sources like ... CVE, NVD, and OSV" — confirmed.
- **Detect:**
  - All ecosystems: `osv-scanner scan source -r .` (Go call analysis is on by default). Add `--call-analysis=all` (or `--call-analysis=rust`) for experimental Rust call analysis only in a sandbox: "Running call analysis for Rust will execute build scripts (`build.rs`) in your dependencies" (verified in dependency-hygiene T16-F08).
  - Go: `govulncheck ./...`
  - Python: `pip-audit -r requirements.txt --strict`
  - Rust: `cargo audit`, `cargo deny check`
  - npm: `npm audit --omit=dev --audit-level=high`, then a full `npm audit` to see dev-tool exposure separately.
  - Where no call analysis exists: `grep -rn '<affected function or module>' src/`
  - The pip-audit and cargo flags were not re-verified in this pass.
- **Tools:** osv-scanner, govulncheck, pip-audit, cargo-audit, cargo-deny, npm audit.
- **Applies to:** All projects with third-party dependencies. Free, automated function-level reachability was verified only for Go (and Rust, experimental).
- **When not to apply / counterpoints:**
  - Compliance and customers may demand fixes regardless of reachability. An HN commenter (maltalex) wrote: "If you ship them vulnerable binaries, they'll complain even if the vulnerable code is never used". The OpenSSF 60-day criterion does not mention reachability.
  - Abramov showed that npm audit hits in build tooling are mostly irrelevant at runtime. But dev dependencies run code on developer and CI machines, which is a separate malware threat (F08).
- **Fix risk:** low

### T15-F11 — CI workflows: SHA-pin third-party actions, read-only default token, no context interpolation into run:, no untrusted checkout in privileged triggers
- **Grade:** A · **Verdict:** CORRECTED. Three changes:
  1. The warning that bots updating SHA pins reintroduce the risk came from HN user frenchtoast8, not brokenpip3 (brokenpip3 shared a pinning script).
  2. The zizmor `unpinned-uses` description is replaced with the docs' wording. By default since v1.20.0 it requires hash-pinning for all actions.
  3. The "23K+ repos" figure comes from the HN/StepSecurity story title, not from CISA.
- **Rule:** If the project has CI workflows (GitHub Actions or similar):
  - Pin third-party actions to a full commit SHA with a version comment.
  - Set the token's default permissions to read-only (`permissions: contents: read` at the top level) and grant write per job.
  - Never interpolate `${{ github.event.* }}` or other attacker-controlled context straight into `run:` scripts; pass it through `env:`.
  - Avoid `pull_request_target`/`workflow_run` jobs that check out and run PR code.
- **Rationale:**
  - GitHub: "Pinning an action to a full-length commit SHA is currently the only way to use an action as an immutable release", and "a tag can be moved or deleted".
  - In March 2025, tj-actions/changed-files had malicious versions that dumped CI secrets into logs (CISA, CVE-2025-30066).
  - Scorecard rates Token-Permissions High risk and Dangerous-Workflow Critical risk, and names "Untrusted Code Checkout" and "Script Injection with Untrusted Context Variables".
- **Evidence:**
  - [Secure use reference (GitHub Actions)](https://docs.github.com/en/actions/reference/security/secure-use) — GitHub Docs — official docs — "Pinning an action to a full-length commit SHA is currently the only way to use an action as an immutable release"; "a tag can be moved or deleted"; recommends a read-only default GITHUB_TOKEN for contents and an intermediate environment variable against script injection — confirmed.
  - [Supply Chain Compromise of tj-actions/changed-files (CVE-2025-30066)](https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-tj-actionschanged-files-cve-2025-30066-and-reviewdogaction) — CISA, 2025 — incident report — malicious window "2025-03-12 00:00 UTC to 2025-03-15 12:00 UTC"; patched in v46.0.1; rotate secrets. CISA does not give a count of affected repos — confirmed.
  - [OpenSSF Scorecard checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md) — OpenSSF — standard — Token-Permissions: Risk High, "Set top-level permissions as `read-all` or `contents: read`"; Dangerous-Workflow: Risk Critical, "Untrusted Code Checkout", "Script Injection with Untrusted Context Variables" — confirmed.
  - [zizmor audit rules](https://docs.zizmor.sh/audits/) — zizmor project — official docs — `unpinned-uses`: 'Detects "unpinned" uses: clauses'; "Starting with zizmor v1.20.0, the default policy for unpinned-uses is to require hash-pinning on all actions"; also `template-injection`, `excessive-permissions`, `dangerous-triggers` (pull_request_target, workflow_run), `artipacked`, `secrets-inherit`, `cache-poisoning` — confirmed.
  - [HN: tj-actions/changed-files compromised, comment by arianvanp](https://news.ycombinator.com/item?id=43372045) — Hacker News, 2025 — practitioner forum — "actions can be Composite and call arbitrary other actions. So only if you use actions that themselves lock everything by commit for the actions they depend on you're safe." — confirmed via the HN Algolia API (story 43367987, 273 points).
  - [HN comment by frenchtoast8](https://news.ycombinator.com/item?id=43369373) — Hacker News, 2025 — practitioner forum — "lots of people use bots like Renovate to update your pinned hashes whenever a new version is published, which runs into the same problem." — confirmed (replaces the misattribution to brokenpip3).
- **Detect:**
  - `zizmor .github/workflows/` (unpinned-uses, excessive-permissions, template-injection, dangerous-triggers, artipacked, secrets-inherit, cache-poisoning).
  - Tag or branch pins: `grep -rnE 'uses: [^@]+@(v?[0-9]+(\.[0-9]+)*|main|master)\s*$' .github/workflows/`
  - Risky triggers: `grep -rn 'pull_request_target\|workflow_run' .github/workflows/`
  - Context interpolation in scripts: `grep -rnE 'run:.*\$\{\{\s*github\.event' .github/workflows/`
  - Scorecard: `--checks=Pinned-Dependencies,Token-Permissions,Dangerous-Workflow`
- **Tools:** zizmor, scorecard, dependabot/renovate (to update SHA pins).
- **Applies to:** Repos with GitHub Actions. The principles (immutable refs, least-privilege tokens, no template injection) carry over to other CI systems.
- **When not to apply / counterpoints:**
  - SHA pins are not transitive: composite actions can pull in unpinned actions.
  - Bots that auto-update pins partly bring the risk back.
  - Pins need an update process.
  - Cutting permissions can break jobs that legitimately write (releases, PR comments).
- **Fix risk:** low

### T15-F14 — Never deserialize untrusted data with native object serializers
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:** Never deserialize untrusted data with native object serializers:
  - Python: `pickle`, `yaml.load` without a safe loader, `jsonpickle`.
  - Java: `ObjectInputStream.readObject`, `XMLDecoder`.
  - .NET: `BinaryFormatter`; Json.NET with `TypeNameHandling` other than None.
  - PHP `unserialize`; Ruby `Marshal.load`.

  Replace them with data-only formats (JSON) plus schema validation, safe loaders (`yaml.safe_load`), or signed payloads with a type allowlist.
- **Rationale:** CWE-502 is #15 in the 2025 CWE Top 25. OWASP says BinaryFormatter "is dangerous and cannot be secured", "Don't allow the datastream to define the type of object", and recommends JSON for PHP. Bandit flags pickle (B301) and `yaml.load` (B506).
- **Evidence:**
  - [Deserialization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html) — OWASP — standard — "Microsoft has stated that the BinaryFormatter type is dangerous and cannot be secured"; "Don't allow the datastream to define the type of object that the stream will be deserialized to"; "Where JSON.Net is being used make sure the TypeNameHandling is only set to None"; "Use a safe, standard data interchange format such as JSON"; Java markers "AC ED 00 05" and "rO0" — confirmed verbatim.
  - [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html) — MITRE/CISA, 2025 — standard — #15 CWE-502 — confirmed.
  - [Bandit blacklist calls](https://bandit.readthedocs.io/en/latest/blacklists/blacklist_calls.html) — PyCQA — official docs — B301 "Pickle and modules that wrap it can be unsafe when used to deserialize untrusted data"; B506 yaml_load on the plugins page — confirmed.
- **Detect:**
  - `rg -n 'pickle\.loads?\(|cPickle|jsonpickle\.decode|yaml\.load\(|yaml\.unsafe_load|ObjectInputStream|readObject\(|XMLDecoder|BinaryFormatter|TypeNameHandling\.(All|Auto|Objects|Arrays)|\bunserialize\(|Marshal\.load|shelve\.open|torch\.load\('`
  - Scanners: Bandit B301/B506, Semgrep `p/owasp-top-ten`, CodeQL unsafe-deserialization queries.
  - For each hit, decide whether the bytes can ever come from outside the trust boundary.
- **Tools:** bandit, semgrep, codeql, ripgrep.
- **Applies to:** Python, Java, .NET, PHP and Ruby; also ML projects that load downloaded model or pickle files.
- **When not to apply / counterpoints:**
  - Pickling data that only your own process writes and reads within a trust boundary is lower risk.
  - Migrating a persisted format needs a one-time converter.
  - `yaml.safe_load` rejects custom tags the app may rely on.
- **Fix risk:** medium

### T15-F16 — Block mass assignment and (JS) prototype pollution; return only needed fields
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:**
  - Bind request bodies only through explicit allowlists or DTOs: Rails strong params, Laravel `$fillable`, Spring `setAllowedFields`/DTOs, Django explicit fields, `_.pick` in Node.
  - Return only the fields the client needs.
  - In JS, never recursively merge user-controlled objects without rejecting `__proto__`, `constructor` and `prototype`. Prefer `Map`/`Set` or `Object.create(null)` for data keyed by user input.
- **Rationale:** ASVS 5.0 15.3.3 (L2) requires mass-assignment countermeasures, 15.3.6 (L2) requires JS code that prevents prototype pollution, and 15.3.1 (L1) requires returning only the required subset of fields. The OWASP cheat sheets give the mechanism for each framework.
- **Evidence:**
  - [OWASP ASVS 5.0.0 V15](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/en/0x24-V15-Secure-Coding-and-Architecture.md) — OWASP, 2025 — standard — 15.3.1 (L1) "only returns the required subset of fields from a data object"; 15.3.3 (L2) "...by limiting allowed fields per controller and action"; 15.3.6 (L2) "by using Set() or Map() instead of object literals" — confirmed verbatim.
  - [Mass Assignment Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html) — OWASP — standard — "Autobinding: Spring MVC, ASP NET MVC", "Object injection: PHP"; `binder.setAllowedFields(...)`, `protected $fillable`; sections for Rails, Django, Laravel and Grails — confirmed.
  - [Prototype Pollution Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Prototype_Pollution_Prevention_Cheat_Sheet.html) — OWASP — standard — "Developers should use new Set() or new Map() instead of using object literals"; Object.create(null); "--disable-proto=delete ... a defense in depth measure"; freeze/seal "can break the application" — confirmed.
- **Detect:**
  - `rg -n '\.(create|update|insert|build|new)\(\s*(req|request)\.(body|params|json)|Object\.assign\([^,]+,\s*req\.body|\{\s*\.\.\.req\.body|\$guarded\s*=\s*\[\s*\]|permit!|_\.(merge|defaultsDeep|set)\(|deepmerge\('`
  - Check for ORM entities bound straight from requests.
  - Check for responses that serialize whole models (`res.json(user)`, `fields = '__all__'`).
- **Tools:** ripgrep, semgrep, eslint (framework plugins).
- **Applies to:** Web backends with ORMs or auto-binding; JS/TS for prototype pollution.
- **When not to apply / counterpoints:**
  - Allowlisting breaks clients that currently set extra fields.
  - Freezing prototypes can break libraries.
  - Internal admin tools that bind all fields are acceptable only behind strong authorization.
- **Fix risk:** medium

### T15-F18 — Remove secrets and sensitive data from logs; neutralize CR/LF; log auth and authz failures
- **Grade:** A · **Verdict:** CORRECTED. The Meta/DPC fine is kept only as an illustration of plaintext credential storage. The DPC release says passwords were stored in plaintext "on its internal systems" and does not mention logs.
- **Rule:**
  - Remove secrets and sensitive data from logs: passwords, session IDs, access or refresh tokens, API keys, connection strings, full Authorization or Cookie headers, payment data, and most PII.
  - Avoid logging whole request, response or env objects.
  - Encode or strip CR/LF in user-controlled log fields.
  - Make sure authentication and authorization failures are logged.
- **Rationale:** The OWASP Logging Cheat Sheet:
  - lists data that should be "removed, masked, sanitized, hashed, or encrypted";
  - requires sanitizing CR, LF and delimiter characters;
  - lists authentication and authorization failures as events to log.

  ASVS 16.2.5, 16.3.1, 16.3.2 and 16.4.1 (all L2) codify this. CWE-532 says "Do not write secrets into the log files."
- **Evidence:**
  - [Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) — OWASP — standard — "The following should usually not be recorded directly in the logs, but instead should be removed, masked, sanitized, hashed, or encrypted:" including "Session identification values", "Access tokens", "Authentication passwords", "Database connection strings"; "Perform sanitization on all event data to prevent log injection attacks e.g. carriage return (CR), line feed (LF) and delimiter characters"; events "Authentication successes and failures", "Authorization (access control) failures" — confirmed verbatim.
  - [OWASP ASVS 5.0.0 V16](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md) — OWASP, 2025 — standard — 16.2.5 (L2) "it may not be allowed to log certain data, such as credentials or payment details"; 16.3.1 (L2) auth operations logged, including unsuccessful ones; 16.3.2 (L2) "failed authorization attempts are logged"; 16.4.1 (L2) "encode data to prevent log injection" — confirmed.
  - [CWE-532](https://cwe.mitre.org/data/definitions/532.html) — MITRE — standard — "Do not write secrets into the log files."; "Remove debug log files before deploying the application into production." — confirmed.
  - [DPC announces EUR 91 million fine of Meta](https://www.dataprotection.ie/en/news-media/press-releases/DPC-announces-91-million-fine-of-Meta) — Data Protection Commission (Ireland), 27 Sep 2024 — incident report — Meta "inadvertently stored certain passwords of social media users in 'plaintext' on its internal systems"; EUR 91M — confirmed. The release does not mention logging, so it is indirect support only.
- **Detect:**
  - Sensitive values passed to loggers: `rg -n -i '(log|logger|console|print|warn|error|info|debug)[\w.]*\(.*(password|passwd|secret|token|api[_-]?key|authorization|cookie|session|credential|connection[_-]?string|card)'`
  - Whole objects logged: `rg -n '(log|logger|console)\.[a-z]+\((req|request)(\.headers)?\)|process\.env\)|os\.environ\)'`
  - Check the logger config for redaction (pino `redact`, structlog processors, logback masking).
  - Check that the auth code path logs failures.
- **Tools:** ripgrep, semgrep, pino redact / structlog processors.
- **Applies to:** All languages and services that log.
- **When not to apply / counterpoints:**
  - Over-redaction weakens incident investigation. Hashing identifiers keeps them correlatable.
  - Downstream alerts may depend on fields you remove.
  - A logged failed-login username sometimes contains a mistyped password.
- **Fix risk:** low

### T15-F20 — Validate self-contained tokens (JWT/JWS/PASETO) completely
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:**
  - Verify the signature or MAC before reading any claim.
  - Pin an algorithm allowlist that excludes `none`.
  - Take keys only from pre-configured sources: allowlist or ignore `jku`, `x5u` and `jwk`.
  - Enforce `exp`/`nbf`, and check `aud` and the token type or purpose.
- **Rationale:** ASVS 5.0 V9 makes 9.1.1–9.1.3 and 9.2.1 Level 1, and 9.2.2–9.2.3 Level 2. In Node `jsonwebtoken`, `jwt.decode()` does not verify.
- **Evidence:**
  - [OWASP ASVS 5.0.0 V9 Self-contained Tokens](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/en/0x18-V9-Self-contained-Tokens.md) — OWASP, 2025 — standard — 9.1.1 (L1) "...validated using their digital signature or MAC to protect against tampering before accepting the token's contents"; 9.1.2 (L1) "must not include the 'None' algorithm"; 9.1.3 (L1) "'jku', 'x5u', and 'jwk' must be validated against an allowlist of trusted sources"; 9.2.1 (L1) "'nbf' and 'exp' must be verified"; 9.2.2 (L2) type/purpose; 9.2.3 (L2) "validating the 'aud' claim against an allowlist" — confirmed verbatim with levels.
  - [node-jsonwebtoken README](https://github.com/auth0/node-jsonwebtoken) — auth0 — official docs (added by the verifier) — jwt.decode: "This will __not__ verify whether the signature is valid. You should __not__ use this for untrusted messages." — confirmed.
  - [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html) — MITRE/CISA — standard — #21 CWE-306, #4 CWE-862. Tangential: token-validation gaps are not a ranked CWE of their own.
- **Detect:**
  - `rg -n 'jwt\.decode\(|verify_signature[\"\']?\s*:\s*False|verify\s*=\s*False|algorithms\s*=\s*None|ignoreExpiration\s*:\s*true|ignoreNotBefore|alg.*none'`
  - Check every verify call for an explicit `algorithms=[...]` and an audience or issuer.
- **Tools:** ripgrep, semgrep, codeql.
- **Applies to:** Any service that issues or consumes bearer tokens.
- **When not to apply / counterpoints:**
  - Strict `aud`/`exp` enforcement can reject tokens accepted today (clock skew, issuers with several audiences). Allow small leeway and monitor the rollout.
  - Some libraries already enforce these checks by default.
- **Fix risk:** medium

### T15-F21 — Harden outbound requests (SSRF) and resource use (timeouts, size/rate limits)
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:** Where the server fetches a URL influenced by user input:
  - Restrict destinations to an allowlist, or at minimum block private, loopback and metadata ranges after DNS resolution.
  - Turn off automatic redirects.
  - Build URLs from validated parts.

  Every network call needs a timeout. Every request body, upload, query result and loop over user input needs an explicit size or rate limit.
- **Rationale:**
  - SSRF (CWE-918) is #22 in the 2025 CWE Top 25 and now sits inside A01:2025.
  - ASVS 15.3.2 (L2): do not follow redirects unless intended.
  - OWASP: "Deny-lists are bypass-prone. Prefer allow-lists."
  - CWE-770 is #25, and ASVS 15.2.2 (L2) requires defenses against resource exhaustion.
  - Bandit B113 flags requests without a timeout.
- **Evidence:**
  - [Server-Side Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) — OWASP — standard — "Deny-lists are bypass-prone. Prefer allow-lists."; "Disable the support for the following of the redirection in your web client"; 169.254.169.254 and metadata hosts; "Case 2 - Application can send requests to ANY external IP address or domain name" — confirmed.
  - [OWASP ASVS 5.0.0 V15](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/en/0x24-V15-Secure-Coding-and-Architecture.md) — OWASP, 2025 — standard — 15.3.2 (L2), 15.2.2 (L2) — confirmed verbatim.
  - [2025 CWE Top 25](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html) — MITRE/CISA — standard — #22 CWE-918, #25 CWE-770, #12 CWE-434, #6 CWE-22 — confirmed.
  - [Bandit plugins](https://bandit.readthedocs.io/en/latest/plugins/index.html) — PyCQA — official docs — B113 request_without_timeout; B501 request_with_no_cert_validation — confirmed.
- **Detect:**
  - Outbound calls: `rg -n '(requests|httpx)\.(get|post|put|request)\(|fetch\(|axios(\.\w+)?\(|http\.Get\(|urlopen\(|HttpClient|RestTemplate|WebClient'`. Check each for a timeout, a redirect policy and a destination allowlist.
  - Disabled TLS verification: `rg -n 'verify\s*=\s*False|rejectUnauthorized\s*:\s*false|InsecureSkipVerify\s*:\s*true|NODE_TLS_REJECT_UNAUTHORIZED'`
  - Path traversal: `rg -n '(open|readFile|sendFile|send_file|Path)\(.*(req|request|params|args)'`
  - Check body and upload size limits, pagination caps and rate limits on auth endpoints.
  - Bandit B113, B501, B310.
- **Tools:** bandit, semgrep, codeql, ripgrep.
- **Applies to:** Backends that make outbound calls, accept uploads, or touch the filesystem with user-influenced paths.
- **When not to apply / counterpoints:**
  - Webhook and URL-preview features cannot use strict allowlists (OWASP "Case 2").
  - Limits that are too tight cause spurious failures, so derive them from observed latencies.
  - Network egress controls may be the better fix, and they sit outside the codebase.
- **Fix risk:** medium

### T15-F23 — Check production packaging and deploy config (no VCS metadata/debug, no committed binaries, non-root pinned containers, image scan)
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:**
  - Debug modes are off.
  - No `.git`/VCS metadata, source maps or debug endpoints are served.
  - No committed binaries that cannot be reviewed.
  - Containers run as a non-root `USER`, from a pinned base image, and are scanned for OS-package CVEs.
  - The deployment ships only what the app needs.
- **Rationale:**
  - ASVS 5.0: 13.4.1 (L1) no source control metadata; 13.4.2 (L2) debug off; 15.2.3 (L2) only required functionality.
  - Scorecard Binary-Artifacts (High risk): binaries "cannot be reviewed".
  - OWASP Docker: an unprivileged user "is the best way to prevent privilege escalation attacks", and "Ensure the base image version is pinned".
  - A 2026 preprint on the 52,895 highest-exposure Docker Hub repositories found 96.3% of images with a known package vulnerability and 98.0% with at least one CIS benchmark misconfiguration.
- **Evidence:**
  - [OWASP ASVS 5.0.0 V13](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/en/0x22-V13-Configuration.md) — OWASP, 2025 — standard — 13.4.1 (L1) "deployed either without any source control metadata, including the .git or .svn folders, or in a way that these folders are inaccessible"; 13.4.2 (L2) — confirmed verbatim.
  - [OpenSSF Scorecard checks: Binary-Artifacts](https://github.com/ossf/scorecard/blob/main/docs/checks.md) — OpenSSF — standard — Risk High; "Binary artifacts cannot be reviewed, allowing possible obsolete or maliciously subverted executables"; "Build from source." — confirmed.
  - [Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html) — OWASP — standard — "Configuring the container to use an unprivileged user is the best way to prevent privilege escalation attacks"; "Ensure the base image version is pinned"; Trivy, Grype, Clair; `--read-only` — confirmed.
  - [Vulnerabilities, Secrets and Misconfiguration in the Highest-Exposure Docker Hub Images](https://arxiv.org/abs/2608.02669) — Kapelinski, Machado, Kreutz, Aug 2026 — preprint — "96.3% of images carry a known package vulnerability, 93.4% a critical one, and 98.0% at least one CIS Docker Benchmark misconfiguration"; 52,895 repositories, 84.7% of pulls, six scanners — confirmed verbatim.
- **Detect:**
  - Committed binaries: `git ls-files | grep -Ei '\.(exe|dll|so|dylib|jar|war|class|pyc|whl|bin|o|a)$'` or `scorecard --checks=Binary-Artifacts`
  - Dockerfiles without a `USER` directive: `grep -L '^USER ' <dockerfiles>`
  - Unpinned base images: `grep -nE '^FROM [^@]+(:latest)?\s*$'`
  - Source maps in production configs.
  - `.dockerignore` excludes `.git`, `.env` and tests.
  - Scan the built image with Trivy or Grype.
- **Tools:** scorecard, trivy, grype, ripgrep.
- **Applies to:** Projects that ship containers, web bundles or deployable artifacts.
- **When not to apply / counterpoints:**
  - Some committed binaries are legitimate (test fixtures): document them rather than deleting them.
  - Public source maps are sometimes a deliberate choice.
  - OS-package CVE counts raise the same reachability debate as F05.
  - Moving to non-root can break file permissions or low-port binding.
- **Fix risk:** medium

### T15-F04 — Keep secrets out of build definitions and committed config (Dockerfile ENV/ARG, compose, CI YAML, IaC, .env)
- **Grade:** A · **Verdict:** CORRECTED. The zizmor descriptions are replaced with the docs' wording. `unredacted-secrets` "Detects potential secret leakage via redaction failures", for example `fromJSON(secrets.X).field`, which the runner does not mask. It is not a generic "secrets exposed in output" check.
- **Rule:**
  - No credentials in Dockerfile ENV/ARG or image layers, docker-compose files, CI workflow YAML, IaC, or committed `.env` files.
  - Use BuildKit secret mounts (`RUN --mount=type=secret,...`) for build-time secrets, and runtime injection or a secret manager for run-time secrets.
  - Commit only a `.env.example` with empty values.
- **Rationale:**
  - Docker: build arguments and environment variables "are inappropriate for passing secrets to your build, because they persist in the final image".
  - OWASP: ENV/ARG "can easily leak with the container definitions", and environment variables "may be included in logs or system dumps".
  - ASVS 13.3.1 covers build artifacts.
  - GitGuardian (vendor): AWS IAM keys appear in 8% of private repositories, five times more often than in public ones.
- **Evidence:**
  - [Build secrets](https://docs.docker.com/build/building/secrets/) — Docker Docs — official docs — "Build arguments and environment variables are inappropriate for passing secrets to your build, because they persist in the final image."; secret mounts and SSH mounts recommended — confirmed verbatim.
  - [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) — OWASP — standard — "Secrets themselves should never be hardcoded using docker ENV or docker ARG commands, as these can easily leak with the container definitions."; "Environment variables are generally accessible to all processes and may be included in logs or system dumps." — confirmed.
  - [The State of Secrets Sprawl 2025](https://blog.gitguardian.com/the-state-of-secrets-sprawl-2025/) — GitGuardian, 2025 — industry report (vendor) — "AWS IAM keys in 8% of private repositories (5x more frequent than public repositories)" — confirmed.
  - [zizmor audit rules](https://docs.zizmor.sh/audits/) — zizmor — official docs — hardcoded-container-credentials: "Detects Docker credentials (usernames and passwords) hardcoded in various places within workflows"; unredacted-secrets: "Detects potential secret leakage via redaction failures" — confirmed (wording corrected).
- **Detect:**
  - Dockerfiles: `grep -nEi '^\s*(ENV|ARG)\s+[A-Z0-9_]*(PASS|SECRET|TOKEN|KEY|CRED)' <dockerfiles>`
  - Built images: `docker history --no-trunc <image>`
  - Committed env files: `git ls-files | grep -iE '(^|/)\.env($|\.)' | grep -v '\.example$'`
  - Workflows: `zizmor .github/workflows/`
  - Compose and IaC files: `gitleaks dir` (F02).
- **Tools:** zizmor, gitleaks, docker.
- **Applies to:** Projects with containers, CI, IaC or dotenv configuration.
- **When not to apply / counterpoints:**
  - Runtime environment variables are still the norm on most PaaS platforms. OWASP flags a leakage risk, not a ban.
  - An uncommitted `.env` loaded at runtime can be an acceptable trade-off for a solo project.
  - Non-secret ARGs are fine.
- **Fix risk:** medium

### T15-F07 — Commit lockfiles and install from them in frozen mode; pair with an update bot
- **Grade:** A · **Verdict:** CORRECTED. Two changes:
  1. The codecentric Shai-Hulud article is removed as support. Its text contains no recommendation of `npm ci`, `--ignore-scripts` or lockfile discipline; it is about scanner data sources (see Practitioner voice).
  2. Scorecard Pinned-Dependencies is scoped correctly: it checks Dockerfiles, shell scripts and GitHub workflows, not application lockfiles, so it supports the principle only.
- **Rule:** Every application commits its lockfile, and CI and deploys install from it in frozen mode: `npm ci`; pnpm with the committed `pnpm-lock.yaml`; pip with hashes or `pylock.toml`; `go.sum`; `Cargo.lock`. A lockfile without an update bot freezes vulnerabilities in place, so pair it with Dependabot or Renovate (cooldowns in F08).
- **Rationale:**
  - `npm ci` "will exit with an error" when the lock and package.json disagree, and never writes to them.
  - pnpm: "Commit your lockfile to your repository to avoid unexpected updates."
  - Scorecard: pinning ensures "checking and deployment are all done with the same software".
  - pip 26.1 added experimental `pylock.toml` installs with hash validation.
  - The Rust Cargo team dropped its "don't commit Cargo.lock for libraries" advice in 2023.
- **Evidence:**
  - [npm-ci](https://docs.npmjs.com/cli/v11/commands/npm-ci) — npm Docs (CLI v11) — official docs — "If dependencies in the package lock do not match those in package.json, npm ci will exit with an error"; "It will never write to package.json or any of the package-locks" — confirmed verbatim.
  - [Supply chain security](https://pnpm.io/supply-chain-security) — pnpm — official docs — "Commit your lockfile to your repository to avoid unexpected updates."; "Since v11.20.0, pnpm records those packages in the lockfile under registry-qualified keys" — confirmed.
  - [OpenSSF Scorecard checks: Pinned-Dependencies](https://github.com/ossf/scorecard/blob/main/docs/checks.md) — OpenSSF — standard — Risk Medium; 'A "pinned dependency" is a dependency that is explicitly set to a specific hash instead of allowing a mutable version or range of versions'; "They ensure that checking and deployment are all done with the same software". It checks Dockerfiles, shell scripts and GitHub workflows — confirmed, scope noted.
  - [What's new in pip 26.1](https://sichard.ca/blog/2026/04/whats-new-in-pip-26.1/) — Richard Si (pip maintainer), 26 Apr 2026 — engineering blog — "pip 26.1 gains experimental support for reading and installing from such lockfiles"; "If hashes are available for a locked requirement, pip will validate hashes as expected." — confirmed.
  - [Change in Guidance on Committing Lockfiles](https://blog.rust-lang.org/2023/08/29/committing-lockfiles/) — Ed Page for the Cargo team, 29 Aug 2023 — official docs — "do what is best for their project"; suggests a scheduled `cargo update` job or bots that update `Cargo.lock` in PRs — confirmed.
- **Detect:**
  - Lockfiles present: `git ls-files | grep -E '(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|poetry\.lock|uv\.lock|Pipfile\.lock|pylock\.toml|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock)$'`
  - Non-frozen installs: `grep -rnE 'npm install|pip install -r' .github/ Dockerfile* scripts/`
  - Update bot: `ls .github/dependabot.yml renovate.json* 2>/dev/null`
  - Scorecard: `--checks=Pinned-Dependencies,Dependency-Update-Tool`. Dependency-Update-Tool was confirmed to exist.
- **Tools:** npm ci, pnpm, pip (hash-checking / pylock.toml), scorecard.
- **Applies to:** Applications and services in every ecosystem. For published libraries it is a judgement call (Rust guidance), but CI should still test against the latest versions.
- **When not to apply / counterpoints:**
  - A lockfile does not help if a malicious version is already locked.
  - It freezes known-vulnerable versions unless something updates it (Scorecard pairs Pinned-Dependencies with Dependency-Update-Tool).
  - The claim that lockfiles blocked Shai-Hulud's silent upgrades is plausible but not sourced here.
- **Fix risk:** low

### T15-F01 — Treat SAST output as leads, not verdicts; triage every alert source→sink; manual review for authz/logic
- **Grade:** A · **Verdict:** CORRECTED (counterpoints only):
  - The quote attributed to woodruffw ("FP/FN ratio simply wasn't worth it") could not be found in any fetched thread and was removed.
  - silverwind's "CodeQL seems to raise too many false-positives" is confirmed (HN item 47099262). The reply by Chris_Newton, who says CodeQL's path-backed reports resist false positives, is added.
  - All numeric evidence was confirmed verbatim.
- **Rule:** Treat SAST output as leads, not verdicts.
  - Run at least one semantic engine (CodeQL security-extended and/or Semgrep) plus the language's security linter (e.g. Bandit for Python).
  - Triage every alert before changing code: trace a concrete untrusted source to the flagged sink, or prove the path unreachable or constant.
  - Record each suppression with the rule-specific id and a written reason. Pin and record tool versions.
  - Never report "0 alerts" as "secure". Tools do not see authorization or business-logic flaws, so a manual review of those is mandatory (F15–F17).
- **Rationale:**
  - Standards require static analysis and triage: the OpenSSF badge says a SAST tool "MUST be applied", and SSDF PW.7.2 says "record and triage all discovered issues".
  - Empirical recall and precision are low:
    - Charoenwet et al. (ISSTA 2024): a single SAST tool warned in the vulnerable function for 52% of VCCs; at least 76% of warnings in vulnerable functions were irrelevant; 22% of VCCs were missed because of rule limitations.
    - CodeQL longitudinal preprint (2026): CodeQL identified 171 of 3,993 CVEs, 83 of them with a pre-fix version, and 21 stopped being detected after a version change.
    - Sajadi et al. (2026 preprint) sort CodeQL Java false positives into missed sanitization (36.6%), benign context (29.4%) and missing trust-boundary modeling (27.6%). Triage should check exactly those three things.
  - Semgrep Community Edition is intraprocedural only.
- **Evidence:**
  - [An Empirical Study of Static Analysis Tools for Secure Code Review](https://arxiv.org/abs/2407.12241) — Charoenwet, Thongtanunam, Pham, Treude (ISSTA 2024) — peer reviewed — "a single SAST can produce warnings in vulnerable functions of 52% of VCCs"; "at least 76% of the warnings in vulnerable functions are irrelevant to the VCCs"; "22% of VCCs remain undetected due to limitations of SAST rules"; 319 vulnerabilities, 815 VCCs, 92 C/C++ projects — confirmed verbatim. Scope: C/C++ only.
  - [Longitudinal Analyses of SAST Tools: A CodeQL Case Study](https://arxiv.org/abs/2605.07900) — Noirot Ferrand, Domico, Beugin, McDaniel, submitted 8 May 2026 — preprint — 114 CodeQL versions, 3,993 CVEs, 1,622 repos; "CodeQL identifies a total of 171 CVEs, and that for 83 of them, a CodeQL version prior to the fix could detect it"; "21 CVEs were no longer detected following a version change" — confirmed.
  - [An Empirical Analysis of CodeQL False Positives and Query Refinements for Java Vulnerabilities](https://arxiv.org/abs/2609.04535) — Sajadi, Dutta, Chatterjee, submitted 3 Sep 2026, revised 15 Sep 2026 — preprint — 167 CVE instances, 500 sampled FP paths; 36.6% / 29.4% / 27.6%, plus concurrency (5%) and sink modeling (1.4%) — confirmed.
  - [CodeQL query suites](https://docs.github.com/en/code-security/code-scanning/managing-your-code-scanning-configuration/codeql-query-suites) — GitHub Docs — official docs — "all the queries in the default query suite, plus additional queries with slightly lower precision and severity"; "may return a greater number of false positive code scanning results" — confirmed.
  - [Semgrep Pro Engine intro](https://docs.semgrep.dev/semgrep-code/semgrep-pro-engine-intro) — Semgrep — official docs — "Semgrep Community Edition (CE), can only analyze interactions within a single function, also known as intraprocedural analysis"; interfile rules "may produce different results than Semgrep CE. Some instances could be regarded as regressions." — confirmed.
  - [NIST SP 800-218 SSDF v1.1](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-218.pdf) — NIST, 2022 — standard — PW.7.2 "...record and triage all discovered issues and recommended remediations"; Example 4 "Use a static analysis tool ... with a human reviewing the issues reported by the tool" — confirmed in the PDF text.
  - [OpenSSF Best Practices criteria](https://www.bestpractices.dev/en/criteria/0) — OpenSSF — standard — static_analysis: "At least one static code analysis tool (beyond compiler warnings and "safe" language modes) MUST be applied to any proposed major production release ... if there is at least one FLOSS tool that implements this criterion in the selected language" — confirmed.
  - [OWASP Secure Code Review Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html) — OWASP — standard — "Use automated findings to prioritize manual review areas"; "Apply human judgment to validate automated findings"; business logic flaws "require domain understanding" — confirmed.
- **Detect:**
  - Semgrep: `semgrep scan --config auto --error`; `semgrep scan --config p/owasp-top-ten --config p/secrets --sarif --sarif-output=semgrep.sarif`
  - CodeQL: `codeql database analyze <db> codeql/<lang>-queries:codeql-suites/<lang>-security-extended.qls --format=sarif-latest --output=codeql.sarif`. The general `codeql database analyze <database> --format --output <query-specifiers>` form was confirmed in the docs.
  - Bandit: `bandit -r . -f json -o bandit.json`, then `-b bandit.json` for new issues only.
  - For each alert, record the source, the path, the sink, and whether a sanitizer sits on the path.
  - Suppress only with a rule id and a reason: `# nosemgrep: <rule-id>`, `# nosec <test-id>`. A bare suppression counts as a finding.
- **Tools:** semgrep, codeql, bandit.
- **Applies to:** All languages (Bandit is Python only).
- **When not to apply / counterpoints:**
  - Alert fatigue is real. On HN, silverwind wrote "CodeQL seems to raise too many false-positives in my experience" ([item 47099262](https://news.ycombinator.com/item?id=47099262)). Chris_Newton replied that path-backed reports resist false positives but can still miss an unrecognized sanitizer ([item 47101696](https://news.ycombinator.com/item?id=47101696)).
  - security-extended trades precision for coverage.
  - The ISSTA data are C/C++ only, and the CodeQL papers are preprints.
  - Claims that LLM or "semantic" scanners beat SAST come mostly from vendors or preprints. Treat them as unproven (see F22).
- **Fix risk:** low

### T15-F08 — Close install-time code execution and fresh-release windows (scripts off by default, cooldowns for version updates)
- **Grade:** B · **Verdict:** CORRECTED. Four changes:
  1. The OpenSSF Concise Guide cooldown item was added on 2026-09-19 (commit #1136), so it is not a 2023 recommendation.
  2. The A03 Shai-Hulud quote is replaced with the page's wording ("the first successful self-propagating npm worm ... reached over 500 package versions").
  3. The Woodruff table has 10 rows, and Ultralytics counts as two phases.
  4. Per Unit 42, the November 2025 variant moved execution to the **pre**-install phase, so blocking only postinstall is not enough.
- **Rule:** Close the two main malware entry points.
  - **Install-time code execution.** Turn off dependency lifecycle scripts by default: pnpm v10+ does this, and npm uses `ignore-scripts=true` in `.npmrc`, which covers preinstall, install and postinstall. Allowlist only the packages that need builds.
  - **Freshly published versions.** Set a release-age cooldown for version updates: pnpm `minimumReleaseAge`, Dependabot `cooldown`, pip `--uploaded-prior-to P<n>D`. Let security updates bypass it.
- **Rationale:**
  - OWASP A03:2025 (Software Supply Chain Failures) was ranked #1 by exactly 50% of community survey respondents. It describes Shai-Hulud, which used post-install scripts to harvest data and npm tokens and then republished the victim's packages.
  - Unit 42 documents the post-install harvesting, the republishing loop, the abuse of TruffleHog, and the later shift to preinstall.
  - pnpm v10 turns off dependency postinstall scripts. Current pnpm docs give `minimumReleaseAge` a default of 1440 minutes.
  - Woodruff's table: 8 of 10 incidents had windows under a week, and 14 days would have blocked all but xz-utils.
  - The OpenSSF Concise Guide recommends a cooldown of "typically ~3 days". Dependabot's cooldown applies only to version updates and defaults to 3 days.
- **Evidence:**
  - [OWASP Top 10:2025 A03](https://top10.owasp.org/2025/A03_2025-Software_Supply_Chain_Failures/) — OWASP, 2025 — standard — "top-ranked in the Top 10 community survey with exactly 50% respondents ranking it #1"; "The Shai-Hulud supply chain attack in 2025 was the first successful self-propagating npm worm ... used a post-install script ... The worm reached over 500 package versions before being disrupted by npm." — confirmed verbatim.
  - [Supply chain security](https://pnpm.io/supply-chain-security) — pnpm — official docs — "pnpm v10 disables the automatic execution of postinstall scripts in dependencies"; allowBuilds; minimumReleaseAge "defaults to 1440 (1 day)"; blockExoticSubdeps; trustPolicy `no-downgrade` — confirmed. The pnpm release in which 1440 became the default was not confirmed; these are current (v11.x) docs.
  - [Shai-Hulud Worm Compromises npm Ecosystem](https://unit42.paloaltonetworks.com/npm-supply-chain-attack/) — Palo Alto Networks Unit 42, page dated 25 Nov 2025 (updated coverage) — incident report — "executes a post-installation script"; "identifies other packages maintained by that developer, injects malicious code into them, and publishes the new, compromised versions"; TruffleHog abuse; the November variant shifted execution to pre-install — confirmed.
  - [We should all be using dependency cooldowns](https://blog.yossarian.net/2025/11/21/We-should-all-be-using-dependency-cooldowns) — William Woodruff, 21 Nov 2025 — engineering blog — 10 rows: xz-utils ≈5 weeks, Ultralytics 12h and 1h, tj-actions 3 days, chalk <12h, Nx 4h, rspack 1h, num2words <12h, Kong Ingress Controller ≈10 days, web3.js 5h; "Setting a cooldown of 7 days would have prevented the vast majority of these attacks from reaching end users"; "Increasing the cooldown to 14 days would have prevented all but 1" — confirmed.
  - [Dependabot options reference](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference) — GitHub Docs — official docs — "The cooldown option is only available for version updates, not security updates"; "If not specified, Dependabot applies a default cooldown of 3 days." — confirmed.
  - [Concise Guide for Developing More Secure Software](https://best.openssf.org/Concise-Guide-for-Developing-More-Secure-Software) — OpenSSF Best Practices WG — standard (guide) — item 8: "Keep dependencies reasonably up-to-date after a cooldown ... Apply a cooldown delay (typically ~3 days) for updating components without known vulnerabilities; cooldowns counter the vast majority of malicious package releases". The page shows 2023-06-14, but the cooldown text was added 2026-09-19 per the [repo history](https://github.com/ossf/wg-best-practices-os-developers/commits/main/docs/Concise-Guide-for-Developing-More-Secure-Software.md) — confirmed.
  - [What's new in pip 26.1](https://sichard.ca/blog/2026/04/whats-new-in-pip-26.1/) — Richard Si, 26 Apr 2026 — engineering blog — "`--uploaded-prior-to` now supports accepts a relative duration in the `PnD` format" — confirmed.
  - [Dependency cooldowns turn you into a free-rider](https://calpaterson.com/deps.html) — Cal Paterson, Apr 2026 — engineering blog — "dependency cooldowns work by free-riding on the pain and suffering of others"; "unpaid, inadvertent beta testers"; proposes an index-level upload queue — confirmed.
- **Detect:**
  - npm: `grep -n ignore-scripts .npmrc`
  - pnpm: check `pnpm --version` (10+), then allowBuilds (onlyBuiltDependencies in older configs), `minimumReleaseAge`, `blockExoticSubdeps` and `trustPolicy`.
  - Dependabot: `grep -n -A3 cooldown .github/dependabot.yml`
  - zizmor: the `dependabot-cooldown` and `dependabot-execution` audits (both confirmed to exist).
  - Python: `grep -rn 'uploaded-prior-to\|exclude-newer' pyproject.toml pip.conf uv.toml`
- **Tools:** pnpm, npm, dependabot, renovate, pip, uv, zizmor.
- **Applies to:** Mainly JS/TS and Python. An HN commenter notes that Go does not run code at build time by design. Python users can get similar protection with `--only-binary=:all:`. Rust `build.rs` scripts deserve the same scrutiny.
- **When not to apply / counterpoints:**
  - Paterson's free-rider argument.
  - jcalvinowens on HN: "Delaying real bugfixes to achieve some nebulous poorly defined security benefit is just bad engineering." woodruffw replied that the cooldown is an overridable policy and that security advisories bypass it in Dependabot.
  - Cooldown lengths rest on a 10-row practitioner compilation, and the defaults differ: 1 day (pnpm), 3 days (Dependabot, OpenSSF), 7 days (Woodruff).
  - Turning off scripts breaks packages that compile native addons until they are allowlisted.
- **Fix risk:** medium

### T15-F09 — Verify every direct dependency is real, intended, and from the expected registry (hallucination, typosquat, dependency confusion)
- **Grade:** B · **Verdict:** CORRECTED. The counterpoint attributed to HN user "ysofunny" came with no URL and could not be verified, so it was removed. The Lasso author and date are added.
- **Rule:** Check that every direct dependency exists on the official registry, that its repository link and maintainers match the project the code expects, and that its publish history is plausible. Look especially hard in AI-assisted code. Flag names one edit away from a popular package, and any internal name that could resolve from a public index.
- **Rationale:**
  - USENIX Security 2025 (16 LLMs, 576,000 samples): hallucinated packages averaged at least 5.2% for commercial models and 21.7% for open-source models, with 205,474 unique hallucinated names.
  - Lasso's empty `huggingface-cli` package, a name models had hallucinated, got more than 30k real downloads in three months, and install instructions for it appeared in an Alibaba research repo.
  - ASVS 15.2.4 (L3) requires components from the expected repository with no dependency-confusion risk.
  - OWASP A03 says to "Only obtain components from official (trusted) sources over secure links".
- **Evidence:**
  - [We Have a Package for You!](https://arxiv.org/abs/2406.10279) — Spracklen, Wijewickrama, Sakib, Maiti, Viswanath, Jadliwala (USENIX Security 2025) — peer reviewed — "at least 5.2% for commercial models and 21.7% for open-source models"; "205,474 unique examples of hallucinated package names"; 576k samples, 16 LLMs — confirmed.
  - [AI package hallucinations](https://www.lasso.security/blog/ai-package-hallucinations) — Bar Lanyado, Lasso Security, 28 Mar 2024 — industry report (vendor) — "more than 30k authentic downloads" in three months; install instructions in "a repository dedicated to research conducted by Alibaba" — confirmed.
  - [OWASP ASVS 5.0.0 V15](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/en/0x24-V15-Secure-Coding-and-Architecture.md) — OWASP, 2025 — standard — 15.2.4 (L3) "...included from the expected repository, whether internally owned or an external source, and that there is no risk of a dependency confusion attack" — confirmed verbatim.
  - [HN: Dependency Confusion thread, comment by joepie91_](https://news.ycombinator.com/item?id=26087868) — Hacker News, 2021 — practitioner forum — "Artifactory apparently didn't, and served up whichever was the highest version of public vs. private." — confirmed via Algolia (story 26087064, 1107 points).
- **Detect:**
  - List direct dependencies and query the registry for first-publish date, maintainers, repository URL and version history. Any threshold you pick is a local heuristic, not an evidence-based cut-off.
  - Index mixing: `grep -rn 'extra-index-url' requirements*.txt pip.conf pyproject.toml .github/`
  - Check `.npmrc` for unscoped internal packages.
  - zizmor `typosquat-uses` for Actions (confirmed: "a close textual variant of a well-known action, but is owned by a different account").
  - pnpm `blockExoticSubdeps: true`.
- **Tools:** registry metadata (npm/PyPI/crates.io), zizmor, pnpm, osv-scanner.
- **Applies to:** All ecosystems with public registries; highest priority for code written with LLM help.
- **When not to apply / counterpoints:**
  - Legitimate new packages exist.
  - Download counts can be gamed: the fake package itself reached 30k.
  - No large-scale in-the-wild exploitation numbers for slopsquatting were found.
- **Fix risk:** low

### T15-F10 — Remove unused dependencies and demote build-only tools, then verify with clean install, build, tests, smoke run
- **Grade:** B · **Verdict:** CORRECTED. The Knip caveat about dynamic imports is sourced to Knip's "Handling Issues" guide, not the homepage, which does not state it.
- **Rule:** Remove dependencies the shipped code does not use, and move build-only tools to dev dependencies. Detect them with an ecosystem tool, then confirm each removal with a clean install, a full build, tests and a runtime smoke test.
- **Rationale:**
  - OWASP A03:2025: "Reduce attack surface by removing unused dependencies, unnecessary features, components, files, and documentation."
  - ASVS 15.2.3 (L2): production includes only required functionality.
  - Soto-Valero et al. (EMSE 2021) found 75.1% of dependency relationships bloated across 9,639 Maven artifacts. Maintainers merged 18 of 21 answered removal PRs.
  - The Soto-Valero evidence is Maven-only.
- **Evidence:**
  - [A Comprehensive Study of Bloated Dependencies in the Maven Ecosystem](https://arxiv.org/abs/2001.07808) — Soto-Valero, Harrand, Monperrus, Baudry (Empirical Software Engineering 2021, DOI 10.1007/s10664-020-09914-8) — peer reviewed — "75.1% of the analyzed dependency relationships are bloated"; 18 of 21 answered PRs merged, removing 131 dependencies — confirmed.
  - [OWASP Top 10:2025 A03](https://top10.owasp.org/2025/A03_2025-Software_Supply_Chain_Failures/) — OWASP, 2025 — standard — "Reduce attack surface by removing unused dependencies, unnecessary features, components, files, and documentation." — confirmed verbatim. The earlier wording "eliminating unused components" was a paraphrase.
  - [OWASP ASVS 5.0.0 V15](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/en/0x24-V15-Secure-Coding-and-Architecture.md) — OWASP, 2025 — standard — 15.2.3 (L2) "...does not expose extraneous functionality such as test code, sample snippets, and development functionality" — confirmed.
  - [Knip](https://knip.dev/) and [Knip: Handling Issues](https://knip.dev/guides/handling-issues) — knip.dev — official docs — finds unused dependencies, exports and files; `npx knip`, `--fix`; the guide covers "Dynamic import specifiers", "Conditional or dynamic dependencies" and false positives — confirmed.
  - [deptry](https://deptry.com/) — deptry — official docs — `deptry .`; DEP002 "defined as a dependency but not used in the codebase"; DEP004 "imported but declared as a dev dependency" — confirmed.
  - [cargo-udeps](https://github.com/est31/cargo-udeps) — est31 — official docs — `cargo +nightly udeps`; "some unused crates might not be detected"; not archived — confirmed.
- **Detect:**
  - JS/TS: `npx knip` (review the output; do not blindly `--fix`).
  - Python: `deptry .`
  - Rust: `cargo +nightly udeps`, `cargo deny check bans`.
  - Maven: DepClean.
  - Also look for vendored or copied libraries.
- **Tools:** knip, deptry, cargo-udeps, cargo-deny, DepClean.
- **Applies to:** All ecosystems.
- **When not to apply / counterpoints:**
  - Dynamic loading, plugins, framework conventions, CLI tools called from scripts, and peer dependencies fool detectors.
  - cargo-udeps needs nightly.
  - Removing an optional runtime dependency can break a path that tests do not cover.
- **Fix risk:** medium

### T15-F06 — Remediate with the smallest version bump, one dependency per commit; never bulk/forced auto-fix; escalate majors
- **Grade:** B · **Verdict:** CORRECTED. Two changes:
  1. The Endor Labs "95% of version upgrades contain at least one breaking change" comes from a narrow sample: 1,250 updates from vulnerable to non-vulnerable versions, published by the 15 most-problematic libraries after 2016, with changes that can *potentially* break clients. It is not a rate for all upgrades.
  2. Ochoa et al. is an arXiv preprint whose venue was not confirmed here, not "peer-reviewed-style".
- **Rule:**
  - Fix a vulnerable dependency with the smallest version bump that clears the advisory: one dependency (or one coherent group) per commit, with a full build and test run before and after.
  - Never run bulk or forced remediation (`npm audit fix --force` or its equivalents).
  - When only a major version fixes it, escalate to a human with the breaking changes listed.
- **Rationale:**
  - npm documents that `--force` installs outside the stated range, "including SemVer-major changes".
  - The breakage data conflict because they measure different things:
    - Endor Labs (vendor): 95% of the 1,250 remediation updates in its sample contain at least one breaking change, and 24% need a major bump.
    - Ochoa et al. (119,879 Maven upgrades, 293,817 clients): 83.4% of upgrades comply with semver, and "only 7.9% of all clients are affected".
  - Small isolated upgrades keep any breakage attributable and easy to revert.
- **Evidence:**
  - [npm-audit](https://docs.npmjs.com/cli/v11/commands/npm-audit) — npm Docs (CLI v11) — official docs — `--force`: "Allow npm audit fix to install modules outside your stated dependency range (including SemVer-major changes)." — confirmed verbatim.
  - [Breaking Bad? Semantic Versioning and Impact of Breaking Changes in Maven Central](https://arxiv.org/abs/2110.07889) — Ochoa, Degueule, Falleri, Vinju, 2021 — preprint (venue not confirmed) — "83.4% of these upgrades do comply with semantic versioning"; "only 7.9% of all clients are affected by BCs" — confirmed.
  - [2024 Dependency Management Report](https://www.endorlabs.com/lp/2024-dependency-management-report) — Endor Labs, 2024 — industry report (vendor) — "95% of version upgrades contain at least one breaking change."; "24% of 1250 updates from vulnerable to non-vulnerable component versions (published by the 15 most-problematic libraries after 2016) require a major version update"; "Minor updates can potentially break a client 94% of the time, and patches have a 75% chance" — confirmed on page, sample scope added.
  - [HN: Npm Audit: broken by design? (comment by tutuca)](https://news.ycombinator.com/item?id=27761725) — Hacker News, 2021 — practitioner forum — "I've never ever got `audit fix` or `audit fix --force` to solve any of the mentioned vulnerabilities. Ever." — confirmed via Algolia.
- **Detect:**
  - Before committing, diff the lockfile and classify each changed package as patch, minor or major.
  - Flag any major bump, and any change to a package the advisory did not name.
  - Run the full test suite and a production build.
- **Tools:** npm, pnpm, pip-audit --fix (review the diff), cargo audit fix (experimental; not re-verified).
- **Applies to:** All dependency remediation in any ecosystem.
- **When not to apply / counterpoints:**
  - Staying current avoids painful jumps later. jcalvinowens on HN: "If upgrading like that scares you, your automated testing isn't good enough."
  - The real breakage rate for a given project is unknown until its tests run.
- **Fix risk:** medium

### T15-F22 — Proof standard for every finding; scepticism toward AI-written code (and AI-written findings)
- **Grade:** B · **Verdict:** CORRECTED. Four changes:
  1. curl's "66%" covers all 415 reports over the whole bounty history, not AI reports specifically.
  2. The claim that curl ended its bounty is now sourced to curl's own post (ends 31 Jan 2026; confirmed-report rate fell from above 15% in earlier years to below 5% in 2025) instead of HN coverage.
  3. The GitGuardian caveat is replaced with its actual wording.
  4. "Missing authorization" is removed from the list of categories where AI code is "measurably weak", because no cited source measures it. It still gets manual review via F15.
- **Rule:** For codebases written largely by AI assistants, run the pass with explicit scepticism about the code. Hold every security finding, whether from a human, a tool or an AI, to a proof standard before changing code or reporting it:
  - file:line;
  - the concrete source-to-sink path, a failing test or a PoC;
  - the affected asset.

  Prioritise categories with measured AI weakness: XSS (Veracode), hardcoded secrets (GitGuardian) and invented dependencies (USENIX 2025). Do not submit or apply unproven "vulnerabilities".
- **Rationale:**
  - CCS 2023 (Codex davinci-002): participants with an AI assistant "wrote significantly less secure code" and were "more likely to believe they wrote secure code".
  - Veracode 2025 (vendor, 100+ LLMs): 45% of samples failed security tests, and newer or larger models showed no security improvement.
  - GitGuardian 2026 (vendor): Claude Code-assisted commits leaked secrets at 3.2% against a 1.5% baseline. This is correlational.
  - USENIX 2025: package hallucination rates of 5.2% to 21.7%.
  - On the reporting side, curl's bounty collapsed under AI-generated reports.
- **Evidence:**
  - [Do Users Write More Insecure Code with AI Assistants?](https://arxiv.org/abs/2211.03622) — Perry, Srivastava, Kumar, Boneh (ACM CCS 2023, DOI 10.1145/3576915.3623157) — peer reviewed — "wrote significantly less secure code than those without access"; "were more likely to believe they wrote secure code" — confirmed. The model was codex-davinci-002 (2022), so applying it to current assistants is an inference.
  - [2025 GenAI Code Security Report](https://www.veracode.com/blog/genai-code-security-report/) — Veracode, 30 Jul 2025 — industry report (vendor) — "45% of code samples failed security tests"; Java 72%; newer and larger models showed no security improvement — confirmed.
  - [The State of Secrets Sprawl 2026](https://blog.gitguardian.com/the-state-of-secrets-sprawl-2026/) — GitGuardian, 2026 — industry report (vendor) — "Claude Code-assisted commits showed a 3.2% secret-leak rate, versus a 1.5% baseline"; "That gap is meaningful, but it should not be read as a simple tool failure. Developers remain in control of what gets accepted, edited, ignored, or pushed."; AI-service secrets 1,275,105 (+81%) — confirmed.
  - [The I in LLM stands for intelligence](https://daniel.haxx.se/blog/2024/01/02/the-i-in-llm-stands-for-intelligence/) — Daniel Stenberg (curl), 2 Jan 2024 — engineering blog — of 415 reports over the program's life, "66% of the reports were neither a security issue nor a normal bug"; "The better the crap, the longer time and the more energy we have to spend on the report" — confirmed, context corrected.
  - [The end of the curl bug-bounty](https://daniel.haxx.se/blog/2026/01/26/the-end-of-the-curl-bug-bounty/) — Daniel Stenberg, 26 Jan 2026 — engineering blog (substituted primary source) — the bounty "officially stops on January 31, 2026"; "explosion in AI slop reports"; "Previous years we have had a rate of somewhere north of 15% of the submissions ending up confirmed vulnerabilities. Starting 2025, the confirmed-rate plummeted to below 5%." — confirmed.
  - [We Have a Package for You!](https://arxiv.org/abs/2406.10279) — Spracklen et al. (USENIX Security 2025) — peer reviewed — 5.2% / 21.7% — confirmed.
- **Detect:** Process check. Every item in the hardening report needs:
  - file:line;
  - evidence: a trace, a tool rule id plus a triage note, or a failing test;
  - a severity rationale.

  Relabel anything without these as a "hypothesis". Where practical, turn confirmed vulnerabilities into regression tests before fixing.
- **Tools:** test framework, semgrep/codeql (for traces), manual review.
- **Applies to:** All codebases. Mandatory when AI agents wrote the code and when an AI agent runs the pass.
- **When not to apply / counterpoints:**
  - Veracode and GitGuardian are vendors.
  - A competing-scanner author on HN (jfaganel99, Kolega) reported that Semgrep "found 222 issues, 208 of which were false positives" on NocoDB and missed a SQL injection. That claim is biased and anecdotal.
  - The balance between LLM review and SAST is unsettled.
- **Fix risk:** low

## Practitioner voice

- [HN: Npm Audit: broken by design? (872 points)](https://news.ycombinator.com/item?id=27761334) — Security teams impose fix deadlines on scanner output without knowing how the dependencies are used (Macha, woutr_be). tutuca never got `audit fix --force` to fix anything. dane-pgp uses better-npm-audit ignore lists that carry an expiry date and a note per entry, a documented triage pattern.
- [npm audit: Broken by Design](https://overreacted.io/npm-audit-broken-by-design/) — Dan Abramov, 7 Jul 2021. The npm audit issues reported to Create React App over several hours of review "all appear to be false positives" for a build tool (browserslist ReDoS, glob-parent in the dev server). He suggests `--production` scoping.
- [Turn Dependabot Off](https://words.filippo.io/dependabot/) — Filippo Valsorda, 20 Feb 2026. A one-line fix to a rarely used edwards25519 method made Dependabot open "thousands of PRs against unaffected repositories", while govulncheck reported "No vulnerabilities found". He recommends scheduled govulncheck plus scheduled CI against the latest dependencies.
- [HN: Turn Dependabot off (647 points)](https://news.ycombinator.com/item?id=47094192) — maltalex (not Chris_Newton): customers "complain even if the vulnerable code is never used or isn't exploitable". indiekitai: "When every PR has 12 security alerts, people stop reading them." seg_lol: "Be wary of upgrading dependencies too quickly." silverwind and Chris_Newton disagree on CodeQL false positives.
- [HN: We should all be using dependency cooldowns (489 points)](https://news.ycombinator.com/item?id=46005111) — jcalvinowens: "Delaying real bugfixes ... is just bad engineering". swatcoder: cooldowns belong on automated semver bumps, with manual updates when exposed. bumblehean: a 7-day "zero CVE" compliance window pushes teams to "update everything as soon as updates are available". woodruffw: the cooldown is an overridable policy, and advisories bypass it in Dependabot.
- [Dependency cooldowns turn you into a free-rider](https://calpaterson.com/deps.html) — Cal Paterson, Apr 2026. Cooldowns make others "unpaid, inadvertent beta testers". He proposes an index-level upload queue, as Debian does.
- [We should all be using dependency cooldowns](https://blog.yossarian.net/2025/11/21/We-should-all-be-using-dependency-cooldowns) — William Woodruff, Nov 2025. A 10-row incident table: 8 of 10 windows were under a week, and 14 days would have blocked all but xz-utils.
- [HN: tj-actions/changed-files compromised (273 points)](https://news.ycombinator.com/item?id=43367987) — arianvanp: composite actions can call unpinned actions, so SHA pins are not transitive. frenchtoast8 (not brokenpip3): bots such as Renovate that update pinned hashes "run into the same problem". brokenpip3 shared a pre-commit script that pins hashes.
- [Why Scanners Fail in Practice: Lessons from the Shai-Hulud Attacks on npm](https://www.codecentric.de/en/knowledge-hub/blog/why-scanners-fail-in-practice-lessons-from-the-shai-hulud-attacks-on-npm) — Felix Dreißig, codecentric, 9 Dec 2025 (corrected gist).
  - For compromised npm packages "nobody bothered to issue CVEs".
  - GitHub malware advisories need a `type:malware` filter.
  - In their test, Trivy missed the compromise while Grype and OSV-Scanner caught it.
  - Endpoint detection was weak.
  - The article does **not** recommend `npm ci` or `--ignore-scripts`; the original gist was wrong.
- [HN: Shai-Hulud Returns: Over 300 NPM Packages Infected (1038 points)](https://news.ycombinator.com/item?id=46032539) — Layered defenses:
  - `ignore-scripts=true` in `.npmrc` (efortis); qbane says it "should be the default".
  - Cooldowns and non-token (trusted) publishing (progbits, woodruffw).
  - Go "doesn't execute code at compile time by design" (cedws).
  - Python `--only-binary=:all:` avoids source builds (zahlman).
- [The I in LLM stands for intelligence](https://daniel.haxx.se/blog/2024/01/02/the-i-in-llm-stands-for-intelligence/) and [The end of the curl bug-bounty](https://daniel.haxx.se/blog/2026/01/26/the-end-of-the-curl-bug-bounty/) — Daniel Stenberg. 66% of all 415 lifetime bounty reports were not bugs. AI-generated reports cost more time to dismiss. The bounty ended 31 Jan 2026 as the confirmed rate fell below 5% in 2025.
- [First American Financial Corp. Leaked Hundreds of Millions of Title Insurance Records](https://krebsonsecurity.com/2019/05/first-american-financial-corp-leaked-hundreds-of-millions-of-title-insurance-records/) — The standard IDOR example: about 885 million documents readable by changing one digit, with no authentication. The SEC later found the flaw had been identified months earlier ([SEC 2021-102](https://www.sec.gov/newsroom/press-releases/2021-102)).
- [DPC announces EUR 91 million fine of Meta](https://www.dataprotection.ie/en/news-media/press-releases/DPC-announces-91-million-fine-of-Meta) — 27 Sep 2024. Passwords were stored in plaintext on internal systems. The release does not attribute this to logging.
- [Betterleaks, a Gitleaks successor](https://www.aikido.dev/blog/betterleaks-gitleaks-successor) — Zach Rice (Gitleaks author), 12 Mar 2026, on a vendor blog (Aikido). "I don't have full control over the Gitleaks repo and name anymore". Betterleaks is presented as a drop-in replacement; 98.6% recall against 70.4% for entropy on CredData is a vendor claim.
- [HN: Dependency Confusion (1107 points)](https://news.ycombinator.com/item?id=26087064) — joepie91_: Artifactory "served up whichever was the highest version of public vs. private".
- [AI package hallucinations](https://www.lasso.security/blog/ai-package-hallucinations) — Bar Lanyado, Lasso, Mar 2024. An empty package under a hallucinated name (`huggingface-cli`) got more than 30k real downloads in 3 months and appeared in an Alibaba repo's install instructions.
- [HN: Kolega scanner results (comment 46975146)](https://news.ycombinator.com/item?id=46975146) — jfaganel99, author of a competing scanner, so biased. Semgrep "found 222 issues, 208 of which were false positives, and missed" a SQL injection in NocoDB's Oracle client. The original gist said it was an auth or logic bug, which was wrong.

## Contradictions and open questions

**Contradictions**
- **Cooldown length.** Woodruff's table argues for about 7 days (14 days blocks all but one of 10). The OpenSSF Concise Guide (added 2026-09-19) and Dependabot's default say 3 days. pnpm's current default is 1 day. Paterson calls cooldowns free-riding, and HN practitioners say they delay real fixes. Partial reconciliation: Dependabot applies cooldowns only to version updates, and the OpenSSF wording is limited to "components without known vulnerabilities".
- **Reachability versus compliance.** govulncheck, Valsorda and Endor Labs (vendor, under 9.5% reachable) support skipping unreachable advisories. The OpenSSF 60-day criterion and ASVS 15.2.1 do not mention reachability. maltalex reports that customers reject vulnerable binaries regardless.
- **Dev-dependency advisories.** Abramov: known-CVE hits in build tooling are false positives for the shipped app. Shai-Hulud: dev and install-time dependencies are the main malware vector against developer and CI machines. These are different threats and the skill must keep them apart.
- **Upgrade breakage.** Endor Labs' 95% covers a narrow set of 1,250 remediation updates from 15 problem libraries, counting potential breaks. Ochoa et al. found 7.9% of Maven clients affected across 119,879 upgrades. Neither predicts a given project.
- **Secret triage.** Verified-only mode cuts noise (99.7% of TruffleHog hits on Docker Hub images were non-credentials). GitGuardian says validation-only prioritization misses 46% of critical secrets. The highest-recall tool (Gitleaks, 88%) has 46% precision.
- **History rewriting.** OWASP lists squashing as an option with caveats. GitHub treats rotation as the real fix and documents persistence through forks, clones, PR refs and SHA lookups.
- **SHA pinning.** GitHub calls full-SHA pins the only immutable reference. Practitioners note pins are not transitive through composite actions and that bot-managed pin updates partly reintroduce the risk.
- **Lockfiles for libraries.** Rust's 2023 guidance is "do what is best for their project". npm and pnpm treat committed lockfiles as standard.
- **SAST value.** Standards mandate static analysis, while the data show low recall (171 of 3,993 CVEs for CodeQL; 52% of VCCs flagged by a single tool in C/C++). HN practitioners disagree about CodeQL's false-positive rate.
- **CSPRNG and UUIDs.** The OWASP Cryptographic Storage cheat sheet lists `crypto.randomUUID()` among secure generators. ASVS 5.0 11.5.1 says UUIDs do not meet its 128-bit requirement for non-guessable values. Use `randomBytes(16+)` for secret tokens.

**Open questions**
- OWASP Top 10:2025 is marked "RELEASED" and "(Final)" in the README, but no release date was found on the README or the category pages.
- The claim that the "OWASP Code Review Guide repo was archived 11 April 2025" was not confirmed. The GitHub API shows `OWASP/www-project-code-review-guide` as archived with a last push in June 2022. The Secure Code Review Cheat Sheet is the maintained reference used here.
- The pnpm version in which `minimumReleaseAge` began defaulting to 1440 was not confirmed. The cited docs are the current v11.x docs, and the thresholds for older 10.x releases were not checked.
- Free function-level SCA reachability was verified only for Go (govulncheck, on by default in OSV-Scanner) and Rust (experimental). For JS/TS, Python and Java, manual grep of the advisory's affected API remains the fallback.
- Gitleaks is in security-patch-only mode (latest v8.30.1, March 2026), and its author now develops Betterleaks. Betterleaks' long-term status and its independence from the hosting vendor are unclear.
- NIST SSDF v1.2 (SP 800-218 Rev. 1) is an Initial Public Draft (17 Dec 2025, comments closed 30 Jan 2026). Re-check if it becomes final.
- Several cited 2025–2026 arXiv papers are not yet peer-reviewed: the CodeQL longitudinal study, the CodeQL FP taxonomy, the Docker Hub exposure study, and the vulnerable-dependencies study.
- WebSearch was unavailable during verification. Recent industry numbers (Verizon DBIR 2025/2026, Sonatype 2026) were not added, and Reddit, Lobsters and Security StackExchange voices are still missing.
- The venue of Ochoa et al. (arXiv 2110.07889) was not confirmed here.

## Dropped findings

None. All 23 findings survived. Items dropped inside findings:
- F01: woodruffw's "FP/FN ratio simply wasn't worth it" quote could not be found.
- F07: codecentric as support for `npm ci`/`--ignore-scripts`; the article does not say it.
- F09: the "ysofunny" counterpoint had no URL and could not be verified.
- F22: "missing authorization" as a measured AI weakness had no source.
