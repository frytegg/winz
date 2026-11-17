# Rust best practices from authoritative sources
> Code T22 · slug lang-rust · verified 2026-09-23 · counts: verified 11 / corrected 13 / downgraded 0 / dropped 0

## Summary

**Versions checked.** Each was re-confirmed in this pass.

| Source | Version and how it was confirmed |
|---|---|
| Rust / Clippy | 1.98, "Current stable, released 2026-08-20" (Clippy `CHANGELOG.md` on master) |
| Rust 2024 edition | Stabilised in Rust 1.85.0 on 2025-02-20 (Edition Guide) |
| Microsoft Pragmatic Rust Guidelines | "Version: 2026.6", "last generated on: 2026-09-15". This appears on the book's index page only, not on the sub-pages |
| Cargo Book, rustc lint listings | Current online versions |
| ANSSI Secure Rust Guidelines | Online edition titled "Secure Rust Guidelines (unstable)". No version or date is shown. The ANSSI-FR/rust-guide repo was last pushed 2026-05-19 |
| Safety-Critical Rust Coding Guidelines | "0.1". © 2025 Contributors to the Coding Guidelines Subcommittee. The repo is owned by the Safety-Critical-Rust-Consortium GitHub org |

**How the claims were checked.** I used WebFetch on the official docs, raw Clippy sources and arXiv. Hacker News posts were read through the Firebase and Algolia APIs. The GitHub API gave archive status and last-push dates. I also grepped a local copy of current Clippy master for every lint group and version cited. Reddit, Lobsters and the Rust Users Forum were not covered.

**What the official sources agree on:**

1. **Lint policy in the manifest.** Put it in `Cargo.toml` `[lints]` or `[workspace.lints]` (Cargo 1.74+). Give lint groups `priority = -1`. Make warnings fatal only in CI (`-D warnings` or `RUSTFLAGS`), never with `#![deny(warnings)]` in source.
2. **Clippy groups.**
   - Keep the default groups clean.
   - Choose pedantic lints one by one, or run pedantic as a report.
   - Never enable the restriction group as a whole. Pick individual restriction lints instead: `unwrap_used`, `indexing_slicing`, `arithmetic_side_effects`, `undocumented_unsafe_blocks`, `dbg_macro`, `allow_attributes_without_reason`.
3. **Suppressions.** Write them as `#[expect(..., reason = "...")]` (Rust 1.81+).
4. **Unsafe code.** Every `unsafe` block gets a `// SAFETY:` comment and is exercised under Miri. Rust 2024 makes `unsafe_op_in_unsafe_fn` warn by default.
5. **Integer overflow.** Release builds wrap on overflow without any error (`overflow-checks = false` in the release profile). ANSSI LANG-ARITH says the usual operators "MUST NOT be used directly" where overflow can occur.
6. **Supply chain.**
   - Run cargo-deny and cargo-audit.
   - Track `Cargo.lock` (ANSSI says MUST; Cargo says it depends on the package).
   - Restrict sources and build scripts.
   - Real crates.io incidents:
     - **Sept 2025:** `faster_log` and `async_println` exfiltrated crypto keys at run time.
     - **Aug 2026:** `arrayref` 0.3.10, published from an apparently compromised maintainer account, pulled in a typosquatted `proc-macro1` whose build script downloads and runs a binary.

**Empirical evidence (all verified):**
- **Qin et al., PLDI 2020.** They studied 850 unsafe usages, 70 memory-safety issues and 100 thread-safety issues. The sample was five applications, five libraries, two vulnerability databases and the std library. All memory-safety bugs involved unsafe code, and all the blocking bugs they studied were in safe code.
- **Rudra, SOSP 2021.** Found 264 new memory-safety bugs, which led to 76 CVEs. The repo was archived on 2026-04-02.
- **Google Android, Nov 2025.**
  - The primary security concern "generally centers on the approximately 4% of code written within unsafe{} blocks". The post does not say explicitly that this is Android's own share.
  - It "avoided shipping [its] very first Rust-based memory safety vulnerability" (CVE-2025-48530, a linear buffer overflow in CrabbyAVIF). The post does not say the bug was in unsafe code; that is an inference (a Rust memory-safety bug needs unsafe), and the post credits the Scudo allocator with making it non-exploitable.
- **Semver study (Nowak, Gruevski et al., 2023).** 172 of the top 1,000 crates (17.2%) had at least one semver-violating release. 464 of 14,389 releases (3.22%) had a violation.
- **Clippy warning density.** An average of 21 warnings per KLOC (Li et al., arXiv preprint, 2023).
- **Cloudflare, 18 Nov 2025.** One `Result::unwrap()` panicked on an `Err` when a generated feature file exceeded a 200-feature limit. Impact began at 11:28 UTC, core traffic was largely restored at 14:30, and all systems were back at 17:06.

**Real disagreements** remain on:
- unwrap versus panic-free code;
- enabling the whole pedantic group;
- whether libraries should commit `Cargo.lock`;
- error enums versus structs with `is_xxx()` methods;
- whether cargo-udeps still works on current cargo.

**Rules most likely to change behaviour** in a hardening pass:
- replacing panics with `Result`;
- switching to checked arithmetic;
- removing a dependency that only enables a feature (feature unification);
- deleting `pub` items (a semver break);
- edition migration (the drop order of `if let` temporaries changes);
- any auto-fix, which ANSSI DENV-AUTOFIX says MUST be verified by the developer.

**Main corrections from verification:**
- The "which will cause diffs" rustfmt quote was invented; the phrase is not in the source.
- ANSSI DENV-FORMAT is a SHOULD, not a requirement.
- Microsoft M-LINT-OVERRIDE-EXPECT is a "should" for overriding project-global lints, not a hard requirement.
- Two Microsoft quotes were paraphrases presented as quotes (M-SINGLE-ITEM-PATH, M-MSRV). Their real wording is now given.
- Only float-to-int `as` casts saturate; int-to-int casts truncate.
- Default Clippy does catch *some* redundant clones (`clone_on_copy`, `unnecessary_to_owned`).
- Several Clippy lint versions and source-file locations were fixed.

## Findings

### T22-F09 — Audit unsafe code: SAFETY comments, `# Safety` docs, `unsafe_op_in_unsafe_fn`, the smallest possible module, forbid where unused, Miri, cargo-geiger
- **Grade:** A · **Verdict:** CORRECTED. Google's wording changed from "its one near-miss" to "its very first Rust memory-safety vulnerability, avoided before shipping". Google author and date were added. The Rust Foundation figures were made exact. The Qin sample scope was added. (audit correction: the post says only that the primary concern "centers on the approximately 4% of code written within unsafe{} blocks", not that 4% is Android's own share, and it never says the CrabbyAVIF overflow was in unsafe code, which is an inference; it credits the Scudo allocator with making that bug non-exploitable.)
- **Rationale:**
  - Qin et al. (PLDI 2020) manually studied 850 unsafe usages and 70 memory-safety issues, drawn from 5 applications, 5 libraries, 2 vulnerability databases and std. They found "all memory-safety bugs involve unsafe code". This holds for their sample; it is not a population-wide causal proof.
  - Google's Android post says the primary Rust security concern "centers on the approximately 4% of code written within unsafe{} blocks" (it does not say explicitly that this is Android's own share). It nearly shipped its first Rust memory-safety vulnerability (CVE-2025-48530, a linear buffer overflow in CrabbyAVIF). The post does not state that the bug was in unsafe code; that is an inference (a Rust memory-safety bug needs unsafe, and the next section is "Unsafe Review and Training"). The Scudo allocator made the bug non-exploitable. Google's response was more unsafe-specific training, not a ban: "simply banning unsafe code is not workable".
  - The std library requires SAFETY comments, and Clippy can enforce them.
  - Miri catches out-of-bounds access, use-after-free, invalid values, data races and aliasing violations. It only covers executed paths, and it cannot run most FFI.
- **Evidence:**
  - [Understanding Memory and Thread Safety Practices and Issues in Real-World Rust Programs](https://songlh.github.io/paper/rust-study.pdf) — Boqin Qin, Yilun Chen, Zeming Yu, Linhai Song, Yiying Zhang, PLDI 2020 (doi 10.1145/3385412.3386036) — peer_reviewed — "In total, we studied 850 unsafe code usages, 70 memory-safety issues, and 100 thread-safety issues." / "We found that all memory-safety bugs involve unsafe code, and (surprisingly) most of them also involve safe code." — verified verbatim in the PDF.
  - [Rust in Android: move fast and fix things](https://blog.google/security/rust-in-android-move-fast-fix-things/) — Jeff Vander Stoep, Google, 2025-11-13 — industry_report — "a 1000x reduction in memory safety vulnerability density compared to Android's C and C++ code"; "We recently avoided shipping our very first Rust-based memory safety vulnerability: a linear buffer overflow in CrabbyAVIF"; "The primary security concern regarding Rust generally centers on the approximately 4% of code written within unsafe{} blocks"; "Rust changes currently spend about 25% less time in code review compared to C++" — verified. The response described is a new Comprehensive Rust deep dive on unsafe code ("simply banning unsafe code is not workable"). The citation audit notes that the 4% is not explicitly Android's own share, that "in unsafe code" for CrabbyAVIF is an inference, and that the post credits the Scudo allocator with making the bug non-exploitable.
  - [std-dev-guide: Safety comments policy](https://std-dev-guide.rust-lang.org/policy/safety-comments.html) — Rust Library Team — official_docs — "each `unsafe` block should have a `SAFETY:` comment explaining why the block is safe, which invariants are used and must be respected." — verified.
  - [Clippy source: undocumented_unsafe_blocks.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/undocumented_unsafe_blocks.rs) — rust-lang/rust-clippy, 2026 — official_docs — "Checks for `unsafe` blocks and impls without a `// SAFETY: ` comment"; "Writing out the safety justification may help in discovering unsoundness or bugs." — verified. `undocumented_unsafe_blocks` is restriction, 1.58.0; `unnecessary_safety_comment` is restriction, 1.67.0; `missing_safety_doc` is style, 1.39.0 (grep of Clippy master).
  - [Rust 2024 edition guide: unsafe_op_in_unsafe_fn warning](https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-op-in-unsafe-fn.html) — Rust Project, 2025 — official_docs — "This second role was determined to be too risky without explicit `unsafe` blocks." — verified. The rustc listing adds: "allow by default on editions up to 2021, from 2024 it is warn by default".
  - [Miri README](https://github.com/rust-lang/miri) — rust-lang/miri — official_docs — "Out-of-bounds memory accesses and use-after-free", "Invalid use of uninitialized data", "Data races and emulation of _some_ weak memory effects", Stacked/Tree Borrows; `cargo +nightly miri test`; "Miri does not catch every violation of the Rust specification"; "no access to most platform-specific APIs or FFI" — verified.
  - [Unsafe Rust in the Wild](https://rustfoundation.org/media/unsafe-rust-in-the-wild-notes-on-the-current-state-of-unsafe-rust/) — Rust Foundation, 2024-05-21 — industry_report — "Of those 127,000 crates, 24,362 make use of the `unsafe` keyword, which is 19.11% of all crates." / "34.35% make a direct function call into another crate that uses the unsafe keyword." — verified.
  - [cargo-geiger README](https://github.com/geiger-rs/cargo-geiger) — geiger-rs — official_docs — "lists statistics related to the usage of unsafe Rust code in a Rust crate and all its dependencies"; "not meant to advise directly whether the code ultimately is truly insecure or not" — verified. The repo is not archived; last push 2026-09-14.
- **Detect:**
  - Inventory: `grep -rnE '\bunsafe\b' --include=*.rs src/ | wc -l`.
  - Crates with no unsafe: set `[lints.rust] unsafe_code = "forbid"`.
  - Crates with unsafe: set `unsafe_op_in_unsafe_fn = "warn"` (needed on 2021 and earlier), plus `[lints.clippy] undocumented_unsafe_blocks = "warn"` and `unnecessary_safety_comment = "warn"`. `missing_safety_doc` is already on by default.
  - Dynamic check: `cargo +nightly miri test`, optionally with `MIRIFLAGS=-Zmiri-tree-borrows`.
  - Dependencies: `cargo geiger`.
  - Manual check per block: does the SAFETY comment name the invariant and where it is enforced?
- **Tools:** rustc `unsafe_code`, rustc `unsafe_op_in_unsafe_fn`, `clippy::undocumented_unsafe_blocks`, `clippy::unnecessary_safety_comment`, `clippy::missing_safety_doc`, Miri, cargo-geiger.
- **Applies to:** Any crate with unsafe code, FFI, custom collections or performance tricks (`get_unchecked`, `transmute`).
- **When not to apply / counterpoints:**
  - FFI and `-sys` crates need unsafe by nature, and Miri cannot run most FFI.
  - Microsoft M-UNSAFE lists three valid reasons for unsafe: novel abstractions, performance and FFI/platform calls.
  - Safe replacements can cost performance.
  - SAFETY comments written after the fact by an agent can sound plausible and be wrong. Check them against the code.
- **Fix risk:** medium

### T22-F04 — Classify every production panic site; propagate errors from external or generated data; keep only documented invariant panics
- **Grade:** A · **Verdict:** CORRECTED.
  - The `unwrap_used` version is 1.45.0, not 1.50.0.
  - Cloudflare timeline: impact 11:28 UTC, core traffic largely restored 14:30, all systems 17:06.
  - BurntSushi's post was published 2022-08-08 and updated 2025-05-17.
  - The PanicFI rustc statistic is about the compiler's own bugs, so it is indirect evidence for application code.
  - The classify-by-external-data rule is a synthesis, not a single-source rule.
- **Rationale:**
  - ANSSI LANG-LIMIT-PANIC: "A Rust function MUST NOT panic UNLESS its usage conditions have been violated".
  - Microsoft M-PANIC-IS-STOP says panics are not exceptions. M-PANIC-ON-BUG says contract violations must panic.
  - Cloudflare's 18 Nov 2025 outage was one `Result::unwrap()` on a generated config file that exceeded a 200-feature limit. Their remediation is to harden ingestion of internally generated config like user input.
  - Clippy restriction lints can inventory the panic sites. Triage is manual.
- **Evidence:**
  - [Cloudflare outage on November 18, 2025](https://blog.cloudflare.com/18-november-2025-outage/) — Matthew Prince, Cloudflare, 2025-11-18 — incident_report — "thread fl2_worker_thread panicked: called Result::unwrap() on an Err value"; "When the bad file with more than 200 features was propagated to our servers, this limit was hit — resulting in the system panicking."; remediation "Hardening ingestion of Cloudflare-generated configuration files in the same way we would for user-generated input" — verified. The code itself is only shown as an image.
  - [Secure Rust Guidelines: Error handling](https://anssi-fr.github.io/rust-guide/errors.html) — ANSSI, online edition marked "(unstable)", undated — standard — "A Rust function MUST NOT panic UNLESS its usage conditions have been violated."; "Uses of `unwrap`, `expect` and `assert!` MUST be restricted to cases explicitly forbidden by the function's specification"; "Array indexing must be properly tested, or the `get` method SHOULD be used to return an `Option`." — verified. The IDs LANG-LIMIT-PANIC, LANG-LIMIT-PANIC-SRC and LANG-ARRINDEXING were confirmed on the checklist page.
  - [Pragmatic Rust Guidelines 2026.6: Correctness](https://microsoft.github.io/rust-guidelines/guidelines/correctness/index.html) — Microsoft, 2026 — industry_report — "Panics are not exceptions. Instead, they suggest immediate program termination."; "Contract violations, i.e., the breaking of invariants either within a library or by a caller, are programming errors and must therefore panic."; "When code panics intentionally (via `panic!`, `assert!`, `unreachable!`, `todo!`, or similar), a message must be present" — verified.
  - [Using unwrap() in Rust is Okay](https://burntsushi.net/unwrap/) — Andrew Gallant, 2022-08-08, updated 2025-05-17 — engineering_blog — "If a Rust program panics, then it signals a bug in the program. That is, correct Rust programs don't panic." He argues that banning unwrap adds noise and is inconsistent while indexing and arithmetic still panic — verified.
  - [Clippy lint configuration](https://doc.rust-lang.org/clippy/lint_configuration.html) — rust-lang/rust-clippy, 2026 — official_docs — `allow-unwrap-in-tests`, `allow-expect-in-tests`, `allow-panic-in-tests` and `allow-indexing-slicing-in-tests` all default to `false` — verified. Lint facts from a grep of Clippy master:
    - `unwrap_used`: restriction, 1.45.0 (corrected from 1.50.0).
    - `expect_used`: restriction, 1.45.0.
    - `unwrap_in_result`: restriction, 1.48.0. Its text: "These functions promote recoverable errors to non-recoverable errors".
    - `indexing_slicing`: restriction.
    - `panic`: restriction, 1.40.0.
  - [PanicFI (arXiv 2408.03262)](https://arxiv.org/abs/2408.03262) — Yunbo Ni, Yang Feng, Zixi Liu, Runtao Chen, Baowen Xu, 2024 — preprint — "Over half of the bugs in rustc, Rust's own compiler, are attributable to crash stemming from panic errors"; the dataset has "102 real panic bugs and their fixes from the top 500 most-downloaded open-source" Rust projects — verified in the abstract. This is indirect support.
- **Detect:**
  - In `Cargo.toml`, under `[lints.clippy]`: `unwrap_used`, `expect_used`, `panic`, `indexing_slicing` and `unwrap_in_result`, all set to `"warn"`.
  - In `clippy.toml`: `allow-unwrap-in-tests`, `allow-expect-in-tests`, `allow-panic-in-tests` and `allow-indexing-slicing-in-tests`, all set to `true`.
  - Then run `cargo clippy --all-targets --message-format=short`.
  - Triage first the panic sites reachable from:
    - config loading;
    - deserialisation (`serde_json::from_*`);
    - network handlers;
    - anything behind a fixed capacity or preallocation limit.
- **Tools:** cargo clippy, `clippy::unwrap_used`, `clippy::expect_used`, `clippy::panic`, `clippy::indexing_slicing`, `clippy::unwrap_in_result`, clippy.toml.
- **Applies to:** Long-running services, libraries, and any code that processes external or generated data. Less important for CLIs and one-shot tools.
- **When not to apply / counterpoints:**
  - BurntSushi: unwrap on proven invariants is idiomatic, and `slice[i]` is an unwrap too.
  - Microsoft M-PANIC-ON-BUG requires a panic on contract violations.
  - Crashing on a missing file at server startup can be deliberate.
  - Tests, `build.rs`, examples and const contexts are exempt.
  - Converting a panic to a `Result` can let a process continue in a degraded or inconsistent state that was previously impossible.
- **Fix risk:** medium

### T22-F06 — Make integer overflow and lossy numeric conversion explicit
- **Grade:** A · **Verdict:** CORRECTED.
  - Only float-to-int `as` casts saturate (since 1.45). Int-to-int `as` casts still truncate or wrap without warning.
  - `as_conversions` lives in `as_conversions.rs` and `arithmetic_side_effects` in `operators/mod.rs`. The cited `casts/mod.rs` contains neither.
  - The ANSSI rule ID LANG-ARITH comes from the checklist page; the integer page does not show it.
  - The Safety-Critical guidelines are attributed to the Safety-Critical Rust Consortium's Coding Guidelines Subcommittee, © 2025, v0.1.
- **Rationale:**
  - Overflow panics in dev and test builds but wraps in release. The Rust Book calls relying on wrapping "an error".
  - ANSSI requires explicit `checked_`/`wrapping_`/`saturating_`/`overflowing_` operations, or `Wrapping<T>`/`Saturating<T>`.
  - The Safety-Critical Rust guidelines include "The 'as' operator should not be used with numeric operands" and "Ensure that integer operations do not result in arithmetic overflow".
  - Clippy's cast lints exist because `as` performs lossy conversions without warning.
- **Evidence:**
  - [The Rust Programming Language, ch. 3.2](https://doc.rust-lang.org/book/ch03-02-data-types.html) — Rust Project — official_docs — "When you're compiling in release mode with the `--release` flag, Rust does _not_ include checks for integer overflow that cause panics." / "Relying on integer overflow's wrapping behavior is considered an error." — verified.
  - [Cargo Book: Profiles](https://doc.rust-lang.org/cargo/reference/profiles.html) — Rust Project — official_docs — "When overflow-checks are enabled, a panic will occur on overflow." Defaults: dev `true`, release `false`, test inherits dev, bench inherits release — verified.
  - [Secure Rust Guidelines: Integer operations](https://anssi-fr.github.io/rust-guide/integer.html) and [Development environment](https://anssi-fr.github.io/rust-guide/devenv.html) — ANSSI, undated — standard — "When an arithmetic operation can produce an overflow, the usual operators MUST NOT be used directly." (LANG-ARITH: "Use appropriate arithmetic operations regarding potential overflows"); DENV-CARGO-OPTS: "The variables `debug-assertions` and `overflow-checks` MUST NOT be overridden in development profiles' sections (`[profile.dev]` and `[profile.test]`)." — verified.
  - [Safety-Critical Rust Coding Guidelines 0.1: Expressions](https://coding-guidelines.arewesafetycriticalyet.org/coding-guidelines/expressions/index.html) — Safety-Critical Rust Consortium, Coding Guidelines Subcommittee, © 2025, v0.1 — standard (early draft) — titles gui_ADHABsmK9FXz "The 'as' operator should not be used with numeric operands", gui_dCquvqE1csI3 "Ensure that integer operations do not result in arithmetic overflow" and gui_kMbiWbn8Z6g5 "Do not divide by 0" — titles verified. Category and decidability are not shown on the page, and the full guideline text was not read.
  - [Clippy source: operators/mod.rs (ARITHMETIC_SIDE_EFFECTS)](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/operators/mod.rs), [casts/mod.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/casts/mod.rs), [as_conversions.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/as_conversions.rs) — rust-lang/rust-clippy, 2026 — official_docs:
    - `arithmetic_side_effects` (restriction, 1.64.0): "For integers, overflow will trigger a panic in debug builds or wrap the result in release mode".
    - `cast_possible_truncation`, `cast_sign_loss`, `cast_possible_wrap` and `cast_lossless` are pedantic.
    - `as_conversions` (restriction, 1.41.0): "as conversions will perform many kinds of conversions, including silently lossy conversions and dangerous coercions".
    - All verified; file locations corrected.
  - [Announcing Rust 1.45.0](https://blog.rust-lang.org/2020/07/16/Rust-1.45.0/) — Rust Release Team, 2020 — official_docs — float-to-int `as` "would perform a 'saturating cast'". Int-to-int casts are not affected — added in verification.
  - [HN: aggressive clippy lints in a real-time game](https://news.ycombinator.com/item?id=43976280) — evrimoztamur, 2025-05 — practitioner_forum — "unwrap/expect_used already got me 90% of the way out, but ... I think I have around 300+ numerical conversions (which can and do fail!)" — verified.
- **Detect:**
  - One-time audit: `cargo clippy --all-targets -- -W clippy::arithmetic_side_effects -W clippy::cast_possible_truncation -W clippy::cast_sign_loss -W clippy::cast_possible_wrap -W clippy::cast_lossless -W clippy::as_conversions`.
  - Count numeric casts: `grep -rnE '\bas (u|i)(8|16|32|64|128|size)\b|\bas f(32|64)\b' src/`.
  - Run `grep -nE 'overflow-checks|debug-assertions' Cargo.toml` and flag `false` under `[profile.dev]` or `[profile.test]`.
  - For intended wrap-around, list the types in `clippy.toml` `arithmetic-side-effects-allowed`.
- **Tools:** cargo clippy, `clippy::arithmetic_side_effects`, `clippy::cast_possible_truncation`, `clippy::cast_sign_loss`, `clippy::cast_possible_wrap`, `clippy::cast_lossless`, `clippy::as_conversions`, grep.
- **Applies to:** Arithmetic on externally influenced values, sizes and indices, financial amounts (crypto and quant code) and parsers.
- **When not to apply / counterpoints:**
  - `arithmetic_side_effects` fires on every `+`. Use it as an audit report or on selected modules.
  - Hashes, PRNGs and checksums rely on wrap-around. Make it explicit with `wrapping_*`; do not "fix" it.
  - Float-to-int `as` saturates (defined behaviour, but possibly wrong). Int-to-int `as` truncates without warning.
  - Release `overflow-checks = true` has a runtime cost, so measure it.
- **Fix risk:** high

### T22-F01 — Centralise lint policy in Cargo.toml `[lints]`, give groups `priority = -1`, and deny warnings only in CI with a pinned toolchain
- **Grade:** A · **Verdict:** VERIFIED. One wording note: epage's comment literally says "disabling warnings in CI", evidently meaning denying them.
- **Rationale:**
  - Manifest lint configuration applies only to the current package or workspace, never to dependencies.
  - Entry order in `[lints]` is ignored. A group without an explicit priority therefore overrides individual lints in an undefined order. Clippy flags this with `lint_groups_priority` (correctness group, so deny by default).
  - `#![deny(warnings)]` in source breaks builds whenever a new toolchain adds a warning. A deny in CI keeps the same strictness without that breakage.
- **Evidence:**
  - [Cargo Book: the `[lints]` section](https://doc.rust-lang.org/cargo/reference/manifest.html) — Rust Project (Cargo team), 2026 — official_docs — "`priority` is a signed integer that controls which lints or lint groups override other lint groups"; "Cargo only applies these to the current package and not to dependencies."; "MSRV: Respected as of 1.74" — verified verbatim.
  - [Cargo Book: Workspaces, `lints` table](https://doc.rust-lang.org/cargo/reference/workspaces.html) — Rust Project — official_docs — "The `workspace.lints` table is where you define lint configuration to be inherited by members of a workspace."; members opt in with `[lints] workspace = true` — verified.
  - [Clippy source: cargo/mod.rs (LINT_GROUPS_PRIORITY)](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/cargo/mod.rs) — rust-lang/rust-clippy, 2026 — official_docs — "The order of lints in the `[lints]` is ignored, to have a lint override a group the `priority` field needs to be used, otherwise the sort order is undefined." Correctness group, 1.78.0 — verified.
  - [Rust Design Patterns: `#![deny(warnings)]`](https://rust-unofficial.github.io/patterns/anti_patterns/deny-warnings.html) — rust-unofficial/patterns — book — "By disallowing the compiler to build with warnings, a crate author opts out of Rust's famed stability." The alternative given is `RUSTFLAGS="-D warnings" cargo build` — verified. Its explicit deny list includes `const_err` and `private_in_public`, both registered as *removed* lints in current rustc (`register_removed` in `rustc_lint/src/lib.rs`).
  - [Clippy book: Continuous Integration](https://doc.rust-lang.org/clippy/continuous_integration/index.html) — rust-lang/rust-clippy — official_docs — "It is recommended to run Clippy on CI with `-Dwarnings`, so that Clippy lints prevent CI from passing."; "We recommend to use Clippy from the same toolchain, that you use for compiling your crate for maximum compatibility." — verified verbatim.
  - [HN comment by epage](https://news.ycombinator.com/item?id=31608233) — Ed Page (Cargo team member per rust-lang.org governance), 2022-06-03 — practitioner_forum — "Earlier in Rust, I saw people recommending `#![deny(warnings)]` ... I think the community has shifted since then ... and instead see people disabling warnings in CI." — verified. The literal word is "disabling".
- **Detect:**
  - `grep -rnE '#!\[deny\((warnings|clippy::all)\)\]' --include=*.rs`.
  - Check `Cargo.toml` for `[lints]` or `[workspace.lints]`, and every workspace member for `[lints] workspace = true`.
  - `cargo clippy` reports `lint_groups_priority` when a group entry has no priority.
  - CI should run `cargo clippy --workspace --all-targets --all-features -- -D warnings` on the toolchain pinned in `rust-toolchain.toml`.
- **Tools:** cargo clippy, `clippy::lint_groups_priority`, rustc lint levels, `rust-toolchain.toml`.
- **Applies to:** All Rust crates and workspaces (Cargo 1.74+ for `[lints]`).
- **When not to apply / counterpoints:**
  - A private binary with a pinned toolchain gets little harm from an in-source deny.
  - Do not copy the Design Patterns deny list verbatim; it contains removed lints.
- **Fix risk:** low

### T22-F02 — Keep the default Clippy groups clean, triage pedantic, never enable restriction wholesale, and justify each nursery lint
- **Grade:** A · **Verdict:** VERIFIED. The counterpoint that some practitioners run pedantic when agents do the fixing was unsourced; an HN comment now supports it.
- **Rationale:**
  - Clippy describes pedantic as "rather strict or have occasional false positives".
  - Clippy says restriction "should, emphatically, not be enabled as a whole", and a suspicious-group lint (`blanket_clippy_restriction_lints`) exists to catch it.
  - An average of 21 warnings per KLOC in real crates means a first run on a finished project will be noisy. Triage is needed, not blanket suppression.
- **Evidence:**
  - [Clippy book: lint groups](https://doc.rust-lang.org/clippy/) — rust-lang/rust-clippy — official_docs:
    - correctness "code that is outright wrong or useless" (deny);
    - pedantic "lints which are rather strict or have occasional false positives" (allow);
    - "The `restriction` category should, _emphatically_, not be enabled as a whole. The contained lints may lint against perfectly reasonable code, may not have an alternative suggestion, and may contradict any other lints (including other categories)."
    - Verified verbatim.
  - [Clippy book: Usage](https://doc.rust-lang.org/clippy/usage.html) — rust-lang/rust-clippy — official_docs — "This group contains really opinionated lints, that may have some intentional false positives in order to prevent false negatives. So while this group is ready to be used in production, you can expect to sprinkle multiple `#[allow(..)]`s in your code." — verified.
  - [Clippy source: attrs/mod.rs (BLANKET_CLIPPY_RESTRICTION_LINTS)](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/attrs/mod.rs) — rust-lang/rust-clippy — official_docs — "Restriction lints sometimes are in contrast with other lints or even go against idiomatic rust. These lints should only be enabled on a lint-by-lint basis and with careful consideration." Suspicious group, 1.47.0 — verified.
  - [Unleashing the Power of Clippy in Real-World Rust Projects (arXiv 2310.11738)](https://arxiv.org/abs/2310.11738) — Chunmiao Li, Yijun Yu, Haitao Wu, Luca Carlig, Shijie Nie, Lingxiao Jiang, 2023-10-18 — preprint — "average warning density of 21/KLOC"; on Rosetta benchmarks, warnings fell "from 195/KLOC to an impressive 18/KLOC" — verified in the abstract.
  - [Effective Rust, Item 29: Listen to Clippy](https://effective-rust.com/clippy.html) — David Drysdale (O'Reilly), 2024 — book — "you should make your code Clippy-warning free"; on the non-default groups: "Even though you're unlikely to want to enable these warnings for your code, understanding the reasons why they were written in the first place will improve your understanding" — verified.
  - [Pragmatic Rust Guidelines 2026.6: M-STATIC-VERIFICATION](https://microsoft.github.io/rust-guidelines/guidelines/universal/) — Microsoft, 2026 — industry_report — recommends `pedantic = { level = "warn", priority = -1 }` plus about 21 chosen restriction lints, including `undocumented_unsafe_blocks`, `map_err_ignore`, `allow_attributes_without_reason`, `clone_on_ref_ptr` and `unused_result_ok` — verified. The version string is on the book's index page.
  - [HN comment by JoshTriplett](https://news.ycombinator.com/item?id=49657693) — Josh Triplett (Rust language team member per rust-lang.org), 2026-09 — practitioner_forum — "I wouldn't recommend turning on all of `clippy::pedantic` as a unit ... some of them have much more value than others, and turning them all on may make your experience of Rust feel unpleasant and nitpicky." — verified.
  - [HN comment by eru](https://news.ycombinator.com/item?id=49652589) — eru, 2026-09 — practitioner_forum — "you can also tell them to make clippy happy. Both in normal mode or if you are feeling nitpicky, you can also tell them to make clippy::pedantic happy." — added in verification to support the agent-and-pedantic counterpoint.
- **Detect:**
  - `cargo clippy --workspace --all-targets --all-features -- -D warnings` must pass.
  - Triage report: `cargo clippy --all-targets -- -W clippy::pedantic 2>&1 | grep -oE 'clippy::[a-z_]+' | sort | uniq -c | sort -rn`.
  - `grep -rn 'clippy::restriction\|clippy::nursery' Cargo.toml src/`.
- **Tools:** cargo clippy, `clippy::pedantic`, `clippy::blanket_clippy_restriction_lints`.
- **Applies to:** All Rust code. This matters most for a finished codebase with many existing warnings.
- **When not to apply / counterpoints:**
  - Microsoft enables all of pedantic at warn; Effective Rust and a lang-team member advise against that.
  - Pedantic fixes such as `must_use_candidate` and the cast lints change the public API or behaviour. Apply them one by one.
- **Fix risk:** medium

### T22-F03 — Audit every lint suppression; prefer `#[expect(..., reason = "...")]`; enforce with `allow_attributes_without_reason`
- **Grade:** A · **Verdict:** CORRECTED. Microsoft M-LINT-OVERRIDE-EXPECT is a "should", scoped to overriding project-global lints in a submodule or item, not a blanket requirement. The agent anecdote is one practitioner's report.
- **Rationale:**
  - `#[expect]` warns when the suppressed lint no longer fires, so stale suppressions surface on their own.
  - A `reason` string documents intent at the point of suppression.
  - Microsoft recommends `#[expect]` over `#[allow]` for overrides.
  - One experienced developer reports that an AI agent adds `allow(dead_code)` despite instructions forbidding it. That matters for a pass run after agents wrote code.
- **Evidence:**
  - [Announcing Rust 1.81.0](https://blog.rust-lang.org/2024/09/05/Rust-1.81.0/) — Rust Release Team, 2024-09-05 — official_docs — the `expect` lint level "allows explicitly noting that a particular lint _should_ occur, and warning if it doesn't". Example: `#![deny(clippy::float_arithmetic, reason = "no hardware float support")]`. The post names Clippy's `allow_attributes` and `allow_attributes_without_reason` — verified.
  - [Clippy source: attrs/mod.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/attrs/mod.rs) — rust-lang/rust-clippy — official_docs — `allow_attributes` (restriction, 1.70.0): "`#[expect]` attributes suppress the lint emission, but emit a warning, if the expectation is unfulfilled." `allow_attributes_without_reason` (restriction, 1.61.0): "Justifying each `allow` helps readers understand the reasoning, and may allow removing `allow` attributes if their purpose is obsolete." — verified.
  - [Pragmatic Rust Guidelines 2026.6: M-LINT-OVERRIDE-EXPECT](https://microsoft.github.io/rust-guidelines/guidelines/universal/) — Microsoft, 2026 — industry_report — "When overriding project-global lints inside a submodule or item, you should do so via `#[expect]`, not `#[allow]`." — verified. This is a "should", corrected from "require".
  - [HN comment by duttish](https://news.ycombinator.com/item?id=48421662) — duttish, 2026-06 — practitioner_forum — "It often just silences errors and warnings instead of actually fixing the problem" and "review the output code and see allow(dead_code) despite my claude.md forbidding it." — verified. This is a single anecdote.
- **Detect:**
  - `grep -rnE '#!?\[allow\(' --include=*.rs | sort | uniq -c`.
  - Prioritise crate-level `#![allow(` and the `dead_code`, `unused`, `clippy::all` and `clippy::pedantic` suppressions.
  - Enable `[lints.clippy] allow_attributes_without_reason = "warn"`, and optionally `allow_attributes`.
  - After converting to `#[expect]`, delete every suppression the build reports as `unfulfilled_lint_expectations` (warn-by-default).
- **Tools:** rustc `#[expect]`, `clippy::allow_attributes`, `clippy::allow_attributes_without_reason`, grep.
- **Applies to:** Crates with MSRV of 1.81 or later. Below that, use `#[allow]` with a comment.
- **When not to apply / counterpoints:**
  - Code compiled only under some cfg or feature combinations can fulfil an `#[expect]` in one configuration and not in another. Use `cfg_attr` or keep `#[allow]`.
  - Generated code (bindgen, prost) legitimately needs a blanket allow at its module boundary.
- **Fix risk:** low

### T22-F05 — Remove debugging and unfinished-code artefacts (`dbg!`, `todo!`, `unimplemented!`, print-as-logging)
- **Grade:** A · **Verdict:** CORRECTED. M-LOG-NOT-PRINT's text has now been read (previously only its title). It covers production code paths, points to the project's telemetry framework rather than a "logging facade", and exempts CLIs.
- **Rationale:**
  - Clippy: `dbg!` "should not be present in released software or committed to a version control system"; `todo!` "indicates the presence of unfinished code".
  - Microsoft M-LOG-NOT-PRINT: production code paths should emit diagnostics through the project's telemetry framework rather than `println!` or `dbg!`.
  - These are cheap, high-signal checks on a "finished" project.
- **Evidence:**
  - [Clippy source: dbg_macro.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/dbg_macro.rs) — rust-lang/rust-clippy — official_docs — "The `dbg!` macro is intended as a debugging tool. It should not be present in released software or committed to a version control system." Restriction, 1.34.0, respects `allow-dbg-in-tests` — verified.
  - [Clippy source: panic_unimplemented.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/panic_unimplemented.rs) — rust-lang/rust-clippy — official_docs — `todo` (restriction, 1.40.0): "The `todo!` macro indicates the presence of unfinished code, so it should not be present in production code." `unimplemented` (pre 1.29.0) and `unreachable` (1.40.0) share the text "This macro, or panics in general, may be unwanted in production code." — verified.
  - [Clippy lint configuration](https://doc.rust-lang.org/clippy/lint_configuration.html) — rust-lang/rust-clippy — official_docs — `allow-print-in-tests` affects `print_stdout` and `print_stderr`; `allow-dbg-in-tests` affects `dbg_macro`; both default to `false` — verified. `print_stdout` is restriction, pre-1.29; `print_stderr` is restriction, 1.50.0.
  - [Pragmatic Rust Guidelines 2026.6: M-LOG-NOT-PRINT (Library/Resilience)](https://microsoft.github.io/rust-guidelines/guidelines/libs/resilience/) — Microsoft, 2026 — industry_report — "Production code paths should emit diagnostics through the project's telemetry framework rather than via `println!` or `dbg!`." Console printing is reserved for CLIs where stdout is the interface — verified.
- **Detect:**
  - `grep -rnE '\b(dbg|todo|unimplemented)!\(' --include=*.rs src/`.
  - In library crates: `grep -rnE '\be?print(ln)?!\(' src/`.
  - Or set `[lints.clippy] dbg_macro = "deny"`, and `todo`, `unimplemented`, `print_stdout` and `print_stderr` to `"warn"`. Add `clippy.toml` `allow-dbg-in-tests = true` and `allow-print-in-tests = true`.
- **Tools:** cargo clippy, `clippy::dbg_macro`, `clippy::todo`, `clippy::unimplemented`, `clippy::print_stdout`, `clippy::print_stderr`, grep.
- **Applies to:** All crates. The `print_*` lints fit libraries and services, not CLIs.
- **When not to apply / counterpoints:**
  - CLI binaries legitimately print.
  - `unreachable!()` on a proven-impossible branch is an invariant assertion.
  - `dbg!` returns its argument, so keep the inner expression when removing it.
- **Fix risk:** low

### T22-F07 — Libraries expose concrete, well-behaved error types; applications use one error crate consistently
- **Grade:** A · **Verdict:** CORRECTED.
  - `map_err_ignore` is defined in `clippy_lints/src/methods/mod.rs`, not the cited `functions/mod.rs`.
  - "Do not expose `anyhow::Error` in a library's public API" is inferred from thiserror's README and Microsoft's scoping of M-APP-ERROR to applications. No source states it directly.
- **Rationale:**
  - API Guidelines C-GOOD-ERR: error types implement `std::error::Error` plus `Send` and `Sync`, never `()`, with Display messages "lowercase without trailing punctuation, and typically concise".
  - thiserror's author: use thiserror when callers need the exact failure information (library-like code), anyhow when easy propagation is enough (application-like code).
  - Microsoft M-APP-ERROR: applications "should not mix multiple application-level error types".
  - Clippy's `result_unit_err`, `result_large_err` and `map_err_ignore` detect the common violations.
- **Evidence:**
  - [Rust API Guidelines: Interoperability (C-GOOD-ERR)](https://rust-lang.github.io/api-guidelines/interoperability.html) — Rust Library Team — official_docs — "Error types should always implement the `std::error::Error` trait"; "Error types should implement the `Send` and `Sync` traits."; `()` as the error type is discouraged; Display messages should be "lowercase without trailing punctuation, and typically concise." — verified.
  - [thiserror README: Comparison to anyhow](https://github.com/dtolnay/thiserror) — David Tolnay — official_docs — "Use thiserror if you care about designing your own dedicated error type(s) so that the caller receives exactly the information that you choose in the event of failure. This most often applies to library-like code. Use Anyhow if you don't care what error type your functions return, you just want it to be easy. This is common in application-like code." — verified.
  - [Pragmatic Rust Guidelines 2026.6: M-APP-ERROR](https://microsoft.github.io/rust-guidelines/guidelines/apps/) and [M-ERRORS-CANONICAL-STRUCTS](https://microsoft.github.io/rust-guidelines/guidelines/libs/ux/) — Microsoft, 2026 — industry_report:
    - "Applications, and crates in your own repository exclusively used from your application, may use ohno::AppError, anyhow, eyre or similar"; "you should not mix multiple application-level error types".
    - "Errors should be a situation-specific `struct` that contain a `Backtrace`, a possible upstream error cause, and helper methods". Any inner `ErrorKind` should not be exposed.
    - Verified.
  - Clippy lint facts (grep of Clippy master): `result_unit_err` (style, 1.49.0), `result_large_err` (perf, 1.65.0; `large-error-threshold` default 128), `map_err_ignore` (restriction, 1.48.0). The `map_err_ignore` text: "This `map_err` throws away the original error rather than allowing the enum to contain and report the cause." Sources: [functions/mod.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/functions/mod.rs), [methods/mod.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/methods/mod.rs) — verified.
  - [HN comment by zvrba](https://news.ycombinator.com/item?id=26195035) — zvrba, 2021 — practitioner_forum — "as the executable gets larger and refactored, some of the 'executable' code will inevitably become 'library' code. What then?" — verified.
- **Detect:**
  - `cargo clippy` reports `result_unit_err` and `result_large_err` by default. Add `-W clippy::map_err_ignore`.
  - In libraries: `grep -rnE 'pub (async )?fn[^{]*anyhow::(Result|Error)' src/` and look for `Box<dyn Error>` in public signatures.
  - Compile-time Send and Sync check: `fn _assert<T: Send + Sync + 'static>() {}` then `_assert::<MyError>()`.
  - Error-crate inventory: `grep -nE '^(anyhow|eyre|color-eyre|snafu|thiserror)' Cargo.toml`.
- **Tools:** cargo clippy, `clippy::result_unit_err`, `clippy::result_large_err`, `clippy::map_err_ignore`, grep.
- **Applies to:** Library crates and internal crates with more than one consumer. For binaries, only the "one error crate, keep the source chain" part applies.
- **When not to apply / counterpoints:**
  - Microsoft recommends structs with `is_xxx()` over exposed enums; the thiserror ecosystem usually uses enums.
  - Practitioners dispute the library/application split.
  - Changing a public error type or its Display text is a breaking change for callers, log parsers and tests.
- **Fix risk:** medium

### T22-F08 — Find silently discarded results; add `#[must_use]` where ignoring a value is almost certainly a bug
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - The std policy targets outputs where "failing to explicitly consider them or their output is almost certainly a bug": fallible operations, non-mutating methods and lazy iterators.
  - It deliberately excludes `JoinHandle`, because fire-and-forget work is legitimate.
  - `let _ =` drops a lock guard immediately (`let_underscore_lock`, correctness).
  - An unpolled future does no work (`let_underscore_future`, suspicious).
- **Evidence:**
  - [std-dev-guide: When to add #[must_use]](https://std-dev-guide.rust-lang.org/policy/must-use.html) — Rust Library Team — official_docs — "failing to explicitly consider them or their output is almost certainly a bug"; the examples are fallible operations, non-mutating methods like `saturating_add`, and lazy iterators; `thread::JoinHandle` is excluded because "spawning fire-and-forget work is a legitimate pattern" — verified.
  - [Clippy source: let_underscore.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/let_underscore.rs) — rust-lang/rust-clippy — official_docs — verified:
    - `let_underscore_lock` (correctness, 1.43.0): "This statement immediately drops the lock instead of extending its lifetime to the end of the scope".
    - `let_underscore_future` (suspicious, 1.67.0): "Futures must be polled for work to be done."
    - `let_underscore_must_use` (restriction, 1.42.0).
    - `let_underscore_untyped` (restriction, 1.69.0): "will continue to do so even if the type were to change".
  - [rustc allowed-by-default lints](https://doc.rust-lang.org/rustc/lints/listing/allowed-by-default.html) — Rust Project — official_docs — `let_underscore_drop`: "This is usually unintended, especially for types like `MutexGuard`, which are typically used to lock a mutex for the duration of an entire scope." `unused_results`: allow by default "because it can be noisy" — verified.
  - Clippy lint facts (grep of Clippy master): `must_use_candidate` (pedantic, 1.40.0), `double_must_use` (style, 1.40.0), `unused_result_ok` (restriction, 1.82.0) — verified.
- **Detect:**
  - `grep -rnE 'let _ = ' src/` and review each hit.
  - `grep -rnE '\.ok\(\);' src/`.
  - Audit lints: `-W clippy::let_underscore_must_use -W clippy::let_underscore_untyped -W clippy::unused_result_ok -W let_underscore_drop`. The default-on `let_underscore_lock` and `let_underscore_future` already run.
  - `-W clippy::must_use_candidate` gives a report of `#[must_use]` opportunities.
- **Tools:** cargo clippy, `clippy::let_underscore_must_use`, `clippy::let_underscore_untyped`, `clippy::let_underscore_future`, `clippy::let_underscore_lock`, `clippy::unused_result_ok`, `clippy::must_use_candidate`, rustc `let_underscore_drop`.
- **Applies to:** All crates, especially services with background tasks, channels and locks.
- **When not to apply / counterpoints:**
  - Best-effort cleanup (sending to a closed channel, flushing logs at shutdown) is legitimately ignored. Keep it as `let _: Result<_, _> = ...` with a comment.
  - Adding `#[must_use]` to a public API creates new warnings for downstream users.
  - Handling a previously ignored error adds a new failure path.
- **Fix risk:** medium

### T22-F10 — Review manual `unsafe impl Send/Sync`, panic safety in unsafe code, `into_raw`/`from_raw` pairing, `mem::forget`, and panics in `Drop`
- **Grade:** A · **Verdict:** VERIFIED. The open question about a maintained Rudra replacement is partly answered: `clippy::non_send_fields_in_send_ty` exists (nursery, 1.57.0) and heuristically flags `Send` impls on types with non-`Send` fields.
- **Rationale:**
  - Rudra (SOSP 2021) found 264 memory-safety bugs and 76 CVEs across crates.io in three patterns:
    - panic safety;
    - higher-order invariants;
    - Send/Sync variance.
  - ANSSI turns these patterns into checklist items.
  - Microsoft: unsound code is never acceptable, and soundness boundaries equal module boundaries.
- **Evidence:**
  - [Rudra](https://github.com/sslab-gatech/Rudra) — SSLab, Georgia Tech, SOSP 2021 (Distinguished Artifact Award) — peer_reviewed:
    - Patterns: "Panic Safety (Unsafe code that can create memory-safety issues when panicked)", "Higher Order Invariant (Assumed properties about traits)", "Send Sync Variance (Unrestricted Send or Sync on generic types)".
    - "It managed to find 264 new memory safety issues across the Rust ecosystem which resulted in 76 CVEs."
    - "This repository was archived by the owner on Apr 2, 2026."
    - All verified.
  - [Secure Rust Guidelines: checklist](https://anssi-fr.github.io/rust-guide/checklist.html) — ANSSI, undated — standard — verified:
    - LANG-SYNC-TRAITS "Justify `Send` and `Sync` implementation"
    - MEM-FORGET "Do not use `mem::forget`"
    - MEM-INTOFROMRAWALWAYS "Always call `from_raw` on `into_raw`ed value"
    - MEM-INTOFROMRAWONLY "Call `from_raw` _only_ on `into_raw`ed value"
    - LANG-DROP-NO-PANIC "Do not panic in `Drop` implementation"
    - LANG-UNSAFE-ENCP "Encapsulation of _unsafe_ features"
  - [Pragmatic Rust Guidelines 2026.6: M-UNSOUND](https://microsoft.github.io/rust-guidelines/guidelines/correctness/index.html) — Microsoft, 2026 — industry_report — "Unsound code is seemingly _safe_ code that may produce undefined behavior when called from other safe code, or on its own accord."; "unsound code is never acceptable"; "soundness boundaries equal module boundaries" — verified.
  - [Clippy source: non_send_fields_in_send_ty.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/non_send_fields_in_send_ty.rs) — rust-lang/rust-clippy — official_docs — "warns about a `Send` implementation for a type that contains fields that are not safe to be sent across threads"; its known problem is that it "relies on heuristics". Nursery, 1.57.0 — added in verification.
- **Detect:**
  - `grep -rnE 'unsafe impl(<[^>]*>)? *(Send|Sync) for' src/`. For each hit, check that every generic `T` has a `Send`/`Sync` bound where needed. Optionally run `-W clippy::non_send_fields_in_send_ty`.
  - `grep -rnE 'mem::forget|Box::leak|into_raw|from_raw|ManuallyDrop' src/`, then check pairing and ownership.
  - `grep -rn 'impl.*Drop for' src/`, then look for `unwrap`, `expect`, indexing or `panic!` inside `drop()`.
  - Manually check every unsafe block that calls a closure or trait method mid-update: is the structure still valid if the callee panics?
- **Tools:** grep, ast-grep, Miri, `clippy::mem_forget` (restriction), `clippy::non_send_fields_in_send_ty` (nursery).
- **Applies to:** Crates that define containers, synchronisation primitives or FFI wrappers, or that contain any `unsafe impl`.
- **When not to apply / counterpoints:**
  - `Box::leak` is legitimate for intentional `'static` singletons.
  - Rudra is archived, and the Clippy nursery lint is heuristic. There is no maintained full replacement.
  - Adding a `Send` bound to a public generic type is a semver break.
- **Fix risk:** medium

### T22-F11 — Detect dead code in every build configuration before deleting; use `unreachable_pub`; run semver-checks before removing `pub` items
- **Grade:** A · **Verdict:** VERIFIED. The "single configuration at a time" sentence is said of `cargo fix`. Applying it to lints is a sound inference, because cfg'd-out code is never compiled. (audit correction: the semver post's byline reads "coauthored by Tomasz Nowak and Predrag Gruevski", with the work done with Bartosz Smolarczyk, Michał Staniewski and Mieszko Grodzicki as Nowak et al.'s bachelor's thesis; it is a blog post, not an industry report; all numbers stand.)
- **Rationale:**
  - `dead_code` only "detects unused, unexported items", so `pub` items reachable from a library root are invisible to it. `unreachable_pub` exposes `pub` items that are not really exported.
  - Feature- or cfg-gated code looks dead in any single configuration.
  - Removing a `pub` item from a library is a semver break. 17.2% of the top 1,000 crates shipped at least one semver-violating release.
- **Evidence:**
  - [rustc warn-by-default lints: dead_code](https://doc.rust-lang.org/rustc/lints/listing/warn-by-default.html) — Rust Project — official_docs — "The `dead_code` lint detects unused, unexported items."; "To silence the warning for individual items, prefix the name with an underscore such as `_foo`." — verified.
  - [rustc allowed-by-default lints: unreachable_pub](https://doc.rust-lang.org/rustc/lints/listing/allowed-by-default.html) — Rust Project — official_docs — it recommends `pub(crate)`; it is "allow" by default "because it will trigger for a large amount of existing Rust code. Eventually it is desired for this to become warn-by-default." — verified.
  - [Edition Guide: Advanced migrations](https://doc.rust-lang.org/edition-guide/editions/advanced-migrations.html) — Rust Project — official_docs — "cargo fix can only work with a single configuration at a time."; use `--all-features` and `--target` — verified.
  - [cargo-hack README](https://github.com/taiki-e/cargo-hack) — taiki-e — official_docs — `--each-feature`: "Perform for each feature which includes default features and `--no-default-features` of the package."; `--feature-powerset` covers the powerset — verified.
  - [cargo-shear README](https://github.com/Boshen/cargo-shear) — Boshen — official_docs — detects "unlinked source files (Rust files not reachable from any module tree)" — verified. Active; last push 2026-09-22.
  - [Semver violations are common, better tooling is the answer](https://predr.ag/blog/semver-violations-are-common-better-tooling-is-the-answer/) — Tomasz Nowak, Predrag Gruevski (with Bartosz Smolarczyk, Michał Staniewski, Mieszko Grodzicki), 2023-09-07 — engineering_blog (reports Nowak et al.'s bachelor's-thesis study) — 14,389 releases; "Around 1 in 31 releases had at least one semver violation" (464, 3.22%); "172 crates (17.2%) had at least one release with a semver violation" — verified.
  - [Effective Rust, Item 22: Minimize visibility](https://effective-rust.com/visibility.html) — David Drysdale, 2024 — book — "Once a crate item is public, it can't be made private again without breaking any code that uses the crate, thus necessitating a major version bump"; also a dead_code warning "often indicates that code _can't_ be used from outside the module" — verified.
- **Detect:**
  1. Set `[lints.rust] unreachable_pub = "warn"`, run `cargo check --workspace --all-targets --all-features`, and read the dead_code warnings.
  2. Run `cargo hack check --workspace --all-targets --each-feature` (or `--feature-powerset`), plus `cargo check --target <t>` for each `cfg(target_os)` branch.
  3. Find suppressions and underscore-prefixed items: `grep -rnE '#!?\[allow\((dead_code|unused)' src/` and `grep -rnE '\b(fn|struct|enum|const|static) _[a-z]' src/`.
  4. Run `cargo shear` to find unlinked files.
  5. For libraries, run `cargo semver-checks` after the removals.
  6. Before deleting anything, grep for `#[no_mangle]`, `#[export_name]`, `inventory::submit!`, `linkme` and `#[used]`. Items registered this way look unused but are not.
- **Tools:** rustc `dead_code`, rustc `unreachable_pub`, cargo-hack, cargo-shear, cargo-semver-checks, grep.
- **Applies to:** All crates. Deleting `pub` items is risky mainly in published or shared libraries.
- **When not to apply / counterpoints:**
  - Items used only by macros, FFI exports, linker-section registration, proc-macro output, benches or examples can look dead.
  - `unreachable_pub` is noisy on existing code.
  - A dead_code warning may mean the visibility is wrong rather than that the code is unneeded (Effective Rust).
- **Fix risk:** medium

### T22-F13 — Harden the supply chain: cargo-deny and cargo-audit in CI, strict source and wildcard policy, tracked Cargo.lock with `--locked`, a build-script allow-list, review of new build.rs and proc-macro code
- **Grade:** A · **Verdict:** VERIFIED. Two points added. First, cargo-deny's own docs state its build-script checks do "NOT protect you from actively malicious code". Second, the arrayref release was published from an apparently compromised maintainer account.
- **Rationale:**
  - Real crates.io incidents:
    - **Sept 2025:** typosquats `faster_log` (7,181 downloads) and `async_println` (1,243) exfiltrated crypto private keys at run time.
    - **Aug 2026:** `arrayref` 0.3.10 added the typosquatted `proc-macro1` 1.0.107, whose build script downloads and runs a binary.
  - ANSSI makes tracking `Cargo.lock` a MUST and requires vetting direct and transitive dependencies.
  - cargo-deny's `sources` and `wildcards` checks default to warn only.
- **Evidence:**
  - [cargo-deny: sources config](https://embarkstudios.github.io/cargo-deny/checks/sources/cfg.html) and [bans config](https://embarkstudios.github.io/cargo-deny/checks/bans/cfg.html) — Embark Studios — official_docs — verified:
    - `unknown-registry` and `unknown-git` default to "warn": "Prints a warning for each crate, but does not fail the check."
    - `wildcards` and `multiple-versions` also default to warn.
    - The `build` field "Specifies all the crates that are allowed to have a build script. If this option is omitted, all crates are allowed to have a build script".
    - The build-time checks do "NOT protect you from actively malicious code".
  - [cargo-audit README](https://github.com/rustsec/rustsec/tree/main/cargo-audit) — RustSec — official_docs — "Audit your dependencies for crates with security vulnerabilities reported to the RustSec Advisory Database." `cargo audit bin` is fully accurate on binaries built with cargo auditable. `cargo audit fix` is experimental — verified.
  - [Secure Rust Guidelines: Development environment](https://anssi-fr.github.io/rust-guide/devenv.html) and [checklist](https://anssi-fr.github.io/rust-guide/checklist.html) — ANSSI, undated — standard — "Cargo.lock files MUST be tracked by a version control system." Plus LIBS-VETTING-DIRECT, LIBS-VETTING-TRANSITIVE, LIBS-AUDIT and LIBS-OUTDATED — verified.
  - [Cargo Book FAQ](https://doc.rust-lang.org/cargo/faq.html) — Rust Project — official_docs — "While `cargo new` defaults to tracking `Cargo.lock` in version control, whether you do is dependent on the needs of your package."; "`Cargo.lock` does not affect the consumers of your package"; "`cargo install` will select the latest dependencies unless `--locked` is passed in." — verified.
  - [Malicious Rust Crate arrayref Runs a Build-Time Payload](https://safedep.io/arrayref-proc-macro1-rust-build-time-malware/) — SafeDep Team, 2026-08-20 — incident_report — "Version 0.3.10 added a dependency on a typosquatted crate called `proc-macro1`" (1.0.107). The build script "fetches an architecture-specific binary over a TLS connection that accepts any certificate without validation, then runs it detached from the build". The maintainer's account "appears to have been compromised" — verified. The HN thread has 554 points.
  - [crates.io: Malicious crates faster_log and async_println](https://blog.rust-lang.org/2025/09/24/crates.io-malicious-crates-fasterlog-and-asyncprintln/) — Walter Pearce for the crates.io team, 2025-09-24 — incident_report — "downloaded 7181 times" and "downloaded 1243 times"; they searched for "Quoted Ethereum private keys (0x + 64 hex), Solana-style Base58 secrets"; they "did not execute any malicious code at build time" — verified.
  - [Rust dependencies scare me](https://vincents.dev/blog/rust-dependencies-scare-me/) — Vincent, 2025-05 (per the HN submission) — engineering_blog — 9 direct dependencies gave "a staggering 3.6 million lines of rust" vendored, against about 1,000 of the author's own lines; triggered by RUSTSEC-2021-0141 (dotenv unmaintained) — verified. The HN thread had 424 points and 570 comments.
  - [cargo vet](https://mozilla.github.io/cargo-vet/) — Mozilla — official_docs — "a tool to help projects ensure that third-party Rust dependencies have been audited by a trusted entity", with shared, relative and deferred audits — verified. The repo is not archived; last push 2026-04-19.
- **Detect:**
  - Run `cargo deny init && cargo deny check`.
  - In `deny.toml`, set `[sources] unknown-registry = "deny"`, `unknown-git = "deny"`, and `[bans] wildcards = "deny"`. Optionally add a `build` allow-list.
  - Run `cargo audit`.
  - `git ls-files --error-unmatch Cargo.lock` checks the lockfile is tracked. CI must use `--locked`.
  - Run `cargo tree --duplicates`.
  - `git diff <base> -- Cargo.lock | grep '^+name'` lists new or changed crates. Inspect their `build.rs` and proc-macro code.
- **Tools:** cargo-deny, cargo-audit, cargo-vet, cargo tree, cargo auditable.
- **Applies to:** All projects. Essential for applications handling secrets or keys (crypto and trading).
- **When not to apply / counterpoints:**
  - `Cargo.lock` does not protect library consumers.
  - Effective Rust (2024) says libraries should not commit it; ANSSI says MUST.
  - cargo-deny can flag build scripts but cannot prevent their execution.
  - Advisory fixes change dependency versions, so re-run all tests.
- **Fix risk:** low

### T22-F14 — Declare and verify an MSRV; use the MSRV-aware resolver; let Clippy's `msrv` follow `rust-version`
- **Grade:** A · **Verdict:** CORRECTED.
  - Clippy's `msrv` setting affects 76 lints (docs), not "70+".
  - The Microsoft M-MSRV quote was a paraphrase. The real text: an MSRV "should be set when libraries are first created ... should be kept a few versions behind the most recent compiler release"; "Bumping MSRV therefore does not require a major release, but can be handled through a minor update."
  - Setting `package.resolver = "3"` requires MSRV 1.84.
- **Rationale:**
  - The Cargo Book wants `rust-version` support "Verified ... including automated testing". It recommends choosing a policy; the simplest is always using the latest Rust version.
  - The MSRV-aware resolver prefers dependency versions compatible with `rust-version`. It is the default on edition 2024.
  - Clippy's `msrv` defaults to `rust-version`, which stops it suggesting newer APIs.
- **Evidence:**
  - [Cargo Book: rust-version](https://doc.rust-lang.org/cargo/reference/rust-version.html) — Rust Project — official_docs — "A package's functionality is verified on its supported Rust versions, including automated testing."; "Choose a policy for what Rust versions to support ..."; "The simplest policy to support is to always use the latest Rust version." It names cargo-msrv and cargo-hack — verified.
  - [Announcing Rust 1.84.0](https://blog.rust-lang.org/2025/01/09/Rust-1.84.0/) — Rust Release Team, 2025-01-09 — official_docs — opt in with `incompatible-rust-versions = "fallback"` or `package.resolver = "3"` (which requires MSRV 1.84); "enabled by default for projects using the 2024 edition"; clap v4.0.32 is chosen over 4.5.23 for a 1.60 MSRV — verified.
  - [Clippy lint configuration: msrv](https://doc.rust-lang.org/clippy/lint_configuration.html) — rust-lang/rust-clippy — official_docs — "The minimum rust version that the project supports. Defaults to the `rust-version` field in `Cargo.toml`". Affects 76 lints, including `manual_let_else` and `uninlined_format_args` — verified and corrected.
  - [Pragmatic Rust Guidelines 2026.6: M-MSRV, M-LATEST-EDITION](https://microsoft.github.io/rust-guidelines/guidelines/project/index.html) — Microsoft, 2026 — industry_report — quotes as corrected above. M-LATEST-EDITION: "set `edition` to the latest stable edition (at least `2024`)" — verified.
  - [cargo-hack README](https://github.com/taiki-e/cargo-hack) — taiki-e — official_docs — `--rust-version`: "Perform commands on the Rust version of `package.rust-version` field in `Cargo.toml`" — verified.
- **Detect:**
  - `grep -nE '^rust-version|^edition|resolver' Cargo.toml` in every member.
  - Verify with `cargo hack check --rust-version --workspace --all-targets` (or `cargo +<msrv> check --locked`).
  - If no MSRV is declared, `cargo msrv find` establishes one.
  - Check for a `clippy.toml` `msrv` that disagrees with `rust-version`.
- **Tools:** cargo-hack, cargo-msrv, rustup, Clippy's `msrv` config.
- **Applies to:** Libraries (mandatory) and applications (a "latest stable" policy plus `rust-toolchain.toml` is enough).
- **When not to apply / counterpoints:**
  - Old toolchains block modernisation: `#[expect]` needs 1.81, `LazyLock` 1.80, `OnceLock` 1.70, edition 2024 needs 1.85.
  - A declared but unverified `rust-version` misleads the resolver and users.
- **Fix risk:** low

### T22-F15 — Migrate to edition 2024 as a reviewed step, not a blind `cargo fix`
- **Grade:** A · **Verdict:** CORRECTED. The rustfmt quote's clause "which will cause diffs" is not in the source. The real text says formatting "will automatically migrate formatting over to the 2024 style edition formatting", and projects whose contributors use format-on-save are "strongly encouraged to add a `rustfmt.toml`" with `style_edition`.
- **Rationale:** Rust 2024 (1.85) changes semantics that matter for hardening:
  - `if let` temporaries drop before the `else` branch. This fixes a classic RwLock deadlock but changes drop order.
  - References to `static mut` are denied, because they are "instantaneous undefined behavior".
  - `env::set_var` and `remove_var` became unsafe.
  - `unsafe_op_in_unsafe_fn` warns by default.
  - The migration preserves old semantics through rewrites the guide says to review.
- **Evidence:**
  - [Edition guide: if let temporary scope](https://doc.rust-lang.org/edition-guide/rust-2024/temporary-if-let-scope.html) — Rust Project, 2025 — official_docs — "the temporary values generated from evaluating `$expr` will be dropped before the program enters the `else` branch instead of after" (the RwLock DEADLOCK example); "After the migration, it is recommended that you review all of the changes of `if let` to `match`" — verified.
  - [Edition guide: static mut references](https://doc.rust-lang.org/edition-guide/rust-2024/static-mut-references.html) — Rust Project — official_docs — `static_mut_refs` is now deny by default; taking a reference "has always been _instantaneous_ undefined behavior, even if the reference is never read from or written to"; the alternatives are atomics, Mutex/RwLock, OnceLock/LazyLock and `&raw mut` — verified.
  - [Edition guide: Newly unsafe functions](https://doc.rust-lang.org/edition-guide/rust-2024/newly-unsafe-functions.html) — Rust Project — official_docs — `std::env::set_var`, `remove_var` and `CommandExt::before_exec` are now unsafe. The migration inserts `// TODO: Audit that the environment access only happens in single-threaded code.` The guide says "It is still your responsibility to manually review their usage." — verified.
  - [Edition guide: Transitioning an existing project](https://doc.rust-lang.org/edition-guide/editions/transitioning-an-existing-project-to-a-new-edition.html) — Rust Project — official_docs — steps: `cargo update`, `cargo fix --edition`, set `edition`, `cargo build`/`test`, `cargo fmt`; "`cargo fix` can't always fix your code automatically"; "the automatic migration does not update doctests, and build-time code generation or macros may need manual updating" — verified. The 2024 edition shipped in 1.85.0 on 2025-02-20 (Edition Guide index).
  - [Edition guide: Rustfmt style edition](https://doc.rust-lang.org/edition-guide/rust-2024/rustfmt-style-edition.html) — Rust Project — official_docs — quote corrected as above. Verified against the raw HTML.
- **Detect:**
  - `grep -n '^edition' Cargo.toml */Cargo.toml`.
  - Run `cargo fix --edition --all-features --all-targets`, repeating with `--target` for platform-specific cfg code. Then set `edition = "2024"` and run `cargo test --all-features`.
  - After migrating:
    - `grep -rn 'TODO: Audit that the environment access' src/`;
    - `git diff | grep -nE '^\+\s*match '` to find the `if_let_rescope` rewrites;
    - `grep -rnE 'static mut ' src/`.
- **Tools:** `cargo fix --edition`, rustc `if_let_rescope`, rustc `static_mut_refs`, rustc `deprecated_safe_2024`, cargo-hack, rustfmt.
- **Applies to:** Crates on editions 2015, 2018 or 2021 whose MSRV can move to 1.85 or later.
- **When not to apply / counterpoints:**
  - An edition bump raises the MSRV to 1.85.
  - Simplifying the conservative `match` rewrites adopts the new drop order, which can change lock hold times.
  - Commit the formatting churn separately.
- **Fix risk:** medium

### T22-F16 — In async code, never hold std or parking_lot guards or RefCell borrows across `.await`; beware futurelock in `tokio::select!`
- **Grade:** A · **Verdict:** VERIFIED. RFD 609 is by David Pacheco (Oxide). The HN discussion was 2025-10-31 with 449 points and 245 comments. The Qin quote on lifetime misunderstanding applies to concurrency bugs in general, not only blocking bugs.
- **Rationale:**
  - Clippy's `await_holding_lock` and `await_holding_refcell_ref` are suspicious-group lints, so they are on by default.
  - Tokio: a sync mutex is fine if contention is low "and the lock is not held across calls to .await".
  - Qin et al. found all the blocking bugs they studied were in safe code.
  - Oxide traced production hangs in Omicron to futurelock.
- **Evidence:**
  - [Clippy source: await_holding_invalid.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/await_holding_invalid.rs) — rust-lang/rust-clippy — official_docs — std and parking_lot mutexes are "not designed to operate in an async context across await points"; known problem: "Will report false positive for explicitly dropped guards (#6446)". `await_holding_lock` is 1.45.0, `await_holding_refcell_ref` 1.49.0, `await_holding_invalid_type` 1.62.0; all suspicious — verified.
  - [Tokio tutorial: Shared state](https://tokio.rs/tokio/tutorial/shared-state) — Tokio project — official_docs — "using a synchronous mutex from within asynchronous code is fine as long as contention remains low and the lock is not held across calls to `.await`"; the recommended pattern locks only inside non-async methods — verified.
  - [Qin et al., PLDI 2020](https://songlh.github.io/paper/rust-study.pdf) — peer_reviewed — "all blocking bugs we studied are in safe code"; "a lot of the concurrency bugs in Rust are caused by programmers' misunderstanding of Rust's (complex) lifetime and safety rules" — verified in the PDF.
  - [RFD 609: Futurelock](https://rfd.shared.oxide.computer/rfd/0609) — David Pacheco, Oxide Computer Company, 2025 — engineering_blog — "A resource owned by Future `A` is required for another Future `B` to proceed, while the Task responsible for both Futures is no longer polling `A`." In omicron#9259, "essentially every incoming HTTP request hung indefinitely". Mitigation: "spawn `future` in a new task. Then use the `JoinHandle` in the `tokio::select!`" — verified.
- **Detect:**
  - The default Clippy run covers `await_holding_lock`, `await_holding_refcell_ref` and `let_underscore_future`.
  - For custom guard types, add `await-holding-invalid-types = [...]` to `clippy.toml`.
  - Manual checks:
    - `grep -rn 'select!' src/`: look for branches that poll a `&mut fut` while another branch awaits a lock, bounded channel or semaphore.
    - In async fns, check that `.lock()`, `.read()` and `.write()` guards are dropped before the next `.await`.
- **Tools:** cargo clippy, `clippy::await_holding_lock`, `clippy::await_holding_refcell_ref`, `clippy::await_holding_invalid_type`, grep.
- **Applies to:** Async Rust (Tokio and similar), especially services with shared state and `select!` loops.
- **When not to apply / counterpoints:**
  - The lint gives false positives on explicitly dropped guards.
  - `tokio::sync::Mutex` can be held across `.await`, but it is slower.
  - Futurelock comes from one organisation's analysis.
  - Narrowing a lock's scope changes atomicity and can introduce races.
- **Fix risk:** medium

### T22-F19 — Enforce rustfmt in CI, pin `style_edition`, and commit formatting separately
- **Grade:** A · **Verdict:** CORRECTED.
  - ANSSI DENV-FORMAT is a SHOULD ("The tool `rustfmt` SHOULD be used"), not a requirement.
  - The rustfmt style-edition quote "will cause diffs" was invented (see F15). The real concern the page states is that editor format-on-save and CI must agree: editors running `rustfmt` directly default to the 2015 edition, while `cargo fmt` uses the edition from `Cargo.toml`.
- **Rationale:**
  - The Rust Style Guide defines the default style (4-space indent, 100-character max width, block indent) for productivity, consistency and comprehension.
  - ANSSI recommends rustfmt.
  - Pinning `style_edition` keeps editors and CI consistent.
- **Evidence:**
  - [The Rust Style Guide](https://doc.rust-lang.org/style-guide/index.html) — Rust Project (style team) — standard — "Each indentation level must be 4 spaces"; "Maximum line width: 100 characters"; block indent is preferred. Motivation: productivity, consistency, comprehension — verified.
  - [Edition guide: Rustfmt style edition](https://doc.rust-lang.org/edition-guide/rust-2024/rustfmt-style-edition.html) — Rust Project — official_docs — `style_edition = "2024"` in `rustfmt.toml`; "strongly encouraged to add a `rustfmt.toml` file to their project that includes the corresponding `style_edition`" — verified (quote corrected).
  - [Secure Rust Guidelines: devenv (DENV-FORMAT)](https://anssi-fr.github.io/rust-guide/devenv.html) — ANSSI, undated — standard — "The tool `rustfmt` SHOULD be used to ensure that the codebase respects style guidelines." — verified; corrected from "requires".
- **Detect:**
  - `cargo fmt --all -- --check` (non-zero exit means unformatted).
  - `ls rustfmt.toml .rustfmt.toml` and check `style_edition` matches the crate edition.
  - Use `.git-blame-ignore-revs` for the formatting commit.
- **Tools:** rustfmt, cargo fmt.
- **Applies to:** All Rust code.
- **When not to apply / counterpoints:**
  - Many non-default rustfmt options are nightly-only and fragment the style.
  - Mass reformatting pollutes blame unless it is listed in ignore-revs.
- **Fix risk:** low

### T22-F22 — Document failure modes on public APIs (`# Errors`, `# Panics`, `# Safety`); doc examples use `?`
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - API Guidelines: C-FAILURE and C-QUESTION-MARK.
  - Clippy implements these checks (`missing_errors_doc` and `missing_panics_doc` are pedantic; `missing_safety_doc` is style, so on by default).
  - After a panic-to-`Result` pass (F04), the docs must match the new behaviour.
- **Evidence:**
  - [Rust API Guidelines: Checklist](https://rust-lang.github.io/api-guidelines/checklist.html) — Rust Library Team — official_docs — "C-FAILURE: Function docs include error, panic, and safety considerations"; "C-QUESTION-MARK: Examples use `?`, not `try!`, not `unwrap`" — verified.
  - [Clippy source: doc/mod.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/doc/mod.rs) — rust-lang/rust-clippy — official_docs — `missing_panics_doc` (pedantic, 1.51.0): "Documenting the scenarios in which panicking occurs can help callers who do not want to panic to avoid those situations." `missing_errors_doc` is pedantic, 1.41.0; `missing_safety_doc` is style, 1.39.0 — verified.
  - [Clippy lint configuration: check-private-items](https://doc.rust-lang.org/clippy/lint_configuration.html) — rust-lang/rust-clippy — official_docs — "Whether to also run the listed lints on private items." Default `false`; it covers `missing_errors_doc`, `missing_panics_doc`, `missing_safety_doc` and `unnecessary_safety_doc` — verified.
- **Detect:**
  - `cargo clippy -- -W clippy::missing_errors_doc -W clippy::missing_panics_doc`.
  - `grep -rnE '^\s*///.*\.unwrap\(\)' src/`.
  - `cargo test --doc`.
- **Tools:** cargo clippy, `clippy::missing_errors_doc`, `clippy::missing_panics_doc`, `clippy::missing_safety_doc`, `cargo test --doc`.
- **Applies to:** Library crates and internal APIs shared between modules or teams.
- **When not to apply / counterpoints:**
  - `missing_panics_doc` can fire on panics that cannot happen in practice.
  - Microsoft M-NO-META-DESIGN-DOCUMENTATION: document end-state behaviour, not creation history.
- **Fix risk:** low

### T22-F23 — Review every automatic fix: clean tree, one lint family per commit, full tests across features
- **Grade:** A · **Verdict:** CORRECTED. The practitioner support is one person's report, not "practitioners report". The 90% figure is about issues hit when rebuilding old projects on new toolchains, not general lint debt. The garbled detection step was rewritten.
- **Rationale:**
  - ANSSI DENV-AUTOFIX says any automatic fix "MUST be verified by the developer".
  - Clippy's `--fix` implies `--all-targets`, so it rewrites tests too.
  - The edition guide asks for review of the `if let` rewrites.
  - One practitioner reports `cargo clippy --fix` resolved about 90% of issues when rebuilding older projects on newer toolchains.
- **Evidence:**
  - [Secure Rust Guidelines: DENV-AUTOFIX](https://anssi-fr.github.io/rust-guide/devenv.html) — ANSSI, undated — standard — "In a secure Rust development, any automatic fix (for instance, provided by `rustfix` or `clippy`) MUST be verified by the developer." — verified.
  - [Clippy book: Usage](https://doc.rust-lang.org/clippy/usage.html) — rust-lang/rust-clippy — official_docs — "Note that `--fix` implies `--all-targets`, so it can fix as much code as it can." — verified.
  - [HN comment by mmastrac](https://news.ycombinator.com/item?id=41220852) — mmastrac, 2024-08 — practitioner_forum — "I've had a great deal of luck rebuilding older projects. You can lock your toolchain as an added protection, but `cargo clippy --fix` is often enough to fix 90% of those." — verified (full text via the Firebase API).
- **Detect:**
  - `git status --porcelain` must be empty. Never use `--allow-dirty` or `--allow-no-vcs`.
  - For each lint: `cargo clippy --fix -- -W clippy::<one_lint>`, then `git diff --stat`, `cargo test --workspace --all-features`, and one commit.
  - For edition fixes: `git diff | grep -nE '^\+.*(match|unsafe \{)'`.
- **Tools:** `cargo clippy --fix`, `cargo fix`, git.
- **Applies to:** Every automated step of the hardening pass.
- **When not to apply / counterpoints:**
  - Reviewing large mechanical diffs costs real time. Style-only fixes (for example `uninlined_format_args`) can be batched.
  - Fixes apply to one cfg/feature configuration per run.
- **Fix risk:** medium

### T22-F24 — Remove Deref-based "inheritance"; only smart pointers implement Deref/DerefMut
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - The Design Patterns book calls Deref polymorphism "a surprising idiom". It gives no true subtyping, no trait inheritance and no privacy.
  - API Guidelines C-DEREF limits Deref to smart pointers.
- **Evidence:**
  - [Rust Design Patterns: Deref polymorphism](https://rust-unofficial.github.io/patterns/anti_patterns/deref.html) — rust-unofficial/patterns — book — "Most importantly this is a surprising idiom - future programmers reading this in code will not expect this to happen." The alternatives are traits, facade methods, or the delegate/ambassador crates — verified.
  - [Rust API Guidelines: Checklist](https://rust-lang.github.io/api-guidelines/checklist.html) — Rust Library Team — official_docs — "C-DEREF: Only smart pointers implement `Deref` and `DerefMut`"; "C-SMART-PTR: Smart pointers do not add inherent methods" — verified.
- **Detect:** `grep -rnE 'impl(<[^>]*>)? *((std|core)::ops::)?Deref(Mut)? for' src/`, then check that each target is a pointer or a transparent newtype. ast-grep pattern: `impl Deref for $T { $$$ }`.
- **Tools:** grep, ast-grep.
- **Applies to:** Crates with struct-composition hierarchies, often code ported from OO languages (Microsoft M-RUST-SHAPED).
- **When not to apply / counterpoints:**
  - A newtype that intentionally exposes its whole inner API is accepted practice.
  - Removing a public Deref impl is a major semver break.
- **Fix risk:** high

### T22-F12 — Remove unused dependencies using at least two differently-working tools plus a manual check; beware feature-only dependencies; replace crates std has absorbed
- **Grade:** B · **Verdict:** CORRECTED.
  - rustc `unused_crate_dependencies` false positives: the documented example is a package-level dependency used only by the binary being flagged in the library. It does not say "tests and benches".
  - `OnceLock` is std since 1.70 and `LazyLock` since 1.80, not both 1.80.
  - The claim that cargo-udeps "does not work anymore" is a competitor's README statement and is unverified. The cargo-udeps repo was still receiving pushes in April 2026.
- **Rationale:** The tools trade precision for speed:
  - cargo-machete is "fast (yet imprecise)".
  - cargo-udeps needs nightly and cannot check doctest-only dependencies.
  - cargo-shear uses rust-analyzer's parser and can `--fix`.
  - Cargo unifies features across the dependency graph, so removing a dependency that only enabled a feature can change behaviour silently.
- **Evidence:**
  - [cargo-machete README](https://github.com/bnjbvr/cargo-machete) — bnjbvr — official_docs — "fast (yet imprecise)"; `[package.metadata.cargo-machete] ignored = ["prost"]`; `--with-metadata` "will call `cargo metadata --all-features`" and "This may modify the `Cargo.lock` files" — verified.
  - [cargo-udeps README](https://github.com/est31/cargo-udeps) — est31 — official_docs — "needs Rust nightly to actually run"; doctest-only dependencies cannot be checked; `[package.metadata.cargo-udeps.ignore]` — verified. Not archived; last push 2026-04-29.
  - [cargo-shear README](https://github.com/Boshen/cargo-shear) — Boshen — official_docs — uses `ra_ap_syntax`; `--fix`; `--expand` (nightly). It says cargo-machete "does not detect all usages of a dependency" and cargo-udeps "does not seem to work anymore with the latest versions of cargo" — verified that the README says this, not that the claim is true.
  - [rustc allowed-by-default lints: unused_crate_dependencies](https://doc.rust-lang.org/rustc/lints/listing/allowed-by-default.html) — Rust Project — official_docs — "This lint is 'allow' by default because it can provide false positives depending on how the build system is configured ... If there is a dependency that is only used in the binary, but not the library, then the lint will be incorrectly issued in the library." — verified; corrected.
  - [Effective Rust, Item 25: Manage your dependency graph](https://effective-rust.com/dep-graph.html) — David Drysdale, 2024 — book — "The features that get activated for a dependent crate are the _union_ of the features selected by different places in the dependency graph."; `cargo tree --duplicates` — verified.
  - [Announcing Rust 1.80.0](https://blog.rust-lang.org/2024/07/25/Rust-1.80.0/) — Rust Release Team, 2024-07-25 — official_docs — "This completes the stabilization of functionality adopted into the standard library from the popular `lazy_static` and `once_cell` crates." `OnceCell`/`OnceLock` were stabilised in 1.70. Clippy `non_std_lazy_statics` is pedantic, 1.86.0, and "will not trigger ... with MSRV < 1.80.0" — verified (lint source grep).
- **Detect:**
  - Run `cargo machete --with-metadata` and `cargo shear` (then `cargo shear --fix` on a clean tree). Optionally run `cargo +nightly udeps --all-targets --all-features`.
  - Treat the intersection as high-confidence candidates.
  - For each candidate, grep for the crate name (`-` replaced by `_`) in `src/`, `build.rs`, `benches/`, `examples/` and macros.
  - Run `cargo tree -e features -i <crate>` to see whether the dependency only enables features.
  - After removal, rebuild all targets and features and run all tests.
  - Modernise with `-W clippy::non_std_lazy_statics`.
- **Tools:** cargo-machete, cargo-shear, cargo-udeps, rustc `unused_crate_dependencies`, cargo tree, `clippy::non_std_lazy_statics`.
- **Applies to:** All Cargo projects; most valuable in workspaces and long-lived applications.
- **When not to apply / counterpoints:**
  - The tools disagree, and each has documented false positives. Dependencies used by build scripts, macros or doctests, or kept for feature unification or version pinning, are common false positives.
  - Microsoft M-STATIC-VERIFICATION still lists cargo-udeps, while cargo-shear says it no longer works. Neither claim was tested on cargo 1.98.
- **Fix risk:** medium

### T22-F17 — Performance hardening is measured and stays safe
- **Grade:** B · **Verdict:** CORRECTED. "A default Clippy run does not find these clones" was overstated. The default groups include `clone_on_copy` (complexity) and `unnecessary_to_owned` (perf), which catch *some* unnecessary clones, and the Design Patterns book says Clippy "will detect some cases". The general `redundant_clone` analysis is nursery and conservative. `needless_collect` is also nursery.
- **Rationale:**
  - The Rust Performance Book: "benchmarking is required to confirm that an optimization is effective"; "Benchmark all changes, one at a time".
  - Microsoft reports "up to 25%" gains from mimalloc and "~15%" from fixing String issues on hot paths. These are measured, program-specific results.
  - A fast non-cryptographic hasher is acceptable only for trusted keys.
- **Evidence:**
  - [Rust Performance Book: Heap allocations](https://nnethercote.github.io/perf-book/heap-allocations.html) — Nicholas Nethercote et al. — book — "If you know the minimum or exact size of a vector, you can reserve a specific capacity with `Vec::with_capacity`"; it recommends reusing a "workhorse" collection; "As always, benchmarking is required to confirm that an optimization is effective." — verified.
  - [Rust Performance Book: Build configuration](https://nnethercote.github.io/perf-book/build-configuration.html) — Nicholas Nethercote et al. — book — `panic = "abort"` only "if your program doesn't use `catch_unwind`"; allocators: "The exact effect will depend on the individual program and the alternative allocator chosen."; "Benchmark all changes, one at a time" — verified.
  - [Rust Performance Book: Linting](https://nnethercote.github.io/perf-book/linting.html) — book — `ptr_arg` suggests slices; `disallowed-types = ['std::collections::HashMap', 'std::collections::HashSet']` — verified.
  - [Clippy source: redundant_clone.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/redundant_clone.rs) — rust-lang/rust-clippy — official_docs — "Checks for a redundant `clone()` (and its relatives) which clones an owned value that is going to be dropped without further use."; "False-negatives: analysis performed by this lint is conservative and limited." Nursery, 1.32.0 — verified. Also: `clone_on_copy` is complexity, `unnecessary_to_owned` perf, `clone_on_ref_ptr` restriction, `needless_collect` nursery.
  - [Rust Design Patterns: Clone to satisfy the borrow checker](https://rust-unofficial.github.io/patterns/anti_patterns/borrow_clone.html) — book — "Using `.clone()` causes a copy of the data to be made. Any changes between the two are not synchronized"; cloning is acceptable in prototypes and when there are no great speed or memory constraints; "cargo clippy ... will detect some cases in which `.clone()` is not necessary" — verified.
  - [Pragmatic Rust Guidelines 2026.6: Performance](https://microsoft.github.io/rust-guidelines/guidelines/performance/index.html) and [Applications](https://microsoft.github.io/rust-guidelines/guidelines/apps/) — Microsoft, 2026 — industry_report — verified:
    - M-HOTPATH: "~15% benchmark gains on hot paths where only some of these `String` problems were addressed".
    - M-INITIAL-CAPACITY: use `with_capacity`.
    - M-FAST-HASHER: "When hashing trusted, internal keys, prefer a fast non-cryptographic hasher (e.g., `foldhash`, `FxHash`)".
    - M-MIMALLOC-APPS: "we have seen up to 25% benchmark improvements".
- **Detect:**
  - The default Clippy run covers perf, style (`ptr_arg`) and complexity (`clone_on_copy`).
  - Audit run: `cargo clippy -- -W clippy::redundant_clone -W clippy::clone_on_ref_ptr -W clippy::needless_collect`.
  - Look for `Vec::new()` next to loops with a known bound.
  - Benchmark (criterion or divan) and profile (flamegraph) before and after. Record the numbers.
- **Tools:** cargo clippy, `clippy::perf`, `clippy::redundant_clone`, `clippy::clone_on_ref_ptr`, `clippy::ptr_arg`, `clippy::disallowed_types`, criterion, divan, cargo flamegraph.
- **Applies to:** Hot paths identified by profiling.
- **When not to apply / counterpoints:**
  - Cloning is fine outside hot paths (an `Arc` clone is cheap).
  - Microsoft's blanket mimalloc advice conflicts with the Performance Book's "depends on the program".
  - A fast hasher on attacker-controlled keys brings back HashDoS.
  - `panic = "abort"` breaks `catch_unwind` isolation.
- **Fix risk:** medium

### T22-F18 — Do not gate on `cognitive_complexity`; use the configurable size and nesting lints as refactoring hints
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - Clippy keeps `cognitive_complexity` in restriction "so as to not mislead users into using this lint as a measurement tool".
  - The remaining size and nesting lints are simple proxies. Their defaults are conventions, not empirically derived thresholds.
- **Evidence:**
  - [Clippy source: cognitive_complexity.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/cognitive_complexity.rs) — rust-lang/rust-clippy — official_docs — "We used to think it measured how hard a method is to understand."; "The true Cognitive Complexity of a method is not something we can calculate using modern technology. This lint has been left in `restriction` so as to not mislead users into using this lint as a measurement tool." (rust-clippy#3793). Restriction, 1.35.0 — verified.
  - [Clippy lint configuration](https://doc.rust-lang.org/clippy/lint_configuration.html) — official_docs — defaults: `too-many-lines-threshold` 100, `too-many-arguments-threshold` 7, `type-complexity-threshold` 250, `excessive-nesting-threshold` 0, `cognitive-complexity-threshold` 25 — verified.
  - [Clippy source: functions/mod.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/functions/mod.rs) and [excessive_nesting.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/excessive_nesting.rs) — official_docs — verified:
    - `too_many_arguments`: complexity, pre-1.29.
    - `too_many_lines`: pedantic, 1.34.0.
    - `excessive_nesting` (complexity, 1.72.0): "It can severely hinder readability."; "Even though this lint is warn-by-default, it will only trigger if a maximum nesting level is defined in the clippy.toml file."
    - `type_complexity`: complexity.
- **Detect:**
  - In `clippy.toml`, set `too-many-lines-threshold` and `excessive-nesting-threshold` (for example 4; it must be set explicitly).
  - Run `cargo clippy -- -W clippy::too_many_lines -W clippy::excessive_nesting`.
  - Flag any `cognitive_complexity` gate in CI.
- **Tools:** cargo clippy, `clippy::too_many_lines`, `clippy::too_many_arguments`, `clippy::type_complexity`, `clippy::excessive_nesting`.
- **Applies to:** Any codebase; most useful for large functions in finished projects.
- **When not to apply / counterpoints:**
  - Long exhaustive `match` statements are often clearer than splitting them.
  - Thresholds are arbitrary.
  - Extracting functions can change borrow scopes and drop order, so refactors need tests.
- **Fix risk:** medium

### T22-F20 — For libraries, treat the public API as behaviour: semver-checks, `avoid-breaking-exported-api`, a single item path, Debug everywhere, private fields, sealed traits
- **Grade:** B · **Verdict:** CORRECTED.
  - The M-SINGLE-ITEM-PATH "quote" was a paraphrase. The real text: "This rule is often violated by agents creating or refactoring large code bases over several iterations. In an attempt to simplify their task, they re-export items under multiple paths."
  - `avoid-breaking-exported-api` gates 19 lints in current Clippy source; the docs say 18.
  - M-PUBLIC-DEBUG is a Universal guideline, not part of the AI section.
- **Rationale:**
  - 17.2% of the top 1,000 crates violated semver at least once, mostly through changes to exhaustive types, removals and lost auto-trait impls.
  - cargo-semver-checks catches many breaks but not type, generic or lifetime changes, or feature-subset changes.
  - Clippy suppresses API-changing suggestions by default for exported items.
  - Microsoft notes agents re-export items under several paths.
- **Evidence:**
  - [cargo-semver-checks README](https://github.com/obi1kenobi/cargo-semver-checks) — Predrag Gruevski — official_docs — "Lint your crate API changes for semver violations." It cannot yet catch breaking type changes, generics or lifetime changes, or changes limited to some feature combinations. Exit code `100` means deny-level violations; `--baseline-rev` is supported — verified.
  - [Semver violations are common](https://predr.ag/blog/semver-violations-are-common-better-tooling-is-the-answer/) — Nowak, Gruevski et al., 2023-09-07 — engineering_blog — "More than 1 in 6 crates violated semver at least once"; "Around 1 in 31 releases had at least one semver violation" — verified.
  - [Clippy lint configuration: avoid-breaking-exported-api](https://doc.rust-lang.org/clippy/lint_configuration.html) — official_docs — "Suppress lints whenever the suggested change would cause breakage for other crates." Default `true`. Current source lists 19 lints, including `enum_variant_names`, `upper_case_acronyms`, `box_collection` and `wrong_self_convention` — verified (count corrected).
  - [Pragmatic Rust Guidelines 2026.6: AI (M-SINGLE-ITEM-PATH)](https://microsoft.github.io/rust-guidelines/guidelines/ai/index.html) and [Universal (M-PUBLIC-DEBUG)](https://microsoft.github.io/rust-guidelines/guidelines/universal/) — Microsoft, 2026 — industry_report — "Public items within a crate should be reachable only through one path." (quote as corrected); "All public types exposed by a crate should implement `Debug`" — verified.
  - [Rust API Guidelines: Checklist](https://rust-lang.github.io/api-guidelines/checklist.html) — official_docs — C-DEBUG "All public types implement `Debug`"; C-STRUCT-PRIVATE "Structs have private fields"; C-SEALED "Sealed traits protect against downstream implementations"; C-SEND-SYNC "Types are `Send` and `Sync` where possible" — verified.
- **Detect:**
  - `cargo semver-checks` (baseline: the crates.io version or `--baseline-rev`).
  - `[lints.rust] missing_debug_implementations = "warn"`.
  - `grep -rn '^pub use' src/`, compared against module paths.
  - Check `clippy.toml` for `avoid-breaking-exported-api = false`.
  - Compare the `cargo doc` output before and after the pass.
- **Tools:** cargo-semver-checks, rustc `missing_debug_implementations`, Clippy's `avoid-breaking-exported-api`, cargo doc.
- **Applies to:** Published libraries and internal crates consumed by other teams or services. Binaries are exempt.
- **When not to apply / counterpoints:**
  - semver-checks has blind spots.
  - `missing_debug_implementations` is allow-by-default "because adding `Debug` to all types can have a negative impact on compile time and code size".
  - Removing duplicate re-export paths is itself a breaking change.
- **Fix risk:** high

### T22-F21 — Measure test effectiveness: mutation testing, coverage, removing tautological tests, Miri, Kani
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - cargo-mutants reports each mutant as missed, caught, unviable or timeout. It advises behaviour-level tests through public interfaces.
  - Microsoft M-TAUTOLOGICAL-TESTS flags tests that "pass by construction". Microsoft notes agents often produce them.
  - Kani proves the absence of panics with bounded model checking. It runs over 16,000 harnesses per change in the std verification campaign.
- **Evidence:**
  - [cargo-mutants: Using the results](https://mutants.rs/using-results.html) — Martin Pool — official_docs — "Missed: No test failed with this mutation applied, which seems to indicate a gap in test coverage."; it advises tests that "assert the _correct_ behavior at the right level of abstraction, preferably through a public interface"; `#[mutants::skip]` — verified. The repo is active (last push 2026-09-22).
  - [cargo-llvm-cov README](https://github.com/taiki-e/cargo-llvm-cov) — taiki-e — official_docs — `--html` and `--fail-under-lines <MIN>`; "Support for branch coverage is unstable"; "Support for doc tests is unstable and has known issues" — verified.
  - [Pragmatic Rust Guidelines 2026.6: M-TAUTOLOGICAL-TESTS](https://microsoft.github.io/rust-guidelines/guidelines/ai/index.html) — Microsoft, 2026 — industry_report — "Unit tests should verify meaningful behavior instead of repeating foundational definitions." Such tests "pass by construction, provide virtually no value, but increase the noise floor of subsequent changes." — verified.
  - [Kani: A Model Checker for Rust (arXiv 2607.01504)](https://arxiv.org/abs/2607.01504) — Delmas, Hassan, Hu, Kumar, Monteiro, Nguyen, Palacios, Val, Tautschnig, Adam, Schwartz-Narbonne, Zech, submitted 2026-07-01 — preprint — "the soundness of unsafe operations ... and absence of runtime panics"; "uncovering six previously unknown bugs"; "over 16,000 harnesses verified per code change in the Rust standard library verification campaign" — verified in the abstract.
- **Detect:**
  - `cargo mutants --in-diff <diff>` for a scoped run, or `cargo mutants -p <crate>`. Read `mutants.out/missed.txt`.
  - `cargo llvm-cov --workspace --html`.
  - Heuristic grep for self-comparing asserts.
  - `cargo +nightly miri test` for modules with unsafe code.
  - `cargo kani` for `#[kani::proof]` harnesses.
- **Tools:** cargo-mutants, cargo-llvm-cov, Miri, Kani, cargo nextest.
- **Applies to:** Projects whose tests are the safety net for the hardening pass. Run this before other refactors.
- **When not to apply / counterpoints:**
  - Mutation testing is slow on large crates, and equivalent mutants create unavoidable "missed" results.
  - Coverage percentages are easy to game.
  - Kani and Miri need extra setup or nightly and only cover bounded or executed paths.
- **Fix risk:** low

## Practitioner voice

- [Cloudflare outage on November 18, 2025](https://blog.cloudflare.com/18-november-2025-outage/) — One `Result::unwrap()` in the FL2 Rust proxy panicked when a generated feature file exceeded a 200-feature limit. Core traffic was affected 11:28–14:30 UTC, with full recovery at 17:06. The remediation treats internally generated config like user input.
- [HN 45981773 (empath75)](https://news.ycombinator.com/item?id=45981773) — "We flag unwrap/expect usage in lints and have limited it to just server startup where we want the server to crash if a file is missing".
- [HN 45994308 (burntsushi)](https://news.ycombinator.com/item?id=45994308) — "If you're using `slice[i]`, then you're using `unwrap()`"; "You use `unwrap()` when you know the failure cannot happen." He calls the no-unwrap position "de facto extreme".
- [HN 45996159 (frumplestlatz)](https://news.ycombinator.com/item?id=45996159) — "Using unwrap is assuming humans won't get human-enforced invariants wrong. They will. They did here." The author says they work in formal verification of crypto systems. (Corrected: the earlier gist added "invariants should be encoded in types", which the comment does not say.)
- [HN 43976280 (evrimoztamur)](https://news.ycombinator.com/item?id=43976280) — Deny-level `unwrap_used`, `expect_used`, `panic`, `indexing_slicing` and others "got me 90% of the way out" of panics in a real-time game, but 300+ `as` numeric conversions remained.
- [HN 49657693 (JoshTriplett, Rust language team member)](https://news.ycombinator.com/item?id=49657693) — Do not turn on all of `clippy::pedantic` as a unit; some lints are far more valuable than others.
- [HN 49652589 (eru)](https://news.ycombinator.com/item?id=49652589) — AI agents produce better Rust than Python partly because you can tell them to make Clippy, or even `clippy::pedantic`, happy.
- [HN 36339127 (bryanlarsen)](https://news.ycombinator.com/item?id=36339127) — "I wouldn't recommend running pedantic clippy in CI, but it is useful to run it against your app occasionally."
- [HN 31608233 (epage, Cargo team)](https://news.ycombinator.com/item?id=31608233) — The community shifted away from in-source `#![deny(warnings)]`. The literal words are "disabling warnings in CI", evidently meaning denying them in CI.
- [HN 48421662 (duttish)](https://news.ycombinator.com/item?id=48421662) — An experienced developer reports that Claude "often just silences errors and warnings instead of actually fixing the problem" and adds `allow(dead_code)` despite a CLAUDE.md forbidding it. This is a single anecdote.
- [HN 26195035 (zvrba)](https://news.ycombinator.com/item?id=26195035) — As executables grow, "executable" code becomes "library" code, which breaks the thiserror/anyhow rule of thumb.
- [HN 46156052 (nu11ptr)](https://news.ycombinator.com/item?id=46156052) — "I don't think `thiserror` and `anyhow` with their libraries vs applications distinction makes a lot of sense. I find my programs (typically API servers) need the the equivalent of `anyhow` + `thiserror`".
- [Rust dependencies scare me (vincents.dev, May 2025)](https://vincents.dev/blog/rust-dependencies-scare-me/) — 9 direct dependencies vendored to about 3.6M lines against about 1,000 of the author's own lines. Triggered by RUSTSEC-2021-0141 (dotenv unmaintained).
- [SafeDep: arrayref / proc-macro1 (Aug 2026)](https://safedep.io/arrayref-proc-macro1-rust-build-time-malware/) — A compromised maintainer account published `arrayref` 0.3.10, which pulled in the typosquatted `proc-macro1`, whose build script downloads and runs a payload.
- [HN 49376247 (praseodym)](https://news.ycombinator.com/item?id=49376247) — In the arrayref discussion: "cargo-deny can audit build scripts, but unfortunately not prevent execution of malicious build scripts".
- [Oxide RFD 609: Futurelock](https://rfd.shared.oxide.computer/rfd/0609) — A `tokio::select!` pattern made "essentially every incoming HTTP request hung indefinitely" (omicron#9259). The mitigation is to spawn the future and select on its `JoinHandle`.
- [HN 41220852 (mmastrac)](https://news.ycombinator.com/item?id=41220852) — `cargo clippy --fix` "is often enough to fix 90%" of issues when rebuilding older projects on newer toolchains.
- [Google: Rust in Android (Nov 2025)](https://blog.google/security/rust-in-android-move-fast-fix-things/) — The primary concern "centers on the approximately 4% of code written within unsafe{} blocks". Google avoided shipping its very first Rust memory-safety vulnerability (CVE-2025-48530 in CrabbyAVIF; presumably unsafe code, though the post does not say so) and responded with more unsafe-specific training, not a ban.

## Contradictions and open questions

**Contradictions:**
- **unwrap/expect.** ANSSI LANG-LIMIT-PANIC ("MUST NOT panic UNLESS its usage conditions have been violated") and several practitioners in the Cloudflare thread favour lint-enforced bans. BurntSushi argues unwrap on runtime invariants is idiomatic and blanket lints add noise. Microsoft M-PANIC-ON-BUG requires a panic on contract violations. Classifying each site by whether its failure depends on external data is an inference, not a sourced consensus.
- **Pedantic group.** Microsoft 2026.6 enables all of pedantic at warn. Effective Rust Item 29 suggests only reading the non-default groups. JoshTriplett, a lang-team member, advises against pedantic as a unit. Clippy calls pedantic production-ready but expects many `#[allow]`s.
- **Cargo.lock for libraries.** ANSSI DENV-CARGO-LOCK says MUST. The Cargo FAQ says it "is dependent on the needs of your package" and that `Cargo.lock` "does not affect the consumers of your package". Effective Rust Item 25 says library crates "should _not_ commit a _Cargo.lock_ file".
- **Error type shape.** The API Guidelines and thiserror practice commonly use enums. Microsoft M-ERRORS-CANONICAL-STRUCTS recommends situation-specific structs with `Backtrace` and `is_xxx()` methods, with any `ErrorKind` kept private. Practitioners (zvrba, nu11ptr) dispute the library/application split.
- **cargo-udeps.** Microsoft M-STATIC-VERIFICATION lists it. cargo-shear's README says it "does not seem to work anymore with the latest versions of cargo". The udeps repo was still receiving pushes in April 2026. Neither claim was tested on cargo 1.98.
- **Cloning.** The Design Patterns book treats clone-to-satisfy-the-borrow-checker as an anti-pattern and says Clippy "will detect some cases". Default Clippy catches only some (for example `clone_on_copy`, `unnecessary_to_owned`); the general `redundant_clone` is nursery and conservative. Many practitioners accept cloning outside hot paths.
- **Allocators.** Microsoft M-MIMALLOC-APPS says applications "should" use mimalloc ("up to 25%"). The Performance Book says the effect "will depend on the individual program" and every change must be benchmarked.
- **`#![deny(warnings)]`.** The Design Patterns book lists it as an anti-pattern but offers an explicit deny list that contains removed lints (`const_err`, `private_in_public`). Clippy's CI docs recommend `-Dwarnings` on the command line or in `RUSTFLAGS`, which resolves the conflict.

**Open questions:**
- No peer-reviewed study shows that restriction lints (`unwrap_used`, `indexing_slicing`, `arithmetic_side_effects`) reduce production incidents. The evidence is one major incident (Cloudflare 2025) plus anecdotes.
- Clippy's threshold defaults (100 lines, 7 arguments, type complexity 250) are conventions with no Rust-specific empirical validation. The maintainers explicitly reject `cognitive_complexity` as a measure.
- Is cargo-udeps functional on cargo 1.98? Unverified.
- Rudra was archived on 2026-04-02. `clippy::non_send_fields_in_send_ty` (nursery, heuristic) covers part of Send/Sync variance. No maintained tool covers Rudra's panic-safety or higher-order-invariant checks.
- The Safety-Critical Rust Coding Guidelines are v0.1. Only guideline titles were read; category and decidability were not shown.
- The ANSSI guide has no version or date and is labelled "(unstable)". Rule IDs and key sentences were checked verbatim on the errors, integer, devenv and checklist pages in this pass.
- The Cloudflare postmortem shows the offending code as an image; only the panic message is extractable.
- Practitioner voice comes from HN, engineering blogs and incident reports. Reddit, Lobsters and the Rust Users Forum were not covered.
- Futurelock (Oxide RFD 609) is a single-organisation analysis. No lint or tool is known to detect it.
- The arXiv papers used (Clippy warning density 2023, PanicFI 2024, Kani 2026) are preprints. Peer-reviewed status was not checked.

## Dropped findings

None. All 24 findings survived verification: 11 VERIFIED and 13 CORRECTED. No practitioner-voice URL was dropped; one gist (45996159) was corrected.
