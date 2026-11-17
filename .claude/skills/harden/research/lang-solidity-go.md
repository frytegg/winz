# Solidity and Go best practices from authoritative sources
> Code T24 · slug lang-solidity-go · verified 2026-09-23 · counts: verified 9 / corrected 15 / downgraded 1 / dropped 0

## Summary

These are language-specific hardening rules for Solidity and Go, checked on 2026-09-23. This verification pass re-opened every cited source. It keeps the corrections from the earlier pass today and adds new ones (F03, F05 and F07).

**Versions confirmed during verification**
- **Solidity.**
  - The newest release is 0.8.37 (10 Sep 2026, GitHub release API).
  - Solidity 0.8.31 (3 Dec 2025) deprecated `send`/`transfer`, virtual modifiers, ABI coder v1, the `memory-safe-assembly` comment and comparisons between contract types. It calls these "the first batch of features scheduled for removal in the 0.9.0 breaking release".
- **Solidity standards and tools.**
  - EEA EthTrust Security Levels v3 (March 2025) is still the latest release. entethalliance.org/specs/ethtrust-sl/ redirects to v3, and the spec's own "latest editor's draft" link returns 404.
  - The Slither detector wiki lists 100 detectors (Slither 0.11.6, Jul 2026).
  - Foundry v1.3.0 (published 2025-07-31 per the GitHub API) added the built-in `forge lint`. The current docs page links 93 lint ids. Foundry is now at v1.8.3 (15 Sep 2026).
  - Aderyn (Cyfrin) is active; its latest release is v0.6.8 (Jan 2026).
  - OpenZeppelin Contracts 5.x (latest v5.7.0, Jul 2026).
- **OWASP.** The **OWASP Smart Contract Top 10 is now the 2026 edition** (scs.owasp.org/sctop10). The 2025 list is archived there, although the old owasp.org project page still presents 2025. The researcher cited 2025 only. The 2026 list is explicitly "forward-looking", derived from 2025 incident and survey data.
- **Go.**
  - Go 1.26.0 (10 Feb 2026) rewrote `go fix` around modernizers.
  - Go 1.27.0 (19 Aug 2026; 1.27.1 on 1 Sep 2026) made the `goroutineleak` profile generally available (it was a GOEXPERIMENT in 1.26), and `go test` now runs the `stdversion` vet check. Both 1.26.1 and 1.27.1 shipped fixes to the `go fix` command itself.
- **Go tools and guides.**
  - golangci-lint v2 (v2.13.2, Aug 2026). Its `standard` default set is errcheck, govet, ineffassign, staticcheck and unused.
  - staticcheck 2026.2.1, errcheck, deadcode, govulncheck.
  - Go Code Review Comments, the Google Go Style Guide and the Uber Go Style Guide.

**Main takeaways**
1. **Tool output is input for triage, never a certificate.** This holds for both languages.
   - On 47,518 contracts, 9 Solidity tools (2019 versions) tagged 97% as vulnerable. On a 69-contract annotated set, all tools combined detected only 42% of known vulnerabilities (Durieux et al., ICSE 2020).
   - Of 516 real exploitable bugs (2021-2022, 462 of them from Code4rena contests), more than 80% were beyond existing tools (Zhang et al., ICSE 2023).
   - Go's race detector found 10 of 20 reproduced non-blocking bugs. The built-in deadlock detector found 2 of 21 blocking bugs (Tu et al., ASPLOS 2019).
2. **Some Solidity "refactors" that look safe change storage layout, the ABI or bytecode.**
   - Examples: removing an "unused" state variable, reordering state variables, and turning a storage variable into a `constant` (OpenZeppelin notes that the compiler reserves no slot for constants).
   - Also: renaming public functions or events, and changing the compiler.
   - Every such rule needs an upgradeability and deployment guard. OWASP SC Top 10:2026 added "Proxy & Upgradeability Vulnerabilities" as SC10.
3. **Several popular rules only hold for certain versions.**
   - Go 1.22 changed loop-variable scoping.
   - Go 1.23 changed timer garbage collection, for the main module only. The *100 Go Mistakes* site itself now flags its #76 as obsolete.
   - Solidity 0.8.22 generates unchecked loop increments automatically. `require(bool, error)` works via-IR from 0.8.26 and in the legacy pipeline from 0.8.27. Solidity 0.8.31 deprecates `send`/`transfer`.
   - The reviewer must read the go.mod `go` directive, the solc version and the via-IR setting before applying any rule.
4. **Real conflicts remain.**
   - Floating vs pinned pragma.
   - Latest vs "mature" compiler. Trail of Bits: "we do not recommend the newest version for deployment". EthTrust: "SHOULD use the latest available stable Solidity compiler version".
   - Gas-driven assembly vs readability.
   - `_ =` vs never discarding errors.
   - Sentinel errors.
   - `%w` everywhere (errorlint's default) vs "do not wrap … implementation details" (Go blog).
   - Message passing vs shared memory. Message passing caused 58% of *blocking* bugs, while shared memory caused about 80% of *non-blocking* bugs.

**Method limits.**
- The WebSearch budget was already spent (200/200) when this verification ran.
- Every source was opened directly with WebFetch, curl or the `gh` API.
- PDFs were extracted with pdftotext, and wiki pages and GitHub files were read raw.
- Where WebFetch's summarizer disagreed with the raw page (for example on staticcheck ST1005's default status), the raw page won.
- The researcher reported that Reddit and Ethereum StackExchange could not be fetched, so practitioner voice leans on engineering blogs, postmortems, GitHub issues and Lobsters/HN threads.

## Findings

### T24-F01 — Solidity: run Slither, forge lint and Aderyn as a baseline, then triage every finding one by one. Suppress accepted findings inline with the tool's syntax plus a written reason. Never report a clean run as "secure", and never auto-apply every suggested fix.
- **Grade:** A · **Verdict:** CORRECTED. Four changes:
  - The Slither flags (`--triage-mode`, `--exclude-informational`, `--filter-paths`) and the inline-suppression syntax are documented in the Slither *Usage* wiki, not the README.
  - The Durieux 97% figure applies to the 47,518-contract set.
  - The forge lint id count is 93, not "about 90".
  - The OWASP reference is updated to the 2026 edition.
- **Rationale:** Solidity analyzers are both noisy and incomplete. They flag almost everything on real contracts yet miss most exploitable business-logic bugs. Their value is as a cheap first filter for known patterns such as reentrancy, unchecked calls, tx.origin and dead code.
  - A pass that "fixes" every finding changes behaviour for no benefit.
  - A pass that trusts a clean run misses the dominant bug class: functional, accounting and logic bugs.
- **Evidence:**
  - [Empirical Review of Automated Analysis Tools on 47,587 Ethereum Smart Contracts](https://arxiv.org/abs/1910.10601) — Durieux, Ferreira, Abreu, Cruz, ICSE 2020 (DOI 10.1145/3377811.3380364) — peer_reviewed — "only 42% of the vulnerabilities from our annotated dataset are detected by all the tools"; the best tool is Mythril at 27%; "97% of contracts are tagged as vulnerable" (47,518-contract set); 9 tools, 428,337 analyses. The abstract was read and confirmed. "All the tools" means all tools combined.
  - [Demystifying Exploitable Bugs in Smart Contracts](https://raw.githubusercontent.com/ZhangZhuoSJTU/Web3Bugs/main/papers/icse23.pdf) — Zhuo Zhang, Brian Zhang, Wen Xu, Zhiqiang Lin, ICSE 2023 — peer_reviewed — "516 exploitable bugs from 167 real-world contracts reported/exploited in years 2021-2022" (462 from Code4rena, 54 real exploits); "More than 80% exploitable bugs are beyond existing tools (we call them machine unauditable bugs (MUBs))". Confirmed from the PDF text.
  - [Slither: the leading static analyzer for smart contracts](https://blog.trailofbits.com/2019/05/27/slither-the-leading-static-analyzer-for-smart-contracts/) — Trail of Bits, 27 May 2019 — engineering_blog (vendor benchmark) — "Slither is the most accurate tool with the lowest false positive rate of 10.9%; followed by Securify with 25%"; "SmartCheck and Solhint have extremely high false positive rates: 73.6% and 91.3% (!)". Confirmed verbatim.
  - [Slither Usage wiki](https://github.com/crytic/slither/wiki/Usage) — Crytic/Trail of Bits, 2026 — official_docs — `--exclude-informational`/`--exclude-low`, `--filter-paths` (string or regex), `//slither-disable-next-line DETECTOR_NAME`, `// slither-disable-start … // slither-disable-end`, `--triage-mode` (saves to `slither.db.json`). Confirmed. This replaces the README as the location of these flags.
  - [Slither README](https://github.com/crytic/slither) — Crytic, 2026 — official_docs — "Average execution time of less than 1 second per contract"; lists 100 detectors and `slither-check-upgradeability`. Confirmed.
  - [Forge lint (Foundry book)](https://getfoundry.sh/forge/linting) — Foundry, 2026 — official_docs — severities `high`/`med`/`low`/`info`/`gas`/`code-size`; `[lint]` keys `severity`, `exclude_lints`, `ignore`, `lint_on_build`; inline `// forge-lint: disable-next-line(rule-id)`, `disable-line`, `disable-next-item`, `disable-start`/`disable-end`. Confirmed; 93 lint ids are linked.
  - [Foundry v1.3.0 release](https://github.com/foundry-rs/foundry/releases/tag/v1.3.0) — foundry-rs, published 2025-07-31 (GitHub API) — official_docs — "As of v1.3.0, Forge ships with a built-in linter that analyzes Solidity code for style, correctness, and best practices"; linting runs on build unless `lint_on_build = false`. Confirmed; the year is confirmed, not inferred.
  - [Aderyn README](https://github.com/Cyfrin/aderyn) — Cyfrin, 2026 — official_docs — "Rust-based solidity smart contract static analyzer…"; "Runs without need for any configuration support for Foundry and Hardhat projects." Confirmed; the repo is active and not archived.
  - [OWASP Smart Contract Top 10:2026](https://scs.owasp.org/sctop10/) — OWASP, 2026 — standard — SC01 Access Control, SC02 Business Logic, SC03 Price Oracle Manipulation, SC04 Flash Loan–Facilitated Attacks, SC05 Lack of Input Validation, SC06 Unchecked External Calls, SC07 Arithmetic Errors (Rounding & Precision), SC08 Reentrancy, SC09 Integer Overflow/Underflow, SC10 Proxy & Upgradeability; "forward-looking", derived from 2025 data. Confirmed.
- **Detect:**
  - Run from the project root: `slither . --filter-paths "lib/|test/|script/|node_modules/"` (add `--exclude-informational` for a first pass), then `forge lint` (configured in `foundry.toml [lint]`), then `aderyn`.
  - Deduplicate across tools, then sort each finding into true positive, accepted-with-justification, or false positive.
  - Find suppressions without a reason: `grep -rnE "slither-disable|forge-lint: disable" src/`, and check that each has an adjacent comment explaining why.
- **Tools:** slither, forge lint, aderyn, slither-check-upgradeability
- **Applies to:** Any Solidity codebase (Foundry or Hardhat). Most valuable before a first deployment, or before an upgrade of an upgradeable system.
- **When not to apply / counterpoints:**
  - The 10.9% false-positive figure is Trail of Bits' own 2019 benchmark of its own tool. The Durieux numbers come from 2019 tool versions.
  - No public precision data was found for forge lint or Aderyn.
  - Web3Bugs is mostly Code4rena contest findings, which may over-represent logic bugs.
  - A clean run says nothing about access control, business logic or price-oracle logic. These are the top three categories in OWASP SC Top 10:2026 (the 2025 edition ranked Access Control then Price Oracle Manipulation first).
- **Fix risk:** low

### T24-F20 — Go data races: run the test suite with `go test -race ./...` in CI and treat any report as a bug. Also run a -race build under realistic load when test coverage of concurrent paths is weak. Review the known race patterns: concurrent map access, mutex copied by value, WaitGroup.Add inside the goroutine, captured err or loop variables, and t.Parallel table tests.
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** In the ASPLOS study the race detector reported no false positives, but it only sees executed interleavings. It caught 10 of 20 reproduced non-blocking bugs, and 4 of those needed about 100 runs. At Uber scale (about 50M LOC, about 2,100 services) it found about 2,000 races, and about 1,100 were fixed by 210 developers in six months.
- **Evidence:**
  - [Data Race Detector](https://go.dev/doc/articles/race_detector) — Go project, 2026 — official_docs — "The race detector only finds races that happen at runtime, so it can't find races in code paths that are not executed. If your tests have incomplete coverage, you may find more races by running a binary built with -race under a realistic workload"; "memory usage may increase by 5-10x and execution time by 2-20x". Confirmed verbatim.
  - [Data Race Patterns in Go](https://www.uber.com/blog/data-race-patterns-in-go/) — Milind Chabbi, Murali Krishna Ramanathan, Uber Engineering, 2 Jun 2022 — engineering_blog — "about 50 million lines of code"; "approximately 2,100 unique Go services"; about 2,000 races detected and about 1,100 fixed by 210 unique developers in six months. It lists 7 patterns: free-variable capture, slices, maps, pass-by-value sync types, mixed channels and shared memory, WaitGroup Add/Done placement, and parallel table tests. Confirmed.
  - [Understanding Real-World Concurrency Bugs in Go](https://songlh.github.io/paper/go-study.pdf) — Tu, Liu, Song, Zhang, ASPLOS 2019 — peer_reviewed — "We use our 20 reproduced non-blocking bugs … The detector reports no false positives"; "detected 7/13 traditional bugs and 3/4 bugs caused by anonymous functions … for the rest four, around 100 runs were needed" (Table 12: 10/20). Confirmed from the PDF.
  - [cmd/vet](https://pkg.go.dev/cmd/vet) — Go project (go1.27.1 docs), 2026 — official_docs — copylocks and testinggoroutine are among the default analyzers. Confirmed.
- **Detect:**
  - In CI: `go test -race -count=1 ./...`. For flaky concurrency, repeat with `-count=5`.
  - `go vet ./...` (copylocks, testinggoroutine).
  - staticcheck SA2001 (empty critical section) and SA2002 (t.FailNow in a goroutine).
  - Manual: grep for package-level `map[` written from handlers, and for `wg.Add(` inside `go func`.
- **Tools:** go test -race, go vet, staticcheck
- **Applies to:** Any Go code with goroutines; CI pipelines.
- **When not to apply / counterpoints:**
  - The 2-20x time overhead can make -race impractical for some integration suites.
  - A clean run cannot prove the absence of races.
  - The ASPLOS numbers come from six projects studied in 2019. The Uber numbers come from one company's monorepo.
- **Fix risk:** low

### T24-F19 — Go concurrency lifetimes: every `go` statement must have a visible, guaranteed exit path (ctx.Done(), a channel close, WaitGroup/errgroup). A goroutine that sends on an unbuffered channel while its parent may leave on timeout or cancel needs a buffered(1) channel or a select on ctx.Done(). context.Context is the first parameter, is not stored in a struct (sole exception: methods that must match an external interface), and never uses a custom context type.
- **Grade:** A · **Verdict:** CORRECTED. Two changes:
  - The researcher's quote spliced the Google rules together and implied "no exceptions" for storing a context in a struct. In fact, both Go Code Review Comments and the Google guide allow one exception: methods whose signature must match an interface. "There are no exceptions to this rule" applies only to custom context types.
  - The goroutine-leak profile was a GOEXPERIMENT in 1.26 and is generally available in 1.27. The researcher said "Go 1.27 adds".
- **Rationale:** Goroutine leaks and blocking bugs are common and hard to detect.
  - In the study of 171 real Go concurrency bugs, about 58% of blocking bugs came from message passing, and the built-in deadlock detector caught 2 of 21 reproduced blocking bugs.
  - Uber's production leak detector found 10 critical leaks. Fixing two of them cut peak memory 2.5x and 5x.
  - The `goroutineleak` profile finds leaks only at runtime, after they occur. It misses primitives still reachable from globals or runnable goroutines, so it complements code review rather than replacing it.
- **Evidence:**
  - [Understanding Real-World Concurrency Bugs in Go](https://songlh.github.io/paper/go-study.pdf) — Tu, Liu, Song, Zhang, ASPLOS 2019 — peer_reviewed — 171 bugs from Docker, Kubernetes, etcd, gRPC, CockroachDB, BoltDB; "around 58% of blocking bugs are caused by message passing"; "The built-in deadlock detector can only detect two blocking bugs" (Table 8: 2 of 21); "Implication 2: Contrary to common belief, message passing can cause more blocking bugs than shared memory." Confirmed.
  - [LeakProf: Featherlight In-Production Goroutine Leak Detection](https://www.uber.com/blog/leakprof-featherlight-in-production-goroutine-leak-detection/) — Georgian-Vlad Saioc, Milind Chabbi, Uber Engineering, 10 Nov 2022 — engineering_blog — "10 critical leaking goroutines, and only 1 false positive"; "2.5x and a 5x reduction in the service's peak memory"; the fix is to "increase the capacity of done to 1". Confirmed.
  - [Goroutine Leak Profiles](https://go.dev/blog/goroutine-leak-profiles) — Vlad Saioc, Go blog, 2 Sep 2026 — official_docs — `/debug/pprof/goroutineleak`; "if a concurrency primitive is consistently reachable through global variables or runnable goroutines, then goroutines blocking on it are never reported as leaked". Confirmed. The [Go 1.27 release notes](https://go.dev/doc/go1.27) say the profile was "previously available as an experiment in Go 1.26" and "is now generally available".
  - [Go Code Review Comments — Goroutine Lifetimes, Contexts](https://go.dev/wiki/CodeReviewComments) — Go project, 2026 — official_docs — "When you spawn goroutines, make it clear when - or whether - they exit"; "Don't add a Context member to a struct type … The one exception is for methods whose signature must match an interface in the standard library or in a third party library"; "Don't create custom Context types". Confirmed.
  - [Google Go Style Guide — Decisions (Contexts, Goroutine lifetimes)](https://google.github.io/styleguide/go/decisions) — Google, 2026 — official_docs — "Do not add a context member to a struct type … The one exception is for methods whose signature must match an interface in the standard library or in a third party library outside Google's control"; "Do not create custom context types … There are no exceptions to this rule."; "Goroutines can leak by blocking on channel sends or receives." Confirmed. The quote is corrected so it no longer splices the two rules.
  - [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md) — Uber, 2026 — engineering_blog — "Channels should usually have a size of one or be unbuffered … Any other size must be subject to a high level of scrutiny"; section "Don't fire-and-forget goroutines". Confirmed.
- **Detect:**
  - Enumerate `grep -rn "go func\|go [a-zA-Z_.]*(" --include=*.go .` and write down the exit condition for each hit.
  - Pattern to flag: `ch := make(chan T)` plus a goroutine doing `ch <- v`, while the parent `select`s on `time.After` or `ctx.Done()`.
  - Tool checks: revive `context-as-argument` and `context-keys-type`; golangci `contextcheck`; staticcheck SA1012 (nil context) and SA1029 (bad WithValue key); go vet `lostcancel`.
  - At runtime: collect `/debug/pprof/goroutineleak` (Go 1.27+) under load tests.
- **Tools:** go vet (lostcancel), staticcheck, revive, golangci-lint contextcheck, pprof goroutineleak
- **Applies to:** Go services and libraries that spawn goroutines.
- **When not to apply / counterpoints:**
  - The struct-member rule has a documented exception for interface-mandated signatures.
  - Buffering a channel fixes a leak but can hide a logic error in which nobody consumes the result.
  - The ASPLOS study also found that about 80% of *non-blocking* bugs were shared-memory ones (105 shared-memory vs 66 message-passing bugs overall). Channels are neither automatically safer nor automatically worse.
- **Fix risk:** medium

### T24-F21 — Go version-gated rules: read the go.mod `go` directive (and `toolchain`) before applying any rule whose semantics changed.
  - If go ≥1.22, loop variables are per-iteration, so remove redundant `x := x` copies (go fix `forvar` / copyloopvar). Do not raise the `go` directive as part of a "cleanup".
  - If the main module declares go ≥1.23, unstopped timers are collected, so old "time.After leaks" advice no longer applies.
  - Then run `go fix -diff ./...` (Go ≥1.26) from a clean git state, review the diff, and repeat until it reaches a fixed point. Do this once per relevant GOOS/GOARCH.
- **Grade:** A · **Verdict:** CORRECTED. Three changes:
  - The Let's Encrypt forum post does not state the root cause. The Go loop-variable cause is documented in Let's Encrypt's Mozilla Bugzilla incident report (added).
  - The Go 1.23 timer change is gated on the *main program's* module go line, and it can be reverted with `asynctimerchan=1`.
  - Russ Cox's "1 in 50,000" is the rate of spurious *test* failures. Only 2 of the 58 failures were correct code actually broken.
- **Rationale:** Several classic Go rules are obsolete or dangerous depending on the language version.
  - The loop-variable bug caused a Let's Encrypt mass revocation.
  - Raising the `go` directive changes semantics. Google's trial saw 58 test failures in about 100k tests, and nearly all were previously undiagnosed real bugs.
  - The rewritten `go fix` applies modernizations that the Go team says "should not change the behavior". It is still young: 1.26.1 and 1.27.1 both shipped go fix bug fixes.
- **Evidence:**
  - [Fixing For Loops in Go 1.22](https://go.dev/blog/loopvar-preview) — David Chase and Russ Cox, Go blog, 19 Sep 2023 — official_docs — "the new semantics will only apply in packages contained in modules that declare go 1.22 or later in their go.mod files"; forced at Google from May 2023 with "zero reports of any problems in production code". Confirmed.
  - [spec: less error-prone loop variable scoping (#56010)](https://github.com/golang/go/discussions/56010) — Russ Cox, 2022 — practitioner_forum (Go team) — "only 58 failures out of approximately 100,000 tests executed, covering approximately 1.3M for loops"; "36 (62%)" were t.Parallel tests not testing what they appeared to; "The rate of spurious test failures (correct code actually broken by the change) was 1 in 50,000"; "only 2 instances out of the 58 where code correctly depended on per-loop semantics". Confirmed.
  - [2020.02.29 CAA Rechecking Bug](https://community.letsencrypt.org/t/2020-02-29-caa-rechecking-bug/114591) — Let's Encrypt, 2020 — incident_report — "when a certificate request contained N domain names that needed CAA rechecking, Boulder would pick one domain name and check it N times"; about 3M certificates affected; 1,706,505 revoked (plus 445 high-priority). Confirmed. This post does not name the root cause.
  - [Mozilla Bugzilla 1619047 — Let's Encrypt CAA rechecking incident](https://bugzilla.mozilla.org/show_bug.cgi?id=1619047) — Let's Encrypt, 2020 — incident_report — "The proximate cause of the bug was a common mistake in Go: taking a reference to a loop iterator variable." Added source; confirmed. Russ Cox's #56010 links this bug as an example.
  - [Go 1.23 Release Notes](https://go.dev/doc/go1.23) — Go project, 2024 — official_docs — "Timers and Tickers that are no longer referred to by the program become eligible for garbage collection immediately, even if their Stop methods have not been called"; "These new behaviors are only enabled when the main Go program is in a module with a go.mod go line using Go 1.23.0 or later"; the GODEBUG `asynctimerchan=1` reverts to the old behaviour. Confirmed.
  - [Using go fix to modernize Go code](https://go.dev/blog/gofix) — Alan Donovan, Go blog, 17 Feb 2026 — official_docs — `go fix -diff ./...`; "start from a clean git state"; "run go fix more than once until it reaches a fixed point; twice is usually enough"; "each run of the go fix command analyzes only a specific build configuration"; modernizers minmax, rangeint, stringscut, forvar, newexpr. A `slices.Clone` modernizer was excluded after it was found to change behaviour on empty slices. Confirmed.
  - [Go 1.26 Release Notes](https://go.dev/doc/go1.26), [Go 1.27 Release Notes](https://go.dev/doc/go1.27) and [release history](https://go.dev/doc/devel/release) — Go project, 2026 — official_docs — go fix "completely revamped … These fixers should not change the behavior of your program"; Go 1.27: "go test now invokes the stdversion vet check by default"; new modernizers atomictypes, embedlit, slicesbackward, unsafefuncs; go1.26.0 released 2026-02-10 and go1.27.0 on 2026-08-19; 1.26.1 and 1.27.1 include fixes to "the go fix command". Confirmed.
- **Detect:**
  - `grep -E "^go |^toolchain " go.mod`
  - For go ≥1.22: `grep -rnE "^\s*([a-zA-Z_][a-zA-Z0-9_]*) := \1$" --include=*.go .` (GNU grep backreference); golangci `copyloopvar`; go fix `forvar`.
  - `go fix -diff ./...`, then again with `GOOS=windows`, `GOOS=darwin`, etc. for build-tagged code.
  - `go vet ./...` (stdversion).
- **Tools:** go fix (Go ≥1.26), go vet, golangci-lint copyloopvar
- **Applies to:** Go modules. Each rule is gated on the go.mod version.
- **When not to apply / counterpoints:**
  - Changing the `go` directive is not a refactor. Rare correct code depends on the old semantics, and t.Parallel tests may start failing because they finally test what they claim.
  - go fix sees one build configuration per run and has had bug-fix releases. Review the diff; do not blindly accept it.
  - *100 Go Mistakes* #76 (time.After leak) is marked by its own site as "not relevant anymore from Go 1.23".
- **Fix risk:** medium

### T24-F02 — Solidity: use one consistent pragma across the project, and compile with a recent stable solc that has no known bug affecting the features in use. Check the exact version plus settings (via-IR, transient storage, assembly) against the official bug list. For audited or certified code, state a bounded version range that produces identical bytecode.
- **Grade:** A · **Verdict:** CORRECTED. Three changes:
  - EthTrust's note *allows* an open-ended range in the pragma itself (e.g. `>=0.8.14`), but the certification must state a specific range of compiler versions for which it is valid.
  - The 0.8.37 memory `bytes` delete bug affected only the legacy (evmasm) pipeline.
  - The Trail of Bits position is quoted verbatim.
- **Rationale:** Compiler bugs are real and recent.
  - The transient-storage clearing bug (rated high) hit 0.8.28–0.8.33 under via-IR.
  - 0.8.37 fixed a legacy-pipeline memory `bytes` delete bug present in all versions up to 0.8.36, plus a via-IR spill-slot collision affecting 0.7.2–0.8.36.
  - Mixed pragmas make it unclear which compiler an audit covered.
- **Evidence:**
  - [EEA EthTrust Security Levels v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) — EEA, March 2025 — standard — "[GP] Use Latest Compiler: The Tested Code SHOULD use the latest available stable Solidity compiler version."; "[Q] Specify Solidity Compiler Versions to Produce Consistent Output: The Tested Code MUST specify a range of Solidity versions in its pragma directive(s) that produce the same Bytecode given the same compilation options"; "The wording of this requirement allows for the specification of an open-ended range … However EEA EthTrust Certification requires specifying a specific range of Solidity Compiler Versions for which it is valid". Confirmed.
  - [Transient Storage Clearing Helper Collision Bug](https://soliditylang.org/blog/2026/02/18/transient-storage-clearing-helper-collision-bug) — Solidity team, 18 Feb 2026 — official_docs — 0.8.28 through 0.8.33 affected. The conditions are `--via-ir`, `delete` on a transient state variable, and a matching persistent-storage clearing in the same compilation unit. Severity "high"; fixed in 0.8.34; only three deployed contracts matched. Workaround: "assigning the zero value directly (e.g., _lock = 0) instead of using delete". Confirmed.
  - [Solidity 0.8.37 release announcement](https://soliditylang.org/blog/2026/09/10/solidity-0.8.37-release-announcement) — Solidity team, 10 Sep 2026 — official_docs — memory `bytes` element delete: "the evmasm pipeline wrote 32 zero bytes starting at that element … The IR pipeline is not affected … All versions up to and including 0.8.36 are affected"; spill-slot collision in mutual recursion, "Versions 0.7.2 through 0.8.36 are affected when compiling with --via-ir". It reports "two rated low/medium severity and one very low". Confirmed.
  - [List of Known Bugs](https://docs.soliditylang.org/en/latest/bugs.html) — Solidity docs, 2026 — official_docs — "It is highly suspicious if a contract was compiled with a compiler that contains a known bug and the contract was created at a time where a newer compiler version containing a fix was already released."; `bugs_by_version.json`. Confirmed verbatim.
  - [Slither Detector Documentation (solc-version, pragma)](https://github.com/crytic/slither/wiki/Detector-Documentation) — Crytic, 2026 — official_docs — "Deploy with a recent version of Solidity (at least 0.8.0) with no known severe issues. Use a simple pragma version that allows any of these versions. Consider using the latest version of Solidity for testing."; pragma: "Use one Solidity version." Confirmed.
  - [Aderyn supported detectors](https://cyfrin.gitbook.io/cyfrin-docs/project-configuration/list-of-supported-detectors) — Cyfrin, 2026 — official_docs — unspecific-solidity-pragma: "Solidity pragma should be specific, not wide". Confirmed.
  - [Development guidelines](https://secure-contracts.com/development-guidelines/guidelines.html) — Trail of Bits (building-secure-contracts), n.d., accessed 2026 — engineering_blog — "Compile using a stable release, but check for warnings with the latest release … since Solidity has a fast release cycle and a history of compiler bugs, we do not recommend the newest version for deployment." Confirmed verbatim.
  - [Vyper nonreentrancy lock vulnerability post-mortem](https://hackmd.io/@vyperlang/HJUgNMhs2) — Vyper team with Omniscia, 2023 — incident_report — v0.2.15, v0.2.16, v0.3.0: "All @nonreentrant decorators within a Vyper contract will utilize a unique storage offset regardless of their key", enabling cross-function reentrancy; Curve pools exploited on 30 July 2023. Confirmed.
  - [Layout of a Solidity Source File](https://docs.soliditylang.org/en/latest/layout-of-source-files.html) — Solidity docs — official_docs — "Using the version pragma does not change the version of the compiler." Confirmed.
- **Detect:**
  - `grep -rhn "pragma solidity" src/ | sed 's/.*pragma/pragma/' | sort | uniq -c`. More than one distinct line is a finding.
  - Read `solc_version` and `via_ir` in foundry.toml or the Hardhat config.
  - Cross-check the version against bugs_by_version.json and the Solidity blog security alerts.
  - Tool ids: slither `solc-version`, `pragma`; forge lint `pragma-inconsistent`; aderyn `unspecific-solidity-pragma`.
- **Tools:** slither, forge lint, aderyn, solc bugs_by_version.json
- **Applies to:** Solidity code before (re)deployment. For deployed immutable contracts, record the issue and change the compiler only when a redeploy is planned.
- **When not to apply / counterpoints:**
  - Sources disagree on pragma form: Slither wants a simple range, Aderyn wants a specific one, and EthTrust wants a bytecode-stable certified range.
  - They also disagree on freshness: EthTrust says latest, Trail of Bits says not the newest for deployment.
  - Both sides are supported by recent history: a new bug introduced in 0.8.28, and old bugs fixed in 0.8.37.
  - The pragma does not select the compiler; the build configuration does.
- **Fix risk:** medium

### T24-F03 — Solidity: every function that makes an external call (ETH send, token transfer, ERC721/1155/777 hooks, arbitrary call) must finish all checks and state writes before the call (Checks-Effects-Interactions). Where CEI is impossible, use a reentrancy guard, and make nonReentrant the first modifier.
- **Grade:** A · **Verdict:** CORRECTED. Two changes:
  - Reentrancy is **SC08:2026** in the current OWASP SC Top 10. It was SC05 in the now-archived 2025 edition.
  - The researcher's counterpoint said transient-storage guards interact with the 0.8.28–0.8.33 bug. That is overbroad: the bug path needs `delete` on a `transient` state variable. OpenZeppelin's `ReentrancyGuardTransient` (v5.7.0) clears its lock with `TransientSlot…tstore(false)`, not `delete`.
- **Rationale:** Any external call hands over control. The OWASP SC Top 10 names reentrancy as a category (SC08:2026). EthTrust makes CEI a level [S] requirement that can be checked automatically.
- **Evidence:**
  - [Security Considerations](https://docs.soliditylang.org/en/latest/security-considerations.html) — Solidity docs, 2026 — official_docs — "Any interaction from a contract (A) with another contract (B) and any transfer of Ether hands over control to that contract (B)."; "complete all required checks of the supplied parameters before modifying the contract's state (Checks); only then it makes any changes to the state (Effects); it may make calls to functions in other contracts after all planned state changes have been written to storage (Interactions)." Confirmed verbatim.
  - [EEA EthTrust Security Levels v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) — EEA, March 2025 — standard — "[S] Use Check-Effects-Interaction: Tested code that makes external calls MUST use the Checks-Effects-Interactions pattern to protect against Re-entrancy Attacks unless it meets the Set of Overriding Requirements…"; "[M] Protect External Calls: … the protection against Re-entrancy Attacks for the Tested Code MUST be equivalent to what the Checks-Effects-Interactions pattern offers". Confirmed.
  - [Slither Detector Documentation](https://github.com/crytic/slither/wiki/Detector-Documentation) — Crytic, 2026 — official_docs — reentrancy-eth (High severity / Medium confidence), reentrancy-no-eth (Medium/Medium), reentrancy-benign (Low/Medium), reentrancy-events (Low/Medium); recommendation "Apply the check-effects-interactions pattern". Confirmed from the raw wiki.
  - [Forge lint list](https://getfoundry.sh/forge/linting) — Foundry — official_docs — High: reentrancy-eth, reentrancy-balance; Medium: reentrancy-no-eth, non-reentrant-not-first; Low: reentrancy-events. Confirmed.
  - [OWASP Smart Contract Top 10:2026](https://scs.owasp.org/sctop10/) — OWASP, 2026 — standard — "SC08:2026 Reentrancy Attacks". Confirmed. The 2025 edition ([owasp.org project page](https://owasp.org/www-project-smart-contract-top-10/)) listed SC05 Reentrancy and cited "over $1.42 billion in financial losses" across its sources.
  - [ReentrancyGuardTransient.sol (v5.7.0)](https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.7.0/contracts/utils/ReentrancyGuardTransient.sol) — OpenZeppelin, 2026 — official_docs (source) — `_nonReentrantAfter()` does `_reentrancyGuardStorageSlot().asBoolean().tstore(false);`. Added; confirmed from the source.
- **Detect:**
  - slither `--detect reentrancy-eth,reentrancy-no-eth,reentrancy-benign,reentrancy-events`
  - forge lint `reentrancy-eth`, `reentrancy-balance`, `reentrancy-no-eth`, `non-reentrant-not-first`
  - Manual: for each `.call{`, `.transfer(`, `safeTransfer`, `_safeMint` or interface call, confirm that no state write follows it on any path in the same function or in called internal functions.
  - Check cross-function reentrancy, where two functions share state and only one is guarded.
  - For hand-written transient guards, grep `delete` on `transient` variables when solc is 0.8.28–0.8.33 with via-IR.
- **Tools:** slither, forge lint, OpenZeppelin ReentrancyGuard / ReentrancyGuardTransient
- **Applies to:** Solidity contracts with external calls. Applies before deployment or in an upgrade.
- **When not to apply / counterpoints:**
  - CEI is sometimes impossible, for example when the amount credited depends on the balance received. Guards then become necessary.
  - Guards add gas and can block legitimate callbacks.
  - Hand-written transient guards that `delete` a `transient` variable can hit the 0.8.28–0.8.33 via-IR bug (see F02).
  - The Vyper/Curve incident shows that a guard fails if the compiler implements it wrongly.
- **Fix risk:** medium

### T24-F04 — Solidity: check the result of every low-level call and send. Route every ERC-20 transfer/transferFrom/approve through SafeERC20, or check the bool explicitly. Never discard a success-signalling return value.
- **Grade:** A · **Verdict:** VERIFIED. OWASP "Unchecked External Calls" is SC06 in both the 2025 and 2026 editions.
- **Rationale:** Low-level calls do not revert on failure, and several tokens return false instead of reverting. EthTrust makes the check a level [S] requirement.
- **Evidence:**
  - [EEA EthTrust Security Levels v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) — EEA, 2025 — standard — "[S] Check External Calls Return: Tested Code that makes external calls using the Low-level Call Functions (i.e. call(), delegatecall(), staticcall(), and send()) MUST check the returned value from each usage to determine whether the call failed, unless it meets the Overriding Requirement [M] Handle External Call Returns." Confirmed.
  - [Slither Detector Documentation](https://github.com/crytic/slither/wiki/Detector-Documentation) — Crytic, 2026 — official_docs — unchecked-transfer (High): "Use SafeERC20, or ensure that the transfer/transferFrom return value is checked." low-level-calls: "Low-level calls do not check for code existence or call success … If the call is meant for a contract, check for code existence." unchecked-lowlevel, unchecked-send and unused-return are Medium. Confirmed.
  - [Forge lint list](https://getfoundry.sh/forge/linting) / [Aderyn detectors](https://cyfrin.gitbook.io/cyfrin-docs/project-configuration/list-of-supported-detectors) — Foundry; Cyfrin — official_docs — forge lint High: erc20-unchecked-transfer, unchecked-call; Medium: unused-return. Aderyn unchecked-return: "Return value of the function call is not checked." Confirmed.
  - [OWASP Smart Contract Top 10:2026](https://scs.owasp.org/sctop10/) — OWASP, 2026 — standard — "SC06:2026 Unchecked External Calls". Confirmed.
- **Detect:**
  - slither `--detect unchecked-transfer,unchecked-lowlevel,unchecked-send,unused-return`
  - forge lint `erc20-unchecked-transfer`, `unchecked-call`, `unused-return`
  - `grep -rnE "\.call\{?|\.call\(|\.delegatecall\(|\.send\(" src/`, then confirm `(bool success, ...) =` followed by `require(success` or `if (!success) revert`.
  - Grep for `IERC20(...).transfer(` without `safeTransfer`.
- **Tools:** slither, forge lint, aderyn, OpenZeppelin SafeERC20
- **Applies to:** Solidity contracts that move ETH or tokens, or make low-level calls.
- **When not to apply / counterpoints:**
  - Best-effort calls, such as notifying an optional hook, should be documented rather than silently ignored (EthTrust [M] Handle External Call Returns is the override).
  - A low-level call to an address with no code "succeeds", so contract targets still need a code-existence check (Slither low-level-calls).
- **Fix risk:** medium

### T24-F05 — Solidity: remove or replace these hazardous and deprecated constructs.
  - `tx.origin` used for authorization becomes `msg.sender`.
  - `address.send`/`transfer` becomes `call{value:}` under CEI or a guard. Both are deprecated in 0.8.31 and scheduled for removal in 0.9.0.
  - `selfdestruct` is removed unless it is protected and documented.
  - The `/// @solidity memory-safe-assembly` comment becomes `assembly ("memory-safe")`.
  - Also fix the other 0.8.31 deprecation warnings: virtual modifiers, ABI coder v1 and contract-type comparisons.
- **Grade:** A · **Verdict:** CORRECTED. Two changes:
  - The researcher's EthTrust quote cut off the "unless" clause. [S] No selfdestruct() is overridable by [M] Protect Self-destruction plus [M] Document Special Code Use, and [S] No tx.origin by [Q] Verify tx.origin Usage.
  - The Parity issue page does not show the impact. EthTrust's own Example 18 is added: it states the loss.
- **Rationale:** These constructs break a security assumption or are on the removal path.
  - tx.origin is phishable.
  - The 2300-gas stipend of send/transfer is brittle.
  - Since EIP-6780, selfdestruct no longer deletes code except in the creation transaction.
  - An unprotected selfdestruct in the Parity multisig library "blocked around 1/2 Million Ether" (EthTrust).
- **Evidence:**
  - [Security Considerations](https://docs.soliditylang.org/en/latest/security-considerations.html) — Solidity docs, 2026 — official_docs — "Never use tx.origin for authorization."; "the contract can only rely on the "gas stipend" it is passed (2300 gas) being available to it at that time." Confirmed.
  - [Solidity v0.8.31 release](https://github.com/ethereum/solidity/releases/tag/v0.8.31) — ethereum/solidity, 3 Dec 2025 — official_docs — "Warn about deprecation of send and transfer functions on instances of address"; virtual modifiers; ABI coder v1; the `memory-safe-assembly` special comment; comparisons between variables of contract types; "deprecates the first batch of features scheduled for removal in the 0.9.0 breaking release". Confirmed.
  - [EEA EthTrust Security Levels v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) — EEA, 2025 — standard — "[S] No tx.origin: Tested Code MUST NOT contain a tx.origin instruction unless it meets the Overriding Requirement [Q] Verify tx.origin Usage"; "[S] No selfdestruct(): Tested code MUST NOT contain the selfdestruct() instruction or its now-deprecated alias suicide() unless it meets the Set of Overriding Requirements [M] Protect Self-destruction, and [M] Document Special Code Use"; Example 18: "This vulnerability led to the Parity MultiSig Wallet Failure that blocked around 1/2 Million Ether on mainnet in 2017." Confirmed with the full wording.
  - [EIP-6780](https://eips.ethereum.org/EIPS/eip-6780) — Ballet, Buterin, Feist; created 2023-03-25; Final. The fork (Cancun/Dencun, 2024) is not stated on the EIP page — standard — "SELFDESTRUCT will recover all funds to the target but not delete the account, except when called in the same transaction as creation". Confirmed verbatim.
  - [anyone can kill your contract #6995](https://github.com/openethereum/parity-ethereum/issues/6995) — parity-ethereum GitHub issue, 6 Nov 2017 — incident_report — "I accidentally killed it"; labels F1-security, P0-dropeverything. Confirmed. The issue text is sparse and does not describe the mechanism.
  - [Writing Upgradeable Contracts — Initializing the Implementation Contract](https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable) — OpenZeppelin, 2026 — official_docs — "Do not leave an implementation contract uninitialized. An uninitialized implementation contract can be taken over by an attacker … invoke the _disableInitializers function in the constructor". Added; confirmed.
- **Detect:**
  - `grep -rnE "tx\.origin|selfdestruct|suicide\(|memory-safe-assembly|pragma abicoder v1" src/`
  - For send/transfer: `grep -rnE "payable\([^)]*\)\.(send|transfer)\(|\.send\(" src/`. ERC-20 `.transfer(` is a false positive, so check the receiver's type.
  - Compile with solc ≥0.8.31 and treat deprecation warnings as findings.
  - Tool ids: slither `tx-origin` (Medium), `suicidal` (High); forge lint `tx-origin` (Medium).
  - For implementations behind proxies, check that the constructor calls `_disableInitializers()`.
- **Tools:** solc ≥0.8.31 warnings, slither, forge lint, grep
- **Applies to:** Solidity ≥0.8 codebases, especially those planning to move to 0.9.
- **When not to apply / counterpoints:**
  - EthTrust allows tx.origin under [Q] and selfdestruct under [M] with protection and documentation.
  - Replacing `transfer` with `call` forwards all gas and re-opens reentrancy unless CEI or a guard is present.
  - The replacement also changes behaviour for contract recipients that previously ran out of the 2300-gas stipend.
- **Fix risk:** high

### T24-F08 — Solidity dead code: remove unused internal/private functions, unused imports, unused custom errors/events, unused locals and unreachable code. Remove an unused STATE variable only in non-upgradeable contracts. Never touch storage layout in proxies, never remove `__gap` arrays, and never remove public/external functions (they are ABI) as "dead code".
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** EthTrust [Q] Code Linting forbids unnecessary variables and unreachable code. Dead-code tools do not understand proxies, though, and removing a state variable in an upgradeable contract shifts every later storage slot. OWASP SC10:2026 (Proxy & Upgradeability Vulnerabilities) reinforces the guard.
- **Evidence:**
  - [EEA EthTrust v3 — [Q] Code Linting](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) — EEA, 2025 — standard — "Tested code MUST NOT create unnecessary variables … MUST NOT include code that cannot be reached in execution except for code explicitly intended to manage unexpected errors, such as assert() statements … MUST explicitly declare the visibility of all functions and variables"; "It is also easier to review Tested Code that does not contain pointless code." Confirmed.
  - [Slither Detector Documentation](https://github.com/crytic/slither/wiki/Detector-Documentation) — Crytic, 2026 — official_docs — dead-code (Informational, Medium confidence): "Remove unused functions" (the example is an internal function); unused-state (Informational, High): "Remove unused state variables." Confirmed.
  - [Forge lint list](https://getfoundry.sh/forge/linting) — Foundry — official_docs — Info: unused-import, unused-error, unaliased-plain-import, todo-comment; Gas: unused-state-variables, write-after-write. Confirmed.
  - [Aderyn supported detectors](https://cyfrin.gitbook.io/cyfrin-docs/project-configuration/list-of-supported-detectors) — Cyfrin — official_docs — unused-state-variable: "Potentially unused private / internal state variables found."; dead-code; useless-error ("Unused Custom Error"); unused-import. Confirmed.
  - [Writing Upgradeable Contracts](https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable) — OpenZeppelin, 2026 — official_docs — "you cannot change the type of a variable", "you cannot change the order in which the contract state variables are declared", "Or remove an existing variable", "Or introduce a new variable before existing ones"; storage gaps are named `__gap` or `__gap_*`. Confirmed.
- **Detect:**
  - slither `--detect dead-code,unused-state`
  - forge lint `unused-import`, `unused-error`, `unused-state-variables`
  - aderyn `dead-code`, `unused-state-variable`, `useless-error`, `unused-import`
  - Compiler "Unreachable code" and "Unused local variable" warnings.
  - Before deleting any state variable, check for proxies: `grep -rnE "Initializable|UUPSUpgradeable|ERC1967|TransparentUpgradeableProxy|delegatecall|__gap|erc7201" src/`. If there are hits, run `slither-check-upgradeability` or the OZ upgrades validation instead of deleting.
- **Tools:** slither, forge lint, aderyn, slither-check-upgradeability, OpenZeppelin upgrades plugins
- **Applies to:** All Solidity. State-variable removal only in non-upgradeable contracts that are not yet deployed.
- **When not to apply / counterpoints:**
  - "Unused" internal functions in abstract bases or libraries may be meant for downstream inheritors.
  - Unused errors or events in interfaces may be part of a published ABI or an EIP.
  - EthTrust explicitly allows assert()-guarded defensive code.
- **Fix risk:** high

### T24-F07 — Solidity arithmetic hardening:
  - (a) On ≥0.8, remove SafeMath.
  - (b) On ≥0.8.22, remove manual `unchecked { ++i; }` loop increments where the compiler's conditions hold.
  - (c) Every remaining `unchecked` block must carry a comment proving overflow is impossible.
  - (d) Treat divide-before-multiply as a bug fix that needs tests, not a refactor.
  - (e) Never convert checked code to unchecked during a hardening pass.
- **Grade:** A · **Verdict:** CORRECTED. The researcher's counterpoint ("SafeMath reverted with Error(string) while built-in checks revert with Panic(0x11)") is wrong for the SafeMath found in ≥0.8 codebases. OpenZeppelin 4.x SafeMath (`pragma ^0.8.0`) "relies on the compiler's built in overflow checks", so its plain `add`/`sub`/`mul` already revert with Panic(0x11). Only the `errorMessage` overloads (`sub`/`div`/`mod(a, b, errorMessage)`) and pre-0.8 copies revert with a string.
- **Rationale:** Checked arithmetic made SafeMath redundant, and the 0.8.22 optimizer made the manual unchecked-increment idiom redundant. EthTrust requires overflow-capable code to be justified and documented. OWASP SC07:2026 (Arithmetic Errors — Rounding & Precision) and SC09:2026 (Integer Overflow/Underflow) keep arithmetic in the Top 10.
- **Evidence:**
  - [Checked or Unchecked Arithmetic](https://docs.soliditylang.org/en/latest/control-structures.html) — Solidity docs, 2026 — official_docs — "Since Solidity 0.8.0, all arithmetic operations revert on over- and underflow by default, thus making the use of these libraries unnecessary."; "It is not possible to disable the check for division by zero or modulo by zero using the unchecked block."; Panic "0x11: If an arithmetic operation results in underflow or overflow outside of an unchecked { ... } block". Confirmed.
  - [OpenZeppelin SafeMath.sol (v4.9.6)](https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v4.9.6/contracts/utils/math/SafeMath.sol) — OpenZeppelin, 2023 — official_docs (source) — "because it relies on the compiler's built in overflow checks"; "NOTE: SafeMath is generally not needed starting with Solidity 0.8"; `sub(uint256 a, uint256 b, string memory errorMessage)` uses `require(b <= a, errorMessage)`. Added; confirmed from the source.
  - [Solidity 0.8.22 release announcement](https://soliditylang.org/blog/2023/10/25/solidity-0.8.22-release-announcement/) — Solidity team, 25 Oct 2023 — official_docs — "automatically generates an unchecked arithmetic increment of the counter of for loops"; "removes the need for poor unchecked increment patterns"; the conditions are an `i < …` comparison, the same type, a local built-in integer counter, `i++`/`++i`, and no modification in the body; "<= and others are intentionally excluded". Confirmed.
  - [OpenZeppelin Contracts GUIDELINES.md](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/GUIDELINES.md) — OpenZeppelin, 2026 — engineering_blog — "Unchecked arithmetic blocks should contain comments explaining why overflow is guaranteed not to happen." Confirmed.
  - [EEA EthTrust v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) — EEA, 2025 — standard — "[M] Safe Overflow/Underflow: Tested code MUST NOT contain calculations that can overflow or underflow unless there is a demonstrated need (e.g. for use in a modulo operation)…"; [M] Document Special Code Use covers "code that can cause an overflow or underflow". Confirmed.
  - [Slither divide-before-multiply](https://github.com/crytic/slither/wiki/Detector-Documentation) — Crytic — official_docs — Medium/Medium: "Consider ordering multiplication before division", with the caveat "unless the limit of a smaller type makes this dangerous". Confirmed.
  - [Gas optimization book](https://www.rareskills.io/post/gas-optimization) — RareSkills, last updated 22 Oct 2025 — engineering_blog — "As of Solidity 0.8.22, this trick is done automatically by the compiler"; unchecked is still appropriate for "for loops which have natural upper bounds" and inputs "already sanitized into reasonable ranges". Confirmed.
- **Detect:**
  - `grep -rn "using SafeMath\|SafeMath\." src/`. Also grep for the three-argument `errorMessage` overloads, whose removal changes revert data.
  - `grep -rn -B2 -A6 "unchecked {" src/`: flag blocks without a justification comment, and loop-increment-only blocks when solc ≥0.8.22.
  - slither/forge lint `divide-before-multiply`; forge lint `unsafe-typecast`.
- **Tools:** grep, slither, forge lint
- **Applies to:** Solidity ≥0.8.0 (SafeMath) and ≥0.8.22 (loop increments).
- **When not to apply / counterpoints:**
  - Removing the `errorMessage` SafeMath overloads changes revert data from `Error(string)` to `Panic(0x11)`/`Panic(0x12)`. Tests or integrators that decode the reason will see the change.
  - Loops that use `<=` do not get the automatic optimization: removing `unchecked` costs gas but stays safe.
  - Reordering multiply and divide changes numeric results and can introduce overflow.
- **Fix risk:** medium

### T24-F06 — Solidity: replace revert strings with custom errors (`error Unauthorized(address caller);` with `revert Unauthorized(msg.sender)`, or `require(cond, Err())` on a compiler that supports it). Name them per the EIP-6093 rationale where applicable.
- **Grade:** A · **Verdict:** VERIFIED. One clarification added: `require(bool, error)` is via-IR only in 0.8.26, and works in the legacy pipeline from 0.8.27.
- **Rationale:** Custom errors are cheaper at deploy time and at runtime, and they carry typed parameters. OpenZeppelin measured a 12.84% average drop in deployment cost across its library after switching to custom errors in 5.0.
- **Evidence:**
  - [Expressions and Control Structures](https://docs.soliditylang.org/en/latest/control-structures.html) — Solidity docs, 2026 — official_docs — "Using a custom error instance will usually be much cheaper than a string description, because you can use the name of the error to describe it, which is encoded in only four bytes." Confirmed.
  - [Custom Errors in Solidity](https://soliditylang.org/blog/2021/04/21/custom-errors/) — Solidity team, 2021 — official_docs — introduced in 0.8.4; revert strings are "rather expensive, especially when it comes to deploy cost"; "custom errors decrease both deploy and runtime gas costs". Confirmed.
  - [Solidity 0.8.26 release announcement](https://soliditylang.org/blog/2024/05/21/solidity-0.8.26-release-announcement/) — Solidity team, 21 May 2024 — official_docs — adds `require(bool, error)`; "currently, using custom errors with require is only supported by the IR pipeline … For the legacy pipeline, please use the if (!condition) revert CustomError(); pattern instead." Confirmed.
  - [Solidity 0.8.27 release announcement](https://soliditylang.org/blog/2024/09/04/solidity-0.8.27-release-announcement/) — Solidity team, 4 Sep 2024 — official_docs — "With the release of 0.8.27, you can use the feature in the legacy pipeline as well." Added source; confirmed.
  - [Introducing OpenZeppelin Contracts 5.0](https://www.openzeppelin.com/news/introducing-openzeppelin-contracts-5.0) — OpenZeppelin, 5 Oct 2023 — engineering_blog — the deployment cost "has dropped 12.84% on average across the library" with custom errors. Confirmed.
  - [Solidity 0.8.37 release announcement](https://soliditylang.org/blog/2026/09/10/solidity-0.8.37-release-announcement) — Solidity team, 10 Sep 2026 — official_docs — "In the IR pipeline, the arguments of a custom error constructed with named arguments and passed to require … were put on the stack in call-site order rather than declaration order"; it affects only the revert data of an already-reverting transaction and is rated very low. Confirmed.
  - [OpenZeppelin GUIDELINES.md](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/GUIDELINES.md) — OpenZeppelin — engineering_blog — "Custom errors should be declared following the EIP-6093 rationale whenever reasonable." Confirmed.
- **Detect:**
  - `grep -rnE 'require\([^;]*,\s*"' src/` and `grep -rnE 'revert\(\s*"' src/`
  - forge lint `custom-errors` (gas).
  - Aderyn `require-without-string` flags empty `require()`/`revert()`. Replace these with a custom error, not a string.
- **Tools:** forge lint, aderyn, grep
- **Applies to:** Solidity ≥0.8.4. `require(cond, Err())` needs ≥0.8.26 with via-IR, or ≥0.8.27 on any pipeline. Use ≥0.8.37 if named error arguments are used via-IR.
- **When not to apply / counterpoints:**
  - Revert data is observable interface. Frontends, subgraphs and tests that match strings (`vm.expectRevert("...")`) will break.
  - On deployed immutable contracts the change means a redeploy.
- **Fix risk:** medium

### T24-F16 — Go: never drop an error silently. Every returned error is handled, returned, or explicitly discarded with `_ =` plus a comment saying why. Flag dead error assignments (SA4006/ineffassign), `if err != nil { return nil }` (nilerr), and deferred Close() on writable files whose error is lost.
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** The compiler does not force error checks, and errcheck exists because "these unchecked errors can be critical bugs". In the 2025 Lobsters thread on the Go team's error-syntax decision, practitioners pointed to errcheck as the practical safeguard.
- **Evidence:**
  - [Go Code Review Comments — Handle Errors](https://go.dev/wiki/CodeReviewComments) — Go project, 2026 — official_docs — "Do not discard errors using _ variables. If a function returns an error, check it to make sure the function succeeded. Handle the error, return it, or, in truly exceptional situations, panic." Confirmed.
  - [errcheck README](https://github.com/kisielk/errcheck) — kisielk/errcheck, 2026 — official_docs — "all returned errors must be either assigned to a variable or explicitly discarded by being assigned to _"; "The -blank flag enables checking for assignments of errors to the blank identifier"; `-asserts` covers ignored type assertions; a built-in exclude list applies unless `-excludeonly` is set. Confirmed.
  - [Staticcheck checks](https://staticcheck.dev/docs/checks/) — Dominik Honnef, 2026 — official_docs — "SA4006 - A value assigned to a variable is never read before being overwritten. Forgotten error check or dead code?" Confirmed.
  - [golangci-lint linters](https://golangci-lint.run/docs/linters/) and [settings](https://golangci-lint.run/docs/linters/configuration/) — golangci-lint, 2026 — official_docs — nilerr: "Find the code that returns nil even if it checks that the error is not nil."; errcheck: "These unchecked errors can be critical bugs in some cases."; `check-blank` and `check-type-assertions` both default to false. Confirmed.
  - [100 Go Mistakes #53, #54](https://100go.co/) — Teiva Harsanyi, book (Manning 2022) with a companion site — book, confirmed via the author's own site — #53: "Ignoring an error … should be done explicitly using the blank identifier"; #54: handle a defer error or propagate it, "If you want to ignore it, use the blank identifier." Confirmed.
  - [[ On | No ] syntactic support for error handling](https://go.dev/blog/error-syntax) — Robert Griesemer, Go blog, 3 Jun 2025 — official_docs — "the Go team will stop pursuing syntactic language changes for error handling"; "Lack of better error handling support remains the top complaint in our user surveys." Confirmed.
- **Detect:**
  - `errcheck -blank -asserts ./...`, or golangci errcheck with `check-blank: true` and `check-type-assertions: true`.
  - staticcheck SA4006; ineffassign; nilerr.
  - `grep -rnE "defer [a-zA-Z_.]+\.Close\(\)" --include=*.go .`. For writers (os.Create, OpenFile with write flags, gzip/bufio writers), the Close/Flush error must be checked.
- **Tools:** errcheck, golangci-lint, staticcheck, ineffassign, nilerr
- **Applies to:** All Go code.
- **When not to apply / counterpoints:**
  - Code Review Comments says not to discard with `_`, while *100 Go Mistakes* endorses `_ =` as an explicit signal. errcheck without `-blank` accepts `_ =`.
  - errcheck's built-in exclude list covers calls that are documented never to fail.
- **Fix risk:** medium

### T24-F17 — Go: handle each error once, either by logging it or returning it, not both. When returning, add context the error does not already contain (no "failed to" prefixes), with `%w` if callers may inspect the error and `%v` if the cause is an implementation detail. Compare with errors.Is/errors.As, never `==` or a type assertion on possibly wrapped errors. Error strings are lowercase with no trailing punctuation.
- **Grade:** A · **Verdict:** CORRECTED. Three changes:
  - staticcheck ST1005 is **enabled by default**. The raw checks page tags only SA9003, ST1000, ST1003, ST1016, ST1020, ST1021, ST1022 and ST1023 as non-default. The researcher said ST1005 was non-default.
  - errorlint's `errorf` check (default true) pushes toward `%w`, which conflicts with the `%v` guidance.
  - Google permits `%w` at the *start* of the string for sentinel categories.
- **Rationale:** Log-and-return produces duplicate logs. Wrapping with `%w` makes the wrapped error part of the API. `==` silently fails once anything in the chain wraps.
- **Evidence:**
  - [Google Go Style Guide — Best Practices (Error handling)](https://google.github.io/styleguide/go/best-practices) — Google, 2026 — official_docs — "If you return an error, it's usually better not to log it yourself but rather let the caller handle it."; "Prefer to place %w at the end of an error string if you are to use error wrapping"; "avoid redundant information that the underlying error already provides". For sentinel errors, "placing the %w verb at the beginning of the error string can improve readability". Confirmed.
  - [Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors) — Damien Neil, Jonathan Amsterdam, Go blog, 17 Oct 2019 — official_docs — "Wrap an error to expose it to callers. Do not wrap an error when doing so would expose implementation details."; "wrapping an error makes that error part of your API." Confirmed.
  - [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md) — Uber, 2026 — engineering_blog — "it should typically handle each error only once. The caller should not, for example, log the error and then return it"; "keep the context succinct by avoiding phrases like "failed to""; "Use %v to obfuscate the underlying error". Confirmed.
  - [Don't just check errors, handle them gracefully](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully) — Dave Cheney, 27 Apr 2016 — engineering_blog — "you should only handle errors once. Handling an error means inspecting the error value, and making a decision."; "avoid using sentinel error values in the code you write". Confirmed. The post predates Go 1.13 and recommends `errors.Cause` from pkg/errors.
  - [100 Go Mistakes #52](https://100go.co/) — Teiva Harsanyi — book, confirmed via the author's site — "In most situations, an error should be handled only once. Logging an error is handling an error." Added; confirmed.
  - [Staticcheck ST1005](https://staticcheck.dev/docs/checks/) / [golangci errorlint](https://golangci-lint.run/docs/linters/configuration/) — staticcheck; golangci-lint, 2026 — official_docs — "ST1005 - Incorrectly formatted error string" (no non-default tag). errorlint: "Find code that can cause problems with the error wrapping scheme introduced in Go 1.13"; `errorf` ("Check whether fmt.Errorf uses the %w verb"), `asserts` and `comparison` all default to true. Confirmed.
- **Detect:**
  - golangci-lint `errorlint`. Its `comparison` and `asserts` checks catch `==` and type assertions. Treat `errorf` hits as design questions, not automatic fixes.
  - staticcheck ST1005 (on by default); revive `error-strings`, `error-naming`.
  - Log-and-return: ast-grep, or grep for `if err != nil` blocks that contain both `log.`/`slog.`/`logger.` and `return .*err`.
  - Grep for `"failed to ` inside fmt.Errorf/errors.New.
- **Tools:** golangci-lint (errorlint, revive), staticcheck, ast-grep
- **Applies to:** Go application and library code.
- **When not to apply / counterpoints:**
  - Cheney says to avoid sentinel errors, while the Go 1.13 blog, the Google guide and the standard library use them with errors.Is.
  - Switching `%v` to `%w` is an API commitment, even though errorlint's default nudges toward it.
  - Removing a log line can remove the only record of an error if the caller swallows it. Verify that the top level logs first.
- **Fix risk:** medium

### T24-F18 — Go: library code returns errors instead of panicking. `panic` is reserved for impossible states and for Must* helpers used at program start. os.Exit and log.Fatal* are called only in main(), ideally once.
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Panics that cross package boundaries cause cascading failures, and exits deep in the call tree skip cleanup. The official Go guidance, Google's guide and Uber's guide all agree.
- **Evidence:**
  - [Go Code Review Comments — Don't Panic](https://go.dev/wiki/CodeReviewComments) — Go project, 2026 — official_docs — "Don't use panic for normal error handling. Use error and multiple return values." Confirmed.
  - [Google Go Style Guide — Decisions](https://google.github.io/styleguide/go/decisions) — Google, 2026 — official_docs — "Do not use panic for normal error handling."; Must functions "should only be called early on program startup, not on things like user input". Confirmed.
  - [Google Go Style Guide — Best Practices](https://google.github.io/styleguide/go/best-practices) — Google, 2026 — official_docs — for internal panic/recover designs, "these panics are never allowed to escape across package boundaries". Confirmed.
  - [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md) — Uber, 2026 — engineering_blog — "Code running in production must avoid panics. Panics are a major source of cascading failures."; "Call one of os.Exit or log.Fatal* only in main()"; "prefer to call os.Exit or log.Fatal at most once in your main()". Confirmed.
  - [revive rules](https://github.com/mgechev/revive/blob/master/RULES_DESCRIPTIONS.md) — mgechev/revive, 2026 — official_docs — deep-exit: "Packages exposing functions that can stop program execution by exiting are hard to reuse." Confirmed.
- **Detect:**
  - revive `deep-exit`.
  - `grep -rnE "\bpanic\(" --include=*.go . | grep -v _test.go`, then exclude `func Must`, `init()` and genuinely unreachable branches.
  - `grep -rnE "os\.Exit|log\.Fatal|log\.Panic" --include=*.go .` outside `package main`/main().
- **Tools:** revive, grep
- **Applies to:** Go libraries and non-main packages; production services.
- **When not to apply / counterpoints:**
  - [Effective Go](https://go.dev/doc/effective_go) allows a panic during initialization "if the library truly cannot set itself up" (confirmed).
  - Google permits internal panic/recover within one package.
  - Converting a panic to an error changes the function signature, and therefore every caller.
- **Fix risk:** medium

### T24-F22 — Go dead code: remove unused unexported identifiers reported by staticcheck U1000 / golangci `unused`. Then run whole-program `deadcode -test ./...` for unreachable functions, including exported ones in binaries. Verify each candidate with `-whylive` and a linkname, assembly and build-configuration check before deleting. Prune module requirements with `go mod tidy`.
- **Grade:** A · **Verdict:** CORRECTED. Two changes:
  - The Go team states that deadcode's RTA handles reflection **soundly** ("The analysis can soundly analyze dynamic calls though func values, interface methods, and reflection"). Its documented blind spots are `//go:linkname` aliasing, functions called only from assembly, and single-GOOS/GOARCH/-tags analysis. The researcher had listed reflection as a caveat and attributed the build-tag caveat to the blog, but it comes from the command doc.
  - The researcher's `go mod tidy` quote was not verbatim.
- **Rationale:** `unused` treats exported identifiers as roots, so it cannot see dead exported code. deadcode performs whole-program RTA from main, but its results hold only for one build configuration, and a dead method may still be needed to satisfy an interface.
- **Evidence:**
  - [Finding unreachable functions with deadcode](https://go.dev/blog/deadcode) — Alan Donovan, Go blog, 12 Dec 2023 — official_docs — `go install golang.org/x/tools/cmd/deadcode@latest`; Rapid Type Analysis; "calls made using reflection are considered to reach any method of any type used in an interface conversion"; "the tool is not sound. Its analysis is not aware of functions called exclusively from assembly code, or of the aliasing of functions that arises from the go:linkname directive"; `-whylive`; `-test`. Confirmed.
  - [deadcode command documentation](https://pkg.go.dev/golang.org/x/tools/cmd/deadcode) — Go project, 2026 — official_docs — "a dead method may be required to satisfy an interface that is never called. Some judgement is required. The analysis is valid only for a single GOOS/GOARCH/-tags configuration … Consider running the tool once for each configuration of interest."; "The analysis can soundly analyze dynamic calls though func values, interface methods, and reflection." Added source; confirmed.
  - [unused (source doc comment)](https://raw.githubusercontent.com/dominikh/go-tools/master/unused/unused.go) — dominikh/go-tools, 2026 — official_docs — roots include "(1.1) exported named types", "(1.2) exported functions (but not methods!)", "(1.8) symbols linked via go:linkname", "(1.9) objects in generated files"; "(8.3) All interface methods are marked as used". Confirmed.
  - [golangci-lint linters](https://golangci-lint.run/docs/linters/) — golangci-lint, 2026 — official_docs — unused: "Checks Go code for unused constants, variables, functions and types."; unparam: "Reports unused function parameters." Confirmed.
  - [Go Modules Reference — go mod tidy](https://go.dev/ref/mod) — Go project, 2026 — official_docs — "it removes requirements on modules that don't provide any relevant packages. It also adds any missing entries to go.sum and removes unnecessary entries." Confirmed; the quote is corrected.
- **Detect:**
  - `staticcheck ./...` (U1000) or golangci `unused`.
  - `deadcode -test ./...`, repeated per GOOS/GOARCH/tags of interest. Intersect the results.
  - `deadcode -whylive=<pkg>.<Func> ./...`
  - Before deleting, grep for `//go:linkname`, `.s` files and `//go:build`-tagged files.
  - Modules: `go mod tidy && git diff --exit-code go.mod go.sum`.
  - revive `unreachable-code`, `unused-parameter`, `unused-receiver`.
- **Tools:** staticcheck (U1000), deadcode, golangci-lint unused/unparam, go mod tidy, revive
- **Applies to:** Go binaries, where deadcode is most reliable. In library modules, only unexported code.
- **When not to apply / counterpoints:**
  - In a library, exported functions may be used by downstream modules you cannot see.
  - Removing a parameter from an exported function or interface method breaks callers and implementers.
  - Generated code should be regenerated, not hand-edited.
- **Fix risk:** high

### T24-F15 — Go baseline: all code gofmt/goimports-clean. Run `go vet` and golangci-lint v2 with at least the `standard` set (errcheck, govet, ineffassign, staticcheck, unused; staticcheck now includes the former gosimple and stylecheck). Replace golint with staticcheck/revive. Every `//nolint` must name the linter and give a reason (nolintlint). On a large finished codebase, adopt new linters incrementally with `new-from-rev` / `new-from-merge-base`.
- **Grade:** A · **Verdict:** CORRECTED. Three changes:
  - The `standard` list comes from golangci-lint's linters page (linters tagged "default") and configuration-file page, not the migration guide.
  - The migration guide says deadcode, structcheck, varcheck and golint "have been removed". It does not say "replaced by unused".
  - The researcher said Uber "still says to run golint". That is half true: the Uber guide's intro still says so, but its own Linting section recommends revive as "the modern, faster successor to the now-deprecated golint".
- **Rationale:** gofmt removes style debate, the standard set targets correctness, and blanket nolint comments hide real issues.
- **Evidence:**
  - [Go Code Review Comments — Gofmt](https://go.dev/wiki/CodeReviewComments) — Go project, 2026 — official_docs — "Run gofmt on your code to automatically fix the majority of mechanical style issues."; goimports is "a superset of gofmt which additionally adds (and removes) import lines as necessary". Confirmed.
  - [golangci-lint v2 migration guide](https://golangci-lint.run/docs/product/migration-guide/) — golangci-lint, 2026 — official_docs — "The linters stylecheck, gosimple, and staticcheck has been merged inside the staticcheck."; "The following deprecated linters have been removed: deadcode … golint … structcheck … varcheck". Confirmed.
  - [golangci-lint linters list](https://golangci-lint.run/docs/linters/) and [configuration file](https://golangci-lint.run/docs/configuration/file/) — golangci-lint, 2026 — official_docs — the linters tagged default are errcheck, govet, ineffassign, staticcheck and unused; "`standard`: the "Default" linters"; `new-from-merge-base`, `new-from-rev`. Confirmed.
  - [golangci-lint: false positives](https://golangci-lint.run/docs/linters/false-positives/) — golangci-lint, 2026 — official_docs — "Valid syntax: //nolint:xxx"; invalid: `// nolint`, `//nolint :xxx`, `//nolint: xxx`; example `//nolint:gocyclo // This legacy function is complex…`. nolintlint's `require-explanation` and `require-specific` are on the [settings page](https://golangci-lint.run/docs/linters/configuration/) (both default false). Confirmed.
  - [golang/lint README](https://github.com/golang/lint) — Go project, archived 9 May 2021 — official_docs — "Golint is deprecated and frozen. There's no drop-in replacement for it, but tools such as Staticcheck and go vet should be used instead." Confirmed.
  - [Uber Go Style Guide — Linting](https://github.com/uber-go/guide/blob/master/style.md) — Uber, 2026 — engineering_blog — recommends errcheck, goimports, revive, govet and staticcheck at a minimum, with golangci-lint as the runner; "revive is the modern, faster successor to the now-deprecated golint". Its intro still says "All code should be error-free when run through golint and go vet". Confirmed.
  - [cmd/vet](https://pkg.go.dev/cmd/vet) — Go project (go1.27.1 docs), 2026 — official_docs — "Vet uses heuristics that do not guarantee all reports are genuine problems, but it can find errors not caught by the compilers." Confirmed.
  - [Go Proverbs](https://go-proverbs.github.io/) — Rob Pike, Gopherfest SV 2015 — talk — "Gofmt's style is no one's favorite, yet gofmt is everyone's favorite." Confirmed.
- **Detect:**
  - `test -z "$(gofmt -l .)"`; `go vet ./...`
  - `golangci-lint run` with `linters.default: standard`, plus `nolintlint` with `require-explanation: true` and `require-specific: true`.
  - Blanket suppressions: `grep -rnE "//\s*nolint($|[^:])" --include=*.go .`
  - Check the config for `golint`.
- **Tools:** gofmt, goimports, go vet, golangci-lint v2, staticcheck, revive, nolintlint
- **Applies to:** All Go modules.
- **When not to apply / counterpoints:**
  - `linters.default: all` produces many opinionated style findings that are not quality defects.
  - vet warnings are heuristics.
- **Fix risk:** low

### T24-F23 — Go dependencies: run `govulncheck ./...` and fix reachable vulnerable symbols first. Verify module integrity with `go mod verify`. Pin developer tools through the go.mod `tool` directive (Go ≥1.24) instead of floating `@latest` installs.
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** govulncheck is the official reachability-based scanner, and pinned tools make lint results reproducible.
- **Evidence:**
  - [Go Vulnerability Management](https://go.dev/doc/security/vuln/) — Go project, 2026 — official_docs — "analyzes your codebase and only surfaces vulnerabilities that actually affect you, based on which functions in your code are transitively calling vulnerable functions"; "Govulncheck provides a low-noise, reliable way to find known vulnerabilities in your projects"; "All reports in the database are reviewed and curated by the Go Security team." Confirmed.
  - [Go Modules Reference](https://go.dev/ref/mod) — Go project, 2026 — official_docs — "go mod verify checks that dependencies of the main module stored in the module cache have not been modified since they were downloaded"; "Since Go 1.24, a tool directive adds a package as a dependency of the current module." Confirmed.
  - [Go Proverbs](https://go-proverbs.github.io/) — Rob Pike, 2015 — talk — "A little copying is better than a little dependency." Confirmed.
- **Detect:**
  - `govulncheck ./...`; `go mod verify`; `go list -m -u all`.
  - Check go.mod for `tool` lines, and search scripts and CI for `go install …@latest` or `go run …@latest`.
- **Tools:** govulncheck, go mod verify, go list -m
- **Applies to:** Go modules.
- **When not to apply / counterpoints:**
  - Reachability analysis may miss plugin or dynamic loading (this is reasoning, not a sourced claim).
  - Dependency upgrades can change behaviour, so run the full suite with -race after each bump.
- **Fix risk:** medium

### T24-F24 — Go API and package shape:
  - Define interfaces in the consuming package, only once a real need exists, and keep them small.
  - Return concrete types, and don't export test doubles.
  - Avoid package-level mutable state and init() side effects; inject dependencies instead.
  - Avoid util/common/helper package names.
  - Follow MixedCaps and consistent initialisms, with no Get prefix and consistent short receiver names.
- **Grade:** A · **Verdict:** CORRECTED. The researcher's Google "package-level mutable state" quote was not verbatim. It is replaced with the guide's actual "Global state" wording.
- **Rationale:** These are the most-repeated structural comments in the official and major corporate Go guides.
- **Evidence:**
  - [Go Code Review Comments](https://go.dev/wiki/CodeReviewComments) — Go project, 2026 — official_docs — "Go interfaces generally belong in the package that uses values of the interface type, not the package that implements those values."; "Avoid meaningless package names like util, common, misc, api, types, and interfaces."; "ServeHTTP not ServeHttp"; receiver names are "often a one or two letter abbreviation of its type". Confirmed.
  - [Google Go Style Guide — Decisions](https://google.github.io/styleguide/go/decisions) — Google, 2026 — official_docs — "Avoid creating interfaces until a real need exists."; "Do not define back doors or export test double implementations of an interface solely for testing."; "Do not use generics just because you are implementing an algorithm or data structure that does not care about the type of its member elements." Confirmed.
  - [Google Go Style Guide — Best Practices](https://google.github.io/styleguide/go/best-practices) — Google, 2026 — official_docs — "Libraries should not force their clients to use APIs that rely on global state"; "Global state should be approached with extreme scrutiny"; "Naming a package just util, helper, common or similar is usually a poor choice". Confirmed; the wording is corrected.
  - [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md) — Uber, 2026 — engineering_blog — "Avoid mutating global variables, instead opting for dependency injection."; "Avoid init() where possible."; `var _ http.Handler = (*Handler)(nil)`. Confirmed.
  - [100 Go Mistakes #5–#7, #13](https://100go.co/) — Teiva Harsanyi — book, confirmed via the author's site — "Abstractions should be discovered, not created"; "Keeping interfaces on the client side avoids unnecessary abstractions"; "a function shouldn't return interfaces but concrete implementations in most cases"; "Creating packages such as common, util, and shared doesn't bring much value". Confirmed.
  - [Effective Go](https://go.dev/doc/effective_go) — Go project, 2009 — official_docs — the getter for `owner` "should be called Owner (upper case, exported), not GetOwner"; the banner says it was "written for Go's release in 2009 and is not actively updated". Confirmed.
- **Detect:**
  - staticcheck ST1003 and ST1016 (both non-default; confirmed).
  - revive `receiver-naming`, `var-naming`, `unexported-return`, `import-shadowing`.
  - Manual: list `type .* interface` declarations with their implementations and consumers.
  - `grep -rn "^func init()" --include=*.go .`
  - `find . -type d \( -name 'util*' -o -name common -o -name helpers \)`
- **Tools:** staticcheck (ST1003, ST1016), revive, grep
- **Applies to:** Go codebases. Rename only unexported identifiers unless an API break is acceptable.
- **When not to apply / counterpoints:**
  - Renaming exported identifiers, moving interfaces or changing return types breaks library users.
  - Removing test-seam interfaces may break tests.
  - Effective Go is not updated for generics or modules.
- **Fix risk:** medium

### T24-F13 — Solidity observability and documentation: emit an event for every privileged or critical state change (roles, owners, fees, limits, pauses), immediately after the change, with a past-tense name. Give every ABI-visible item full NatSpec.
- **Grade:** A · **Verdict:** CORRECTED. The Slither detector ids are **`events-access`** and **`events-maths`**. `missing-events-access-control` and `missing-events-arithmetic` are the *forge lint* ids; the researcher had given them for Slither too, so `slither --detect` with those names would fail.
- **Rationale:** Events are the main off-chain monitoring signal, several tools detect missing ones, and NatSpec for everything in the ABI is the official recommendation.
- **Evidence:**
  - [Style Guide — NatSpec](https://docs.soliditylang.org/en/latest/style-guide.html) — Solidity docs, 2026 — official_docs — "It is recommended that Solidity contracts are fully annotated using NatSpec for all public interfaces (everything in the ABI)." Confirmed.
  - [OpenZeppelin GUIDELINES.md](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/GUIDELINES.md) — OpenZeppelin — engineering_blog — "Events should generally be emitted immediately after the state change that they represent, and should be named in the past tense." Confirmed.
  - [Development guidelines](https://secure-contracts.com/development-guidelines/guidelines.html) — Trail of Bits — engineering_blog — "Log all critical operations. Events facilitate contract debugging during development and monitoring after deployment." Confirmed.
  - [Slither Detector Documentation](https://github.com/crytic/slither/wiki/Detector-Documentation) — Crytic — official_docs — `events-access` (Low/Medium): "Detect missing events for critical access control parameters"; `events-maths` (Low/Medium): "Detect missing events for critical arithmetic parameters." Confirmed; ids corrected.
  - [Aderyn detectors](https://cyfrin.gitbook.io/cyfrin-docs/project-configuration/list-of-supported-detectors) — Cyfrin — official_docs — state-variable-changes-without-events: "State variable changes but no event is emitted." Confirmed.
  - [Forge lint list](https://getfoundry.sh/forge/linting) — Foundry — official_docs — Low: missing-events-access-control, missing-events-arithmetic; Info: event-fields. Confirmed.
- **Detect:**
  - slither `--detect events-access,events-maths`
  - forge lint `missing-events-access-control`, `missing-events-arithmetic`, `event-fields`
  - aderyn `state-variable-changes-without-events`
  - NatSpec: list `external`/`public` functions, events and errors not preceded by `///` or `/** */`.
- **Tools:** slither, forge lint, aderyn, forge doc
- **Applies to:** Solidity contracts with admin or parameter-setting functions.
- **When not to apply / counterpoints:**
  - Events cost gas and change bytecode; on deployed immutable contracts the change means a redeploy.
  - Moving an existing emit across an external call changes what reentrancy-events reports and what indexers see.
- **Fix risk:** low

### T24-F09 — Solidity style: enforce the official style guide with `forge fmt --check`, and fix naming with forge lint/Slither.
  - File layout order: pragma, imports, events, errors, interfaces, libraries, contracts.
  - Function order: constructor, receive, fallback, external, public, internal, private, with view/pure last in each group.
  - Modifier order: visibility, mutability, virtual, override, custom.
  - Naming: CapWords for contracts/events/structs, mixedCase for functions/variables, UPPER_CASE constants, and an underscore prefix for non-external functions and variables.
  - Do NOT reorder state variables or rename ABI-visible functions or events in deployed or upgradeable code.
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Consistent layout is what reviewers expect, and the formatter and linters make it cheap. But state-variable declaration order IS the storage layout, and names ARE selectors and event topics.
- **Evidence:**
  - [Style Guide](https://docs.soliditylang.org/en/latest/style-guide.html) — Solidity docs, 2026 — official_docs — "constructor, receive function (if exists), fallback function (if exists), external, public, internal, private. Within a grouping, place the view and pure functions last."; "Visibility, Mutability, Virtual, Override, Custom modifiers"; maximum line length 120; file order pragma, import, events, errors, interfaces, libraries, contracts; UPPER_CASE constants; `_singleLeadingUnderscore` for non-external items. Confirmed.
  - [Formatting (forge fmt)](https://getfoundry.sh/forge/formatting) — Foundry — official_docs — `--check` "exits with an error if any file needs formatting—useful for CI"; `line_length` default 120, `tab_width` 4. Confirmed.
  - [Slither naming-convention](https://github.com/crytic/slither/wiki/Detector-Documentation) — Crytic — official_docs — exceptions: "Allow constant variable name/symbol/decimals to be lowercase (ERC20)"; "Allow _ at the beginning of the mixed_case match for private variables and unused parameters." Confirmed.
  - [Forge lint list](https://getfoundry.sh/forge/linting) — Foundry — official_docs — Info: mixed-case-function, mixed-case-variable, screaming-snake-case-const, screaming-snake-case-immutable, pascal-case-struct, interface-naming, multi-contract-file, named-struct-fields. Confirmed.
  - [forge inspect reference](https://getfoundry.sh/forge/reference/forge-inspect) — Foundry — official_docs — the fields `storageLayout` and `methodIdentifiers` are available. Confirmed.
  - [Writing Upgradeable Contracts](https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable) — OpenZeppelin — official_docs — "you cannot change the order in which the contract state variables are declared". Confirmed.
- **Detect:**
  - `forge fmt --check`; forge lint (info severity); slither `--detect naming-convention`.
  - `forge inspect <C> storageLayout` and `forge inspect <C> methodIdentifiers` must be identical before and after, unless a break is intended.
- **Tools:** forge fmt, forge lint, slither, forge inspect
- **Applies to:** All Solidity. Renames and reorders only for internal/private items, or for not-yet-deployed non-upgradeable contracts.
- **When not to apply / counterpoints:**
  - Standards override the style guide (ERC-20 `name`/`symbol`/`decimals`; EIP interface names).
  - Use one formatter per repo.
  - Reordering state variables in a non-upgradeable contract can still change storage packing and gas.
- **Fix risk:** medium

### T24-F10 — Solidity: replace magic numbers with named constants, and write long literals with scientific notation or ether/time suffixes. Mark never-reassigned state as constant/immutable, but only in non-upgradeable contracts. In a proxy implementation, converting a storage variable to `constant` or `immutable` removes a slot and shifts the layout.
- **Grade:** B (was A) · **Verdict:** DOWNGRADED. Two changes:
  - Every source for the magic-number and readability part is a tool vendor's detector recommendation. No standard or measured study backs it. The storage-layout guard *is* directly supported by OpenZeppelin.
  - The researcher's unsourced immutables counterpoint ("each implementation redeploy changes them") is replaced with OpenZeppelin's FAQ wording.
- **Rationale:** Many-digit literals are hard to review; Slither's example is `1_ether = 10000000000000000000`, which is actually 10 ether. Unwritten state variables cost an SLOAD on every read. But the compiler reserves no slot for constants, so the conversion is a storage-layout change.
- **Evidence:**
  - [Slither Detector Documentation](https://github.com/crytic/slither/wiki/Detector-Documentation) — Crytic — official_docs — too-many-digits: "Literals with many digits are difficult to read and review. Use scientific notation or suffixes to make the code more readable."; recommendation "Use: Ether suffix, Time suffix, or The scientific notation"; constable-states and immutable-states are Optimization, High confidence. Confirmed.
  - [Forge lint list](https://getfoundry.sh/forge/linting) — Foundry — official_docs — Info: literal-instead-of-constant, too-many-digits; Gas: could-be-constant, could-be-immutable. Confirmed.
  - [Aderyn detectors](https://cyfrin.gitbook.io/cyfrin-docs/project-configuration/list-of-supported-detectors) — Cyfrin — official_docs — literal-instead-of-constant: "Define and use constant variables instead of using literals". Confirmed.
  - [Writing Upgradeable Contracts](https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable) — OpenZeppelin — official_docs — prohibits removing a variable or changing its type; "It is still ok to define constant state variables, because the compiler does not reserve a storage slot for these variables". Confirmed.
  - [OpenZeppelin Upgrades FAQ — immutable variables](https://docs.openzeppelin.com/upgrades-plugins/faq) — OpenZeppelin — official_docs — "Upgradeable contracts have no constructors but initializers, therefore they can't handle immutable variables"; "Since the immutable variable value is stored in the bytecode its value would be shared among all proxies pointing to a given contract instead of each proxy's storage"; the override is `unsafeAllow: ['state-variable-immutable']`. Added; confirmed.
- **Detect:**
  - slither `--detect too-many-digits,constable-states,immutable-states`
  - forge lint `literal-instead-of-constant`, `too-many-digits`, `could-be-constant`, `could-be-immutable`
  - aderyn `literal-instead-of-constant`
  - `forge inspect <C> storageLayout` before and after.
- **Tools:** slither, forge lint, aderyn, forge inspect
- **Applies to:** Solidity. The constant/immutable conversion applies only to non-upgradeable or pre-deployment code.
- **When not to apply / counterpoints:**
  - Small literals (0, 1, 10_000 basis points) are often clearer inline, and over-extraction hurts readability.
  - OZ's upgrade plugins flag `immutable` in implementations as unsafe by default.
- **Fix risk:** medium

### T24-F11 — Solidity complexity: flag functions with cyclomatic complexity >11 (Slither) or deep nesting, and split them into small, single-purpose internal functions within the same contract. Every use of "special code" (assembly, delegatecall, CREATE2, block.timestamp/number, oracles, pseudo-randomness, external calls, overflow-capable math) must carry a comment saying why it is needed and how misuse is prevented.
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Small, understandable contracts are an official security recommendation, EthTrust [M] requires special code to be documented, and excessive nesting is named as a legibility problem.
- **Evidence:**
  - [Security Considerations](https://docs.soliditylang.org/en/latest/security-considerations.html) — Solidity docs — official_docs — "Keep your contracts small and easily understandable. Single out unrelated functionality in other contracts or into libraries." Confirmed.
  - [Slither cyclomatic-complexity](https://github.com/crytic/slither/wiki/Detector-Documentation) — Crytic — official_docs — "Detects functions with high (> 11) cyclomatic complexity."; "Reduce cyclomatic complexity by splitting the function into several smaller subroutines." Confirmed.
  - [EEA EthTrust v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) — EEA, 2025 — standard — "[M] Document Special Code Use: Tested Code MUST document the need for each instance of: CREATE2, assembly {}, selfdestruct() or its deprecated alias suicide(), external calls, delegatecall(), code that can cause an overflow or underflow, block.number or block.timestamp, or Use of oracles and pseudo-randomness, and MUST describe how the Tested Code protects against misuse or errors in these cases"; [GP] "Excessive nesting, unstructured comments, complex looping structures, and the use of very terse names for variables and functions are examples of coding styles that can also make code harder to understand." Confirmed.
  - [Development guidelines](https://secure-contracts.com/development-guidelines/guidelines.html) — Trail of Bits — engineering_blog — "Write small functions with clear purposes."; "minimize the depth and width of the inheritance tree. Use Slither's inheritance printer". Confirmed.
  - [Simplicity vs. Complexity](https://consensysdiligence.github.io/smart-contract-best-practices/general-philosophy/simplicity-vs-complexity/) — ConsenSys Diligence, n.d. — engineering_blog — "A monolithic self-contained contract keeps all knowledge locally identifiable and readable"; "there is a fundamental tradeoff between malleability and security"; "security best practices trend away from software engineering best practices in simple short-lived contracts". Confirmed.
- **Detect:**
  - slither/forge lint `cyclomatic-complexity`
  - `slither . --print inheritance-graph,function-summary`
  - Special-code grep: `grep -rnE "assembly|delegatecall|create2|new [A-Z][A-Za-z]*\{salt|block\.(timestamp|number)|unchecked" src/`, then confirm each hit has a justification comment or `@dev` NatSpec.
- **Tools:** slither, forge lint
- **Applies to:** Solidity contracts in a hardening pass.
- **When not to apply / counterpoints:**
  - The >11 threshold is a tool default with no empirical validation.
  - Splitting across *contracts* adds external calls and trust boundaries. ConsenSys notes that simple short-lived systems favour locality.
  - Extracting internal functions can shift gas use and trigger "stack too deep" on the legacy pipeline (reasoning, not sourced).
- **Fix risk:** medium

### T24-F25 — Go complexity: keep the happy path at minimal indentation. Return early on errors, drop else after return, and flatten nested ifs. Flag functions using explicitly stated thresholds (for example cognitive 15–20, cyclomatic 10–15, nestif score 4–5, max control nesting 5, funlen 60 lines / 40 statements), and refactor them only where tests cover them.
- **Grade:** B · **Verdict:** CORRECTED. Three changes:
  - `nestif`'s setting is a *complexity score* of nested if statements (default 5), not a nesting depth.
  - revive's `cognitive-complexity` defaults to **7** and `max-control-nesting` to **5**, which widens the known spread of defaults.
  - revive's `early-return` description is quoted verbatim (the researcher's quote was not).
- **Rationale:** Indent-error-flow is official Go review guidance. Tool defaults vary widely (revive cognitive 7; gocyclo/gocognit 30 with a recommended 10–20; cyclop 10), so the reviewer must state the threshold used.
- **Evidence:**
  - [Go Code Review Comments — Indent Error Flow](https://go.dev/wiki/CodeReviewComments) — Go project — official_docs — "Try to keep the normal code path at a minimal indentation, and indent the error handling, dealing with it first." Confirmed.
  - [golangci-lint linter settings](https://golangci-lint.run/docs/linters/configuration/) — golangci-lint, 2026 — official_docs — gocyclo and gocognit "Default: 30 (but we recommend 10-20)"; cyclop max-complexity "Default: 10"; funlen lines "Default: 60", statements "Default: 40"; nestif "Minimal complexity of if statements to report. Default: 5"; dupl threshold "Default: 150" tokens. Confirmed.
  - [revive rules](https://github.com/mgechev/revive/blob/master/RULES_DESCRIPTIONS.md) — mgechev/revive, 2026 — official_docs — early-return: "In Go it is idiomatic to minimize nesting statements, a typical example is to avoid if-then-else constructions."; cognitive-complexity "Default: 7"; max-control-nesting "Default: 5"; indent-error-flow, superfluous-else, cyclomatic and function-length also exist. Confirmed.
  - [Uber Go Style Guide — Reduce Nesting, Unnecessary Else](https://github.com/uber-go/guide/blob/master/style.md) — Uber — engineering_blog — "Code should reduce nesting where possible by handling error cases/special conditions first and returning early". Confirmed.
  - [Go Proverbs](https://go-proverbs.github.io/) — Rob Pike, 2015 — talk — "Clear is better than clever. Reflection is never clear." Confirmed.
- **Detect:**
  - golangci-lint `gocognit`, `cyclop`/`gocyclo`, `nestif`, `funlen`, `dupl`
  - revive `indent-error-flow`, `superfluous-else`, `early-return`, `max-control-nesting`, `cognitive-complexity`
  - staticcheck S1008 (simplify returning a boolean expression) and S1002 (omit comparison with a boolean constant).
  - Refactor only covered functions: `go test -coverprofile=c.out ./... && go tool cover -func=c.out`.
- **Tools:** golangci-lint (gocognit, cyclop, gocyclo, nestif, funlen, dupl), revive, staticcheck
- **Applies to:** Go code; highest value on frequently changed functions.
- **When not to apply / counterpoints:**
  - No threshold is empirically validated for Go.
  - Table-driven switches and generated parsers score high but read easily.
  - Splitting code only to satisfy a metric can scatter logic.
- **Fix risk:** medium

### T24-F12 — Solidity gas vs readability: in a hardening pass, do not introduce inline assembly, new unchecked blocks or other gas-golfing. Treat gas-severity lints (e.g., forge lint `asm-keccak256`) as optional and measure them. Any existing assembly must be justified, marked `("memory-safe")` only if it truly is, and have a tested non-assembly reference.
- **Grade:** C · **Verdict:** CORRECTED. The RareSkills book is a gas-optimization catalogue. It *recommends* assembly reverts and unchecked math in the right cases, alongside its readability caveat, so it is not "pushback against gas-golfing". The characterization is fixed here and in Practitioner voice, and its date is corrected (last updated 22 Oct 2025).
- **Rationale:** Standards and practitioner sources agree that gas optimizations trade away readability, and that assembly bypasses compiler safety checks and appears in EthTrust's special-code list. Newer compilers already apply several optimizations automatically (0.8.22 loop increments; 0.8.26 small custom-error reverts).
- **Evidence:**
  - [Gas optimization book](https://www.rareskills.io/post/gas-optimization) — RareSkills, last updated 22 Oct 2025 — engineering_blog — "Gas optimizations usually make code less readable and more complex. A good engineer must make a subjective tradeoff…"; "you should always test the non-assembly version"; "you should actually measure the effect of the alternatives". Confirmed. The same book lists assembly reverts and unchecked blocks as optimizations.
  - [Development guidelines](https://secure-contracts.com/development-guidelines/guidelines.html) — Trail of Bits — engineering_blog — "Avoid inline assembly. Assembly requires EVM expertise. Do not write EVM code unless you have mastered the yellow paper." Confirmed.
  - [OpenZeppelin GUIDELINES.md](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/GUIDELINES.md) — OpenZeppelin — engineering_blog — "The code should be simple and straightforward, prioritizing readability and understandability."; "Sometimes these guidelines may be broken if doing so brings significant efficiency gains, but explanatory comments should be added." Confirmed.
  - [EEA EthTrust v3 — [GP] Write Clear, Legible Solidity Code; [S] No assembly {}](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) — EEA, 2025 — standard — "developers can sacrifice easy reading for other benefits such as reducing gas costs - this can be mitigated somewhat by well-documented code."; "[S] No assembly {}: Tested Code MUST NOT contain the assembly {} instruction unless it meets the Set of Overriding Requirements…". Confirmed.
  - [Solidity 0.8.26 release announcement](https://soliditylang.org/blog/2024/05/21/solidity-0.8.26-release-announcement/) — Solidity team, 2024 — official_docs — for small custom errors, "developers often resorted to performing such reverts in inline assembly in order to save on deployment gas cost. As of this release, a check is performed at the code generation stage, and said optimization applied if possible". Confirmed verbatim.
- **Detect:**
  - `grep -rn "assembly" src/`. Each block needs a justification comment and a test against a Solidity reference.
  - forge lint gas findings (`asm-keccak256`, `custom-errors`, `cache-array-length`, `costly-loop`) go to an optional list with `forge snapshot --diff` evidence.
- **Tools:** forge lint, forge snapshot, grep
- **Applies to:** Projects where readability and auditability outweigh marginal gas.
- **When not to apply / counterpoints:**
  - forge lint ships a gas lint that pushes toward assembly, and OZ tolerates guideline breaks for "significant efficiency gains".
  - For high-volume protocols, gas is a user-facing cost.
  - This is consensus guidance, not measured evidence.
- **Fix risk:** low

### T24-F14 — Solidity dependencies: consume audited libraries (e.g., OpenZeppelin) through a dependency manager at pinned versions, never as copy-pasted source. Remove redundant dependencies, fix forge lint `deprecated-oz-function` hits, and never jump an OZ major version in an upgradeable system without a storage-layout check.
- **Grade:** C · **Verdict:** CORRECTED. Two changes:
  - The researcher overstated ConsenSys. It does **not** say that duplication is safer than reusing untrusted code. It says "Duplication is frequently relied upon in cases where self-owned previously-deployed contracts are not available", and that re-used code without established trust must be included in the security analysis.
  - Trail of Bits' "Always keep external sources up-to-date" is added.
- **Rationale:** Every dependency widens the attack surface, and copied library code misses upstream fixes. OZ 5.0 moved to ERC-7201 namespaced storage and removed SafeMath and Counters, so major bumps are not drop-in.
- **Evidence:**
  - [Dependencies](https://scsfg.io/developers/dependencies/) — Smart Contract Security Field Guide (Dominik Muhs), 2023–2026 — engineering_blog — "Review each dependency at least once and declare fixed versions of all of them explicitly."; "Every additional dependency widens the attack surface of a smart contract." Confirmed.
  - [Development guidelines](https://secure-contracts.com/development-guidelines/guidelines.html) — Trail of Bits — engineering_blog — "Use well-tested libraries. Importing code from well-tested libraries reduces the likelihood of writing buggy code. If writing an ERC20 contract, use OpenZeppelin. Use a dependency manager instead of copying and pasting code. Always keep external sources up-to-date." Confirmed.
  - [Simplicity vs. Complexity — Duplication versus Reuse](https://consensysdiligence.github.io/smart-contract-best-practices/general-philosophy/simplicity-vs-complexity/) — ConsenSys Diligence, n.d. — engineering_blog — "Using proven previously-deployed contracts which you own is generally the safest manner to achieve code reuse. Duplication is frequently relied upon in cases where self-owned previously-deployed contracts are not available."; "Any contract security analysis must include any re-used code that has not previously established a level of trust commensurate with the funds at risk". Confirmed; the paraphrase is corrected.
  - [Introducing OpenZeppelin Contracts 5.0](https://www.openzeppelin.com/news/introducing-openzeppelin-contracts-5.0) — OpenZeppelin, 5 Oct 2023 — engineering_blog — ERC-7201 namespaced storage; SafeMath and Counters removed "for efficiency, simplification, and security purposes"; Solidity 0.8.20. Confirmed.
- **Detect:**
  - `git submodule status` (Foundry `lib/` pins) or exact versions in package.json; `cat remappings.txt`.
  - Vendored copies: `grep -rln "OpenZeppelin Contracts" src/`.
  - forge lint `deprecated-oz-function`, `solmate-safe-transfer-lib`.
- **Tools:** git submodule, forge lint, pnpm/npm lockfile
- **Applies to:** Solidity projects using external libraries.
- **When not to apply / counterpoints:**
  - Pinning without monitoring freezes known bugs in place (Trail of Bits: keep sources up to date).
  - The evidence is practitioner consensus, not measured data.
- **Fix risk:** medium

## Practitioner voice

- [Let's Encrypt 2020.02.29 CAA rechecking bug](https://community.letsencrypt.org/t/2020-02-29-caa-rechecking-bug/114591) — Boulder checked one domain N times instead of N domains. About 3M certificates were affected and 1,706,505 revoked. The root cause, "taking a reference to a loop iterator variable", is stated in the [Bugzilla incident report](https://bugzilla.mozilla.org/show_bug.cgi?id=1619047). This is the canonical real-world case behind Go 1.22's loop-variable change.
- [Russ Cox, golang/go discussion #56010](https://github.com/golang/go/discussions/56010) — At Google, forcing per-iteration loop semantics gave 58 failures in about 100k tests over about 1.3M loops. 36 were t.Parallel tests not testing what they claimed, and only 2 were correct code broken. He estimates the old semantics "easily cost many millions of dollars".
- [Uber: Data Race Patterns in Go](https://www.uber.com/blog/data-race-patterns-in-go/) — about 2,000 races found across about 50M LOC and about 2,100 services, and about 1,100 fixed by 210 developers in 6 months. It catalogues 7 recurring, greppable patterns.
- [Uber: LeakProf](https://www.uber.com/blog/leakprof-featherlight-in-production-goroutine-leak-detection/) — 10 critical leaking goroutines with 1 false positive. Fixing two cut peak memory 2.5x and 5x. The typical fix is a done channel with capacity 1.
- [Lobsters: On/No syntactic support for error handling](https://lobste.rs/s/xyhnvt/on_no_syntactic_support_for_error) — Practitioners split between "nothing particularly wrong with error handling in Go, it's just verbose" and complaints beyond syntax. One offers tooling as the answer ("errcheck is a thing you can use"); another replies that ignoring errors "likely should have been a compilation error".
- [Lobsters: Goroutine leak profiles](https://lobste.rs/s/dpfpr3/goroutine_leak_profiles) — mknyszek, writing as part of the Go team ("Don't take this as me or the Go team saying 'never'"): "reaping goroutines out from under the program risks generating new hard-to-debug failure modes". masklinn contrasts this with Rust's mpsc drop semantics. Leak detection is diagnostic; prevention stays the developer's job.
- [HN: Using go fix to modernize Go code](https://news.ycombinator.com/item?id=47049479) — 432 points. "I had missed that rangeint addition to the language but with go fix I'll just get that improvement for free!"; another user used to hand-fix loops by search and regexp. This supports mechanical, reviewable modernization passes.
- [fasterthanli.me: Lies we tell ourselves to keep using Golang](https://fasterthanli.me/articles/lies-we-tell-ourselves-to-keep-using-golang) — Amos Wenger, 29 Apr 2022, a dissenting critique. It covers copied mutexes and zero-value fields "resulting in countless logic errors", and nil-channel sends and receives that "block forever". The conclusion "run mandatory linters" is this dossier's takeaway, not the author's own recommendation.
- [parity-ethereum #6995 "anyone can kill your contract"](https://github.com/openethereum/parity-ethereum/issues/6995) — 6 Nov 2017, "I accidentally killed it", labelled P0-dropeverything. EthTrust v3 (Example 18) records that the unprotected self-destruction "blocked around 1/2 Million Ether". OpenZeppelin's `_disableInitializers()` guidance addresses the uninitialized-implementation class of bug.
- [Vyper nonreentrancy post-mortem](https://hackmd.io/@vyperlang/HJUgNMhs2) — Vyper 0.2.15, 0.2.16 and 0.3.0 gave every `@nonreentrant` decorator a unique storage offset regardless of key, which enabled cross-function reentrancy. Curve pools were exploited on 30 July 2023. Source-level guards failed because the compiler was wrong.
- [Solidity transient-storage clearing bug](https://soliditylang.org/blog/2026/02/18/transient-storage-clearing-helper-collision-bug) — rated high, affecting 0.8.28–0.8.33 with via-IR, yet only three deployed contracts matched. The workaround is to assign zero instead of `delete`. Compiler version plus settings belong in every Solidity review.
- [OpenZeppelin Contracts 5.0](https://www.openzeppelin.com/news/introducing-openzeppelin-contracts-5.0) — a 12.84% average deployment-cost drop across the library from custom errors. The release also removed SafeMath and Counters and adopted ERC-7201 storage.
- [Trail of Bits: Slither](https://blog.trailofbits.com/2019/05/27/slither-the-leading-static-analyzer-for-smart-contracts/) — a vendor reentrancy benchmark: Slither 10.9% false positives, Securify 25%, SmartCheck 73.6%, Solhint 91.3%. Analyzers disagree widely.
- [RareSkills gas optimization book](https://www.rareskills.io/post/gas-optimization) — a widely used gas-optimization catalogue. It still warns "Gas optimizations usually make code less readable and more complex" and says to "always test the non-assembly version" and "actually measure". It is a readability caveat from within the gas-optimization community, not opposition to it.

## Contradictions and open questions

**Contradictions (sources verified)**
- **Solidity pragma form.**
  - Slither: "Use a simple pragma version that allows any of these versions".
  - Aderyn: "should be specific, not wide".
  - EthTrust [Q]: a range that produces identical bytecode. Its note *allows* an open-ended `>=` pragma, but the certification must name a specific validated range.
- **Compiler freshness.**
  - EthTrust [GP]: "SHOULD use the latest available stable Solidity compiler version".
  - Trail of Bits: "we do not recommend the newest version for deployment". It also says to check warnings with the latest release.
  - History supports both: 0.8.28 introduced a new via-IR transient-storage bug, while 0.8.37 fixed bugs present in all versions up to 0.8.36.
- **Assembly for gas.**
  - forge lint's `asm-keccak256` gas lint and OZ's "significant efficiency gains" exception push toward assembly.
  - Trail of Bits ("Avoid inline assembly") and EthTrust ([S] No assembly unless the [M] overrides are met) push the other way.
- **Revert messages.** Aderyn's `require-without-string` flags empty require/revert, while Solidity docs, OZ 5.0 and forge lint `custom-errors` push toward custom errors. Custom errors satisfy both, but a naive fix reintroduces strings.
- **Go error discarding.** Code Review Comments says "Do not discard errors using _ variables". *100 Go Mistakes* #53 says to ignore explicitly with `_`. errcheck accepts `_ =` unless `-blank` is set.
- **Go sentinel errors.** Cheney (2016, pre-Go 1.13) says to "avoid using sentinel error values in the code you write", while the Go 1.13 blog, the Google guide and the standard library use them with errors.Is.
- **Go error wrapping.** golangci errorlint's `errorf` check (default true) flags `fmt.Errorf` that does not use `%w`. The Go 1.13 blog says "Do not wrap an error when doing so would expose implementation details", and Uber and Google allow `%v` deliberately.
- **Go concurrency philosophy (partial contradiction).** Effective Go and the proverbs say "share memory by communicating". Tu et al. found 58% of *blocking* bugs came from message passing ("Contrary to common belief, message passing can cause more blocking bugs than shared memory"), but also that about 80% of *non-blocking* bugs were shared-memory ones (105 shared-memory vs 66 message-passing bugs overall). Neither model is simply "safer".
- **Outdated Go guidance.**
  - The Uber guide's intro still says to run `golint`, while its own Linting section recommends revive as golint's successor.
  - *100 Go Mistakes* #76 (time.After leak) is flagged on the author's own site as obsolete from Go 1.23.
  - Effective Go says it is "not actively updated".
- **Complexity thresholds.** revive cognitive-complexity defaults to 7, gocyclo/gocognit to 30 ("we recommend 10-20"), cyclop to 10, and Slither flags >11. None has empirical validation in the sources found.
- **Reuse vs duplication.** The Go proverb "A little copying is better than a little dependency" conflicts with Trail of Bits and scsfg.io ("Use a dependency manager instead of copying and pasting code"; "Every additional dependency widens the attack surface"). ConsenSys is descriptive: duplication is "frequently relied upon" when self-owned deployed contracts are unavailable.
- **OWASP Smart Contract Top 10 editions disagree on ranking.** The 2025 edition put Reentrancy at SC05; the 2026 edition puts it at SC08 and adds Business Logic (SC02), Arithmetic Errors (SC07) and Proxy & Upgradeability (SC10). The 2026 list is explicitly a *forecast* based on 2025 data and a survey. The old owasp.org project page still shows 2025.

**Open questions**
- No public false-positive or precision data exists for forge lint (93 lints in the current docs) or Aderyn. Slither's 10.9% is a 2019 vendor benchmark. Should the skill weight findings by tool?
- EthTrust v3 (March 2025) is still what entethalliance.org/specs/ethtrust-sl/ resolves to (checked 2026-09-23). The spec expected a successor "in the second half of 2026", but none was found, and its editor's-draft link returns 404.
- How can the skill detect upgradeability reliably (UUPS, Transparent, Beacon, Diamond/ERC-2535, custom delegatecall proxies) before storage-affecting fixes? slither-check-upgradeability and the OZ plugins cover common patterns only.
- Web3Bugs shows that more than 80% of exploitable bugs are beyond existing tools. Which manual checklist (access control, business logic, oracles, accounting invariants) should the skill run? This needs another topic's findings.
- Do forge lint gas lints still save measurable gas under via-IR with the 0.8.3x optimizer? This needs per-project `forge snapshot --diff` evidence.
- No Go-specific study linking gocognit or gocyclo scores to defects was found.
- go fix and deadcode analyze one GOOS/GOARCH/tags configuration per run. How many configurations should the skill iterate by default?
- The new `go fix` has had bug-fix releases (1.26.1, 1.27.1). How much trust should an automated pass place in it without human diff review?
- Practitioner-forum coverage for Solidity (r/ethdev, Ethereum StackExchange, Code4rena judging) remains thin because of fetch and search limits.

## Dropped findings

None. All 25 findings had real, reachable sources that supported at least a corrected version of the rule.

All 14 practitioner-voice URLs opened and said what is stated above. The gists were reworded where needed:
- **Let's Encrypt:** the root cause comes from Bugzilla.
- **Parity:** the impact comes from EthTrust.
- **fasterthanli.me:** the gist stays within the author's actual claims.
- **RareSkills:** described as a gas catalogue with caveats.
