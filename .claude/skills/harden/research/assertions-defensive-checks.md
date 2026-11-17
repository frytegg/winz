# Assertions, invariants and defensive checks: when a hardening pass should add them, when it may remove them, and what a failed check should do
> Code G203 · slug assertions-defensive-checks · verified 2026-09-23 · counts: verified 12 / corrected 4 / downgraded 2 / dropped 0

## Summary

What the evidence says (every item re-checked against the source on 2026-09-23; corrections to the researcher's text are marked **[corrected]**).

**1. Assertion density and defects.** A few peer-reviewed observational studies exist.
- **Kudrjavets, Nagappan and Ball** (ISSRE 2006, DOI 10.1109/ISSRE.2006.14). They studied two Visual Studio components written mostly in C/C++, with two internal releases each. Per-file Spearman correlations between assertion density and post-release fault density ranged from -0.209 to -0.384, all significant. Faults "related to assertions" averaged 14.5% in component A and 6.5% in component B. The authors say "enforcing the use of assertions would not work well", and that a mandate of 30 asserts/KLOC "may not lead to an effective use of assertions".
- **Casalnuovo et al.** (ICSE 2015, C/C++ on GitHub). Functions with asserts "do have significantly fewer defects". Their own summary, known only through a secondary quote in Counsell 2017, adds two points. The effect in the count model "is almost insignificant, and the magnitude of the effect is negligible overall" **[added]**. "Adding the first assert to a file has a significant and sizable effect on bugs, but after the first ... additional asserts has no appreciable difference."
- **Kochhar and Lo** (EASE 2017, 185 Java projects) found a "small yet significant relationship". The abstract does not state the direction of the effect.
- **Counsell et al.** (ISSREW 2017; test classes of two industrial telecom Java systems) found "only limited evidence" for the earlier results.

All four studies are correlational, and developer ownership and experience confound them. The fixed quotas in Power of Ten (2 per function), TigerStyle (2 per function) and the JPL C standard (1 per function over 10 lines) are expert rules: none cites data that is specific to assertions.

**2. What developers assert.** Mostly null or presence checks:
- about three-quarters of Code Contracts (Schiller et al., ICSE 2014);
- 80–96% of C# preconditions (Estler et al., FM 2014), who expect static analysis to "supersede such checks".

There is almost no evidence on which kinds of check catch bugs. The strongest industrial data point is Google's always-on hardened libc++: 0.30% average performance impact, over 1,000 bugs found, and a 30% reduction in the baseline segfault rate. The low overhead is partly because the compiler removes redundant checks, and a handful of hot paths still use explicitly unsafe accesses **[added]**.

**3. Per language.**
- **Python.** `-O` removes `assert`. How common `-O` is in production is disputed: Ruff calls it "a common practice", while CPython core developer Gregory P. Smith expected most people to answer "No".
- **C/C++.** CMake's GNU, Clang and MSVC modules add `-DNDEBUG` to the Release, RelWithDebInfo and MinSizeRel flags. This happens only when one of those build types is selected **[added]**.
- **C++26 contracts.** The final C++26 plenary vote was 114-12-3 in March 2026. Contracts have four evaluation semantics: ignore, observe, enforce and quick-enforce. They are still contested (P3835R0, P3911, P4334R0 of August 2026), and P3846R1 defends them.
- **Rust.** `assert!` cannot be disabled. `debug_assert!` is off in the default release profile. The std docs allow replacing `assert!` with `debug_assert!` "only after thorough profiling, and more importantly, only in safe code!".
- **JS/TS.** `tiny-invariant` still throws in production; only the message is replaced.
- **Solidity.** `assert` raises Panic(0x01), and "properly functioning code should never create a Panic". Use `require` or custom errors for input.
- **Go.** Go has no assertions, and Effective Go says library functions should avoid panic. `net/http` recovers a handler panic, assuming it was isolated to that request. It logs a stack trace and closes the connection (or sends HTTP/2 RST_STREAM), so the client does not get a 5xx **[added]**.

**4. Unreachable-by-construction branches.** SQLite's `ALWAYS`/`NEVER`/`testcase` macros are the model. The code is compiled three ways and the test suite must give identical results under all three. SQLite also documents that 100% MC/DC and fuzzing pull in opposite directions.

**5. Rollout.** Adding an always-on check to a working product is a behaviour change.
- Google rolled out hardened libc++ in stages: tests, then a pre-production "bake", then production service by service over several months.
- **[corrected]** Google's post describes no non-fatal production phase. Only Chromium (`base::NotFatalUntil`) and libc++ (the `observe` semantic) provide a non-fatal phase, and both limit it in time.
- Chromium also forbids `NotFatalUntil` when there is no reasonable way to recover from the failure.

**6. Postmortems.** Several show a check in the wrong place, or with the wrong failure scope, taking down whole systems:
- **Cloudflare 2025:** `unwrap()` on a self-generated feature file that exceeded a 200-feature limit.
- **CrowdStrike 2024:** a missing runtime bounds check; 21 fields were defined but only 20 inputs supplied.
- **NATS 2023:** one flight plan put both the primary and the backup system into maintenance mode. **[corrected]** The flight plan was valid. The failure was a software defect plus the wrong failure scope, not a missing validation of untrusted input.
- **Yuan et al.** (OSDI 2014; 198 failures in Cassandra, HBase, HDFS, MapReduce and Redis, 48 of them catastrophic): 92% of catastrophic failures came from incorrect handling of non-fatal errors. 25% ignored the error (log-only counts as ignoring). 8% aborted the whole cluster through an over-broad catch.

**Decision table** (context x language x check type -> action; failure behaviour; grade). Kept from the researcher; the grades reflect verification.
- **R1. Data crossing a trust or version boundary** (user input, network, files, env, persisted state, IPC from a less-privileged process, and your own generated config or rules). KEEP, or ADD, an explicit always-on check, ideally a parse into a precise type. Never use assert, unwrap/expect, CHECK or panic here. On failure, reject the item with a typed error, keep the last-known-good state, and alert. Grade B.
- **R2. Internal O(1) invariant whose violation means memory unsafety, UB or a security bug.**
  - C/C++: CONVERT `assert()` to an always-on mechanism (a CHECK-style macro, hardened libc++ fast mode, or `contract_assert` under enforce or quick-enforce).
  - Rust: KEEP `assert!`, and never downgrade it where unsafe code relies on it.
  - On failure, terminate the process (trap or abort) under a supervisor. Grade A.
- **R3. Internal O(1) invariant in memory-safe code.**
  - Python: keep `assert` only if losing it under `-O` is harmless; otherwise use `if not c: raise`.
  - TS/JS: use an `invariant()` that throws.
  - Rust: use `assert!` or `expect("why this cannot fail")`. That this complies with ANSSI is an interpretation: ANSSI allows panics only when "usage conditions have been violated".
  - Go: panic only on impossible states.
  - Java: use `assert` (off by default) or `IllegalStateException`.
  - Solidity: use `assert`.
  - On failure, fail the unit of work through one top-level handler that logs the stack and alerts. Never return success. Grade B.
- **R4. Expensive internal invariant.** Make it DEBUG-ONLY. CI or fuzzing must run a build where it is enabled. Grade B.
- **R5. Branch unreachable by construction.** KEEP it and MARK it with a marker that crashes at runtime. In TS, a `never` assignment alone does not throw **[corrected]**. Exclude it from coverage explicitly. Grade B.
- **R6. Check made redundant by a SOUND compile-time guarantee or a static proof,** within the same trust domain, and not the only guard before UB or unsafe code. REMOVE it, or move the guarantee into a type. Guarantees that exist only as annotations (TS types, C# nullable reference types, Java @NonNull) do not count at public APIs or on external data. Grade B.
- **R7. Assert followed by a silent fallback for the same condition.** CONVERT it to one mechanism. Grade C.
- **R8. Success-shaped fallback or swallowed error.** REMOVE it or CONVERT it to a propagated error. Keep only documented degradations that emit a metric. Grade A.
- **R9. Assertion with side effects.** FIX it by moving the effect out of the predicate. Grade A.
- **R10. New always-on check, or promotion from debug-only to always-on, in a live product.** Roll it out in stages. Use a non-fatal phase only where a safe fallback exists, and only for a limited time. Grade B.
- **R11. Assertion-density quotas.** Do not add asserts to reach a number. Grade B.
- **R12. Security-critical decisions.** Use an explicit always-on check that fails closed. Grade A/B.

**How this resolves the dossier conflicts** (researcher's reconciliation, kept):
- **T01 vs S101/-O/NDEBUG.** The density rule and the "recover or crash" clause apply to checks that are always on. Anything that must hold in production goes through R1–R3. S101 hits are triaged one by one.
- **T12.** Over-defensive code is removed through R6–R8. Trust-boundary validation stays. When the pass cannot prove a check redundant, it converts rather than deletes.
- **T18.** typescript-eslint itself says `no-unnecessary-condition` "may report inaccurately" when the types do not match runtime behaviour.
- **T22.** Using unwrap or expect on external or config data violates both ANSSI and R1.
- **T14/T28.** Detect at the point of violation, then terminate the smallest unit whose state can be discarded.

## Findings

### G203-F03 — Python: use `assert` only for internal invariants whose removal under `-O` is harmless; everything else must be `if not cond: raise SpecificError(...)`
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:** Any check that validates input, enforces authorization or is needed for correct behaviour must raise explicitly. Triage Ruff S101 / Bandit B101 hits one by one, not in bulk: keep true invariants (suppressed per line with a reason) and convert the rest. Also fix `assert False` (B011) and `assert (x, msg)` (F631).
- **Rationale:** The language reference says CPython emits no code for `assert` under `-O`. Bandit documents real projects that lost protections this way. Ruff's claim that `-O` is "common" in production is disputed, so argue from what the check protects, not from how often `-O` is used. Library code cannot know how it will be run. icontract's default (`enabled=__debug__`) also disappears under `-O`.
- **Evidence:**
  - [The Python Language Reference 3.14.7 — The assert statement](https://docs.python.org/3/reference/simple_stmts.html#the-assert-statement) — PSF, 2026 — official docs — "__debug__ is True under normal circumstances, False when optimization is requested (command line option -O). The current code generator emits no code for an assert statement when optimization is requested at compile time." — Verified verbatim (page header 3.14.7).
  - [B101: assert_used](https://bandit.readthedocs.io/en/latest/plugins/b101_assert_used.html) — Bandit (PyCQA), 2026 — official docs — "some projects used assert to enforce interface constraints. However, assert is removed with compiling to optimised byte code ... This caused various protections to be removed." Severity Low, Confidence High, CWE-703 — Verified.
  - [assert (S101)](https://docs.astral.sh/ruff/rules/assert/) — Astral (Ruff), 2026 — official docs — "Assertions are removed when Python is run with optimization requested (i.e., when the -O flag is present), which is a common practice in production environments." Asserts in `TYPE_CHECKING` blocks are exempt — Verified. The "common practice" claim is Ruff's own assertion, not data.
  - [Does anyone use -O or -OO or PYTHONOPTIMIZE=1 in their deployments?](https://discuss.python.org/t/does-anyone-use-o-or-oo-or-pythonoptimize-1-in-their-deployments/37671) — discuss.python.org, thread by Gregory P. Smith, 1 Nov 2023 — practitioner forum — gpshead: "I expect the answer to the question in the subject for most is 'No'". Marc-André Lemburg: "I regularly use -O ... for production application code". Dima Tisnek: "At 3/4, never used -O" — Verified.
  - [icontract usage — Toggling contracts](https://github.com/Parquery/icontract/blob/master/docs/source/usage.rst) — Parquery, 2025 — official docs — "If you left enabled argument to its default __debug__, the contract will not be verified in -O mode". Contracts marked `icontract.SLOW` are "too sluggish to execute in a real application" — Verified in the raw rst.
  - [assert-false (B011)](https://docs.astral.sh/ruff/rules/assert-false/) and [assert-tuple (F631)](https://docs.astral.sh/ruff/rules/assert-tuple/) — Astral (Ruff), 2026 — official docs — B011: "making assert False an unreliable means of raising an AssertionError". F631: "Non-empty tuples are always True, so an assert statement with a non-empty tuple as its test condition will always pass" — Verified.
- **Detect:** Run `ruff check --select S101,B011,F631` on non-test code, or `bandit -r src -t B101`. Classify each hit:
  - The condition involves request, user, env, file, network, DB or deserialized data, permissions or money, or a later side effect depends on it. CONVERT it to `raise`.
  - It is a pure relationship between internal values. KEEP it, with `# noqa: S101 - invariant: <why>`.

  Then run the test suite with `python -O -m pytest`. Failures that appear only under `-O` mean an assert was doing real work.
- **Tools:** ruff (S101, B011, F631), bandit (B101), pytest under `python -O`.
- **Applies to:** Python (CPython 3.x), including libraries whose deployment flags are unknown.
- **When not to apply / counterpoints:** Converting every assert removes the cheap way to write internal invariants. In the `-O` thread, a user (Numerlor) notes that linters warning on asserts mean "they never end up in the code". Test files and `TYPE_CHECKING` narrowing are legitimate uses.
- **Fix risk:** medium

### G203-F04 — C/C++: treat `assert()` as absent in every production build; conditions guarding memory safety, UB or security must use an always-on mechanism
- **Grade:** A · **Verdict:** VERIFIED (context added on CMake and on why Google's overhead was low)
- **Rule:** Use a CHECK-style macro, the standard-library hardening mode ('fast' in libc++), or C++26 `contract_assert` under an enforce or quick-enforce semantic. Keep plain `assert()` for expensive or purely diagnostic checks, and make sure CI builds and runs the tests with assertions enabled.
- **Rationale:**
  - With `NDEBUG` defined, `assert` does nothing.
  - CMake's compiler modules add `-DNDEBUG` to the Release, RelWithDebInfo and MinSizeRel flags. This applies only when one of those build types is selected; an empty `CMAKE_BUILD_TYPE` adds no NDEBUG.
  - SQLite turns asserts off in release because they make it about 3x slower.
  - Chromium prefers `CHECK` and says crash instructions are "nearly free on modern CPUs".
  - Google measured 0.30% average impact for hardened libc++ across its services. The post attributes this partly to the compiler eliminating redundant checks, and notes that "a handful of performance-critical code paths still require targeted use of explicitly unsafe accesses".
- **Evidence:**
  - [assert — cppreference](https://en.cppreference.com/cpp/error/assert) — cppreference.com, 2026 — reference wiki — "If NDEBUG is defined as a macro name at the point in the source code where <cassert> or <assert.h> is included, the assertion is disabled: assert does nothing." — Verified.
  - [Modules/Compiler/GNU.cmake](https://github.com/Kitware/CMake/blob/master/Modules/Compiler/GNU.cmake) — Kitware, 2026 — source/official — lines 64–66: `string(APPEND CMAKE_${lang}_FLAGS_{MINSIZEREL,RELEASE,RELWITHDEBINFO}_INIT " -DNDEBUG")` — Verified. `Platform/Windows-MSVC.cmake` does the same with `/DNDEBUG`.
  - [The Use Of assert() In SQLite](https://www.sqlite.org/assert.html) — SQLite, 2026 — official docs — "Leaving assert(X) turned on causes SQLite to run about three times slower ... For these reasons, assert(X) is a no-op for release builds in SQLite." — Verified. Another stated reason is keeping 100% MC/DC in the as-delivered build.
  - [Retrofitting spatial safety to hundreds of millions of lines of C++](https://security.googleblog.com/2024/11/retrofitting-spatial-safety-to-hundreds.html) — Alex Rebert, Max Shavrick, Kinuko Yasuda (Google), 15 Nov 2024 — industry report — "average 0.30% performance impact across our services"; "The safety checks have uncovered over 1,000 bugs"; "30% reduction in our baseline segmentation fault rate across production" — Verified verbatim.
  - [Hardening Modes](https://libcxx.llvm.org/Hardening.html) — LLVM libc++, 2026 — official docs — Fast mode: checks "intended to be used in production. We recommend most projects adopt this." Debug mode: "not intended to be used in production." — Verified.
  - [CHECK(), DCHECK() and NOTREACHED()](https://chromium.googlesource.com/chromium/src/+/main/styleguide/c++/checks.md) — Chromium, 2026 — official style guide — "Prefer CHECK() and NOTREACHED() over DCHECK()s ... great effort and care has gone into making the crash instructions nearly free on modern CPUs." — Verified in full text. googlesource timed out, so the identical file was read from the GitHub mirror `chromium/chromium`.
- **Detect:** Confirm what production builds compile: `grep -rn NDEBUG CMakeLists.txt cmake/`, and `cmake -LA -N build | grep FLAGS_RELEASE`. List `assert(` calls that come right before a dereference, an index, `memcpy`/`memmove` or a variable-sized allocation (ast-grep). Check the `_LIBCPP_HARDENING_MODE` setting, and check that some CI job builds without NDEBUG.
- **Tools:** clang-tidy bugprone-assert-side-effect, ast-grep, `cmake -LA`, libc++ hardening modes.
- **Applies to:** C and C++ (CMake, Make, Bazel), especially code that handles external data or raw memory.
- **When not to apply / counterpoints:** Hot paths can pay real costs (SQLite measured 3x with all asserts on). Keep those checks debug-only, but then fuzzing and tests must run the debug build. Stroustrup et al. (P4334R0) call "enable while testing, remove in production" "a 1980s approach". They argue for always-on hardened libraries plus static analysis, not more programmer-written runtime assertions.
- **Fix risk:** medium

### G203-F06 — Rust: keep `assert!` and `expect("why this cannot fail")` for genuine internal invariants; never unwrap or expect a Result or Option that comes from outside the binary; in libraries, do not panic on caller-controlled input
- **Grade:** A · **Verdict:** VERIFIED (ANSSI's stricter rule for libraries added)
- **Rule:** Propagate external failures with `?` plus context. Document any remaining panics under `# Panics`. Downgrade `assert!` to `debug_assert!` only after profiling, and only in safe code.
- **Rationale:**
  - `assert!` is always on, and unsafe code may rely on it.
  - The `debug_assert!` doc allows the downgrade only after profiling and only in safe code.
  - Cargo's default release profile has `debug-assertions = false` and `overflow-checks = false`.
  - The Rust Book says to panic when a contract or invariant is broken, and to return `Result` when failure is expected.
  - ANSSI LANG-LIMIT-PANIC: a function "MUST NOT panic UNLESS its usage conditions have been violated". ANSSI also says "Crates providing libraries should never use functions or instructions that can fail and cause the code to panic", which is stricter than this rule.
  - Reading an invariant `expect()` as compliant with LANG-LIMIT-PANIC-SRC is an interpretation. The rule restricts unwrap, expect and assert! "to cases explicitly forbidden by the function's specification".
  - Cloudflare's worst outage since 2019 came from `unwrap()` on a self-generated feature file.
- **Evidence:**
  - [Macro std::debug_assert (Rust 1.98.1)](https://doc.rust-lang.org/std/macro.debug_assert.html) — Rust project, 2026 — official docs — "An unchecked assertion allows a program in an inconsistent state to keep running ... The performance cost of assertions, however, is not measurable in general. Replacing assert! with debug_assert! is thus only encouraged after thorough profiling, and more importantly, only in safe code!" — Verified.
  - [Macro std::assert](https://doc.rust-lang.org/std/macro.assert.html) — Rust project, 2026 — official docs — "Assertions are always checked in both debug and release builds, and cannot be disabled"; "Unsafe code may rely on assert! to enforce run-time invariants" — Verified.
  - [To panic! or Not to panic! (Book ch. 9.3)](https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html) — Rust project, 2026 — official docs — "When failure is expected, it's more appropriate to return a Result"; calling expect is acceptable when "you have some other logic that ensures that the Result will have an Ok value", and the reason should go in the expect message — Verified.
  - [ANSSI Secure Rust Guidelines — errors.md](https://github.com/ANSSI-FR/rust-guide/blob/master/src/en/errors.md) — ANSSI, last commit 2026-03-23 — standard/guideline — LANG-LIMIT-PANIC: "A Rust function MUST NOT panic UNLESS its usage conditions have been violated." LANG-LIMIT-PANIC-SRC: "Uses of unwrap, expect and assert! MUST be restricted to cases explicitly forbidden by the function's specification." — Verified in raw markdown. Commit date confirmed via the GitHub API.
  - [Cargo Book — Profiles](https://doc.rust-lang.org/cargo/reference/profiles.html) — Rust project, 2026 — official docs — release defaults: `debug-assertions = false`, `overflow-checks = false`, `panic = 'unwind'` — Verified.
  - [Cloudflare outage on November 18, 2025](https://blog.cloudflare.com/18-november-2025-outage/) — Matthew Prince (Cloudflare), 2025 — incident report — "When the bad file with more than 200 features was propagated to our servers, this limit was hit — resulting in the system panicking"; "thread fl2_worker_thread panicked: called Result::unwrap() on an Err value"; remediation: "Hardening ingestion of Cloudflare-generated configuration files in the same way we would for user-generated input" — Verified verbatim.
  - [Clippy lints](https://rust-lang.github.io/rust-clippy/master/index.html) — Rust Clippy, 2026 — official docs — `unwrap_used` and `expect_used` are restriction lints. `missing_panics_doc` (pedantic) "warns if there is no `# Panics` section". `debug_assert_with_mut_call` (nursery): "mutating something in a debug_assert! macro results in different behavior between a release and debug build" — Verified in the Clippy source (`declare_clippy_lint!` groups). All are allow-by-default, so they must be enabled explicitly.
- **Detect:** Run `cargo clippy --all-targets -- -W clippy::unwrap_used -W clippy::expect_used -W clippy::missing_panics_doc -W clippy::indexing_slicing -W clippy::debug_assert_with_mut_call`. Trace where each unwrap or expect gets its value:
  - From I/O, a parse of external text, deserialization or config: convert to `?` plus a context error.
  - From internal logic: `expect("invariant: ...")`.

  Also check every `debug_assert!` near an `unsafe {` block, and whether overflow-checks are on in release for security-relevant arithmetic.
- **Tools:** cargo clippy, grep `unsafe {`, audit of the Cargo.toml profiles.
- **Applies to:** Rust applications and libraries; stricter for public library crates.
- **When not to apply / counterpoints:** Some teams ban `unwrap` but allow `expect` with a message (Modal, per an HN comment). Converting panics into `Result` changes signatures. With `panic = 'abort'`, any panic kills the process, so G203-F14 applies. ANSSI notes that safety-critical domains may use `panic = 'abort'` as fail-fast with handover to a redundant or backup subsystem.
- **Fix risk:** medium

### G203-F07 — TypeScript/JavaScript: do not delete a runtime check just because `no-unnecessary-condition` or the type says it is unnecessary
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:** Delete such a check only if every value reaching it comes from typed code in the same trust domain, under `strict` and `noUncheckedIndexedAccess`, with no `any`, no `as` casts and no external JSON or I/O. At boundaries, replace ad-hoc checks with a schema parse into a precise type. For internal invariants, use an always-on `invariant()` that throws, and let production builds strip only the message.
- **Rationale:** The TS type system is deliberately unsound. typescript-eslint documents inaccurate reports when types do not match runtime behaviour: `array[0]` and record lookups are false positives, and there is an "intentionally unsound TypeScript behavior" case. tiny-invariant still throws in production. C# nullable reference types are purely a compile-time feature, with documented holes.
- **Evidence:**
  - [Type Compatibility — A Note on Soundness](https://www.typescriptlang.org/docs/handbook/type-compatibility.html) — Microsoft, 2026 — official docs — "TypeScript's type system allows certain operations that can't be known at compile-time to be safe. When a type system has this property, it is said to not be 'sound'." — Verified.
  - [no-unnecessary-condition](https://typescript-eslint.io/rules/no-unnecessary-condition/) — typescript-eslint, 2026 — official docs — "This rule is powered by TypeScript types, therefore, if the types do not match the runtime behavior, the rule may report inaccurately." Examples marked "// false positive"; "intentionally unsound TypeScript behavior"; recommends disable comments rather than turning the rule off — Verified in the raw mdx.
  - [tiny-invariant README](https://github.com/alexreardon/tiny-invariant) — Alex Reardon, 2025 — project docs — "When process.env.NODE_ENV is set to production, the message will be replaced with the generic message Invariant failed." — Verified in the raw README. The throw itself remains.
  - [Parse, don't validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) — Alexis King, 5 Nov 2019 — engineering blog — "Push the burden of proof upward as far as possible, but no further." — Verified.
  - [Nullable reference types — C#](https://learn.microsoft.com/en-us/dotnet/csharp/nullable-references) — Microsoft Learn, 2026 — official docs — "The runtime behavior of your program is unchanged. Nullable reference types are entirely a compile-time feature." Known pitfalls: default structs, and new arrays of non-nullable references that hold null — Verified. Canonical URL: /fundamentals/null-safety/nullable-reference-types.
- **Detect:** Run `@typescript-eslint/no-unnecessary-condition` and trace the provenance of each hit. Keep the check if the value comes from any of these:
  - `JSON.parse(`, `.json()`, or a fetch or axios response;
  - `as X` or `as unknown as`, or `: any`;
  - a `Record<string, T>` lookup, or `arr[i]` without `noUncheckedIndexedAccess`;
  - a third-party `.d.ts`;
  - postMessage or IPC.

  Removal is safe only if none of these apply and the tsconfig has `strict` and `noUncheckedIndexedAccess`.
- **Tools:** typescript-eslint no-unnecessary-condition, `tsc --strict --noUncheckedIndexedAccess`, grep/ast-grep, schema validators at boundaries.
- **Applies to:** TypeScript/JavaScript. By analogy, C# nullable reference types and Java @NonNull annotations.
- **When not to apply / counterpoints:** Checks that really are redundant inside fully typed modules add noise, and the lint is usually right there. Schema parsing everywhere adds runtime cost and dependencies.
- **Fix risk:** medium

### G203-F08 — Solidity: `require` or custom errors for input, caller, `msg.value` and external results; `assert` only for internal invariants
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:** Never turn an input check into `assert`. Never put state changes or costly calls inside `require` or `assert` arguments. Treat any change to revert data as an ABI-visible behaviour change.
- **Rationale:**
  - The Solidity docs: properly functioning code never creates a Panic, "not even on invalid external input".
  - `assert` produces Panic(0x01).
  - `require` arguments "are evaluated unconditionally".
  - Custom errors, available since 0.8.4, are gas-efficient.
  - Before 0.8.0, a Panic used the `invalid` opcode, which "consumed all gas available to the call".
- **Evidence:**
  - [Control Structures — Panic via assert and Error via require](https://docs.soliditylang.org/en/latest/control-structures.html#panic-via-assert-and-error-via-require) — Solidity team, 2026 (0.8.x) — official docs — "Assert should only be used to test for internal errors, and to check invariants. Properly functioning code should never create a Panic, not even on invalid external input." 0x01: "If you call assert with an argument that evaluates to false." "require arguments are evaluated unconditionally, so take special care to make sure that they are not expressions with unexpected side-effects." — Verified.
  - [Custom Errors in Solidity](https://soliditylang.org/blog/2021/04/21/custom-errors/) — Solidity team, 21 Apr 2021 — official blog — "Starting from Solidity v0.8.4, there is a convenient and gas-efficient way to explain to users why an operation failed"; revert strings are "rather expensive, especially when it comes to deploy cost" — Verified.
  - [Slither Detector Documentation — assert-state-change](https://github.com/crytic/slither/wiki/Detector-Documentation#assert-state-change) — Trail of Bits, 2026 — tool docs — Severity Informational, Confidence High; "The assert in bad() increments the state variable s_a while checking for the condition." — Verified in the raw wiki.
- **Detect:** Run `slither . --detect assert-state-change`. Grep `assert(` conditions that reference msg.sender, msg.value, tx.origin, parameters, block values or external call results; those should use `require` or a custom error. Use the SMTChecker to confirm that the remaining asserts are true invariants.
- **Tools:** slither, solc SMTChecker, grep.
- **Applies to:** Solidity >= 0.8.
- **When not to apply / counterpoints:** Replacing revert strings with custom errors changes revert data. Off-chain decoders and tests that match on strings will break, so treat it as an interface change. On already-deployed contracts it only applies to new deployments.
- **Fix risk:** medium

### G203-F09 — Go: do not add assert-style helpers that panic on expected errors; libraries return errors; panic only on impossible states; never discard errors with `_`
- **Grade:** A · **Verdict:** VERIFIED (detail added on what net/http recovery actually does)
- **Rationale:**
  - The Go FAQ calls assertions "a crutch to avoid thinking about proper error handling", and acknowledges that its stance is "a point of contention".
  - Effective Go: "real library functions should avoid panic". It sanctions panicking on impossible states (a CubeRoot loop that does not converge) and on init failure.
  - Code Review Comments forbid panic for normal errors, and discarding errors with `_`.
  - `net/http` recovers a handler panic. It logs a stack trace and closes the connection or sends HTTP/2 RST_STREAM; it does not send a 5xx response.
- **Evidence:**
  - [Go FAQ — Why does Go not have assertions?](https://go.dev/doc/faq#assertions) — The Go Authors, 2026 — official docs — "programmers use them as a crutch to avoid thinking about proper error handling and reporting. Proper error handling means that servers continue to operate instead of crashing after a non-fatal error." — Verified.
  - [Effective Go — Panic](https://go.dev/doc/effective_go#panic) — The Go Authors, 2026 — official docs — "real library functions should avoid panic. If the problem can be masked or worked around, it's always better to let things continue to run rather than taking down the whole program." — Verified.
  - [Go Code Review Comments](https://go.dev/wiki/CodeReviewComments) — The Go Authors, 2026 — official wiki — "Don't use panic for normal error handling. Use error and multiple return values." "Do not discard errors using _ variables." — Verified.
  - [net/http Handler](https://pkg.go.dev/net/http#Handler) — The Go Authors, 2026 — official docs — "If ServeHTTP panics, the server (the caller of ServeHTTP) assumes that the effect of the panic was isolated to the active request. It recovers the panic, logs a stack trace to the server error log, and either closes the network connection or sends an HTTP/2 RST_STREAM" — Verified in `src/net/http/server.go`, because the pkg.go.dev render was truncated.
- **Detect:** Run `golangci-lint run -E errcheck,nilerr`. Grep `panic(` outside `package main` and `init()`. Grep discarded errors, e.g. `_ = f()` and `x, _ := f()`. Check that each `recover()` logs a stack trace and does not return success.
- **Tools:** golangci-lint (errcheck, nilerr), go vet, grep.
- **Applies to:** Go libraries and services.
- **When not to apply / counterpoints:** Panicking on genuinely impossible states is sanctioned. Internal packages that panic on invariants and recover at a boundary are acceptable if that boundary is the unit of failure (F14). Because net/http recovery assumes the panic was isolated to one request, it is unsafe if the handler may have corrupted shared state.
- **Fix risk:** medium

### G203-F16 — Assertion and contract predicates must be side-effect free; audit them before changing any build's assertion setting
- **Grade:** A · **Verdict:** CORRECTED (citation label only: P2900 "Principles 7–9" -> "Principles 6–9"; every quote verified)
- **Rule:** The settings concerned include `-O`, NDEBUG, `debug-assertions=false`, a contract semantic and Java `-ea`. Move any mutation, I/O, iterator or stream consumption, or mutating call out of the predicate.
- **Rationale:** Every source agrees: Power of Ten, JPL, Java, clang-tidy, Clippy, Slither, the Solidity docs, P2900 and Chromium.
- **Evidence:**
  - [bugprone-assert-side-effect](https://clang.llvm.org/extra/clang-tidy/checks/bugprone/assert-side-effect.html) — LLVM clang-tidy, 2026 — tool docs — "The condition of assert() is evaluated only in debug builds so a condition with side effect can cause different behavior in debug / release builds." Options: `AssertMacros` (default `assert,NSAssert,NSCAssert`); `CheckFunctionCalls` (off by default, to reduce false positives); `IgnoredFunctions` — Verified.
  - [Programming With Assertions (Java SE 8)](https://docs.oracle.com/javase/8/docs/technotes/guides/language/assert.html) — Oracle — official docs — "Do not use assertions to do any work that your application requires for correct operation ... Violating this rule has dire consequences." `// Broken! - action is contained in assertion  assert names.remove(null);` — Verified. The page is the Java 8 guide. The behaviour is unchanged in current JDKs: the [JDK 25 `java` man page](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html) says "By default, assertions are disabled in all packages and classes."
  - [Clippy: debug_assert_with_mut_call](https://rust-lang.github.io/rust-clippy/master/index.html#debug_assert_with_mut_call) — Rust Clippy, 2026 — tool docs — "In release builds debug_assert! macros are optimized out by the compiler. Therefore mutating something in a debug_assert! macro results in different behavior between a release and debug build." Group: nursery (allow by default) — Verified in the Clippy source.
  - [P2900R14 Contracts for C++](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2025/p2900r14.pdf) — Berne, Doumler, Krzemieński et al. (WG21), 13 Feb 2025 — standard proposal — Principle 6, "No Destructive Side Effects", and its corollary after Principles 7–9: "such side effects are not guaranteed to occur any particular number of times or at all and cannot be relied upon for correctness" — Verified in the PDF text.
  - [CHECK(), DCHECK() and NOTREACHED()](https://chromium.googlesource.com/chromium/src/+/main/styleguide/c++/checks.md) — Chromium, 2026 — official style guide — "Any side effects intended to happen inside the DCHECK() disappear from production along with it, and unexpected behaviour can happen afterward as a result." — Verified.
  - Supporting: the Power of Ten (Rule 5) and JPL (Rule 16) texts both say "Assertions must be side-effect free" (verified); see F01/F11 for the links. Slither and Solidity: see F08.
- **Detect:**
  - C/C++: `clang-tidy -checks=bugprone-assert-side-effect`, with `CheckFunctionCalls=true` and the project's macros in `AssertMacros`.
  - Rust: `cargo clippy -- -W clippy::debug_assert_with_mut_call`.
  - Solidity: `slither --detect assert-state-change`.
  - Python: ast-grep for `assert` containing `.pop(`, `.remove(`, `next(`, `.send(`, `.write(`, or a walrus assignment.
  - Empirical: run the test suite in both modes (`python` vs `python -O`, Debug vs Release, `cargo test` vs `cargo test --release`) and diff the results.
- **Tools:** clang-tidy, clippy, slither, ast-grep, dual-mode test runs.
- **Applies to:** All languages with removable or configurable assertions.
- **When not to apply / counterpoints:** There is no real dispute. The tools have false positives on calls that are const but not annotated as such.
- **Fix risk:** low

### G203-F15 — Remove success-shaped fallbacks and swallowed errors; keep a fallback only as a documented, instrumented, tested degradation
- **Grade:** A · **Verdict:** VERIFIED (scope of the Yuan numbers and a Ruff/Yuan tension added)
- **Rule:** Targets: empty catch blocks, `except: pass`, log-only handlers, catch-then-return-a-default, `.ok()` or `unwrap_or_default()` on errors that matter, and `_`-discarded errors. Replace them with propagation, or with an assertion when the failure is "impossible".
- **Rationale:** Yuan et al. studied 198 randomly sampled user-reported failures, 48 of them catastrophic, in five Java/C distributed data systems. 92% of the catastrophic failures came from incorrect handling of explicitly signalled non-fatal errors. 35% came from three trivial patterns: an empty or log-only handler, an abort on an over-broad exception, or a TODO in the handler. Ignoring errors alone was 25%, and "an error handler that only logs the error is also considered as ignoring the error". These faults are "easily detectable by tools or code reviews without a deep understanding of the runtime context". Power of Ten Rule 7 lets you ignore a return value only through an explicit `(void)` cast.
- **Evidence:**
  - [Simple Testing Can Prevent Most Critical Failures (OSDI 2014)](https://www.usenix.org/system/files/conference/osdi14/osdi14-paper-yuan.pdf) — Yuan, Luo, Zhuang, Rodrigues, Zhao, Zhang, Jain, Stumm (U. Toronto), 2014 — peer-reviewed — "almost all (92%) of the catastrophic system failures are the result of incorrect handling of non-fatal errors explicitly signaled in software"; "in 35% of the catastrophic failures, the faults in the error handling code fall into three trivial patterns ..."; Figure 5: Errors ignored 25%, Abort in over-caught exceptions 8%, "TODO" in handler 2% — Verified in the PDF text.
  - [try-except-pass (S110)](https://docs.astral.sh/ruff/rules/try-except-pass/) and [blind-except (BLE001)](https://docs.astral.sh/ruff/rules/blind-except/) — Astral (Ruff), 2026 — tool docs — S110: "Suppressing exceptions may hide errors ... Instead, consider logging the exception." BLE001: "catch only those that are expected to be raised in the try block"; handlers that re-raise or log with `exc_info` are exempt — Verified. Note the tension: S110's suggested fix, logging, is exactly what Yuan counts as ignoring the error.
  - [no-empty](https://eslint.org/docs/latest/rules/no-empty) — ESLint, 2026 — tool docs — "This rule ignores block statements which contain a comment", so `catch {/* ignore */}` passes. `allowEmptyCatch` exists — Verified.
  - [The Power of 10 (Rule 7)](https://web.eecs.umich.edu/~imarkov/10rules.pdf) — Gerard J. Holzmann, 2006 (IEEE Computer; university mirror) — practitioner standard — "explicitly casting the function return value to (void) can be acceptable, thereby indicating that the programmer explicitly and not accidentally decided to ignore a return value" — Verified.
  - [HN comment on agent-generated fallbacks](https://news.ycombinator.com/item?id=48420230) — HN user SubiculumCode, 6 Jun 2026, story "My Agent Skill for Test-Driven Development" — practitioner forum — "excessive use of fallbacks routines ... a silent bad fallback means the processed data is not what I thought it was..e.g. used an inaccurate geodesic method in place of the accurate one" — Verified via the HN Algolia API. Anecdote only.
- **Detect:**
  - Python: `ruff check --select S110,S112,BLE001`, plus a grep for `except ...: pass` and `return None/[]/{}/0/""/False` inside handlers. BLE001 will not flag handlers that log with `exc_info`, so log-only handlers still need the grep.
  - TS/JS: ESLint `no-empty` with `allowEmptyCatch: false`. Comments bypass it, so also grep comment-only catch blocks and `.catch(() => null|undefined|[]|{})`.
  - Go: `golangci-lint -E errcheck,nilerr`.
  - Rust: grep `.ok()`, `unwrap_or_default()` and `let _ =` on fallible calls.
  - All: grep handlers containing TODO or FIXME.
- **Tools:** ruff (S110, S112, BLE001), bandit (B110/B112), eslint no-empty, golangci-lint, grep.
- **Applies to:** All languages; especially AI-generated code and I/O, parsing and financial paths.
- **When not to apply / counterpoints:** Some fallbacks are correct product behaviour: cached or degraded results, provider failover, best-effort cleanup at shutdown. Removing a fallback can turn silent wrong answers into visible errors, which changes user-visible behaviour, so coordinate with owners and use a flag. Yuan's study covers distributed data-intensive systems (the authors warn that the results may not generalise), and the 92% rests on 48 catastrophic failures.
- **Fix risk:** high

### G203-F10 — Keep defensive branches that are unreachable by construction, but mark them explicitly with a marker that fails loudly when reached
- **Grade:** B · **Verdict:** CORRECTED (the TS `never` pattern does not throw at runtime; grade lowered from A to B because the "do not delete for coverage" policy is the documented practice of SQLite and Chromium, not a general standard)
- **Rule:** Use one of these markers:
  - an ALWAYS/NEVER-style wrapper;
  - `NOTREACHED()`;
  - `typing.assert_never`, which throws at runtime;
  - Rust `unreachable!`;
  - in TS, a helper such as `function assertNever(x: never): never { throw new Error(...) }`. **[corrected]** The handbook's `const _exhaustiveCheck: never = shape` is compile-time only and returns normally at runtime.

  Do not delete these branches to raise coverage or to silence "condition always true" lints. Do not leave them as unmarked silent fallbacks.
- **Rationale:** SQLite's `ALWAYS(X)`/`NEVER(X)` pass X through in release (the defensive code stays), abort in functionality testing, and become constants in coverage builds. The suite is run three times, and "All three test runs should yield exactly the same result". SQLite also documents the tension between MC/DC and fuzzing. Chromium uses `NOTREACHED()` after exhaustive enum switches because "enums can technically hold any integer value".
- **Evidence:**
  - [The Use Of assert() In SQLite](https://www.sqlite.org/assert.html) — SQLite, 2026 — official docs — ALWAYS(X) means X is "always true as far as the developers know, but there is no proof the X is true, or the proof is complex and error-prone, or the proof depends on implementation details that are likely to change in the future". Build table: Functionality testing -> "abort() if X is false"; Coverage testing -> "always true"; Release -> "pass through the value X" — Verified.
  - [How SQLite Is Tested](https://www.sqlite.org/testing.html) — SQLite, 2026 — official docs — §4.1.6: "MC/DC testing discourages defensive code with unreachable branches, but without defensive code, a fuzzer is more likely to find a path that causes problems." §7.2: "The test suite is designed to be run three times ... All three test runs should yield exactly the same result." §7.3: 1184 testcase() uses. §8.1: 6754 assert() statements — Verified.
  - [CHECK(), DCHECK() and NOTREACHED()](https://chromium.googlesource.com/chromium/src/+/main/styleguide/c++/checks.md) — Chromium, 2026 — official style guide — "enums can technically hold any integer value ... We can avoid dealing with values outside enums by using NOTREACHED() while also making sure we hear about it." — Verified.
  - [typing.assert_never](https://docs.python.org/3/library/typing.html#typing.assert_never) — PSF, 2026 — official docs — "If a type checker finds that a call to assert_never() is reachable, it will emit an error ... At runtime, this throws an exception when called." — Verified in `Doc/library/typing.rst`. Added in Python 3.11.
  - [Narrowing — Exhaustiveness checking](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) — Microsoft, 2026 — official docs — "you can use narrowing and rely on never turning up to do exhaustive checking in a switch statement" — Verified. The example (`const _exhaustiveCheck: never = shape; return _exhaustiveCheck;`) does not throw at runtime, which is why the rule was corrected.
  - [Excluding code from coverage.py (7.16.1)](https://coverage.readthedocs.io/en/latest/excluding.html) — Ned Batchelder, 2026 — tool docs — the example `exclude_also` list includes `'raise AssertionError'`, `'raise NotImplementedError'` and `'if TYPE_CHECKING:'` — Verified (version confirmed in the page title).
- **Detect:** Collect three sets:
  - (a) `no-unnecessary-condition` or Sonar "always true/false" hits;
  - (b) branches that coverage reports as never executed;
  - (c) `default:`, `else` or `case _` arms that return a neutral value.

  Classify each:
  - Defensive against untrusted data or unsound types: keep it, mark it, and add a test that forces it if possible.
  - Impossible under sound types: replace it with a throwing exhaustiveness check.
  - Dead after a refactor: delete it.

  Exclude marked lines explicitly (e.g. coverage.py `exclude_also 'raise AssertionError'`), not with broad pragmas.
- **Tools:** coverage.py `exclude_also`, typescript-eslint, pyright/mypy (`assert_never`), tsc never checks, clippy.
- **Applies to:** All languages; critical for projects with coverage gates or fuzzing.
- **When not to apply / counterpoints:** Coverage exclusions can hide real dead code, so each needs a reason. SQLite's three-build discipline is expensive, and most projects will approximate it with a marker plus one test build. Armstrong's Erlang rules let a function crash on unexpected input rather than add defensive branches.
- **Fix risk:** low

### G203-F05 — C++26 contracts: do not bulk-migrate `assert()` or CHECK to `pre`/`post`/`contract_assert` during a hardening pass; where contracts are used, pin the semantic, keep predicates non-destructive, and never rely on an ignorable contract as the only security check
- **Grade:** B · **Verdict:** DOWNGRADED (every cited fact verified at grade A, but the rule itself, "do not bulk-migrate", is the researcher's conservative inference from an active dispute and immature toolchains, not guidance stated by any source)
- **Rule:** Where a codebase already uses contracts:
  - pin the evaluation semantic per component in the build: enforce or quick-enforce for preconditions that protect memory or security, and observe only during an adoption window;
  - keep predicates non-destructive;
  - never rely on a contract assertion as the only security check while any build could select "ignore".
- **Rationale:**
  - Contracts are in C++26: final vote 114–12–3, "non-unanimous primarily because of the sustained concerns about contracts".
  - The choice of semantic is implementation-defined.
  - P3835R0 says there is no mechanism to guarantee a consistent semantic per component. It relays that clang implementer Eric Fiselier called the feature "essentially unusable without some kind of label mechanism".
  - P3911 (Romanian NB comment RO 2-056, Neațu, Alexandrescu, Teodorescu, Nichita, Dec 2025) asks to "Make Contracts Reliably Non-Ignorable".
  - P4334R0 (Aug 2026) calls the enable-in-test/remove-in-production model "a 1980s approach".
  - P3846R1 answers that almost all objections are repetitions, and that "complete implementations exist in publicly available forks of GCC and Clang ... with upstreaming in progress".
  - As of March 2026, GCC had contracts in trunk, awaiting release.
- **Evidence:**
  - [P2900R14 Contracts for C++](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2025/p2900r14.pdf) — Berne, Doumler, Krzemieński et al. (WG21), 13 Feb 2025 — standard proposal — "We propose four evaluation semantics: ignore, observe, enforce, and quick-enforce"; "contract-assertion predicates that, when evaluated, have side effects that maintain state affecting the correctness of the contract assertions themselves are destructive and therefore are not a correct use" — Verified.
  - [Contract assertions (since C++26) — cppreference](https://en.cppreference.com/cpp/language/contracts) — cppreference.com, 2026 — reference wiki — "It is implementation-defined which evaluation semantic is used for any given evaluation of a contract assertion"; "If the evaluation semantic is 'observe', control flow continues normally after the point of evaluation" — Verified.
  - [C++26 is done! Trip report: March 2026](https://herbsutter.com/2026/03/29/c26-is-done-trip-report-march-2026-iso-c-standards-meeting-london-croydon-uk/) — Herb Sutter, 29 Mar 2026 — engineering blog — "114 in favor, 12 opposed, and 3 abstaining"; contracts are "infinitely better than C's assert macro"; "GCC already has reflection and contracts merged in trunk, awaiting release" — Verified verbatim.
  - [P3835R0 Contracts make C++ less safe — full stop](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2025/p3835r0.html) — Spicer, Voutilainen, Garcia Sanchez, 3 Sep 2025 — WG21 paper — "does not provide a mechanism to make sure that a consistent semantic is provided for a given component"; the clang implementer said "the feature was essentially unusable without some kind of label mechanism" — Verified.
  - [P4334R0 P2900 Contracts' fundamental flaws](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2026/p4334r0.pdf) — Stroustrup, Garcia, Falco, Spicer, Voutilainen, 9 Aug 2026 — WG21 paper — "the cost of that has led to a strategy of enabling contracts while testing and removing them (or at least most) in production code. This is a 1980s approach" — Verified. It argues for always-on hardened libraries plus static analysis.
  - [P3846R1 C++26 Contract Assertions, Reasserted](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2026/p3846r1.pdf) — Doumler, Berne et al., 3 Nov 2025 — WG21 paper — "Almost all objections are repetitions of those raised in earlier papers ... incorporated — with strong consensus — into the C++26 working draft" — Verified.
  - [P3911 Make Contracts Reliably Non-Ignorable](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2025/p3911r0.html) — Neațu, Alexandrescu, Teodorescu, Nichita, 10 Dec 2025 (revisions up to R2 in 2026) — WG21 paper — existence and title confirmed in the WG21 2025/2026 paper indexes; content not read.
- **Detect:** Grep for `contract_assert` and `pre(`/`post(` specifiers. Inspect the compiler flags that select the semantic for each target. Audit predicates for non-const calls, increments and I/O.
- **Tools:** grep/ast-grep, compiler flag audit, clang-tidy.
- **Applies to:** C++26 codebases with a compiler that supports contracts. Not relevant before C++26.
- **When not to apply / counterpoints:** Supporters (Sutter, P3846R1) consider contracts far superior to `assert`. If toolchain support matures during 2026–2027, the "do not migrate" stance should be revisited.
- **Fix risk:** high

### G203-F01 — Do not add assertions to reach a density quota, and do not report low density as a defect; add an assertion only where you can state the invariant it encodes
- **Grade:** B · **Verdict:** VERIFIED (Casalnuovo's own caveat that the count-model effect is "negligible" added)
- **Rule:** Treat "zero assertions in a complex, stateful function" as a prompt to look for invariants, not as a violation.
- **Rationale:**
  - Kudrjavets et al.: per-file Spearman correlations of -0.209 to -0.384 across four releases of two Microsoft components. The authors themselves describe the significance levels as "not high (around 0.3's)".
  - Casalnuovo et al., via Counsell: the count-model effect is "almost insignificant ... negligible overall", and "adding the first assert to a file has a significant and sizable effect on bugs, but after the first ... no appreciable difference".
  - Kochhar and Lo: a "small yet significant" relationship in 185 Java projects.
  - Counsell et al.: only limited support, in industrial test code.
  - Ownership and experience confound all of them. The Microsoft authors say quotas are unlikely to work.
  - Power of Ten's quota rationale cites unit-test defect rates and asserts that "the odds of intercepting defects increase significantly with increasing assertion density", but gives no assertion-specific data.
- **Evidence:**
  - [Assessing the Relationship between Software Assertions and Code Quality: An Empirical Investigation (MSR-TR-2006-54)](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/tr-2006-54.pdf) — Kudrjavets, Nagappan, Ball (Microsoft), 2006; published at ISSRE 2006 as "...Assertions and Faults..." (DOI 10.1109/ISSRE.2006.14, confirmed via Crossref) — peer-reviewed — Table 2 (in order): -0.320, -0.209, -0.384, -0.295, all p<0.002; "on an average 14.5% of the faults for component A and 6.5% of the faults for component B are related to assertions"; "We believe enforcing the use of assertions would not work well. For example, mandating that developers should have an assertion density of 30 asserts/KLOC may not lead to an effective use of assertions" — Verified in the PDF text. The PDF layout makes the row-to-value mapping slightly ambiguous; the range is unaffected.
  - [Assert Use in GitHub Projects (ICSE 2015)](https://api.openalex.org/works/doi:10.1109/icse.2015.88) — Casalnuovo, Devanbu, Oliveira, Filkov, Ray, 2015 — peer-reviewed — abstract: "functions with asserts do have significantly fewer defects" — Verified from the OpenAlex abstract. The "first assert" and "negligible overall" statements were verified only as quotations inside Counsell 2017 (secondary).
  - [Revisiting Assert Use in GitHub Projects (EASE 2017)](https://api.openalex.org/works/doi:10.1145/3084226.3084259) — Kochhar, Lo, 2017 — peer-reviewed — abstract: 185 projects, 20 million LOC; "asserts have a small yet significant relationship with defect occurrence and developers who have added asserts to methods often have higher ownership of and experience with the methods" — Verified. The direction of the effect is not stated in the abstract, and the full text was not accessed.
  - [Assert Use and Defectiveness in Industrial Code (ISSREW 2017)](https://arxiv.org/abs/2104.01514) — Counsell, Hall, Shippey, Bowes, Tahir, MacDonell, 2017 — peer-reviewed workshop — "we found only limited evidence to support the earlier results" (test classes; 10,504 and 12,038 methods) — Verified in the arXiv PDF.
  - [The Power of 10: Rules for Developing Safety-Critical Code](https://web.eecs.umich.edu/~imarkov/10rules.pdf) — Gerard J. Holzmann (NASA/JPL), IEEE Computer 2006; university mirror of the computer.org page — practitioner standard — Rule 5: "The code's assertion density should average to minimally two assertions per function." — Verified.
  - [TIGER_STYLE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md) — TigerBeetle, last commit 2026-07-16 — engineering style guide — "The assertion density of the code must average a minimum of two assertions per function." — Verified. Commit date confirmed via the GitHub API.
- **Detect:** Diagnostic only, never a gate. List functions with zero checks and either high cognitive complexity or mutation of more than one field (ast-grep or Semgrep, plus a count of `assert|raise|invariant(`). For each one, a reviewer writes the invariant in one sentence before adding a check. Reject tautological asserts (Clippy `assertions_on_constants`, style group; Ruff F631).
- **Tools:** ast-grep, semgrep, ruff F631, clippy::assertions_on_constants.
- **Applies to:** All languages; any finished codebase without a local assertion-density rule.
- **When not to apply / counterpoints:** JPL flight software and TigerBeetle mandate a density and pair it with fuzzing or simulation; in such repositories, follow the local rule. All the empirical studies are correlational, date from 2006–2017, and cover C/C++/Java only.
- **Fix risk:** low

### G203-F11 — Remove an existing check as redundant only if all five conditions hold
- **Grade:** B · **Verdict:** VERIFIED (Java behaviour re-confirmed on the JDK 25 man page)
- **Rule:** The five conditions:
  1. The condition is guaranteed by a sound compile-time mechanism or proven by a static tool.
  2. Every producer of the value is in the same trust domain.
  3. The check is not the last guard before UB, unsafe code, a security decision or a persistent write.
  4. The check has no side effects.
  5. The upstream guarantee is carried by a type, not by an earlier `validate()` call.

  Otherwise keep the check, or convert duplicate handling into a single assertion.
- **Rationale:** Power of Ten and JPL both treat an assertion that a static tool can prove never fails as a violation, which gives a formal basis for removal. "Parse, don't validate" explains why a check that relies on an upstream `validate()` is "a bug waiting to happen". Annotation-only nullability does not change runtime behaviour. Java public-method checks must hold "whether assertions are enabled or disabled". Chromium allows CHECKing data "after the caller should've validated it", so re-checking at a trust boundary is legitimate defence in depth.
- **Evidence:**
  - [JPL Institutional Coding Standard for C (D-60411), Rule 16](https://yurichev.com/mirrors/C/JPL_Coding_Standard_C.pdf) — NASA JPL, v1.0, 3 Mar 2009 (third-party mirror of the cleared external version) — standard — "No assertion should be used for which a static checking tool can prove that it can never fail or never hold." — Verified. The rule also requires one assertion per function of more than 10 lines.
  - [The Power of 10](https://web.eecs.umich.edu/~imarkov/10rules.pdf) — Holzmann, 2006 — practitioner standard — "Any assertion for which a static checking tool can prove that it can never fail or never hold violates this rule." — Verified.
  - [Parse, don't validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) — Alexis King, 2019 — engineering blog — "This code is a bug waiting to happen! What if getConfigurationDirectories were modified to stop checking that the list is empty, intentionally or unintentionally?" — Verified.
  - [Programming With Assertions (Java SE 8)](https://docs.oracle.com/javase/8/docs/technotes/guides/language/assert.html) — Oracle — official docs — "Do not use assertions for argument checking in public methods ... these specifications must be obeyed whether assertions are enabled or disabled." "By default, assertions are disabled at runtime." — Verified. The JDK 25 `java` man page confirms that assertions are still disabled by default.
  - [CHECK(), DCHECK() and NOTREACHED()](https://chromium.googlesource.com/chromium/src/+/main/styleguide/c++/checks.md) — Chromium, 2026 — "Note that you may CHECK() that data is valid after the caller should've validated it." — Verified.
  - [Contracts in Practice (FM 2014)](https://arxiv.org/abs/1211.4775) — Estler, Furia, Nordio, Piccioni, Meyer, 2014 (FM 2014, LNCS, confirmed via Crossref) — peer-reviewed — null checks may change "with the increasing adoption of static analyses which supersede such checks" — Verified.
- **Detect:** For each candidate removal, write the provenance chain in the PR: the producers, the type at each hop, and any boundary crossed (process, file, network, FFI) or cast used. Confirm the guarantee with the strictest checker available (mypy/pyright strict; `tsc --strict --noUncheckedIndexedAccess`; rustc). Reject the removal if the guarantee depends on an annotation-only system at a public API.
- **Tools:** mypy --strict / pyright, tsc --strict, rustc/clippy, a review checklist.
- **Applies to:** All languages; highest risk in dynamically typed or annotation-only-typed code.
- **When not to apply / counterpoints:** TigerStyle deliberately keeps "pair assertions", and Chromium allows re-CHECKing validated data. No empirical study measures the defect impact of removing redundant checks.
- **Fix risk:** high

### G203-F12 — Never assert, unwrap/expect, CHECK or panic on data that crosses a trust or version boundary, including data you produced yourself; validate, reject the single item, keep last-known-good, alert
- **Grade:** B · **Verdict:** CORRECTED (NATS reframed as a failure-scope case because its flight plan was valid; the context of Google's last-known-good quote clarified)
- **Rule:** Self-produced data includes generated config or rule files, persisted state from other releases, server-pushed experiments, and IPC from lower-privilege processes. Add missing bounds or size checks on such data as recoverable errors.
- **Rationale:**
  - **Chromium** lists "Failures beyond Chromium's control" that must be handled in regular control flow: untrusted data, serialized data out of sync with the binary (including server experiments), disk corruption, and data across security boundaries. "A bad server-side rollout shouldn't be able to bring down the client."
  - **Cloudflare 2025:** `unwrap()` on an oversized self-generated feature file panicked the core proxy. The remediation treats Cloudflare-generated config like user input.
  - **CrowdStrike 2024:** "A runtime array bounds check was missing". Content that required a 21st input met an interpreter that supplied only 20, and the out-of-bounds read crashed Windows hosts.
  - **NATS 2023 [corrected]:** this is not a trust-boundary case. The triggering flight plan was valid (per the source's own update). The lesson is failure scope: one item raised a "critical exception" that took both the primary and the identical backup offline, instead of being queued for manual processing. It belongs under F14 and is kept here only as a caution.
  - **Google SRS book:** it recommends writing the last known good configuration to disk. Its context is resilience to losing access to configuration APIs, so applying it to rejecting a bad config is an extension. Cloudflare's own recovery rolled back to a known-good file.
- **Evidence:**
  - [CHECK(), DCHECK() and NOTREACHED() — Failures beyond Chromium's control](https://chromium.googlesource.com/chromium/src/+/main/styleguide/c++/checks.md) — Chromium, 2026 — official style guide — "Server data such as experiments should also not be verified with CHECK()s as a bad server-side rollout shouldn't be able to bring down the client." "Untrusted data: ... Don't CHECK() for bad syntax". "A compromised renderer should not be able to bring down the browser process" — Verified.
  - [Cloudflare outage on November 18, 2025](https://blog.cloudflare.com/18-november-2025-outage/) — Matthew Prince (Cloudflare), 2025 — incident report — "Currently that limit is set to 200, well above our current use of ~60 features"; "thread fl2_worker_thread panicked: called Result::unwrap() on an Err value"; "Today was Cloudflare's worst outage since 2019" — Verified.
  - [Channel File 291 Incident Root Cause Analysis](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf) — CrowdStrike, 6 Aug 2024 — incident report — "A runtime array bounds check was missing for Content Interpreter input fields on Channel File 291"; "The Content Interpreter expected only 20 values. Therefore, the attempt to access the 21st value produced an out-of-bounds memory read beyond the end of the input data array and resulted in a system crash." — Verified in the PDF text.
  - [UK air traffic control meltdown](https://jameshaydon.github.io/nats-fail/) — James Haydon, 8 Sep 2023 — engineering blog quoting the NATS preliminary report — backup "raised its own critical exception, writing a log file into the system log and placed itself into maintenance mode"; "A single flight plan caused a problem, and the entire FPRSA-R system crashed"; "more than 2000 flights were cancelled" (citing the BBC); update: the triggering flight plan "was valid" — Verified. Secondary source for the NATS report.
  - [Building Secure and Reliable Systems, ch. 8 Design for Resilience](https://google.github.io/building-secure-and-reliable-systems/raw/ch08.html) — Google (Adkins et al., eds.; chapter by Shipitsyn, Adler, Egyed, Blankinship), 2020 — book (free online) — "enabling systems to write the last known good configuration to disk makes the systems resilient to losing access to configuration APIs: they can use the saved config" — Verified.
- **Detect:** A lightweight taint review. Find checks whose operand comes from a file read, env var, config or rule loader, deserializer, network, DB row or IPC:
  - Rust: `.unwrap()` or `.expect(` near `serde_json::from_`, `toml::from_str`, `fs::read`, `.parse::<`.
  - Python: `assert` on `json.load`, `yaml.safe_load` or `os.environ` results.
  - C++: CHECK or assert on IPC or file fields.

  Also find fixed-capacity limits indexed by counts read from data (`MAX_`, `with_capacity(`, preallocated arrays) and add a recoverable bounds check. Semgrep taint mode can automate part of this.
- **Tools:** semgrep (taint mode), ast-grep, clippy unwrap_used/expect_used, code review.
- **Applies to:** All languages; services, agents, kernel/driver code, anything that loads config, rules or ML features at runtime.
- **When not to apply / counterpoints:** Armstrong's "Do not program defensively" holds only after data "has been checked as it enters the system". The dispute is about where that boundary lies. Rejecting data can itself cause outages when last-known-good goes stale, so pair rejection with alerting and kill switches; Cloudflare added "more global kill switches". Each incident is a single case (n=1).
- **Fix risk:** medium

### G203-F13 — Treat adding an always-on check to a working product, or promoting a debug-only check, as a behaviour change that needs a staged rollout
- **Grade:** B · **Verdict:** CORRECTED (Google's rollout had no non-fatal production phase; Chromium limits non-fatal rollout to cases with a reasonable recovery path)
- **Rule:** The stages are:
  1. enable the check in tests and fuzzing;
  2. soak it in pre-production;
  3. roll it out gradually in production.

  Add a time-boxed non-fatal phase (observe or report, with telemetry and rate limiting) only where a safe fallback exists. In C/C++, continuing past a failed memory-safety check is UB, so keep any such phase short or use a canary rollout instead. Fix every violation seen before going fatal. Never leave observe mode on permanently, and never downgrade a firing check to debug-only.
- **Rationale:**
  - **Google:** "a multi-stage rollout to avoid accidentally disrupting users or creating an outage". The stages were Testing, then Baking in test and pre-production environments, then Gradual Production Rollout "over several months, starting with a small set of services". **[corrected]** That is staging by scope. Google did not report a non-fatal mode.
  - **Chromium:** `base::NotFatalUntil::M<n>` provides "non-fatal crash reports before the fatal milestone". The code must make "best-effort attempts to handle the situation, like an early return". Chromium adds: "Do not use base::NotFatalUntil if there's no reasonable way to recover from the invariant failure (i.e. if this is wrong we're about to crash or hit a memory bug)", and "Failing instances should not downgrade to DCHECKs".
  - **libc++:** the observe semantic "should not be used outside of the adoption period".
  - **P2900:** allows platforms to omit observe.
  - **CrowdStrike:** added staged deployment rings for content.
- **Evidence:**
  - [Retrofitting spatial safety to hundreds of millions of lines of C++](https://security.googleblog.com/2024/11/retrofitting-spatial-safety-to-hundreds.html) — Rebert, Shavrick, Yasuda (Google), 2024 — industry report — "Testing: We first enabled hardened libc++ in our tests over a year ago. This allowed us to identify and fix hundreds of previously undetected bugs ... Baking ... Gradual Production Rollout: We then rolled out hardened libc++ to production over several months, starting with a small set of services ... promptly addressing any crashes or performance regressions." — Verified.
  - [CHECK(), DCHECK() and NOTREACHED() — More cautious rollouts](https://chromium.googlesource.com/chromium/src/+/main/styleguide/c++/checks.md) — Chromium, 2026 — "an additional base::NotFatalUntil::M120 argument after the condition may be used to gather non-fatal diagnostics before turning fatal in a future milestone"; "Any invariant failures should be resolved before turning fatal"; "Do not use base::NotFatalUntil if there's no reasonable way to recover"; "Failing instances should not downgrade to DCHECKs as that hides the ongoing problem" — Verified.
  - [Hardening Modes — Assertion semantics](https://libcxx.llvm.org/Hardening.html) — LLVM libc++, 2026 — "Continuing execution after a hardening check fails results in undefined behavior; the observe semantic is meant to make adopting hardening easier but should not be used outside of the adoption period" — Verified.
  - [P2900R14 §3.5.4](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2025/p2900r14.pdf) — WG21, 2025 — a platform may omit observe "due to observe allowing control flow to continue past a detected contract violation" — Verified.
  - [Channel File 291 RCA](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf) — CrowdStrike, 2024 — "Template Instances should have staged deployment ... successively promoted to wider deployment rings or rolled back if problems are detected" — Verified.
- **Detect:** In the diff, list every new or promoted always-on check on a production path. For each, require (a) the tests or fuzzers that exercise it, (b) the rollout plan, and (c) if there is a non-fatal phase, a recovery path plus a dated plan to make it fatal. Flag permanent observe-mode configuration, and any change from CHECK to DCHECK or from `assert!` to `debug_assert!` made in response to production firings.
- **Tools:** diff review, feature flags or runtime config, crash and telemetry dashboards.
- **Applies to:** Any deployed product; mandatory for checks promoted from debug-only.
- **When not to apply / counterpoints:** Shore and TigerStyle argue against disabling assertions in the field. For small teams without telemetry, the fallback is a longer pre-production soak. No source was found for how long a non-fatal phase may last in memory-safe languages.
- **Fix risk:** medium

### G203-F14 — On a failed check, terminate the smallest unit of work whose state can safely be discarded, report it loudly, and never turn it into a success value
- **Grade:** B · **Verdict:** VERIFIED (source types adjusted: Shore is an IEEE Software column, Armstrong is a PhD thesis)
- **Rule:** Default mapping:

  | Situation | Action on a failed check |
  |---|---|
  | Possible memory corruption or corrupted shared state | Abort the process under a supervisor |
  | Memory-safe request handler | Fail that request, in one top-level handler |
  | Batch or queue item | Quarantine the item and continue |
  | Transaction or smart contract | Revert |
  | Embedded or flight code that cannot restart | Explicit recovery path plus a log |
  | Security decision | Fail closed |

  Never abort a whole cluster or fleet on a non-fatal error.
- **Rationale:** Sources that look contradictory reduce to the unit of failure:
  - TigerStyle: crash, in a replicated database.
  - JPL and Power of Ten: an explicit recovery action, in spacecraft.
  - Shore: don't disable assertions in the field, yet "a crash is never appropriate"; route failures to a global handler.
  - Erlang: let it crash, under supervisors.
  - Crash-only design: stop=crash, start=recover.
  - Go net/http isolates a panic to its request; tower-http converts panics into responses.
  - Node: it is "not safe to resume normal operation after 'uncaughtException'".
  - Yuan: 8% of catastrophic failures came from aborting the cluster on over-caught exceptions.
  - Google: security-critical operations "should not fail open".
- **Evidence:**
  - [Fail Fast](https://martinfowler.com/ieeeSoftware/failFast.pdf) — Jim Shore, IEEE Software Sept/Oct 2004 (Design column, ed. Martin Fowler) — magazine column, editor-reviewed rather than research peer review — "One reaction to this fear is to disable assertions in the field. Don't do that!"; "On the other hand, a crash is never appropriate"; "A batch-processing system might page a system administrator and continue with the next transaction" — Verified.
  - [Simple Testing Can Prevent Most Critical Failures](https://www.usenix.org/system/files/conference/osdi14/osdi14-paper-yuan.pdf) — Yuan et al., OSDI 2014 — peer-reviewed — "Abort in over-caught exceptions (8%)"; the example is a catch of Throwable that "brought down every datanode" — Verified.
  - [Making reliable distributed systems in the presence of software errors](https://erlang.org/download/armstrong_thesis_2003.pdf) — Joe Armstrong, PhD thesis (KTH), 2003 — thesis — "The philosophy is let some other process fix the error ... The answer is let it crash"; "once data has been checked as it enters the system it should thereafter be assumed correct" — Verified.
  - [Crash-Only Software (HotOS IX)](https://www.usenix.org/legacy/events/hotos03/tech/full_papers/candea/candea.pdf) — Candea, Fox, 2003 — peer-reviewed workshop — "Crash-only programs crash safely and recover quickly ... the use of transparent component-level retries hides intra-system component crashes from end users"; "stop=crash and start=recover" — Verified.
  - [Process — Warning: Using 'uncaughtException' correctly](https://nodejs.org/api/process.html#warning-using-uncaughtexception-correctly) — Node.js v26.10.0, 2026 — official docs — "It is not safe to resume normal operation after 'uncaughtException'"; "an external monitor should be employed in a separate process to detect application failures and recover or restart as needed" — Verified.
  - [tower_http::catch_panic (0.7.1)](https://docs.rs/tower-http/latest/tower_http/catch_panic/index.html) — tower-rs, 2026 — official docs — "Convert panics into responses ... using panics for error handling is not recommended. Prefer instead to use Result whenever possible." — Verified.
  - [JPL C Standard, Rule 16](https://yurichev.com/mirrors/C/JPL_Coding_Standard_C.pdf) — NASA JPL, 2009 — standard — "When an assertion fails, an explicit recovery action should be taken, e.g., by returning an error condition to the caller of the function"; "In flight, the assertion then turns into a Boolean test that protects, and enables recovery, from anomalous behavior" — Verified.
  - [TIGER_STYLE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md) — TigerBeetle, 2026 — "Assertions detect programmer errors. Unlike operating errors, which are expected and which must be handled, assertion failures are unexpected. The only correct way to handle corrupt code is to crash." — Verified.
  - [Building Secure and Reliable Systems, ch. 8](https://google.github.io/building-secure-and-reliable-systems/raw/ch08.html) — Google, 2020 — book — "Security-critical operations should not fail open." — Verified.
- **Detect:** Map the process's units of work and the boundary handler for each:
  - Python: `except Exception`/`BaseException` at handler, worker or loop level must log with `exc_info`, emit a metric, and return failure, never 200 or an empty result.
  - Node: `process.on("uncaughtException"` handlers that do not exit.
  - Rust: where `catch_unwind` or `CatchPanicLayer` sits.
  - Go: `recover()` calls that discard the value.

  Also flag `sys.exit`, `os.Exit`, `process.exit`, `abort()` and `std::process::exit` inside library code or per-item handlers, and check that `panic = "abort"` is paired with a supervisor.
- **Tools:** ruff BLE001, grep/ast-grep, service topology review.
- **Applies to:** All languages; an architecture-level decision per service, job or contract.
- **When not to apply / counterpoints:** Practitioners disagree at the extremes (see Practitioner voice: kccqzy vs dkarl). In managed languages, catch-alls often catch and log a thrown AssertionError, which silently defeats the check. Request-level containment is only safe if the request does not share state it may have corrupted. net/http closes the connection rather than sending a 5xx, so a 5xx needs an explicit recovery middleware.
- **Fix risk:** medium

### G203-F18 — Split checks by cost; every debug-only check must be exercised by a CI job or fuzz target built with checks enabled
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:** O(1) checks that protect memory, security or persistent state are always on. Expensive checks are debug- or test-only. A debug-only check that no CI job or fuzz target runs is effectively dead code.
- **Rationale:** Chromium uses DCHECK only when a check is "too expensive", and warns that it is verified only in tests, on developer machines and in a small subset of Canary builds. libc++ separates fast mode (for production) from debug mode (for tests, CI and local development). icontract has `icontract.SLOW`. SQLite runs asserts only in SQLITE_DEBUG builds. TigerStyle calls assertions "a force multiplier for discovering bugs by fuzzing". Google found hundreds of bugs just by enabling hardening in tests.
- **Evidence:**
  - [CHECK(), DCHECK() and NOTREACHED()](https://chromium.googlesource.com/chromium/src/+/main/styleguide/c++/checks.md) — Chromium, 2026 — "DCHECK() ... provide a fallback mechanism to check for invariants where the test being performed is too expensive ... it's only verified in tests, on developer machines and a very small subset of Canary builds." — Verified.
  - [Hardening Modes](https://libcxx.llvm.org/Hardening.html) — LLVM libc++, 2026 — debug mode for "non-production environments (such as test suites, CI, or local development)" and "not intended to be used in production" — Verified.
  - [TIGER_STYLE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md) — TigerBeetle, 2026 — "Assertions downgrade catastrophic correctness bugs into liveness bugs. Assertions are a force multiplier for discovering bugs by fuzzing." — Verified.
  - [How SQLite Is Tested §8.1](https://www.sqlite.org/testing.html) — SQLite, 2026 — "the database engine runs about three times slower when asserts are enabled. Hence, the default (production) build of SQLite disables asserts. Assert statements are only enabled when SQLite is compiled with the SQLITE_DEBUG preprocessor macro defined." — Verified.
  - [Rust's Two Kinds of 'Assert' Make for Better Code](https://tratt.net/laurie/blog/2023/rusts_two_kinds_of_assert_make_for_better_code.html) — Laurence Tratt, 16 Mar 2023 — engineering blog — uses `debug_assert!` liberally for minor assumptions he is confident testing will catch, and keeps `assert!` for assumptions he has lower confidence tests will catch (weighing its performance cost); no measurements — Verified (paraphrase).
- **Detect:** Inventory the debug-only mechanisms (debug_assert!, DCHECK, assert under NDEBUG, `if __debug__`, `icontract.SLOW`, libc++ debug mode). Then grep the CI config for a job that builds with them enabled: a Debug CMake build, `cargo test` without `--release` or with `-C debug-assertions`, Python without `-O`, `ICONTRACT_SLOW` set, fuzzers built with assertions. Also flag always-on O(n) checks in hot loops as candidates for moving to debug-only after profiling.
- **Tools:** CI config review, grep, profilers (perf, py-spy, cargo flamegraph).
- **Applies to:** All languages with a debug/release distinction.
- **When not to apply / counterpoints:** Hoare's "lifejacket" argument and Shore favour production checks. Google's 0.30% suggests that many checks assumed to be expensive are cheap, so measure first. The Rust docs say the cost of assertions "is not measurable in general".
- **Fix risk:** low

### G203-F02 — When adding checks, prefer relationship and state invariants, postconditions and exhaustiveness checks over bare non-null checks the type system could carry; put checks at module seams and immediately before the operation that would corrupt state
- **Grade:** C · **Verdict:** DOWNGRADED (B -> C: the empirical sources describe what developers write, not which checks catch bugs; the placement advice rests on style guides and one magazine column; Shore's source type corrected from peer-reviewed to column)
- **Rationale:** Studies of real contracts show that null and presence checks dominate: about 3/4 of Code Contracts and 80–96% of C# preconditions. Schiller et al. find state updates and conditional properties underused. Estler et al. expect static analysis to supersede null checks. Chromium places a CHECK right before the line where "a security bug would happen". TigerStyle recommends pair assertions and asserting both positive and negative space. Shore says assertions "shine" at the seams. None of this shows that relational invariants catch more defects than null checks.
- **Evidence:**
  - [Case studies and tools for contract specifications (ICSE 2014)](https://api.semanticscholar.org/graph/v1/paper/DOI:10.1145/2568225.2568285) — Schiller, Donohue, Coward, Ernst, 2014 — peer-reviewed — "approximately three-fourths of the Code Contracts are basic checks for the presence of data ... developers underutilize contracts for expressing state updates, object state indicators, and conditional properties" — Verified (abstract).
  - [Contracts in Practice (FM 2014)](https://arxiv.org/abs/1211.4775) — Estler, Furia, Nordio, Piccioni, Meyer (ETH Zurich), 2014 — peer-reviewed — "Void/null checks are by far the most used ... in C#, 80%–96% of preconditions contain null checks ... this may change in the future, with the increasing adoption of static analyses which supersede such checks" — Verified in the arXiv PDF (21 projects, over 260 MLOC).
  - [Contracts in the Wild: A Study of Java Programs (ECOOP 2017)](https://drops.dagstuhl.de/storage/00lipics/lipics-vol074-ecoop2017/LIPIcs.ECOOP.2017.9/LIPIcs.ECOOP.2017.9.pdf) — Dietrich, Pearce, Jezek, Brada, 2017 — peer-reviewed — 200 Maven projects, 351,034 KLOC; "contracts are used less than expected"; "while more programs use assertions, most of them use very few — in several cases only one single assertion" — Verified.
  - [CHECK(), DCHECK() and NOTREACHED()](https://chromium.googlesource.com/chromium/src/+/main/styleguide/c++/checks.md) — Chromium, 2026 — "Testing pointer equality is very cheap so write this as a CHECK. A security bug would happen afterward if the CHECK fails" — Verified.
  - [Fail Fast](https://martinfowler.com/ieeeSoftware/failFast.pdf) — Jim Shore, IEEE Software 2004 (column) — "Assertions shine in their ability to flush out problems in the seams of the system"; turn comments that document assumptions into assertions; assert not-null when a parameter is assigned to an instance variable — Verified.
  - Supporting: [TIGER_STYLE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md) — "assert validity of data right before writing it to disk, and also immediately after reading from disk"; assert "the positive space ... AND ... the negative space" — Verified.
- **Detect:** Look for:
  - (a) functions that update two or more related fields without a post-state check;
  - (b) encode/decode pairs without a symmetric check;
  - (c) switch/match over an enum or union without a throwing exhaustive default;
  - (d) in null-safe languages, null asserts on non-nullable types, which are candidates for removal (F11), not addition.
- **Tools:** ast-grep, semgrep, pyright/mypy (`assert_never`), tsc strict.
- **Applies to:** All languages; most value in stateful code (data structures, ledgers, caches, codecs).
- **When not to apply / counterpoints:** In languages without null safety, null checks still catch real faults cheaply (Shore's not-null rule). Richer invariants cost more and may need to be debug-only (F18).
- **Fix risk:** medium

### G203-F17 — Do not both assert a condition and silently handle it; decide which it is; convert over-defensive guards deep in internal code into one invariant at the module seam rather than deleting them
- **Grade:** C · **Verdict:** VERIFIED
- **Rule:** If the condition is an internal invariant, keep one check with no fallback, under the policy of F14. If it is an expected condition, handle it and do not assert it. Delete a guard outright only when F11 proves it redundant.
- **Rationale:** Chromium labels `DCHECK(foo); if (!foo) {...}` as Bad: the fallback runs only where the check does not, so it is untested. Armstrong: only a small part of the code should check data, at the point where it enters the system. JPL's `if (!c_assert(p >= 0)) return ERROR;` looks similar but is legitimate: one always-on mechanism, logged in test, with a defined recovery. Practitioners report that LLM reviews and agents push redundant null checks and "safe fallbacks". The evidence is guidance plus anecdotes, hence grade C.
- **Evidence:**
  - [CHECK(), DCHECK() and NOTREACHED() — Examples](https://chromium.googlesource.com/chromium/src/+/main/styleguide/c++/checks.md) — Chromium, 2026 — "// Bad: // Do not handle `DCHECK()` failures. Use `CHECK()` instead and omit the conditional below. DCHECK(foo); if (!foo) { ... }" — Verified.
  - [Armstrong thesis, App. B §3.13 "Do not program defensively"](https://erlang.org/download/armstrong_thesis_2003.pdf) — Joe Armstrong, 2003 — thesis — "Most of the code in the system should be written with the assumption that the input data to the function in question is correct. Only a small part of the code should actually perform any checking of the data." — Verified.
  - [JPL C Standard, Rule 16](https://yurichev.com/mirrors/C/JPL_Coding_Standard_C.pdf) — NASA JPL, 2009 — `if (!c_assert(p >= 0) == true) { return ERROR; }` — Verified.
  - [HN comment (The Coming Loop)](https://news.ycombinator.com/item?id=48644604) — HN user datadrivenangel, 23 Jun 2026 — practitioner forum — "AI code reviews encourage overly delusional defensive paranoia. triple null checking deep inside a function is technically a real risk, but in practice should never be hit because you've checked for nulls in every function that calls..." — Verified via the Algolia API.
  - [HN comment (How I write software with LLMs)](https://news.ycombinator.com/item?id=47405634) — HN user BloondAndDoom, 16 Mar 2026 — practitioner forum — "force LLM to throw all exceptions instead of 'safe fallbacks' which in practice means I will swallow everything" — Verified.
- **Detect:** Use ast-grep or Semgrep to find an assertion followed by a guard on the same expression (C++ `DCHECK($X); ... if (!$X)`, Rust `debug_assert!($X); ... if !$X`, TS `invariant($X...); ... if (!$X)`, Python `assert $X ...` then `if not $X`). Then grep internal (non-exported, non-handler) functions for early neutral returns on None or empty values, and trace their callers.
- **Tools:** ast-grep, semgrep, code review.
- **Applies to:** All languages; the primary tool for cleaning AI-generated defensive code.
- **When not to apply / counterpoints:** JPL-style check-and-recover is legitimate where crashing is not an option. Chromium's NotFatalUntil variants require a best-effort early return during the rollout window. Deleting guards is safe only if callers really cannot pass the bad value, so prefer converting them to an assertion.
- **Fix risk:** medium

## Practitioner voice

All links were opened; HN comments were read through the HN Algolia API and StackExchange answers through the SE API.
- [BiteCode_dev on Python assert (HN, 2023)](https://news.ycombinator.com/item?id=35827212) — asserts are meant to be cheap because optimization removes them, but "nobody is going to use '-oo' in prod". Some third-party dependencies use assert for real production checks, so turning on optimization can break a system.
- [Does anyone use -O ...? (discuss.python.org, 2023)](https://discuss.python.org/t/does-anyone-use-o-or-oo-or-pythonoptimize-1-in-their-deployments/37671) — gpshead expected most to answer "No". Lemburg uses `-O` in production. Others use `-OO` to shrink PyInstaller executables (~5%) or container images. **[corrected]** Bokeh had a "botched release" under `-OO`. Pillow now tests both optimization levels and lists scipy, Bokeh, kivy and ReportLab as projects that were affected.
- [Mismatch between assert's semantics and how it's used (discuss.python.org)](https://discuss.python.org/t/mismatch-between-asserts-semantics-and-how-its-used-o-oo-disable/29282) — the opener says "much much more code ... is ignorant of this and broken when running with -O". The thread reports, second-hand, that Guido "prefers to deprecate -O and -OO".
- [dkarl on C++ asserts in production (HN, 2025)](https://news.ycombinator.com/item?id=45560224) — server-side C++ always ran with asserts on, because continuing after memory corruption caused "the most destructive and the most mysterious" bugs. In Java, the commenter says, an assert only throws, gets caught and logged, and the process keeps serving.
- [stinos: assertions on in release (HN, 2017)](https://news.ycombinator.com/item?id=15097175) — the team leaves asserts on in release builds to catch UB that only appears there (uninitialized variables). They turn them off only in the few hot paths where the overhead was proven.
- [kccqzy: the danger is change (HN, 2023)](https://news.ycombinator.com/item?id=37828669) — a later edit to a branch can make a distant assert fire in production when coverage is poor; checks belong at compile time (Liquid Haskell).
- [kccqzy: limited-scope crash (HN, 2023)](https://news.ycombinator.com/item?id=37834352) — "You almost always want a limited scope crash that affects whatever currently is being processed", such as a 500 for one request. Links the UK air-traffic meltdown story (HN 37461695).
- [UK air traffic control meltdown (James Haydon, 2023)](https://jameshaydon.github.io/nats-fail/) — one flight plan (later found to be valid) with duplicate waypoint designators triggered a critical exception. The primary and backup ran the same logic and both went into maintenance mode; more than 2,000 flights were cancelled. The author says the plan should have gone to a slower queue for manual processing.
- [Cloudflare outage, 18 Nov 2025](https://blog.cloudflare.com/18-november-2025-outage/) — the worst outage since 2019 came from `unwrap()` on a self-generated feature file over a 200-feature preallocation limit. The fix treats Cloudflare's own config like user input and adds kill switches.
- [thundergolfer on unwrap at Modal (HN, 2025)](https://news.ycombinator.com/item?id=45974208) — Modal allows only `expect("...")` in the recommended message style, never bare `unwrap()`.
- [flir on TigerBeetle asserts in prod (HN, 2025)](https://news.ycombinator.com/item?id=45436952) — "An assert failing in prod is an assert that I desperately want to know about."
- [martinhath quoting Hoare 1972 (HN, 2024)](https://news.ycombinator.com/item?id=42227399) — turning checks off in production is like a sailor who wears a lifejacket on dry land and takes it off at sea. Knuth also quotes this (1974).
- [datadrivenangel on AI defensive paranoia (HN, 2026)](https://news.ycombinator.com/item?id=48644604) — AI reviews push triple null checks deep inside functions whose callers already check.
- [SubiculumCode on Codex fallbacks (HN, 2026)](https://news.ycombinator.com/item?id=48420230) — "excessive use of fallbacks" silently swapped an accurate geodesic method for an inaccurate one.
- [sigbottle on agentic engineering (HN, 2026)](https://news.ycombinator.com/item?id=47394943) — "I would rather an agent make 10 TODO's and loudly fail than make 1 silent fallback".
- [BloondAndDoom on LLM safe fallbacks (HN, 2026)](https://news.ycombinator.com/item?id=47405634) — forces the model to "throw all exceptions instead of 'safe fallbacks'", because otherwise it swallows everything.
- [MaulingMonkey on hidden crashes (HN, 2016)](https://news.ycombinator.com/item?id=12871258) — segfaults stayed hidden because users never reported them. The lesson is to collect crashes automatically; a CHECKFAIL-with-recovery macro is compatible with that.
- [Patient-management systems and biometric limits (SE.SE)](https://softwareengineering.stackexchange.com/questions/422378/why-would-patient-management-systems-not-assert-limits-for-certain-biometric-dat) — "Would you want to be the doctor to tell your patient that you can't treat them because the IT department thinks the patient can't exist?" An industry answer says such systems accept unvalidated values and filter outliers downstream. Hard domain limits are a behaviour change.
- [assert vs IllegalArgumentException (SE.SE)](https://softwareengineering.stackexchange.com/questions/137158/is-it-better-to-use-assert-or-illegalargumentexception-for-required-method-param) — Java assertions are off unless enabled, so public-method parameter checks must be exceptions. Assertions "are designed to detect errors in your own logic". Another answer notes that `@Nonnull` "does not prevent null from being passed at runtime".

## Contradictions and open questions

**Contradictions**
- **Assertion density.** Power of Ten (≥2 per function), TigerStyle (≥2 per function) and JPL (≥1 per function over 10 lines) mandate quotas without assertion-specific data. The empirical studies show modest correlations, mostly from the first assert. Casalnuovo's own count model calls the overall effect "negligible", and the Microsoft authors warn against mandates.
- **Replication.** Casalnuovo 2015 (C/C++) and Kochhar and Lo 2017 (Java) find a small association. Counsell 2017 (industrial Java test code) finds only limited support. All are correlational and confounded by ownership and experience.
- **What a failed assertion should do.** TigerStyle: crash. Power of Ten and JPL: explicit recovery. Shore: keep assertions on in the field, yet "a crash is never appropriate". Go FAQ: servers should keep running. G203-F14 reconciles them through the unit of failure, but the sources themselves disagree.
- **Python `-O` prevalence.** Ruff says it is "common" in production. gpshead expected "No", and the thread is mixed.
- **Always-on vs debug-only.** Chromium, Shore and Hoare favour always-on checks. SQLite disables asserts in release (about 3x slower), Java disables assertions by default, and CMake adds NDEBUG to its non-Debug build types. Stroustrup et al. (P4334R0) call enable-in-test/remove-in-production "a 1980s approach", but argue for hardened libraries plus static analysis rather than more programmer-written checks.
- **C++26 contracts.** They were adopted and kept (114–12–3). Supporters: Sutter, P3846R1. Critics: P3835R0, P3911, P4334R0. On implementations, P3835R0 relays the clang implementer's "essentially unusable without ... label mechanism", while P3846R1 says complete GCC and Clang fork implementations exist.
- **Defensive code vs coverage.** SQLite says 100% MC/DC "discourages defensive code with unreachable branches" while fuzzing benefits from it. Coverage gates and "always true" lints push toward deleting branches that SQLite keeps with ALWAYS/NEVER.
- **Where the trust boundary lies.** Armstrong: check data once, as it enters the system. Chromium and Cloudflare's remediation treat self-generated config, persisted state and server-pushed data as untrusted.
- **Check-and-recover vs never handle an assertion.** JPL's `if (!c_assert(...)) return ERROR;` against Chromium's "Do not handle DCHECK() failures". They are compatible only when the check is always on and the recovery path is tested.
- **Log the exception vs log-only means ignored [new].** Ruff S110's recommended fix is "consider logging the exception", and BLE001 exempts handlers that log with `exc_info`. Yuan et al. count "an error handler that only logs the error" as ignoring it, and that pattern caused 25% of catastrophic failures.
- **Non-fatal rollout [new].** Chromium's `NotFatalUntil` requires a best-effort recovery and forbids use where "we're about to crash or hit a memory bug". libc++ says continuing past a failed hardening check is UB, while still offering observe for adoption. Google's hardened-libc++ rollout used no non-fatal phase at all.
- **Crashing, among practitioners.** kccqzy says crashing is "almost always a bad idea". dkarl says C++ servers should abort after possible memory corruption. ANSSI endorses fail-fast with handover to a backup in safety-critical systems.

**Open questions**
- No study measures which kinds of assertion (null, range, relational, postcondition, exhaustiveness) catch real defects in general-purpose code. The strongest data is industrial: Google's hardened libc++.
- There is no empirical study of assertion use and defects in Python, TS/JS, Rust or Go. All the defect-correlation studies date from 2006–2017 and cover C/C++ or Java.
- Full texts of Casalnuovo 2015 and Kochhar and Lo 2017 were not read. The "first assert" and "negligible" statements come only through Counsell's quotation, and Kochhar's abstract does not state the direction of the effect.
- No study measures the effect of removing redundant or defensive checks, or of AI-generated over-defensive code. That evidence is guidance plus anecdotes (C).
- Is a long-lived observe or log-only mode acceptable in memory-safe languages? Sources time-box it only for C++.
- How mature are C++26 contract toolchains? As of March 2026 GCC had them in trunk awaiting release. Whether F05 should loosen depends on the 2026–2027 releases.
- How often Python deployments run with `-O` is anecdotal; there is no survey data.
- There is no quantitative threshold for "expensive enough to be debug-only" beyond single data points (SQLite ~3x for all asserts; Google 0.30% for library hardening, helped by the compiler removing redundant checks).

## Dropped findings

None. All 18 findings survived. Every cited source was located and supports the claim at least in part. Corrections and downgrades are noted in each finding.
