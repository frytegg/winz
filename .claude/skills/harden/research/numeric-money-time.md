# Numeric precision, money, token amounts and time correctness across TS, Python, Rust, C++ and Solidity
> Code G103 · slug numeric-money-time · verified 2026-09-23 · counts: verified 11 / corrected 10 / downgraded 0 / dropped 0

## Summary

Numeric and time errors usually produce wrong values rather than crashes, so tests and generic linters rarely catch them.
- **Numerical libraries.** Di Franco et al. (ASE 2017) studied 269 real numerical bugs in NumPy, SciPy, LAPACK, GSL and Elemental. 77% showed up as wrong results, and only 4% could be detected with simple patterns. The same authors note that numerical bugs "are not as numerous in general-purpose applications", which is why they studied libraries. Applying these numbers to application or bot code is an extrapolation.
- **Python date/time.** The MSR 2025 study of 151 date/time bugs (ACM SIGSOFT Distinguished Paper) found:
  - 53.6% involved time zones;
  - 58.9% came from constructing the date/time value;
  - 27.8% came from misusing naive datetimes;
  - 82% were confined to a single function.

**On-chain incidents.** Rounding direction and precision loss caused some of the largest DeFi exploits of 2023-2025.
- **Balancer v2, 3 Nov 2025.** `_upscale` always rounded down with `mulDown`. The source comment says the impact "is expected to be minimal". The loss was amplified through `batchSwap`. Reported losses range from "more than $100M" (Trail of Bits) through "exceeding $120M" (OpenZeppelin) to $128.64M (Check Point).
- **KyberSwap Elastic, 23 Nov 2023.** `mulDivFloor` was used where the design called for rounding up, combined with a missed tick-crossing check. Over $48M was lost.
- **Hundred Finance, 15 Apr 2023.** A donation into an empty market was combined with a rounding error in `redeemUnderlying`. $7.4M was lost.

**Off-chain bugs from 2026.** Exchange SDKs and core libraries still ship float and ID precision bugs:
- **Gate.io community SDK** (sieblyio/gateio-api): order IDs lost precision, so orders could not be cancelled. The issue is still open.
- **viem `parseUnits`:** rounded through a JS float in versions up to and including 2.55.3. The fix was PR #4859, merged 2026-07-18 and released in 2.55.4.
- **Official binance-connector-python:** serialises float order parameters with `str()`.

**What the rules cover:**
- exact quantities and parsing;
- JS integers above 2^53 and bigint at API boundaries (ethers v6 is strict and viem is lenient);
- token and price-feed decimals;
- rounding direction and order of operations;
- donation and empty-vault attacks;
- overflow and narrowing casts;
- float equality and NaN;
- one rounding policy across ecosystems whose defaults differ;
- Python `Decimal` contexts;
- NumPy 2 dtype changes;
- aware datetimes;
- monotonic clocks;
- epoch units;
- JS Date versus Temporal;
- future local-time events;
- invariant and fuzz testing;
- JSON egress.

**Detection.** Each rule says whether an existing lint detects it, a custom ast-grep or rg pattern is needed, or only review will find it.
- Existing lints: Ruff DTZ/RUF032/PLW0177/NPY201; ESLint no-loss-of-precision, use-isnan and no-compare-neg-zero; Clippy cast_*, arithmetic_side_effects and float_cmp; clang-tidy bugprone-narrowing-conversions and incorrect-roundings; Slither divide-before-multiply; Decurity Semgrep compound-precision-loss.
- The custom rg and ast-grep patterns in this dossier have not been tested. Nobody has measured their precision or recall.

**Fix policy.** Any fix that changes numeric outputs is REPORT-ONLY. It needs characterization tests with golden values and human approval.

**Versions checked (2026-09-23)**

| Item | Version or status |
|---|---|
| CWE | 4.20 |
| OWASP Smart Contract Top 10 | 2025 edition; still the current page |
| Temporal | TC39 Stage 4. Shipped in Firefox 139, Chrome and Edge 144, and Node 26. Safari has it only in Technology Preview (caniuse). Not Baseline (web-features). Node 24.13 has no Temporal (checked locally). |
| JSON.parse source-text access | TC39 Stage 4. Baseline "low" since 2025-03-31: Chrome 114, Firefox 135, Safari 18.4. Node 24.13 supports `context.source` (checked locally). |
| TC39 Decimal | Stage 1 |
| TC39 Amount | Stage 2 |
| ESLint docs | v10.11.0 |
| rust_decimal | 1.43.0 |
| Solidity | docs "latest" build is 0.8.38; latest GitHub release is v0.8.37 |
| NumPy | stable docs are v2.5. Checked locally on NumPy 2.4.3 / win32: the default int is int64, and int32 arrays wrap silently. |
| ethers | 6.17.0 |
| viem | 2.56.8 (latest release) |

## Findings

### G103-F06 — Every rounding in value-moving math has an explicit direction favouring the protocol and is backed by documented, multi-operation invariants; "impact is minimal" comments are findings
- **Grade:** A · **Verdict:** CORRECTED (audit correction: the cited Trail of Bits post says "rounding must favor the protocol" is "no longer sufficient" and "insufficient to capture edge cases" in multi-operation flows, so documented rounding invariants with informal proofs and multi-operation invariant tests are a co-requirement of the rule, not an optional confirmation step.)
  - roundme dates from 2023 (created 2023-11, one release 0.1.0), not 2024.
  - The citation audit found selective citation: the Trail of Bits post cited below twice says the headline rule is not enough on its own. The rule now makes documented invariants and multi-operation invariant tests part of the requirement.
  - The KyberSwap root cause also involved a tick-boundary check, not rounding alone.
  - The Balancer comment is now quoted in full. It shows the authors knew swaps should round in opposite directions.
- **Rule:** Every rounding operation in value-moving math needs an explicit direction that favours the protocol or vault over the caller. This covers deposits, withdrawals, mints, redeems, swaps, fees, interest and liquidations, both on-chain and in off-chain ledgers.
  - Use a helper that takes an explicit Rounding argument, for example OpenZeppelin `Math.mulDiv(x, y, d, Rounding.Ceil)`. This overload exists in OZ Math.sol.
  - Any deliberate exception needs an adversarial bound: the worst-case loss per call multiplied by the number of calls an attacker can make in one transaction.
  - Treat comments that call rounding impact "minimal", "negligible" or "dust" as findings, not justifications.
  - Favouring the protocol per operation is necessary but not sufficient. Also require (a) documented rounding and precision-loss invariants, each with an informal proof, and (b) invariant tests that chain multiple operations in one flow (for example a batch of tiny swaps). A missing invariant or a missing multi-operation test is itself a finding.
  - REPORT-ONLY: changing a rounding direction changes outputs by at least 1 unit.
- **Rationale:**
  - **ERC-4626** prescribes opposite rounding directions so the vault is favoured.
  - **Balancer v2 (3 Nov 2025).** `_upscale` always used `mulDown`, under a comment that concedes swaps would normally round token-in up and token-out down, and calls the impact "expected to be minimal". Errors at balances of 8-9 wei (up to 10% relative loss per operation) were compounded through `batchSwap`. One malicious `batchSwap` contained 65 operations (Check Point).
  - **KyberSwap Elastic (23 Nov 2023, over $48M).** `deltaL` was rounded down through `mulDivFloor` where it should have been rounded up. The attacker used this to push `nextSqrtP` past a tick boundary without triggering a tick cross, which double-counted liquidity.
  - **Per-operation direction is not enough.** Trail of Bits, in the same Balancer analysis: "the simple rule 'rounding must favor the protocol' is no longer sufficient to catch edge cases", and "The canonical invariant 'rounding must favor the protocol' is insufficient to capture edge cases that may occur during a multi-operation user flow." Its recommendation is to document all the invariants pertaining to precision loss and rounding direction. The citation audit reads this as requiring documented invariants with informal proofs plus invariant tests over multi-operation flows, alongside the per-operation direction.
- **Evidence:**
  - [ERC-4626: Tokenized Vaults, Security Considerations](https://eips.ethereum.org/EIPS/eip-4626) — Ethereum EIPs, 2021 — standard — "it is considered most secure to favor the Vault itself during calculations over its users"; round down shares issued and assets returned, round up shares or assets required; `convertTo*` functions MUST round down — confirmed verbatim.
  - [ScalingHelpers.sol (`_upscale`)](https://github.com/balancer/balancer-v2-monorepo/blob/master/pkg/solidity-utils/contracts/helpers/ScalingHelpers.sol) — Balancer — primary source code — "Upscale rounding wouldn't necessarily always go in the same direction: in a swap for example the balance of token in should be rounded up, and that of token out rounded down. This is the only place where we round in the same direction for all amounts, as the impact of this rounding is expected to be minimal." `return FixedPoint.mulDown(amount, scalingFactor);` — confirmed from raw source.
  - [Balancer hack analysis and guidance for the DeFi ecosystem](https://blog.trailofbits.com/2025/11/07/balancer-hack-analysis-and-guidance-for-the-defi-ecosystem/) — Trail of Bits, 2025 — incident report — "more than $100M across nine blockchain networks"; "a rounding direction error"; "DeFi protocols should invest resources into documenting all the invariants pertaining to precision loss and rounding direction."; "the simple rule 'rounding must favor the protocol' is no longer sufficient to catch edge cases"; "The canonical invariant 'rounding must favor the protocol' is insufficient to capture edge cases that may occur during a multi-operation user flow." — confirmed; the last two quotes were added by the citation audit.
  - [How an Attacker Drained $128M from Balancer Through Rounding Error Exploitation](https://research.checkpoint.com/2025/how-an-attacker-drained-128m-from-balancer-through-rounding-error-exploitation/) — Check Point Research, 2025 — incident report — "$128.64 million across six blockchain networks in under 30 minutes"; "When balances are small (8-9 wei range) ... up to 10% precision loss per operation"; names `_upscaleArray`, `mulDown` and `batchSwap` — confirmed.
  - [Understanding the Balancer v2 Exploit](https://www.openzeppelin.com/news/understanding-the-balancer-v2-exploit) — OpenZeppelin, 2025 — incident report — losses "exceeding $120M" across Balancer and forks; "If amounts are orders of magnitude less than scalingFactors ones, the precision loss becomes non-negligible"; ComposableStablePool was added on 20 Sep 2021, after OZ's audit ended on 10 Sep 2021 — confirmed.
  - [KyberSwap Incident: Masterful Exploitation of Rounding Errors](https://blocksec.com/blog/kyberswap-incident-masterful-exploitation-of-rounding-errors-with-exceedingly-subtle-calculations) — BlockSec, 2023 — incident report — "deltaL is mistakenly rounded down due to the use of the mulDivFloor function"; "total loss of over $48 million" on 23 Nov 2023 — confirmed. The root cause also includes the tick-crossing check.
  - [OpenZeppelin Math.sol](https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/master/contracts/utils/math/Math.sol) — OpenZeppelin, 2026 — official code — `enum Rounding { Floor, Ceil, Trunc, Expand }`; `mulDiv(x, y, denominator, Rounding)`; "Calculates floor(x * y / denominator) with full precision. Throws if result overflows a uint256 or denominator == 0" — confirmed.
  - [roundme](https://github.com/crytic/roundme) — Trail of Bits (crytic), 2023 — tool — "roundme is a human-assisted rounding analyzer"; rule: the denominator's rounding direction inverts — confirmed. Not archived, but it has only one release (0.1.0, Nov 2023), so treat it as early-stage.
- **Detect:** Mostly review.
  1. Inventory every rounding site: `rg -n "mulDown|divDown|mulDivDown|mulDivFloor|mulWadDown|divWadDown|Rounding\.(Floor|Trunc)|mulDivUp|mulWadUp|divUp" -g "*.sol"`, plus plain `/` inside value-moving functions.
  2. For each site, write down the intended direction (who benefits). Derive compound formulas with `roundme analyze`.
  3. Search for comments that excuse rounding: `rg -n -i "(round|precision|dust|truncat).{0,80}(minimal|negligible|insignificant|small enough|doesn.t matter)"`.
  4. Check that each value-moving path has documented rounding invariants (with an informal proof) and invariant tests (Echidna, Medusa or Foundry invariant tests) that chain several operations in one flow. This is a co-requirement of the rule, not an optional confirmation: report a missing invariant or a missing multi-operation test as a finding. Example invariants: deposit-then-redeem never returns more than was deposited; repeated tiny swaps in one batch never decrease the pool invariant.
- **Tools:** ripgrep, roundme, Echidna, Medusa, Foundry invariant tests, manual review.
- **Applies to:** Solidity/Vyper, Rust on-chain programs, and off-chain ledgers or fee engines in TS/Python/Rust.
- **When not to apply / counterpoints:**
  1. Always favouring the protocol leaves 1-wei dust and makes exact-output operations fail (for example, "withdraw max"). Those need UX workarounds.
  2. Rounding fixes change results by 1 unit. That breaks integrators with hard-coded expectations, and immutable contracts often cannot take the fix at all. For live contracts, the output is usually a mitigation plus a report.
  3. Off-chain there is no ERC-4626-style standard for rounding direction. The "favour the house" rule is extrapolated to off-chain ledgers.
- **Fix risk:** high

### G103-F01 — Exact quantities must not use binary floating point
- **Grade:** A · **Verdict:** CORRECTED
  - CCXT quote fixed to its exact wording.
  - The Effective Java "slower / less convenient" counterpoint is now attributed to the blog.scaledcode.com summary; the thefinestartist reproduction does not contain it.
  - Di Franco scope clarified: numerical libraries, where accuracy bugs are the least frequent class at 14%.
- **Rule:** Do not store or compute exact quantities in binary floating point (float, double, f32, f64 or JS number). Exact quantities include fiat money, token amounts, order price and quantity, fees, balances and booked PnL.
  - Use either integer minor units with an explicit scale (int, BigInt, i128/u128, uint256), or a decimal type: Python `decimal.Decimal`, Rust `rust_decimal`, or JS big.js, decimal.js or bignumber.js.
  - C++ has no standard decimal type. Use integer minor units or a vetted decimal library. C23 `_Decimal32/64/128` exist only in C, and only when `__STDC_IEC_60559_DFP__` is defined.
  - REPORT-ONLY when converting an existing float path, because outputs change.
- **Rationale:** Most decimal fractions have no exact binary representation. Errors therefore accumulate silently and break the equality invariants that ledgers depend on. Numerical bugs mostly show up as wrong results rather than crashes (77% in Di Franco et al.).
- **Evidence:**
  - [FLP02-C. Avoid using floating-point numbers when precise computation is needed](https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/floating-point-flp/flp02-c) — SEI CERT C — standard — the noncompliant example prints "mean is 10.099999" / "array[0] is not the mean"; the compliant solution stores 1010 for 10.10 — confirmed.
  - [CWE-1339: Insufficient Precision or Accuracy of a Real Number](https://cwe.mitre.org/data/definitions/1339.html) — MITRE, CWE 4.20 — standard — "The product processes a real number with an implementation in which the number's representation does not preserve required accuracy and precision in its fractional part, causing an incorrect result." The mitigations note that moving to software formats makes products slower — confirmed.
  - [decimal — Decimal fixed-point and floating-point arithmetic](https://docs.python.org/3/library/decimal.html) — PSF, Python 3.14.7 docs — official docs — "In decimal floating point, 0.1 + 0.1 + 0.1 - 0.3 is exactly equal to zero. In binary floating point, the result is 5.5511151231257827e-017 ... decimal is preferred in accounting applications which have strict equality invariants." — confirmed verbatim.
  - [Effective Java Item 48 (2nd ed.)](https://thefinestartist.com/effective-java/48) — Joshua Bloch, reproduced by thefinestartist.com — book, confirmed via secondary source — "The float and double types are particularly ill-suited for monetary calculations"; "Use BigDecimal, int, or long for monetary calculations" — confirmed. The 3rd edition's Item 60 numbering was not independently confirmed.
  - [Avoid float and double if exact answers are required](https://blog.scaledcode.com/blog/effective-java/avoid_float_if_need_exact/) — scaledcode (Effective Java summary) — secondary — BigDecimal gives "a lot of power at the cost of speed as well as some additional difficulty ... versus the convenience of an int, long" — confirmed. This is the source for counterpoint (3).
  - [Money (PoEAA catalog)](https://martinfowler.com/eaaCatalog/money.html) — Martin Fowler, 2003 — book catalog page — "Monetary calculations are often rounded to the smallest currency unit. When you do this it's easy to lose pennies ... because of rounding errors." — confirmed.
  - [Supported currencies](https://docs.stripe.com/currencies) — Stripe, 2026 — official docs — "The Stripe API expects currency values using the given denomination's smallest unit represented without decimals. For example, enter 1099 to charge 10.99 USD"; ISK and UGX are zero-decimal but must be sent as two-decimal values ending in 00 — confirmed.
  - [CCXT CONTRIBUTING.md](https://raw.githubusercontent.com/ccxt/ccxt/master/CONTRIBUTING.md) — CCXT maintainers, 2026 — project guidelines — "All new code of all new parsers must be initially written with `Precise` string-based representations"; "The rule of thumb is: `+` is for string concatenation only (!) and ALL arithmetic operations must use `Precise`" — confirmed. The quote was corrected. The unified API can still return floats to users through `parseNumber`.
  - [A Comprehensive Study of Real-World Numerical Bug Characteristics](https://web.cs.ucdavis.edu/~rubio/includes/ase17.pdf) — Di Franco, Guo, Rubio-González (UC Davis), ASE 2017 — peer-reviewed — 269 bugs; "The most common symptom for numerical bugs is wrong results, which is observed in 77% of the bugs"; "very few bugs (4%) can be detected using simple patterns" — confirmed. The scope is numerical libraries, not money code.
  - [C arithmetic types, decimal floating types](https://en.cppreference.com/w/c/language/arithmetic_types) — cppreference — reference — `_Decimal32/64/128` are supported only "If the implementation predefines the macro constant `__STDC_IEC_60559_DFP__`" (since C23) — confirmed.
- **Detect:** No lint in any of the five languages flags "float used for money". Detection is a name heuristic plus review, and the heuristics are untested.
  - TS/JS: `ast-grep -p 'parseFloat($X)' -l ts`, `ast-grep -p 'Number($X)' -l ts`, and `rg -n "(price|amount|qty|quantity|size|balance|fee|notional|pnl)\w*\??\s*:\s*number" -t ts`.
  - Python: `rg -n "float\(.*(price|amount|qty|balance|fee|notional)" -t py`, plus pandas/NumPy money columns typed float64.
  - Rust: `rg -n "(price|amount|qty|balance|fee)\w*\s*:\s*f(32|64)" -t rust`.
  - C++: `rg -n "(double|float)\s+\w*(price|amount|qty|balance|fee)" -g "*.{h,hpp,cc,cpp}"`.
  - SQL: money columns declared REAL, DOUBLE PRECISION or FLOAT.
  - Manual: trace each value from the API response to order placement, ledger write or chain call, and flag every hop where it becomes a float.
- **Tools:** ast-grep, ripgrep, Semgrep (custom rule), manual review.
- **Applies to:** Off-chain TS/JS, Python, Rust and C++ code, and database schemas. Solidity has no floats, but its off-chain callers do.
- **When not to apply / counterpoints:**
  1. Floats are defensible for models where "floating point error is swamped by the errors in your models" ([HN 22322636](https://news.ycombinator.com/item?id=22322636)) and for approximate quantities such as insurance loss estimates ([HN 22322641](https://news.ycombinator.com/item?id=22322641)). Scope the rule to values that are booked, settled, sent as orders or compared for equality.
  2. Integer cents make multiplication, division and interest hard ([HN 22322480](https://news.ycombinator.com/item?id=22322480)), and VAT too ([HN 22324376](https://news.ycombinator.com/item?id=22324376)). Minor-unit exponents vary between currencies, and 18-decimal tokens overflow int64.
  3. Decimal types are slower and less convenient (scaledcode summary, CWE-1339 mitigation note).
- **Fix risk:** high

### G103-F09 — Integer overflow must fail loudly in value-handling code
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:** Make integer overflow fail loudly in code that handles value.
  - **Rust:** set `overflow-checks = true` in `[profile.release]` for financial crates, or use `checked_*`, `saturating_*` or `wrapping_*` explicitly, enforced with `clippy::arithmetic_side_effects`.
  - **Solidity:** every `unchecked {}` block needs a written proof of bounds, and every explicit downcast needs OZ SafeCast.
  - **C/C++:** use checked-arithmetic helpers (CWE-190 names SafeInt and IntegerLib) on money and size paths.
  - **NumPy:** never keep volumes or notionals in fixed-width int32 arrays.
- **Rationale:**
  - Rust release builds wrap silently, because Cargo's release profile defaults to `overflow-checks = false`.
  - Solidity 0.8 checks arithmetic, but not inside `unchecked` blocks, not on explicit conversions (which "always truncate") and not on bitwise operators.
  - NumPy int32 arrays wrap silently. `np.array([2**31-1], dtype=np.int32) + 1` gives `[-2147483648]` with no warning (reproduced locally on NumPy 2.4.3 / win32).
- **Evidence:**
  - [Cargo Book — Profiles](https://doc.rust-lang.org/cargo/reference/profiles.html) — Rust project — official docs — the dev profile has `overflow-checks = true` and the release profile `overflow-checks = false` — confirmed.
  - [RFC 0560 Integer Overflow](https://rust-lang.github.io/rfcs/0560-integer-overflow.html) — Rust project, 2014 — standard — overflow is "a program error (but not undefined behavior in the C sense)"; checks "will be compiled out whenever an optimized build is produced"; "leave room in the future to move towards universal overflow checking" — confirmed.
  - [Clippy ARITHMETIC_SIDE_EFFECTS](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/operators/mod.rs) — Rust Clippy — official lint source — restriction group, since 1.64.0: "For integers, overflow will trigger a panic in debug builds or wrap the result in release mode ... it is desirable to explicitly call checked, wrapping or saturating arithmetic methods." — confirmed.
  - [solana-foundation/program-examples counter/anchor Cargo.toml](https://raw.githubusercontent.com/solana-foundation/program-examples/main/basics/counter/anchor/Cargo.toml) — Solana Foundation — official examples — `[profile.release] overflow-checks = true`. A GitHub code search finds 49 Cargo.toml files in that repo with this setting, across Anchor and Pinocchio examples — confirmed.
  - [Solidity docs — Checked or Unchecked Arithmetic](https://docs.soliditylang.org/en/latest/control-structures.html) — Solidity team, 0.8.x — official docs — "Explicit type conversions will always truncate and never cause a failing assertion ..."; "Bitwise operators do not perform overflow or underflow checks." — confirmed.
  - [OpenZeppelin SafeCast.sol](https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/master/contracts/utils/math/SafeCast.sol) — OpenZeppelin — official code — "Downcasting from uint256/int256 in Solidity does not revert on overflow. This can easily result in undesired exploitation or bugs" — confirmed.
  - [OWASP Smart Contract Top 10 (2025) — SC08](https://owasp.org/www-project-smart-contract-top-10/) — OWASP, 2025 — standard — "Arithmetic errors due to exceeding the limits of fixed-size integers can lead to serious vulnerabilities, such as incorrect calculations or token theft." — confirmed. The list has no precision or rounding category.
  - [NumPy user guide — Data types, overflow errors](https://numpy.org/doc/stable/user/basics.types.html) — NumPy (v2.5 docs) — official docs — `np.power(100, 9, dtype=np.int32)` gives `np.int32(-1486618624)`; "Unlike NumPy, the size of Python's int is flexible" — confirmed.
  - [CWE-190: Integer Overflow or Wraparound](https://cwe.mitre.org/data/definitions/190.html) — MITRE, CWE 4.20 — standard — "safe integer handling packages such as SafeInt (C++) or IntegerLib (C or C++)" — confirmed.
- **Detect:**
  - Rust: `rg -n "overflow-checks" -g Cargo.toml` (absent means false in release). Run `cargo clippy -- -W clippy::arithmetic_side_effects` scoped to money modules.
  - Solidity: `rg -n "unchecked\s*\{" -g "*.sol"` and `rg -n "\bu?int(8|16|32|40|48|64|96|112|128|160|192|224)\(" -g "*.sol"`. The Decurity `basic-arithmetic-underflow` Semgrep rule exists but has LOW confidence per its metadata.
  - Python: `rg -n "int32|uint32|int16|astype\(np\.u?int(8|16|32)" -t py`.
  - C/C++: review size and amount arithmetic; CERT INT30/INT32 checkers in commercial tools.
- **Tools:** Cargo profile check, Clippy (arithmetic_side_effects), ripgrep, Semgrep (Decurity, low confidence), Slither, OpenZeppelin SafeCast.
- **Applies to:** Rust (including Solana programs), Solidity, C/C++, Python/NumPy.
- **When not to apply / counterpoints:**
  1. Enabling overflow checks is a behaviour change: silent wrap becomes a panic or revert. It also costs runtime and gas, which is why RFC 560 compiles checks out of optimized builds.
  2. Hash, PRNG and checksum code wraps on purpose. Use `wrapping_*` explicitly there rather than exempting whole crates.
- **Fix risk:** medium

### G103-F02 — Construct exact values from strings or integers, never through a float
- **Grade:** A · **Verdict:** CORRECTED
  - `rust_decimal::Decimal::from_f64` does **not** capture the float's binary error. It strips digits beyond about 15.95 significant digits, so `from_f64(0.1) == 0.1`. Only `from_f64_retain` keeps the exact binary expansion.
  - The rationale therefore applies to Python `Decimal(float)` and rust_decimal `from_*_retain`, not to rust_decimal `from_f64`. `from_f64` is still to be avoided for exact inputs: it silently loses anything past about 16 significant digits and keeps any error already accumulated in float arithmetic.
- **Rule:** Build exact values from strings or integers, never through a float.
  - Python: `Decimal('0.1')`, not `Decimal(0.1)`. For JSON, use `json.loads(..., parse_float=Decimal)`.
  - Rust: use rust_decimal `from_str`, `from_i128_with_scale` or `Decimal::new` rather than `from_f64` or `from_f64_retain`.
  - JS: pass strings to big.js or decimal.js, and enable `Big.strict`. Pass decimal strings to ethers `parseUnits`, which asserts `typeof value === "string"`.
  - The RUF032 autofix is marked unsafe because it changes the value, so treat such fixes as REPORT-ONLY.
- **Rationale:** Converting a float into an exact decimal type captures the float's binary error exactly. For example, `Decimal(float('1.1'))` becomes `Decimal('1.100000000000000088817841970012523233890533447265625')`. This is how code that "uses Decimal" still carries float error.
- **Evidence:**
  - [decimal — constructor and FloatOperation](https://docs.python.org/3/library/decimal.html) — PSF, Python 3.14.7 — official docs — "`Decimal(float('1.1'))` converts to `Decimal('1.100000000000000088817841970012523233890533447265625')`"; "If the FloatOperation signal is trapped, accidental mixing of decimals and floats in constructors or ordering comparisons raises an exception" — confirmed from the raw HTML.
  - [RUF032 decimal-from-float-literal](https://docs.astral.sh/ruff/rules/decimal-from-float-literal/) — Astral (Ruff) — official docs — "This rule's fix is marked as unsafe because it changes the underlying value of the Decimal instance that is constructed." Stable, added in 0.9.0 — confirmed.
  - [big.js API — Big.strict](https://mikemcl.github.io/big.js/) — Michael Mclaughlin, big.js v7.0.x — official docs — "an error will be thrown if a primitive number is passed to the Big constructor" — confirmed.
  - [rust_decimal::Decimal](https://docs.rs/rust_decimal/latest/rust_decimal/struct.Decimal.html) — rust_decimal 1.43.0 — official docs — `Decimal::from_f64(0.1_f64)` gives "0.1" (excess bits "after ~15.95 decimal points ... are removed"); `from_f64_retain(0.1_f64)` gives "0.1000000000000000055511151231" — confirmed. This source is what the correction rests on.
  - [ethers v6 units.ts](https://raw.githubusercontent.com/ethers-io/ethers.js/main/src.ts/utils/units.ts) — ethers-io, v6.17.0 — source — `assertArgument(typeof(value) === "string", "value must be a string", "value", value);` — confirmed.
  - [json — parse_float](https://docs.python.org/3/library/json.html) — PSF — official docs — "If None (the default), it is equivalent to float(num_str). This can be used to parse JSON floats into custom datatypes, for example decimal.Decimal." — confirmed.
- **Detect:**
  - Python: `ruff check --select RUF032`; `rg -n "Decimal\((float|str\(float)" -t py`; `rg -n "json\.loads?\(" -t py` on exchange payloads that lack `parse_float=Decimal`.
  - Python tests: in conftest.py set `decimal.getcontext().traps[decimal.FloatOperation] = True`.
  - Rust: `rg -n "from_f(32|64)(_retain)?|Decimal::try_from\(.*f64" -t rust`.
  - TS: `ast-grep -p 'new Big($X)' -l ts` and `ast-grep -p 'new Decimal($X)' -l ts`, flagging non-string arguments; `rg -n "parse(Units|Ether)\([^'\"]+\.toString\(\)" -t ts`.
- **Tools:** Ruff (RUF032), Python decimal FloatOperation trap, ast-grep, ripgrep.
- **Applies to:** Python, Rust and TS/JS; C++ decimal libraries by analogy.
- **When not to apply / counterpoints:**
  1. When the source really is a float (a model output, say), rust_decimal `from_f64` is the reasonable conversion, because it drops non-guaranteed digits by design. The rule is about exact inputs that arrive as text.
  2. Trapping FloatOperation in production turns silent drift into exceptions. Enable it in tests first.
- **Fix risk:** high

### G103-F03 — JS/TS integers beyond 2^53−1 must never pass through Number
- **Grade:** A · **Verdict:** CORRECTED
  - The Gate.io SDK in the evidence is the community sieblyio/gateio-api, not an official Gate SDK. The issue is still open.
  - `json-bigint` has had no release since 1.0.0 (2020-07-14). Prefer native `context.source` or `lossless-json` (4.3.1, July 2026).
  - Baseline date made precise: 2025-03-31.
- **Rule:** In JS/TS, never let an integer that can exceed 2^53−1 pass through Number. That includes exchange order and trade IDs, Snowflake IDs, wei amounts and nanosecond timestamps.
  - At ingest, parse with a `JSON.parse` reviver that reads `context.source`. It is Stage 4, Baseline since 2025-03-31, and works in Node 24.13 (checked locally). On older runtimes, use `lossless-json`.
  - Keep IDs as strings.
  - Assert `Number.isSafeInteger` wherever a number is unavoidable.
- **Rationale:**
  - `JSON.parse` silently rounds big integers. Checked locally: `JSON.parse('1234567890123456789')` gives `1234567890123456800`.
  - An off-by-a-few ID still looks valid, so cancels go to the wrong ID or fail.
  - ESLint's `no-loss-of-precision` only checks literals in source code.
- **Evidence:**
  - [RFC 7493 The I-JSON Message Format, §2.2](https://www.rfc-editor.org/rfc/rfc7493.html) — IETF (T. Bray), 2015 — standard — "An I-JSON sender cannot expect a receiver to treat an integer whose absolute value is greater than 9007199254740991 ... as an exact value"; "it is RECOMMENDED to encode them in JSON string values" — confirmed verbatim.
  - [Number.MAX_SAFE_INTEGER](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER) — MDN — official docs — "`Number.MAX_SAFE_INTEGER + 1 === Number.MAX_SAFE_INTEGER + 2` will evaluate to true, which is mathematically incorrect." — confirmed.
  - [proposal-json-parse-with-source](https://github.com/tc39/proposal-json-parse-with-source) — TC39 — standard — "This proposal is at stage 4"; implemented in JavaScriptCore, SpiderMonkey and V8; "999999999999999999", "999999999999999999.0" and "1000000000000000000" all parse to 1000000000000000000 — confirmed.
  - [JSON.parse()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse) and [JSON.rawJSON()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/rawJSON) — MDN — official docs — the reviver example returns `BigInt(context.source)` with the comment "Ignore the value because it has already lost precision"; the rawJSON page says "Baseline 2025 · Newly available ... Since March 2025". web-features data shows the reviver context argument Baseline-low on 2025-03-31 (Chrome 114, Firefox 135, Safari 18.4) — confirmed.
  - [X IDs](https://docs.x.com/fundamentals/x-ids) — X developer docs — official docs — "In JavaScript, integers are limited to 53 bits. This causes precision loss with large IDs"; "Always use string IDs in your code." — confirmed.
  - [Discord API Reference — Snowflakes](https://docs.discord.com/developers/reference) — Discord — official docs — "Because Snowflake IDs are up to 64 bits in size (e.g. a uint64), they are always returned as strings in the HTTP API to prevent integer overflows in some languages." — confirmed.
  - [ESLint no-loss-of-precision](https://eslint.org/docs/latest/rules/no-loss-of-precision) — ESLint v10.11.0 docs — official docs — "Disallow literal numbers that lose precision"; in recommended; checks literals only — confirmed.
  - [gateio-api #101](https://github.com/sieblyio/gateio-api/issues/101) — sieblyio (community Gate.io SDK), opened 2026-01-28 — practitioner issue — "the orderId becomes incorrect, which makes it impossible to cancel the order" — confirmed. Still open; the maintainer is weighing a custom JSON parser.
- **Detect:**
  - The existing lint is ESLint `no-loss-of-precision`, which covers literals only.
  - Custom: `rg -n "JSON\.parse\(|\.json\(\)|response\.data" -t ts` in adapters, cross-checked against int64 fields in the API schema; `ast-grep -p 'Number($X.orderId)' -l ts`; `rg -n "parseInt\(.*[Ii]d\b" -t ts`.
  - Runtime: assert `Number.isSafeInteger`, and add a test fixture with ID 1234567890123456789.
- **Tools:** ESLint no-loss-of-precision, ast-grep, ripgrep, `JSON.parse` reviver with `context.source`, lossless-json (json-bigint only for legacy code; unmaintained since 2020).
- **Applies to:** TS/JS (Node and browsers), and any consumer of JSON produced by other services.
- **When not to apply / counterpoints:**
  1. `context.source` needs Chrome 114+, Firefox 135+, Safari 18.4+ or a recent Node. Older runtimes need `lossless-json`.
  2. Switching an ID from number to string or bigint changes equality (`0n == 0` is true, `0n === 0` is false), Map keys and `JSON.stringify` (which throws on BigInt; MDN). Change it at the parse boundary, with tests.
- **Fix risk:** medium

### G103-F12 — One documented rounding policy per domain; no ad-hoc rounding
- **Grade:** A · **Verdict:** CORRECTED
  - The WooCommerce PR #65997 is **open and unmerged**. The linked issue #65623 was closed as "not planned", not "not reproducible", and the fix was not merged.
  - Fowler's `Money.allocate` is in the PoEAA book, not on the online catalog page. It is confirmed only indirectly, through moneyphp, a library "heavily inspired by Martin Fowler's Money pattern" that ships `allocate`.
  - The Binance filter formula is confirmed in its current form: `price % tickSize == 0` and `quantity % stepSize == 0`.
- **Rule:** Give each domain one documented rounding policy: the mode, the scale, and the point in the pipeline where rounding happens. Domains include order sizing, fees, tax, interest, display and settlement.
  - Implement the policy in one helper per language. Forbid ad-hoc `round()`, `toFixed()`, `Math.round(x*100)/100` and `(int)(x+0.5)`.
  - Snap order price and quantity to tickSize and stepSize with decimal arithmetic and an explicit direction.
  - Split totals with an allocation function that distributes the remainder.
  - REPORT-ONLY.
- **Rationale:** Rounding defaults differ silently across ecosystems:

  | Ecosystem | Default rounding |
  |---|---|
  | Python `round()` and `decimal` | half-even |
  | rust_decimal `round()` | banker's rounding |
  | decimal.js | ROUND_HALF_UP (rounding 4) |
  | big.js | half away from zero (RM 1) |
  | viem `parseUnits` | half-up on the next digit |
  | Solidity and BigInt division | truncate toward zero |

  Float-based rounding is wrong at ties: `round(2.675, 2)` gives 2.67, and `(2.55).toFixed(1)` gives '2.5' (both reproduced locally). Accumulated truncation is systematic. The Vancouver Stock Exchange index lost about 25 points a month; the correction raised it from 524.811 to 1098.892.
- **Evidence:**
  - [Built-in Functions — round()](https://docs.python.org/3/library/functions.html) — PSF — official docs — "rounding is done toward the even choice"; "round(2.675, 2) gives 2.67 instead of the expected 2.68" — confirmed.
  - [decimal.js API](https://mikemcl.github.io/decimal.js/) — Michael Mclaughlin — official docs — precision default 20; rounding default 4 (ROUND_HALF_UP); `dividedBy` is "rounded to precision significant digits using rounding mode rounding" — confirmed.
  - [big.js API](https://mikemcl.github.io/big.js/) — Michael Mclaughlin, v7.0.x — official docs — DP default 20, RM default 1, "Rounds towards nearest neighbour. If equidistant, rounds away from zero" — confirmed.
  - [rust_decimal round](https://docs.rs/rust_decimal/latest/rust_decimal/struct.Decimal.html) — rust_decimal 1.43.0 — official docs — "Rounding currently follows 'Bankers Rounding' rules. e.g. 6.5 -> 6, 7.5 -> 8" — confirmed.
  - [Number.prototype.toFixed()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/toFixed) — MDN — official docs — "(2.55).toFixed(1); // '2.5' — it rounds down as it can't be represented exactly by a float and the closest representable float is lower" — confirmed.
  - [clang-tidy bugprone-incorrect-roundings](https://clang.llvm.org/extra/clang-tidy/checks/bugprone/incorrect-roundings.html) — LLVM — official docs — flags `(int)(double_expression + 0.5)`; "0.499999975 ... rounds to 1.0", and "-0.5f and -1.4f both round to 0.0" — confirmed.
  - [Binance Spot API — Filters](https://developers.binance.com/docs/binance-spot-api-docs/filters) — Binance — official docs — PRICE_FILTER `price % tickSize == 0`; LOT_SIZE `quantity % stepSize == 0`; MIN_NOTIONAL and NOTIONAL `price * quantity >= minNotional` — confirmed against the rendered page and the raw [filters.md](https://raw.githubusercontent.com/binance/binance-spot-api-docs/master/filters.md).
  - [WooCommerce PR #65997](https://github.com/woocommerce/woocommerce/pull/65997) — WooCommerce contributor PR, opened 2026-06-24 — practitioner — describes `update_taxes()` rounding aggregates with `NumberUtil::round()` ("always PHP_ROUND_HALF_UP") while per-rate rows go through `wc_round_tax_total()`, which honours the configured mode — confirmed. **The PR is OPEN and not merged, and the related issue was closed as "not planned".** It shows the inconsistency; it does not show an accepted fix.
  - [Vancouver Stock Exchange](https://en.wikipedia.org/wiki/Vancouver_Stock_Exchange) — Wikipedia, citing WSJ (1983-11-08) and Toronto Star (1983-11-29) — secondary — "truncated to three decimal places"; about 3000 updates a day; "erroneous loss of around 25 points per month"; "from its Friday closing figure of 524.811 to 1098.892" — confirmed.
  - [Dinero.js allocate](https://www.dinerojs.com/docs/api/mutations/allocate) — Dinero.js v2.0.2 — official docs — "split a monetary amount then distribute the remainder as evenly as possible"; 1003 split [50, 50] gives 502 and 501 — confirmed.
  - [moneyphp allocation docs](https://raw.githubusercontent.com/moneyphp/money/master/doc/features/allocation.rst) — moneyphp — official docs — remainder allocation, one unit at a time; the README says it is "heavily inspired by Martin Fowler's Money pattern" — confirmed. This is the secondary confirmation for Fowler's allocate.
- **Detect:**
  - Inventory: `rg -n "\bround\(|toFixed\(|Math\.(round|floor|ceil|trunc)\(|quantize\(|ROUND_|RoundingStrategy|round_dp|\.div\(|setScale" -g "*.{py,ts,js,rs}"`.
  - C/C++: `clang-tidy -checks='bugprone-incorrect-roundings'`.
  - ast-grep patterns `Math.round($X * 100) / 100` and `Math.floor($X / $STEP) * $STEP`.
  - Add a cross-language golden-value test.
  - Assert price/tickSize and qty/stepSize are integers when computed in Decimal.
- **Tools:** ripgrep, ast-grep, clang-tidy (bugprone-incorrect-roundings), golden-value characterization tests.
- **Applies to:** All languages, especially mixed Python backend, TS frontend and Solidity settlement stacks.
- **When not to apply / counterpoints:**
  1. HALF_EVEN is statistically unbiased, while HALF_UP is what many invoices expect. The choice of policy is a business and legal decision, not a lint finding.
  2. Centralising rounding can move rounding from per-line to per-total (or back), which legitimately changes invoices. The WooCommerce PR stayed unmerged, which shows this kind of change is contested.
- **Fix risk:** high

### G103-F10 — Lossy numeric casts must be explicit and checked
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:** Make every cast that can lose range or precision explicit and checked.
  - Rust: prefer `TryFrom`/`try_into` over `as`, enforced with `clippy::cast_possible_truncation`, `cast_precision_loss`, `cast_sign_loss` and `cast_possible_wrap` (all pedantic).
  - C/C++: enable clang-tidy `bugprone-narrowing-conversions` (`cppcoreguidelines-narrowing-conversions` is an alias) and follow CERT FLP36-C.
  - Solidity: use SafeCast.
  - JS: never use `Number(bigint)` for arithmetic.
- **Rationale:**
  - Rust `as` truncates integers silently (`1234u16 as u8 == 210`). Out-of-range floats saturate, NaN becomes 0, and int-to-float rounds ties to even (`123_456_789i32 as f32 == 123_456_790f32`).
  - CERT's C example loses 46 when converting a long to float (CWE-681, CWE-197).
- **Evidence:**
  - [Rust Reference — Operator expressions](https://doc.rust-lang.org/reference/expressions/operator-expr.html) — Rust project — official docs — "NaN will return 0"; values beyond range "will saturate"; "rounding is according to roundTiesToEven mode"; `assert_eq!(1234u16 as u8, 210u8)`; `assert_eq!(123_456_789i32 as f32, 123_456_790f32, "Rounded")` — confirmed.
  - [Clippy lint list](https://rust-lang.github.io/rust-clippy/master/index.html) and [casts/mod.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/casts/mod.rs) — Rust Clippy — official — all four `cast_*` lints are in the pedantic group; `cast_precision_loss` "Checks for casts from any numeric type to a float type where the receiving type cannot store all values ... without rounding errors" — confirmed.
  - [FLP36-C](https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/rules/floating-point-flp/flp36-c) — SEI CERT C — standard — `long int big = 1234567890L; float approx = big;` prints -46. Checkers: Cppcheck Premium premium-cert-flp36-c, Klocwork PORTING.CAST.FLTPNT, PVS-Studio V674 — confirmed.
  - [clang-tidy bugprone-narrowing-conversions](https://clang.llvm.org/extra/clang-tidy/checks/bugprone/narrowing-conversions.html) — LLVM — official docs — "Checks for silent narrowing conversions, e.g: int i = 0; i += 0.1;"; WarnOnIntegerToFloatingPointNarrowingConversion and WarnOnFloatingPointNarrowingConversion both default to true — confirmed.
  - [CWE-681](https://cwe.mitre.org/data/definitions/681.html) and [CWE-197](https://cwe.mitre.org/data/definitions/197.html) — MITRE, CWE 4.20 — standard — "Avoid making conversion between numeric types. Always check for the allowed ranges."; "Truncation errors occur when a primitive is cast to a primitive of a smaller size and data is lost in the conversion." — confirmed.
- **Detect:**
  - Rust: `cargo clippy -- -W clippy::cast_possible_truncation -W clippy::cast_precision_loss -W clippy::cast_sign_loss -W clippy::cast_possible_wrap` scoped to money and time modules; `rg -n " as (u|i)(8|16|32|64|128)\b| as f(32|64)\b" -t rust`.
  - C++: `clang-tidy -checks='bugprone-narrowing-conversions'`.
  - Solidity: the downcast grep from F09.
  - TS: `ast-grep -p 'Number($X)' -l ts`, filtered by bigint type.
- **Tools:** Clippy (cast_* lints), clang-tidy, ripgrep, ast-grep.
- **Applies to:** Rust, C/C++, Solidity, TS/JS.
- **When not to apply / counterpoints:**
  1. The pedantic cast lints are noisy, and many casts are provably in range. Scope them to money and time paths.
  2. `try_from` adds an error path, so the behaviour changes from "wrong value" to "error".
- **Fix risk:** medium

### G103-F11 — No ==/!= on computed floats; no machine-EPSILON tolerance; explicit NaN handling
- **Grade:** A · **Verdict:** VERIFIED (with an update: Clippy's own float_cmp docs now say "Do not use f64::EPSILON")
- **Rule:**
  - Do not compare computed floats with `==` or `!=`.
  - Do not use machine EPSILON as an absolute tolerance. Use a relative plus absolute tolerance chosen for the domain. Python `math.isclose` needs an explicit `abs_tol` when comparing to 0.
  - Detect NaN only with `isnan` or `Number.isNaN`. Use `Object.is` to detect -0.
  - Reject NaN and Infinity at input boundaries.
  - In money and threshold logic, remove the need for tolerance by using integers or decimals (F01).
- **Rationale:**
  - NaN is not equal to itself, so equality-based NaN checks are always false.
  - Different computation orders give different last bits.
  - `f64::EPSILON` is the gap at 1.0. Outside the range −2..2, `abs(a-b) < EPSILON` is effectively an exact-equality check.
- **Evidence:**
  - [ESLint use-isnan](https://eslint.org/docs/latest/rules/use-isnan) and [no-compare-neg-zero](https://eslint.org/docs/latest/rules/no-compare-neg-zero) — ESLint v10.11.0 — official docs — "NaN is unique in JavaScript by not being equal to anything, including itself"; both rules are recommended; `enforceForIndexOf` defaults to false; use `Object.is(x, -0)` — confirmed.
  - [Ruff PLW0177 nan-comparison](https://docs.astral.sh/ruff/rules/nan-comparison/) — Astral — official docs — "x == float("NaN") will always return False, even if x is NaN" (stable, added in 0.12.0) — confirmed.
  - [Clippy float_cmp / float_cmp_const](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/operators/mod.rs) — Rust Clippy — official lint source — "arriving at the same logical result via different routes ... may yield different values"; float_cmp is pedantic and float_cmp_const is restriction; the docs now say "NOTE: Do not use `f64::EPSILON` ... not suitable for floating point equality comparison" — confirmed.
  - [rust-clippy #6816](https://github.com/rust-lang/rust-clippy/issues/6816) — GitHub issue, 2021 — practitioner — outside −2..=2, `abs(a - b) < f__::EPSILON` "is actually equivalent to a strict equality check" — confirmed. Closed; the docs were fixed through the cross-referenced PR #13079.
  - [math.isclose](https://docs.python.org/3/library/math.html) — PSF — official docs — defaults `rel_tol=1e-09, abs_tol=0.0`; `isclose(x, 0)` "is False for any nonzero x ... So add an appropriate positive abs_tol argument" — confirmed.
  - [json — NaN/Infinity](https://docs.python.org/3/library/json.html) — PSF — official docs — "The RFC does not permit the representation of infinite or NaN number values. Despite that, by default, this module accepts and outputs Infinity, -Infinity, and NaN" — confirmed.
  - [FLP02-C automated detection](https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/floating-point-flp/flp02-c) — SEI CERT — standard — checkers include Astrée float-comparison, CodeSonar LANG.ARITH.FPEQUAL, Parasoft CERT_C-FLP02-a ("shall not be tested for equality"), Polyspace and PC-lint Plus 777 — confirmed.
- **Detect:**
  - JS/TS: ESLint `use-isnan` with `enforceForIndexOf: true`, and `no-compare-neg-zero`.
  - Python: `ruff check --select PLW0177`; `rg -n "isclose\(" -t py`; `json.dumps(` without `allow_nan=False` on outbound payloads.
  - Rust: `cargo clippy -- -W clippy::float_cmp -W clippy::float_cmp_const`; `rg -n "EPSILON"`.
  - C++: CERT FLP02-C analyzers.
  - Manual: add NaN/inf guards before order sizing.
- **Tools:** ESLint, Ruff (PLW0177), Clippy, ripgrep, CERT-aligned C/C++ analyzers.
- **Applies to:** TS/JS, Python, Rust, C++.
- **When not to apply / counterpoints:**
  1. float_cmp was "by far the most suppressed `correctness` lint on crates.io" (dtolnay, [#7725](https://github.com/rust-lang/rust-clippy/issues/7725)). PR #7692 had already moved it to pedantic, and moving it further to restriction or nursery is still an open proposal. Exact comparison is sometimes correct (sentinels, exactly representable values).
  2. Adding a tolerance changes behaviour at thresholds, so review it rather than auto-applying it.
- **Fix risk:** medium

### G103-F13 — Python decimal: never mutate the global/thread context in library code
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:**
  - Never mutate the global or thread-local decimal context in library code. Use `with localcontext(prec=..., rounding=...)` around the computation instead.
  - Remember that the default precision is 28 significant digits.
  - Keep raw on-chain amounts as Python `int`.
  - Trap Inexact and FloatOperation in tests on paths that must be exact.
- **Rationale:** Context precision applies only to arithmetic results, not to construction, so code "looks" exact while products are rounded half-even. Reproduced locally with prec=28: `123456789123456789123456789 * Decimal('1.2345678')` gives `152415776543209976543209976.4`, and the Inexact flag is set. The context is per-thread.
- **Evidence:**
  - [decimal — contexts](https://docs.python.org/3/library/decimal.html) — PSF, Python 3.14.7 — official docs — "The default values are Context.prec=28, Context.rounding=ROUND_HALF_EVEN"; "The significance of a new Decimal is determined solely by the number of digits input. Context precision and rounding only come into play during arithmetic operations."; "The getcontext() function accesses a different Context object for each thread." — confirmed.
  - [decimal — localcontext()](https://docs.python.org/3/library/decimal.html) — PSF — official docs — `with localcontext(prec=42) as ctx: s = calculate_something()` — confirmed.
- **Detect:** `rg -n "getcontext\(\)\.(prec|rounding|traps|Emax|Emin)\s*=" -t py` and `rg -n "setcontext\(" -t py` outside tests and entry points. Set Inexact and FloatOperation traps in conftest.py for ledger modules. Review Decimal multiplication of 18-decimal amounts.
- **Tools:** ripgrep, pytest with decimal traps, manual review.
- **Applies to:** Python.
- **When not to apply / counterpoints:**
  1. Trapping Inexact is wrong for legitimately inexact operations such as division and interest.
  2. Raising the precision changes outputs.
- **Fix risk:** medium

### G103-F14 — Re-verify dtype assumptions under NumPy 2.x and on Windows
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:** Re-verify dtype assumptions whenever the code moves to NumPy 2.x or runs on Windows.
  - The default integer is now int64 on all 64-bit platforms. It was previously the C `long`, which is int32 on Windows.
  - Under NEP 50, scalar precision is kept, so float32 math stays float32 and `np.uint8(100) + 200` gives `uint8(44)` with a RuntimeWarning.
  - Fixed-width integer arrays wrap silently.
  - `np.longdouble` and `float128` are only 64-bit on MSVC builds.
  - Run Ruff NPY201 (needs ruff>=0.4.8) and pin dtypes for money, volume and timestamps. REPORT-ONLY where results change.
- **Rationale:** These are silent changes across versions and platforms. The same code can give different numbers on a Windows laptop and a Linux server.
- **Evidence:**
  - [NumPy 2.0 migration guide](https://numpy.org/doc/stable/numpy_2_0_migration_guide.html) — NumPy — official docs — "The default integer used by NumPy is now 64bit on all 64bit systems ... previously equivalent to the C long type"; "np.float32(3) + 3. now returns a float32 when it previously returned a float64"; install ruff>=0.4.8 for NPY201 — confirmed.
  - [NEP 50](https://numpy.org/neps/nep-0050-scalar-promotion.html) — NumPy (Sebastian Berg), status Final — official — `np.uint8(100) + 200`: old `int64(300)`, new `uint8(44)` plus RuntimeWarning; "One of the most dangerous changes maybe"; "This can lead to integer overflows and thus incorrect results beyond precision. In many cases this may be silent" — confirmed.
  - [NumPy user guide — extended precision](https://numpy.org/doc/stable/user/basics.types.html) — NumPy v2.5 — official docs — "MSVC (standard for Windows builds) makes long double identical to double (64 bits)"; float96 and float128 give "64 bits in standard Windows builds" — confirmed. Also reproduced locally: `np.finfo(np.longdouble)` is float64 on win32.
- **Detect:** `ruff check --select NPY201` (plus NPY001/NPY002); `rg -n "dtype=(np\.)?(int32|uint32|int16|uint8|float32)|astype\((np\.)?(int32|float32)|longdouble|float128|float96" -t py`; cross-platform CI with golden outputs.
- **Tools:** Ruff (NPY201, NPY001, NPY002), ripgrep, cross-platform CI.
- **Applies to:** Python (NumPy, pandas, polars interop).
- **When not to apply / counterpoints:**
  1. NEP 50 made promotion more consistent. The fix is to pin dtypes, not to emulate NumPy 1.
  2. float32 can be deliberate for ML features. Never use it for prices or sizes.
- **Fix risk:** medium

### G103-F15 — Python: no naive datetimes for instants; enforce Ruff DTZ
- **Grade:** A · **Verdict:** CORRECTED
  - "The only systematic study" becomes "the first in-depth systematic study", as the paper itself says.
  - "82% fixable within one function" becomes "82% localized within a single function".
- **Rule:**
  - Never create naive datetimes for instants. Enforce Ruff DTZ (DTZ001-DTZ012, DTZ901).
  - Replace `utcnow()` and `utcfromtimestamp()`, deprecated since Python 3.12, with `datetime.now(timezone.utc)` and `fromtimestamp(ts, tz=timezone.utc)`.
  - Store instants as timestamptz or as integers with a declared unit.
  - The DTZ005 fix (`now()` to `now(tz=UTC)`) changes values on hosts not set to UTC, so it is REPORT-ONLY unless tests prove the host is UTC.
- **Rationale:** Many datetime methods treat naive values as local time. In the first in-depth systematic study of datetime bugs (MSR 2025, 151 bugs):
  - 53.6% involved time zones;
  - 58.9% involved construction;
  - 27.8% involved naive misuse;
  - 82% were localized within a single function.
- **Evidence:**
  - [datetime — aware and naive objects](https://docs.python.org/3/library/datetime.html) — PSF — official docs — "Because naive datetime objects are treated by many datetime methods as local times, it is preferred to use aware datetimes to represent times in UTC."; `utcnow` is "Deprecated since version 3.12: Use datetime.now() with UTC instead." — confirmed.
  - [Ruff rules — flake8-datetimez](https://docs.astral.sh/ruff/rules/) — Astral — official docs — DTZ001, 002, 003, 004, 005, 006, 007, 011, 012 and 901 are all listed — confirmed.
  - [It's About Time: An Empirical Study of Date and Time Bugs in Open-Source Python Software](https://rohan.padhye.org/files/datetimebugs-msr25.pdf) — Tiwari, Chen, Joukov, Vandervelde, Li, Padhye, MSR 2025 (ACM SIGSOFT Distinguished Paper, per the author's page) — peer-reviewed — "most bugs (53.6%) are related to time zones, with incorrect construction of datetime objects being the primary source of error (58.9%)"; "Using Naive Datetime Incorrectly (27.8%)"; "82% are localized within a single function"; the CodeQL deprecated-API query "raised 617 alerts" on 1,000 repos — confirmed.
  - [Don't Do This](https://wiki.postgresql.org/wiki/Don't_Do_This) — PostgreSQL wiki — community wiki — "timestamptz records a single moment in time ... the number of microseconds since January 1st, 2000 in UTC." — confirmed.
- **Detect:** `ruff check --select DTZ`; SQL `timestamp without time zone`; ORM `DateTime(timezone=False)`; pandas `to_datetime(` without `utc=True`; run tests under several TZ values (freezegun or libfaketime).
- **Tools:** Ruff (DTZ), CodeQL custom queries, freezegun, libfaketime, ripgrep.
- **Applies to:** Python and database schemas; by analogy, any naive local-time type.
- **When not to apply / counterpoints:**
  1. Naive values are correct for wall-clock concepts such as opening hours (see F19).
  2. The DTZ005 change shifts values by the host's UTC offset.
- **Fix risk:** medium

### G103-F16 — Measure durations with a monotonic clock
- **Grade:** A · **Verdict:** VERIFIED (counterpoint now sourced: CGPM 2022 Resolution 4)
- **Rule:** Measure durations, timeouts, rate-limit windows, latencies and backoffs with a monotonic clock:

  | Language | Use | Not |
  |---|---|---|
  | Python | `time.monotonic()` / `perf_counter()` | `time.time()` |
  | JS | `performance.now()` | `Date.now()` |
  | Rust | `Instant` | `SystemTime` |
  | C++ | `steady_clock` | `system_clock` |
  | Go | `time.Since`/`Sub` on values that still carry the monotonic reading | values stripped by `Round(0)`, `UTC()` etc. |

  Clamp elapsed times to be non-negative. Use the wall clock only for timestamps that leave the process.
- **Rationale:** Wall clocks jump. In Cloudflare's 2017 leap-second incident, subtracting `time.Now()` values gave a negative RTT, and `rand.Int63n` then panicked. About 0.2% of DNS queries were affected at peak. The incident was cited in the proposal that led Go 1.9 to add transparent monotonic time. Reddit was down 30-40 minutes in the 2012 leap second.
- **Evidence:**
  - [How and why the leap second affected Cloudflare DNS](https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/) — Cloudflare, 1 Jan 2017 — incident report — rtt "could be negative if time.Now() was earlier than start"; `rand.Int63n` "promptly panics if its argument is negative"; about 0.2% of DNS queries at peak; a "one character" fix — confirmed.
  - [Proposal: Monotonic Elapsed Time Measurements in Go](https://go.googlesource.com/proposal/+/master/design/12914-monotonic.md) — Russ Cox, 2017 — design doc — "A Go program measuring a negative elapsed time during a leap second caused CloudFlare's recent DNS outage." — confirmed. The [Go 1.9 release notes](https://go.dev/doc/go1.9) confirm "Transparent Monotonic Time support".
  - [time package — Monotonic Clocks](https://pkg.go.dev/time) — Go project — official docs — "The wall clock is for telling time and the monotonic clock is for measuring time."; `Round(0)`, `In`, `Local`, `UTC` and `AddDate` strip the reading, and the Marshal/Gob encodings omit it — confirmed.
  - [time.monotonic / time.time](https://docs.python.org/3/library/time.html) — PSF — official docs — "a clock that cannot go backwards. The clock is not affected by system clock updates."; `time()` "can return a lower value than a previous call if the system clock has been set back" — confirmed.
  - [Performance.now()](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now) — MDN — official docs — `Date.now()` "may have been impacted by system and user clock adjustments, clock skew, etc."; `performance.now()` "never decreases and isn't subject to adjustments" — confirmed. Resolution is coarsened to 5 µs (isolated) or 100 µs.
  - [std::time::SystemTime](https://doc.rust-lang.org/std/time/struct.SystemTime.html) — Rust — official docs — "this time measurement is not monotonic"; "To measure elapsed time reliably, use Instant instead" — confirmed.
  - [std::chrono::steady_clock](https://en.cppreference.com/w/cpp/chrono/steady_clock) — cppreference — reference — "The time points of this clock cannot decrease as physical time moves forward ... most suitable for measuring intervals." — confirmed.
  - [It's time to leave the leap second in the past](https://engineering.fb.com/2022/07/25/production-engineering/its-time-to-leave-the-leap-second-in-the-past/) — Meta Engineering, 2022 — engineering blog — "Back in 2012, Reddit experienced a massive outage because of a leap second; the site was inaccessible for 30 to 40 minutes."; Meta smears over 17 hours — confirmed.
  - [CGPM 2022 Resolution 4](https://www.bipm.org/en/cgpm-2022/resolution-4) — BIPM, 2022 — standard — "the maximum value for the difference (UT1-UTC) will be increased in, or before, 2035" — confirmed (added by the verifier for counterpoint 2).
- **Detect:**
  - Python: `ast-grep -p 'time.time() - $S' -l python`.
  - TS: `ast-grep -p 'Date.now() - $S' -l ts`.
  - Rust: `rg -n "SystemTime::now\(\).*(elapsed|duration_since)" -t rust`.
  - C++: `rg -n "system_clock::now\(\)"` in timing code.
  - Go: `rg -n "\.Round\(0\)|\.UTC\(\)\.Sub|UnixNano\(\) -" -t go`.
  - Guard every duration fed to sleep, rand or backoff with `max(0, d)`.
- **Tools:** ast-grep, ripgrep, manual review.
- **Applies to:** All languages; especially bots with timeouts, rate limiters, order TTLs and latency metrics.
- **When not to apply / counterpoints:**
  1. Monotonic clocks have no meaning across processes. Exchange request timestamps must stay wall-clock and synchronised.
  2. Leap smearing and the CGPM decision to widen the UT1-UTC limit by 2035 reduce clock jumps but do not remove them: NTP steps, VM migration and manual changes still happen.
- **Fix risk:** low

### G103-F07 — Multiply before dividing (with a full-precision mulDiv); flag quotients that can round to zero
- **Grade:** A · **Verdict:** CORRECTED
  - clang-tidy `bugprone-integer-division` does **not** detect divide-before-multiply. It flags integer division whose result is used in a floating-point context, such as `double d = 32 * 8 / (2 + i)`.
  - Clippy `integer_division` flags **every** integer division. It is a triage aid, not a pattern detector.
  - Di Franco's "reordering" finding concerns floating-point accuracy bugs in numerical libraries, which is indirect support.
- **Rule:** In integer and fixed-point arithmetic, multiply before dividing. Use a full-precision mulDiv (512-bit intermediate) so the reordering cannot overflow. Flag any quotient that can round to zero and is then used as a multiplier, share count or fee. REPORT-ONLY for money paths.
- **Rationale:** Integer division truncates. In Solidity, "division rounds towards zero", and Rust, C++ and BigInt behave the same way. `(a / n) * k` is zero when `n > a`. Slither's own docs add the caveat "unless the limit of a smaller type makes this dangerous".
- **Evidence:**
  - [Slither Detector Documentation — divide-before-multiply](https://github.com/crytic/slither/wiki/Detector-Documentation) — Trail of Bits — official docs — Severity Medium, Confidence Medium; "Solidity's integer division truncates. Thus, performing division before multiplication can lead to precision loss."; "Consider ordering multiplication before division."; "unless the limit of a smaller type makes this dangerous" — confirmed.
  - [Solidity docs — Types](https://docs.soliditylang.org/en/latest/types.html) — Solidity team — official docs — "In Solidity, division rounds towards zero. This means that int256(-5) / int256(2) == int256(-2)." — confirmed.
  - [clang-tidy bugprone-integer-division](https://clang.llvm.org/extra/clang-tidy/checks/bugprone/integer-division.html) — LLVM — official docs — "Finds cases where integer division in a floating point context is likely to cause unintended loss of precision." — confirmed, but it is a **related pattern, not divide-before-multiply**.
  - [Clippy INTEGER_DIVISION](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/operators/mod.rs) — Rust Clippy — official lint source — restriction group, since 1.37.0: "integer division is very often a mistake because it discards the remainder" — confirmed; it flags all division.
  - [Precision Loss Errors](https://dacian.me/precision-loss-errors) — Dacian (dacian.me), 2023-04-04 — engineering blog — sections "Division Before Multiplication" (Numoen, Ajna, NounsDAO, Opyn, Canto ...) and "Rounding Down To Zero" (Cooler, Notional, Caviar, Biconomy ...) — confirmed.
  - [A Comprehensive Study of Real-World Numerical Bug Characteristics](https://web.cs.ucdavis.edu/~rubio/includes/ase17.pdf) — Di Franco et al., ASE 2017 — peer-reviewed — Finding 2: "two common strategies to fix accuracy bugs: using higher precision, and reordering arithmetic expressions" — confirmed. This concerns floating point in numerical libraries, so it is indirect support.
  - [OpenZeppelin Math.mulDiv](https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/master/contracts/utils/math/Math.sol) — OpenZeppelin — official code — full-precision `floor(x * y / denominator)` — confirmed.
- **Detect:**
  - Solidity: `slither . --detect divide-before-multiply`.
  - ast-grep: `($A / $B) * $C` for Solidity and TS bigint, and `($A // $B) * $C` for Python.
  - C/C++ has no dedicated check. `bugprone-integer-division` only catches int division in float context.
  - Rust: `clippy::integer_division` as a triage list.
  - Manual: for each division, ask whether the result can be 0 for realistic inputs.
- **Tools:** Slither, ast-grep, Clippy (integer_division, triage only), clang-tidy (integer-division, related pattern), OpenZeppelin mulDiv.
- **Applies to:** Solidity, Rust, C++, TS bigint, Python int arithmetic.
- **When not to apply / counterpoints:**
  1. Multiplying first can overflow fixed-width integers. In Solidity 0.8+ that reverts, which can become a DoS, so use mulDiv rather than naive reordering.
  2. Deliberate truncation (bucketing into epochs, say) is intended. Mark those as false positives.
- **Fix risk:** high

### G103-F04 — In EVM TypeScript keep on-chain amounts as bigint end to end; ethers and viem parse differently
- **Grade:** A · **Verdict:** CORRECTED
  - viem PR #4732 was **closed without merging** (2026-06-13).
  - The actual fix was PR #4859, "delegate parse/format unit utils to Ox's Value module". It was merged 2026-07-18 and released in **viem 2.55.4** (2026-07-19). Affected versions: 2.55.3 and earlier.
  - viem uses a vendored `Value` module "adapted from the Ox v1 Value module", not `ox` directly.
- **Rule:** In EVM TypeScript (ethers v6, viem), keep on-chain amounts as bigint end to end. Convert to decimal strings only for display, with `formatUnits`.
  - Never do arithmetic on `Number(formatUnits(...))` or `parseFloat(formatEther(...))`.
  - Never build a bigint from float math, such as `BigInt(Math.floor(x * 1e18))`.
  - ethers `parseUnits` throws "too many decimals for format" on over-precise input. viem `parseUnits` silently rounds half-up on the first dropped digit, applied to the magnitude.
  - Treat a library swap or a viem upgrade across 2.55.4 as a behaviour change. REPORT-ONLY.
- **Rationale:**
  - Number cannot hold wei-scale amounts exactly.
  - BigInt division truncates toward zero, and mixing BigInt with Number throws a TypeError.
  - viem itself rounded through a JS float until 2.55.4: `parseUnits('1.4499999999999999999', 1)` returned 15n.
- **Evidence:**
  - [BigInt](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt) — MDN — official docs — operands of arithmetic operators cannot mix types (TypeError); "Division (/) truncates fractional components towards zero"; `5n / 2n // 2n`; JSON.stringify with BigInt raises TypeError; `0n == 0` is true and `0n === 0` is false — confirmed.
  - [ethers v6 fixednumber.ts](https://raw.githubusercontent.com/ethers-io/ethers.js/main/src.ts/utils/fixednumber.ts) — ethers-io, v6.17.0 — source — `assert(decimal.substring(format.decimals).match(/^0*$/), "too many decimals for format", "NUMERIC_FAULT", ...)`; `parseUnits` calls `FixedNumber.fromString` — confirmed.
  - [viem src/utils/unit/Value.ts](https://raw.githubusercontent.com/wevm/viem/main/src/utils/unit/Value.ts) and [ox Value.ts](https://raw.githubusercontent.com/wevm/ox/main/src/core/Value.ts) — wevm — source — "Adapted from the Ox v1 Value module"; `if (roundDigit >= 5) { // Carry through the truncated fraction digits into the integer part without converting to a JS Number` — confirmed in both.
  - [viem #4855](https://github.com/wevm/viem/issues/4855) — GitHub issue, opened 2026-07-17 — practitioner — `parseUnits('1.4499999999999999999', 1)` gave 15n instead of 14n; affects viem 2.55.3; closed 2026-07-18 by PR #4859 — confirmed.
  - [viem PR #4859](https://github.com/wevm/viem/pull/4859) — wevm — merged 2026-07-18 — "Reuses Ox's `Value` module ... which rounds exactly in decimal space" — confirmed. Shipped in viem@2.55.4 (release compare 2.55.2...2.55.4 contains commit cb4bd8fd).
  - [viem PR #4732](https://github.com/wevm/viem/pull/4732) — GitHub PR, 2026-06-13 — practitioner — shows `parseUnits("3.4999999999999999999", 0)` giving 4n because `Number(".4999999999999999999") === 0.5` — the example is confirmed, but the PR was **closed, not merged**.
  - [ethers v6 migration guide](https://docs.ethers.org/v6/migrating/) — ethers-io — official docs — "the BigNumber class has been replaced with the built-in ES2020 BigInt"; "a ES2020 BigInt can only operate on integers" — confirmed.
- **Detect:**
  - ast-grep (ts) patterns: `Number(formatUnits($$$))`, `parseFloat(formatUnits($$$))`, `Number(formatEther($$$))`, `parseFloat(formatEther($$$))`, `BigInt(Math.floor($X))`, `BigInt(Math.round($X))`, `BigInt($A * $B)`.
  - `rg -n "parse(Units|Ether)\(.*(toString|toFixed)\(" -t ts`.
  - Check that viem is at 2.55.4 or later, and review any ethers-to-viem swap.
- **Tools:** ast-grep, ripgrep, TypeScript strict mode, manual review.
- **Applies to:** TS/JS dapps, bots, keepers and liquidators using ethers v6 or viem.
- **When not to apply / counterpoints:**
  1. ethers' strictness frustrates users. [ethers #4833](https://github.com/ethers-io/ethers.js/issues/4833) (ethers 6.9.0) shows `parseEther("0.0004985398760370963")` (19 decimals) throwing; the string came from `A0.toString()`. Choosing strict or lenient parsing is a product decision.
  2. Display-only conversions to Number are fine when the value never feeds back into arithmetic.
- **Fix risk:** medium

### G103-F18 — JS/TS: don't parse or do calendar math with legacy Date on uncertain formats
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:**
  - Use Temporal where the runtime ships it: Firefox 139+, Chrome and Edge 144+, Node 26+. Safari has it only in Technology Preview, and Node 24 has none (checked locally). Otherwise use a vetted polyfill or library.
  - If Date must stay, parse only full ISO 8601 strings that carry an explicit offset or Z.
  - Never rely on Date setters for arithmetic that crosses DST.
- **Rationale:** `Date.parse` treats date-only strings as UTC but date-time strings without an offset as local time. Other formats are implementation-defined, and setters mutate in place.
- **Evidence:**
  - [Date.parse()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/parse) — MDN — official docs — `Date.parse("2019-01-01")` "will imply UTC time because it's date-only"; `Date.parse("2019-01-01T00:00:00")` is local; "Other formats are implementation-defined and may not work across all browsers." — confirmed.
  - [Temporal](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal) — MDN — official docs — "Limited availability"; Date supports only UTC and local; "all setters being mutating"; the date time string format is "impossible to parse in a consistent way" — confirmed.
  - [proposal-temporal](https://github.com/tc39/proposal-temporal) — TC39 — standard — "currently Stage 4"; Firefox 139 (27 May 2025), Chrome 144 (13 Jan 2026), Node.js 26 (5 May 2026); Safari in progress — confirmed.
  - [Can I use: Temporal](https://caniuse.com/temporal) — caniuse — compat data — Chrome and Edge 144+, Firefox 139+; Safari "TP: Supported" only — confirmed. web-features marks Temporal as not Baseline.
- **Detect:**
  - `rg -n "new Date\(['\"\`]|Date\.parse\(|new Date\([a-zA-Z_.]+\)" -t ts`.
  - `rg -n "\.set(Hours|Date|Month|FullYear|Minutes)\(" -t ts`.
  - No ESLint core rule covers this. Write a custom ast-grep rule for string-literal `new Date(...)`.
- **Tools:** ripgrep, ast-grep, Temporal, temporal-polyfill (1.0.5, Sept 2026) or @js-temporal/polyfill, manual review.
- **Applies to:** TS/JS (browser, Node, Bun).
- **When not to apply / counterpoints:**
  1. Temporal is not Baseline, so a polyfill costs bundle size.
  2. Date is fine for epoch-millisecond instants when no parsing or calendar math is involved.
- **Fix risk:** medium

### G103-F08 — Share-based accounting must be safe when empty or near-empty (inflation/donation attacks)
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:** Share-based accounting (ERC-4626 vaults, cTokens, LP shares, staking receipts) must be safe when totalSupply is zero or tiny.
  - Use virtual shares and assets, or a decimals offset.
  - Seed the pool with a minimum or dead-share deposit.
  - Never let redeem or mint amounts derived from caller arguments round against the protocol while totalSupply is 0 or tiny.
  - Check existing Compound v2 forks for the Hundred Finance pattern.
- **Rationale:** A donation to an empty pool inflates the exchange rate, so victims' deposits round to 0 shares. Rounding in redeem then lets the attacker withdraw more than is backed. Hundred Finance lost $7.4M this way, and the flaw is generic to Compound v2 forks.
- **Evidence:**
  - [ERC-4626 (OpenZeppelin Contracts 5.x docs)](https://docs.openzeppelin.com/contracts/5.x/erc4626) — OpenZeppelin — official docs — deposit rounding "takes away value from the user in favor of the vault"; the attack condition is `u < 1 + a₁/a₀`; the defence is to include "virtual shares and virtual assets in the exchange rate computation" — confirmed. `_decimalsOffset()` is present in ERC4626.sol.
  - [Hundred Finance — REKT 2](https://rekt.news/hundred-rekt2) — rekt.news, 2023 — incident report — $7.4M on Optimism, 15 Apr 2023; "the attacker donates 200 WBTC to inflate hWBTC's exchange rate"; "the redeemUnderlying function contained a rounding error"; "a general flaw in the code and not specific to Hundred deployment" — confirmed.
  - [compound-precision-loss Semgrep rule](https://raw.githubusercontent.com/Decurity/semgrep-smart-contracts/master/solidity/security/compound-precision-loss.yaml) — Decurity — tool rule — "In Compound forks if there is a market with totalSupply = 0 and collateralFactor != 0 a precision loss attack is possible if redeemAmount is taken from the arguments of redeemFresh()"; references the Hundred post-mortem — confirmed. The repository is not archived; last push June 2025.
- **Detect:** Run `semgrep --config https://raw.githubusercontent.com/Decurity/semgrep-smart-contracts/master/solidity/security/compound-precision-loss.yaml .`. Then check manually:
  - Do the conversion functions use virtual offsets?
  - Is a seed deposit made at deployment?
  - Is there a test in which an attacker deposits 1 wei and donates N, and a victim then deposits less than N?
  - Are markets listed with collateralFactor > 0 before any supply exists?
- **Tools:** Semgrep (Decurity), Foundry/Echidna scenario tests, manual review.
- **Applies to:** Solidity/Vyper vaults, lending markets, staking; Rust on-chain equivalents.
- **When not to apply / counterpoints:**
  1. Virtual offsets change the share price slightly, so on a live vault this is a migration, not a refactor.
  2. Seed deposits are an operational control that can be forgotten when redeploying.
- **Fix risk:** high

### G103-F05 — Never assume token or price-feed decimals; normalise to a declared scale
- **Grade:** B · **Verdict:** CORRECTED
  - The Sherlock evidence was wrong. Issue #42 ("High ... underpaid by 99.99%") is an **unlabelled, unaccepted submission** whose severity was the submitter's own claim; the final ROVA report has only two Medium findings.
  - It is replaced by the accepted finding M-1 ([#231](https://github.com/sherlock-audit/2025-02-rova-judging/issues/231)), a decimals mismatch that let users bypass `maxTokenAmountPerUser`.
  - The Ackee blog author and date are added.
- **Rule:**
  - Never assume a token's or price feed's decimals. Read `decimals()` once, caching it per address and chain, or pin it in reviewed config.
  - Normalise every operand to a declared scale before combining amounts, and put the scale in the name or type (`amountWad`, `priceE8`).
  - Flag every hard-coded 1e18, 1e12, 1e8 or 1e6 factor, and every `parseEther` or `formatEther` applied to a token that does not have 18 decimals.
- **Rationale:**
  - EIP-20 makes `decimals()` optional.
  - Chainlink feeds use 8 or 18 decimals, with exceptions.
  - A scale mismatch is a silent 10^k error. In Sherlock's 2025 ROVA contest, one of the only two accepted findings (M-1, confirmed by the sponsor) was this mismatch: USDC at 6 decimals against an 18-decimal launch token.
  - Fiat has special cases too (Stripe ISK/UGX, HUF/TWD).
- **Evidence:**
  - [EIP-20: Token Standard](https://eips.ethereum.org/EIPS/eip-20) — Vogelsteller and Buterin, 2015 — standard — decimals: "OPTIONAL - This method can be used to improve usability, but interfaces and other contracts MUST NOT expect these values to be present." — confirmed.
  - [Chainlink Data Feeds, Security Researcher's Perspective](https://ackee.xyz/blog/chainlink-data-feeds/) — Ackee Blockchain (Miroslav Skrabal), 7 Aug 2023 — engineering blog — "It shouldn't be assumed that a given feed has x decimals without first verifying it"; most USD feeds use 8 and ETH feeds 18, with AMPL/USD an exception — confirmed.
  - [Sherlock ROVA judging #231 / M-1](https://github.com/sherlock-audit/2025-02-rova-judging/issues/231) — Sherlock, 2025 — audit finding — "`maxTokenAmountPerUser` limit can be bypassed when currency token has less decimals than the launch token" (USDC 6 vs 18); labels Sponsor Confirmed and Will Fix; listed as M-1 in the repo's final README — confirmed (substituted by the verifier).
  - [Precision Loss Errors](https://dacian.me/precision-loss-errors) — Dacian, 2023 — engineering blog — "No Precision Scaling" (Notional, Surge, Olympus, Blueberry ...), "Excessive Precision Scaling" (Notional), "Mismatched Precision Scaling" (Sublime, Yearn, Trader Joe ...) — confirmed.
  - [Supported currencies](https://docs.stripe.com/currencies) — Stripe — official docs — ISK and UGX must be sent as two-decimal values ending in 00; HUF and TWD manual payouts must be multiples of 100 — confirmed.
- **Detect:**
  - `rg -n "1e18|10 ?\*\* ?18|1e12|10 ?\*\* ?12|1e8|1e6|10 ?\*\* ?6|WAD|RAY" -g "*.{sol,ts,py,rs}"`, then check each constant against the real operand.
  - `rg -n "parseEther|formatEther|toWei|fromWei"`.
  - Every `latestRoundData()` consumer must scale by the feed's `decimals()`.
  - Keep a table mapping token address to decimals, per chain.
- **Tools:** ripgrep, ast-grep, manual review, an on-chain `decimals()` query script.
- **Applies to:** Solidity, TS/JS, Python and Rust code handling ERC-20/SPL tokens, oracles and multi-currency fiat.
- **When not to apply / counterpoints:**
  1. Calling `decimals()` at runtime costs gas and trusts the token. Pinning an immutable value at listing time is equally valid if it is explicit and tested.
  2. Replacing a hard-coded factor with a computed one changes outputs for any asset whose real decimals differ.
- **Fix risk:** medium

### G103-F20 — Pin behaviour with golden values, then add property, invariant and fuzz tests
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:** Before any numeric or time hardening change, pin behaviour with characterization tests that use golden values. Then add property, invariant and fuzz tests for these properties:
  - allocations sum to the total;
  - parse/format round-trips are the identity;
  - deposit-then-withdraw never profits;
  - the pool invariant never decreases under repeated minimal operations;
  - results match an arbitrary-precision oracle;
  - the code behaves correctly under several host time zones and frozen clocks around DST and leap days.
- **Rationale:** These bugs are mostly silent wrong values. Per-operation tests miss cumulative adversarial effects. Trail of Bits reports fuzzing as the most effective technique for rounding invariants. The MSR 2025 authors recommend time mocking, property-based round-trips and fuzzing. Di Franco et al. suggest differential testing against arbitrary-precision packages.
- **Evidence:**
  - [Balancer hack analysis](https://blog.trailofbits.com/2025/11/07/balancer-hack-analysis-and-guidance-for-the-defi-ecosystem/) — Trail of Bits, 2025 — incident report — "In our experience, fuzzing is the most effective technique for this type of invariant testing."; "A well-maintained fuzzing suite with the right invariants would aid in identifying that the function is now rounding in the wrong direction." — confirmed.
  - [Check Point on Balancer](https://research.checkpoint.com/2025/how-an-attacker-drained-128m-from-balancer-through-rounding-error-exploitation/) — Check Point, 2025 — incident report — "Traditional testing focuses on individual operation correctness, not cumulative effects of adversarial batch operations." — confirmed.
  - [It's About Time (MSR 2025)](https://rohan.padhye.org/files/datetimebugs-msr25.pdf) — Tiwari et al. — peer-reviewed — "using a combination of timemocking tools and increasing test coverage ...; using property-based testing for string-formatting/parsing; and using fuzz testing for uncovering edge-case DST and out-of-bounds issues"; 60% of bugs "manifest readily when the erroneous code is executed" — confirmed.
  - [Di Franco et al., ASE 2017](https://web.cs.ucdavis.edu/~rubio/includes/ase17.pdf) — peer-reviewed — "Correctness bugs are extremely challenging to detect. Differential testing may be a good method to detect these bugs"; 4% can be detected with simple patterns and 29% might be with program analysis — confirmed.
- **Detect:** For each money, rounding or time module, check that at least one property, invariant or fuzz test exists; a missing test is the finding. Record golden outputs over real historical inputs before refactoring.
- **Tools:** Hypothesis, fast-check, proptest, cargo-fuzz, Echidna, Medusa, Foundry invariant testing, freezegun, libfaketime.
- **Applies to:** All languages.
- **When not to apply / counterpoints:**
  1. Choosing invariants needs domain knowledge, and weak invariants give false comfort (Balancer had audits).
  2. Fuzzing costs CI time. Run long campaigns nightly.
- **Fix risk:** low

### G103-F17 — Every timestamp and duration carries its unit; convert once at the boundary
- **Grade:** B · **Verdict:** VERIFIED (nuance added: Binance `recvWindow` is "milliseconds only" but accepts up to three decimals to express microseconds)
- **Rule:**
  - Put the unit (s, ms, µs or ns) in every timestamp's and duration's type or name.
  - Represent instants as integer counts of a declared unit.
  - Never infer the unit from the magnitude.
  - Convert once at each exchange boundary and assert a plausible range.
  - For signed exchange requests, synchronise with server time and respect the documented window.
- **Rationale:**
  - Exchange APIs differ, and some let you pick the unit per request.
  - A seconds/milliseconds mix-up gives dates in 1970 or far in the future, with no error.
  - Guessing the unit from magnitude misreads 1970s millisecond values.
  - Accumulated conversion error grows with uptime. In the Patriot failure, 24-bit registers on a 1970s-design computer caused a 20% range-gate shift after 8 hours. The battery had run for over 100 hours, and 28 Americans were killed.
- **Evidence:**
  - [Binance Spot API — General API Information](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/general-api-information) — Binance — official docs — timestamps are "in milliseconds by default"; `X-MBX-TIME-UNIT:MICROSECOND`; `recvWindow` is "specified in milliseconds only", default 5000, max 60000, with up to three decimal places for microseconds; the server check is `timestamp < (serverTime + 1 second) && (serverTime - timestamp) <= recvWindow` — confirmed.
  - [pydantic #7940](https://github.com/pydantic/pydantic/issues/7940) — GitHub issue, 2023 — practitioner — the heuristic is "seconds (if >= -2e10 and <= 2e10) or milliseconds"; the Apollo 13 (1970) millisecond timestamp parses to 2245-11-14. `ConfigDict.val_temporal_unit` now exists in the Pydantic docs — confirmed.
  - [fleet-management #71](https://github.com/eclipse-sdv-blueprints/fleet-management/issues/71) — GitHub issue, 2026-09-02 — practitioner — the writer uses `instant.seconds` and the reader `DateTime::from_timestamp_millis()`; 1767225609 (2026-01-01) is returned as "1970-01-21T10:53:45.606Z" — confirmed. Still open.
  - [GAO/IMTEC-92-26 Patriot Missile Defense](https://www.gao.gov/assets/imtec-92-26.pdf) — U.S. GAO, 1992 — incident report — "killing 28 Americans"; "its registers are only 24 bits long, the conversion of time from an integer to a real number cannot be any more precise than 24 bits"; "a 20 percent shift ... after the system had been running for 8 consecutive hours"; "operating continuously for over 100 hours"; the computer is "based on a 1970s design" — confirmed by text extraction of the PDF.
  - [std::chrono::duration](https://en.cppreference.com/w/cpp/chrono/duration) and [its converting constructor](https://en.cppreference.com/w/cpp/chrono/duration/duration) — cppreference — reference — the tick period is "a compile-time rational fraction"; the implicit conversion exists only when it cannot truncate, so truncating conversions need `duration_cast` — confirmed.
- **Detect:**
  - `rg -n "\* ?1000\b|/ ?1000\b|\* ?1e3|/ ?1e3|\* ?1e6|/ ?1e6|\* ?1_?000_?000" -g "*.{py,ts,js,rs,cpp}"` near time variables.
  - `rg -n "fromtimestamp\(|new Date\(|from_timestamp(_millis|_micros)?\(|pd\.to_datetime\("`, then check the unit at each site.
  - Name audit: find fields such as `ts`, `time` or `expires` without a unit suffix.
  - Add range asserts at adapters.
  - Check that signed calls handle server-time sync and recvWindow.
- **Tools:** ripgrep, ast-grep, Pydantic `val_temporal_unit`, std::chrono, Temporal.Duration, Rust Duration.
- **Applies to:** All languages; exchange adapters, market-data pipelines, schedulers.
- **When not to apply / counterpoints:**
  1. Renaming fields is safe. Fixing a wrong conversion factor changes stored data, so it is REPORT-ONLY for persisted data.
  2. Patriot involved 24-bit, 1970s-design hardware. It illustrates drift with uptime and is not a direct analogue of modern code.
- **Fix risk:** low

### G103-F21 — At serialization boundaries send exact amounts and 64-bit IDs as strings; refuse NaN/Infinity
- **Grade:** B · **Verdict:** CORRECTED
  - "APIs are moving to string-encoded int64" was a generalisation from one example. It becomes: at least one exchange spec (Gemini Titan, July 2026, as reported in a third-party spec-drift issue) specifies string-encoded int64.
  - The binance-connector-python report is an external researcher's Informational-severity finding. The maintainers have not confirmed it, although the verifier confirmed the `str(val)` code path in the source.
- **Rule:**
  - Send exact amounts and 64-bit IDs as JSON strings (RFC 7493).
  - Refuse NaN and Infinity on output and on input: `json.dumps(allow_nan=False)` and `json.loads(parse_constant=...)` that raises.
  - Pass pre-formatted decimal strings snapped to tick and step size rather than letting an SDK stringify floats.
  - Treat a change of an int64 field between number and string as a breaking change, and cover it with contract tests.
- **Rationale:** Python's json module emits NaN and Infinity by default, which is invalid JSON. `str(0.1 + 0.2)` serialises as 0.30000000000000004, which can get orders rejected or mis-sized.
- **Evidence:**
  - [json — Infinite and NaN Number Values](https://docs.python.org/3/library/json.html) — PSF — official docs — "by default, this module accepts and outputs Infinity, -Infinity, and NaN as if they were valid JSON number literal values"; JSON numbers are commonly "deserialized into IEEE 754 double precision numbers"; `parse_constant` "can be used to raise an exception if invalid JSON numbers are encountered" — confirmed. `json.dumps(float('nan')) == 'NaN'` was also reproduced locally.
  - [RFC 7493](https://www.rfc-editor.org/rfc/rfc7493.html) — IETF, 2015 — standard — "it is RECOMMENDED to encode them in JSON string values" — confirmed.
  - [binance-connector-python #514](https://github.com/binance/binance-connector-python/issues/514) — GitHub issue, 2026-03-20 — practitioner — `make_serializable` uses `str(val)` on floats; "str(0.1 + 0.2) produces 0.30000000000000004"; "precision issues causing order rejection or unintended quantities". Severity: Informational — confirmed. The source (`common/src/binance_common/utils.py`) does `if isinstance(val, float): return str(val)`. Still open.
  - [pmxt #1878](https://github.com/pmxt-dev/pmxt/issues/1878) — GitHub issue, 2026-07-26 — practitioner — says the Gemini Titan OpenAPI artifact (published 15 Jul 2026) specifies that all int64 response fields use string encoding — confirmed as reported. The verifier did not open the Gemini spec itself.
- **Detect:**
  - Python: `rg -n "json\.dumps\(" -t py` (check for `allow_nan=False`); `rg -n "str\((price|qty|quantity|amount)" -t py`.
  - TS: `rg -n "JSON\.stringify\(" -t ts`; `ast-grep -p 'String($X)'` and `$X.toString()` on number amounts, which can produce exponent notation.
  - Contract tests with recorded fixtures.
- **Tools:** ripgrep, ast-grep, contract tests.
- **Applies to:** Python and TS/JS services and bots talking to exchanges, RPC nodes and each other.
- **When not to apply / counterpoints:**
  1. Strings push parsing onto every consumer and lose schema-level numeric typing unless the field is annotated (for example with `x-bigint`).
  2. `allow_nan=False` turns silent corruption into exceptions, which is a behaviour change.
- **Fix risk:** medium

### G103-F19 — Store future local-time events as local date-time + IANA zone; derive UTC
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:**
  - For future events defined in local time, store the local date-time plus the IANA zone ID and derive UTC from them. The RFC 9557 suffix format is, for example, `[Europe/Paris]`.
  - Never model a place that observes DST with a fixed offset.
  - Guard calendar arithmetic against DST gaps and folds, and against leap days (`date.replace(year=...)`).
- **Rationale:** Offsets cannot express DST rules, and zone rules change after data is stored. The MSR 2025 CodeQL queries found real bugs of both kinds: fixed offsets and partial replacement, including `now().replace(year=now().year-2)`, which fails on 29 Feb.
- **Evidence:**
  - [RFC 9557 Date and Time on the Internet: Timestamps with Additional Information](https://www.rfc-editor.org/rfc/rfc9557.html) — IETF, April 2024 — standard — for "an instant in time with an associated time zone name in order to take into account events such as daylight saving time transitions"; its example shows adding six months to `...+01:00[Europe/Paris]` with summer-time adjustment — confirmed.
  - [Storing UTC is not a silver bullet](https://codeblog.jonskeet.uk/2019/03/27/storing-utc-is-not-a-silver-bullet/) — Jon Skeet, 27 Mar 2019 — engineering blog — "Any time you discard information, that should be a conscious choice."; "Option 3: preserve local time, using UTC as derived data to be recomputed" (store local time, zone ID, derived UTC and rules version) — confirmed.
  - [It's About Time (MSR 2025)](https://rohan.padhye.org/files/datetimebugs-msr25.pdf) — Tiwari et al. — peer-reviewed — the fixed-offset query found "23 results, with only 1 being an actual bug"; the partial-replacement query found "37 results, of which only 2 were true positives", including "now().replace(year=now().year-2)"; DST caused 7.9% of bugs — confirmed.
- **Detect:** `rg -n "timezone\(timedelta\(hours|FixedOffset|UTC[+-][0-9]|[+-]0[0-9]:00['\"]|Etc/GMT[+-]" -g "*.{py,ts,js,rs}"`; `rg -n "\.replace\(year=" -t py`; review the schema of scheduled and expiry columns. Expect heavy false positives (1 of 23 and 2 of 37 in MSR 2025).
- **Tools:** ripgrep, CodeQL custom queries, Hypothesis (DST and leap-day fuzzing), manual review.
- **Applies to:** All languages; schedulers, expiries, venue calendars, reporting.
- **When not to apply / counterpoints:**
  1. For instants that already happened, UTC or epoch integers are correct and simpler.
  2. Fixed offsets are legitimate for zones without DST. MSR 2025's false positive was UTC+8 for Shanghai.
- **Fix risk:** high

## Practitioner voice

- [HN: Never Use Floats for Money (2016), thread from 2020](https://news.ycombinator.com/item?id=22321782) — Commenters recommend integer cents and push back. "No, the answer is floating point" (riskneutral). Error "is swamped by the errors in your models" (nostrademons, [22322636](https://news.ycombinator.com/item?id=22322636)). Integer cents struggle with interest and division ([22322480](https://news.ycombinator.com/item?id=22322480)) and VAT ([22324376](https://news.ycombinator.com/item?id=22324376)). Anecdote: banks in the 1990s were "caught skimming" by choosing exchange amounts so rounding favoured them (toolslive).
- [sieblyio/gateio-api #101](https://github.com/sieblyio/gateio-api/issues/101) — Jan 2026. The community Gate.io SDK's JSON parsing corrupts large auto-order orderIds, so orders cannot be cancelled. The issue is open, and the maintainer is considering an opt-in custom parser.
- [ccxt/node-binance-api #539](https://github.com/ccxt/node-binance-api/issues/539) — Dec 2020. Binance futures ETHUSDT order IDs outgrew JS Number and broke `JSON.parse`. The reporter switched to json-bigint. The issue is still open, labelled "help wanted" and "needs-testing".
- [binance/binance-connector-python #514](https://github.com/binance/binance-connector-python/issues/514) — Mar 2026. An external researcher reports that the official connector serialises float parameters with `str()` (Informational severity). The verifier confirmed the code path.
- [sammchardy/python-binance #219](https://github.com/sammchardy/python-binance/issues/219) — 2018. "Filter failure: LOT_SIZE" after computing quantity as `float(balance) * 0.9995`. **Corrected gist:** the fixes in the thread round to a hard-coded 6 decimals or to `round(quantity, precision)` derived from stepSize, plus hand-written float truncation. They are float-based, not Decimal plus floor. The claim that this "recurs across many bot repos 2018-2026" was not verified and is removed.
- [wevm/viem #4855](https://github.com/wevm/viem/issues/4855) — Jul 2026. `parseUnits('1.4499999999999999999', 1)` gave 15n because of `Math.round(Number(...))`. **Corrected:** fixed by PR #4859 (merged 2026-07-18, shipped in 2.55.4). The earlier PR #4732 describing "3.4999999999999999999" becoming 4n was closed unmerged.
- [ethers-io/ethers.js #4833](https://github.com/ethers-io/ethers.js/issues/4833) — Sep 2024, ethers 6.9.0. `parseEther` on a 19-decimal string that came from `A0.toString()` throws "too many decimals for format". This is the friction strict parsing creates.
- [pydantic/pydantic #7940](https://github.com/pydantic/pydantic/issues/7940) — 2023. Magnitude-based seconds/milliseconds guessing turned a 1970 millisecond timestamp into the year 2245. An explicit unit now exists (`val_temporal_unit`).
- [eclipse-sdv-blueprints/fleet-management #71](https://github.com/eclipse-sdv-blueprints/fleet-management/issues/71) — Sep 2026, Rust. A timestamp written in seconds is read with `from_timestamp_millis`, so 2026 GNSS data shows as 1970-01-21. There is no error.
- [woocommerce/woocommerce PR #65997](https://github.com/woocommerce/woocommerce/pull/65997) — 2026. The order-tax aggregation uses an always-HALF_UP helper while per-rate rows honour the configured mode. **Corrected:** the PR is still open and unmerged, and the linked issue was closed as "not planned".
- [Cloudflare leap-second post-mortem](https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/) — 2017. Subtracting wall-clock values gave a negative RTT and `rand.Int63n` panicked. The fix was "one character", and the incident is cited in Go's monotonic-time proposal.
- [HN discussion of the Cloudflare incident](https://news.ycombinator.com/item?id=13297810) — "I habitually do <= checks for things that should never be below 0" (esailija). Go "does not expose that clock" (zigzigzag). A call for leap smearing (HappyTypist).
- [Meta: leave the leap second in the past](https://engineering.fb.com/2022/07/25/production-engineering/its-time-to-leave-the-leap-second-in-the-past/) — Reddit's 30-40 minute outage in 2012, and Meta's 17-hour leap smear.
- [Jon Skeet: Storing UTC is not a silver bullet](https://codeblog.jonskeet.uk/2019/03/27/storing-utc-is-not-a-silver-bullet/) — For future local events, store local time plus zone ID and derive UTC.
- [rust-lang/rust-clippy #7725](https://github.com/rust-lang/rust-clippy/issues/7725) — dtolnay, 2021: float_cmp was "by far the most suppressed `correctness` lint on crates.io". **Corrected:** PR #7692 had already moved it to pedantic, and #7725's proposal to move it to restriction or nursery is still open. The EPSILON advice has since been removed from the lint docs.
- [Dacian: Precision Loss Errors](https://dacian.me/precision-loss-errors) — 2023. A catalogue of 7 precision-loss patterns, each with named audit findings.
- [Sherlock ROVA M-1 (#231)](https://github.com/sherlock-audit/2025-02-rova-judging/issues/231) — 2025. A decimals mismatch (USDC 6 vs an 18-decimal launch token) bypasses `maxTokenAmountPerUser`. Medium, confirmed by the sponsor. It **replaces** #42, which was an unaccepted self-rated "High".
- [Balancer ScalingHelpers.sol](https://github.com/balancer/balancer-v2-monorepo/blob/master/pkg/solidity-utils/contracts/helpers/ScalingHelpers.sol) — Primary source. The comment admits swaps should round in opposite directions but rounds `_upscale` down "as the impact of this rounding is expected to be minimal". That path was exploited for over $100M in Nov 2025.

## Contradictions and open questions

**Contradictions**
- **Balancer v2 loss figures differ by source** (3 Nov 2025).
  - Trail of Bits: "more than $100M across nine blockchain networks".
  - Check Point: "$128.64 million across six blockchain networks".
  - OpenZeppelin: "exceeding $120M" across Balancer and its forks.
  - The root cause (`_upscale` with `mulDown`, amplified by `batchSwap`) is consistent. A fourth figure attributed to bex.co was not verified and is removed.
- **"Never use floats for money" versus quant practice.** CERT FLP02-C, the Python decimal docs, CCXT and Effective Java all say avoid floats. Quant and insurance practitioners say doubles are right for models (HN 22322636, 22322641). This dossier resolves it by scoping the rule to booked, settled and ordered values.
- **Integer minor units versus decimal types.** Integer cents struggle with VAT, interest and division. Minor-unit exponents are not uniform (Stripe ISK/UGX/HUF/TWD), and 18-decimal token amounts exceed int64.
- **Rounding defaults conflict across ecosystems:**
  - half-even: Python `round`, Python `decimal`, rust_decimal;
  - half-up or half-away-from-zero: decimal.js, big.js, viem `parseUnits`;
  - truncation toward zero: Solidity and BigInt.
- **Strict versus lenient amount parsing.** ethers v6 throws on excess decimals (#4833). viem rounds half-up, and before 2.55.4 it rounded through a JS float. Neither behaviour is "the standard".
- **Multiply-before-divide versus overflow.** Slither recommends multiplying first but itself warns "unless the limit of a smaller type makes this dangerous". A full-precision mulDiv reconciles the two.
- **Overflow checking.** Rust release profiles turn checks off for performance (RFC 560, Cargo defaults), while Solana's official examples turn them on (49 Cargo.toml files). Decurity's gas rule `unnecessary-checked-arithmetic-in-loop` recommends `unchecked` only for loop counters. That is narrower than "pushes developers toward unchecked blocks", but it normalises `unchecked` usage.
- **Clippy float_cmp.** It was the most-suppressed correctness lint and was moved to pedantic (PR #7692). Its EPSILON advice has since been **fixed in the docs**, which now say "Do not use `f64::EPSILON`". So this is no longer a live contradiction in Clippy's guidance, only in older code and advice.
- **"Always store UTC" versus Jon Skeet** for future local events. RFC 9557 (2024) adds zone-name suffixes, which sides with keeping the zone ID.
- **Vancouver Stock Exchange figures vary across secondary sources.** Only the Wikipedia/WSJ figures (524.811 corrected to 1098.892) are used. The MathWorld variant was not opened.
- **OWASP coverage gap.** The OWASP Smart Contract Top 10 (2025) has SC08 Integer Overflow and Underflow but no precision-loss or rounding-direction category, even though rounding bugs caused KyberSwap (over $48M) and Balancer (over $100M).
- **Scope of the empirical evidence.** Di Franco et al. say numerical bugs "are not as numerous in general-purpose applications", and accuracy bugs were the least frequent class (14%). Their headline percentages come from numerical libraries, not money or bot code.

**Open questions**
- **No lint for "float used for money".** No lint in any of the five languages detects a binary float used for a monetary or token quantity. The rg and ast-grep heuristics here have not been tested. Should the skill ship curated rules with a false-positive benchmark?
- **No prevalence data for application code.** No peer-reviewed study measures how common float-for-money or ID-precision bugs are in application or bot code. The off-chain evidence is practitioner issues (grade C/D), several of them still open or unconfirmed by maintainers (Gate SDK, binance-connector #514, WooCommerce #65997).
- **When to recommend Temporal.** Safari has it only in Technology Preview, and Node 26 is not yet the default LTS for many deployments. When can the skill recommend Temporal without a polyfill?
- **Which JS decimal library.** TC39 Decimal is Stage 1 and Amount is Stage 2. Should the skill recommend big.js, decimal.js, bignumber.js or dinero.js, given their different default rounding modes?
- **Unverified incidents.** Resupply (June 2025), Sonne Finance (May 2024) and Raft (Nov 2023) were not verified and are not used.
- **Enforce or flag Rust overflow checks.** Should the skill enforce `overflow-checks = true` in release profiles, or only flag its absence? Evidence supports both.
- **Rounding direction off-chain.** No off-chain standard equivalent to ERC-4626 was found for rounding direction beyond the Money/allocation pattern.
- **Resolved: Binance LOT_SIZE formula.** The current docs read `quantity % stepSize == 0` and `price % tickSize == 0`, with no minQty or minPrice offset. Historical variants were not checked.

## Dropped findings

None of the 21 findings was dropped. These parts were removed or replaced:
- G103-F05, evidence: Sherlock ROVA #42 was presented as a "High" finding with 99.99% underpayment. It was an unaccepted, unlabelled self-rated submission, and it is replaced by M-1 (#231).
- G103-F04, evidence: viem PR #4732 was described as "merged 2026-06-13". It was closed unmerged, and the merged fix is PR #4859.
- G103-F12, evidence: WooCommerce PR #65997 was described as a merged consistency fix. It is still open.
- Practitioner voice, python-binance #219: the gist's "community fix is Decimal and flooring; recurs across many bot repos 2018-2026" was not supported by the thread and is removed.
- Contradictions: the bex.co Balancer figure was not verified and is removed.
