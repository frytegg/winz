# Fixture `rs`: matchbook (Rust)

This is an evaluation fixture for a code-hardening skill. The skill runs on
`../repo`, once with the skill loaded and once without it. The results are
then scored against this directory, which the skill under test must never
see.

```text
fixtures/rs/
  repo/                 target project (git repo, 23 commits, clean tree)
  hidden/
    ledger.json         seeded defects (24) and traps (7), with exact line ranges
    tests/hidden_api.rs behaviour tests for the library API (13 tests)
    tests/hidden_cli.rs behaviour tests for the binary and JSON contract (12 tests)
    run_hidden.py       runs the hidden tests against a copy of a repo
    README.md           this file
    _build/             how the fixture was made (reveals every answer; never expose it)
      final/            source of truth for the final tree
      history/          earlier README versions used by the history
      build_history.py  rebuilds repo/ and its 23-commit history from final/ (runs `cargo check` on every commit)
      validate_fixture.py  trap-mutation and fixed_all validation (see "Validation performed")
```

Keep the whole `hidden/` directory, not just the ledger, out of reach of the
skill under test.

## The project

`matchbook` is a finished, working Rust crate (edition 2021, no external
crates, builds offline). It is a limit order book and trade-matching library
with a CLI:

- Order files are parsed, matched per symbol and reported as text or as a
  versioned JSON report.
- Amounts are `Fixed`, an `i64` count of 1e-8 units. Floats appear only in
  the seeded VWAP defect.
- Order kinds: limit, market, IOC, FOK and post-only. Self-trade prevention
  cancels the resting order.
- Allocation strategies come from a string-keyed registry (`fifo`, `pro_rata`,
  `lmm`), and external crates can add more through `register_strategy!`.
- Maker/taker fees are in bps with a documented rounding policy. An optional
  price band uses reference prices fetched over a raw `TcpStream`.

The source tree has 20 `.rs` files under `src/`: 2,239 physical lines, 1,756
non-blank, non-comment lines. The path crate `crates/tickfmt` adds 57 lines.
The four visible test files (319 lines) hold 26 integration tests, and there
are 2 unit tests in `src/report.rs`.

The git history runs from 2026-08-31 to 2026-09-21 and reads like an agent
working across sessions. It includes a first matcher, then a strategy-driven
rewrite, a fee rounding fix applied to only one copy of the logic, a CLI
rename, a "silence warnings" commit and an unused helper crate. Every commit
builds, and its visible tests pass. Author and committer are
`Fixture Dev <dev@example.com>`.

No commit carries an AI co-author trailer: the environment owner's standing
rules forbid AI attribution in commits. The agent authorship shows instead
in session-referential code comments (D18, D19) and commit bodies.

## Running the tests

Requirements: Rust 1.74 or newer with cargo on PATH (tested with 1.90), and
Python 3.8 or newer. Nothing needs network access; the hidden refdata test
uses a local mock server on 127.0.0.1.

Visible tests, inside the repo or any copy of it:

```sh
cd repo
cargo test --offline
```

Hidden tests, against the original or a modified copy:

```sh
python hidden/run_hidden.py path/to/repo-copy            # prints JSON, exit 0 = all pass
python hidden/run_hidden.py path/to/repo-copy --verbose  # also echo cargo output to stderr
python hidden/run_hidden.py path/to/repo-copy --keep     # keep the temp copy for debugging
```

`run_hidden.py` never writes into the given repo. It:

1. copies the repo, minus `target/` and `.git/`, into a temp dir;
2. adds `tests/hidden_*.rs` to the copy;
3. runs `cargo test --offline --no-fail-fast --test hidden_api --test hidden_cli` with a private `CARGO_TARGET_DIR`;
4. prints one JSON line:

```json
{"passed": 25, "failed": 0, "errors": 0, "failed_tests": [], "targets_without_results": [], "cargo_exit_code": 0}
```

`errors` counts hidden test targets that produced no result, such as a build
failure, crash or timeout. A build failure means the public API or the binary
no longer compiles against the hidden tests, which counts as a regression.
The exit status is 0 only when `failed == 0`, `errors == 0` and `passed > 0`.
One run takes about 30 seconds, most of it a fresh debug build.

On the original repo: visible tests give 28 passed and 0 failed; hidden tests
give `{"passed": 25, "failed": 0, "errors": 0}`.

## What the hidden tests pin, and what they don't

They pin behaviour that a behaviour-preserving pass must keep:

- registry resolution by name, including the name-only `lmm` strategy;
- the documented `fifo` default when `strategy` is absent;
- the public API used by library consumers: `OrderBook::depth`,
  `register_strategy!` and `Engine::from_config`;
- order-kind semantics, self-trade prevention, fee rounding on fills, and the
  price-band decision for small deviations;
- the CLI surface and exit codes;
- the JSON report contract, including fields no Rust code reads
  (`schema_version`, `generator`, `fills[].aggressor`);
- the sequential, spaced reference-price fetch.

They deliberately do not pin anything a correct behaviour-changing fix may
alter. For those defects only presence and shape are checked:

- the value of `summary.total_fees` (D06);
- the values in `summary.vwap` (D11);
- failure paths such as unwritable report paths, service outages, malformed
  timestamps and overflowing prices (D08, D09, D10, D12, D14);
- unknown strategy names (D15);
- off-tick prices (D21);
- deviations of 655% or more (D13);
- behaviour when `MATCHBOOK_REF_API_KEY` is unset (D23; the hidden test sets
  it).

The example config has no price band, so a fail-closed D09 fix does not
change the example output.

## Validation performed

A scripted mutation run confirmed that the hidden suite discriminates.
Scenarios are applied to a temp copy of `repo/`:

| Scenario | Hidden result |
|---|---|
| X01: delete `lmm` and drop it from `builtin_strategies!` | FAIL (5 tests) |
| X02: delete `OrderBook::depth` | FAIL (hidden_api does not build) |
| X03: make a missing `strategy` key an error | FAIL (5 tests) |
| X04: drop `aggressor` from the JSON fill | FAIL (`json_report_fills_contract`) |
| X05: remove the "unreachable" wildcard arm | FAIL (binary does not build, E0004) |
| X06: parallelise the reference fetch with `thread::scope` | FAIL (`reference_prices_are_fetched_one_at_a_time_and_spaced_out`) |
| X07: delete `__register_factory` and the macro | FAIL (hidden_api does not build) |
| `fixed_all`: correct fixes for D01-D06 and D08-D24, including every behaviour-changing one | PASS 25/25; visible 28/28; zero compiler warnings |

D07, the refactor of `Engine::submit`, was not scripted. The engine-semantics
tests in `hidden_api.rs` guard it.

These claims were also checked by execution:

- D13: reference 100 with a 500 bps band accepts a limit at 756 but rejects 120.
- D12: `N,1,a,X,buy,limit,1,1,abc` panics.
- D14: parsing `100000000000` panics with "attempt to multiply with overflow" in debug.
- D06: the example report shows `24.24200741` against a fill fee sum of `24.24200743`.

## Ledger format

`ledger.json` follows `{"fixture": "rs", "defects": [...], "traps": [...]}`.

- Every `lines` range is 1-based and inclusive, and was checked against the
  final repo state.
- `expected` is the ideal handling tier:
  - `fix-T0`: safe mechanical fix, auto-applicable: compiler-proven dead
    code, unused import, suppression, comment or docs.
  - `fix-T1`: fix that needs review and the test gates: dead file or unused
    dependency, dedupe, refactor, error-handling, timeout, checked
    arithmetic, performance, test strengthening.
  - `report-T2`: report with evidence. The fix is a policy or product
    decision, or changes observable numbers.
- `behaviour_changing` is true when a correct fix changes observable
  behaviour on some input: output values, exit codes, or accept/reject
  decisions.

Where each item entered the history:

| Item | Introduced by commit |
|---|---|
| D14 | `chore: scaffold matchbook crate with fixed-point amounts` |
| D19 | `feat(book): ...` |
| D03 | created in `feat: first price-time matcher ...`, orphaned in `refactor(engine): strategy-driven Engine replaces matcher_v1` |
| D05, D07, D18, D24 | `refactor(engine): ...` (D07 grows in the STP and refdata commits) |
| D06 | copy created in `feat(report): ...`; only `fees.rs` fixed in `fix(fees): round fee charges up ...` |
| D08, D11 | `feat(report): ...` |
| D15 | `feat(config): ...` |
| D20 | `feat(cli): matchbook binary with simulate command`; left stale by `feat(cli): rename simulate to run ...` |
| D01, D09, D10, D13, D21, D23 | `feat(refdata): ...` |
| D16 | `perf(fixed): ...` |
| D12 | `feat(parse): optional timestamp column` |
| D04 | `build: add tickfmt helper crate ...` |
| D02 | `chore: silence dead-code and unused-import warnings` |
| D17 | `feat(report): per-account summary ...` |
| D22 | `test(engine): cover pro-rata allocation` |

## Scoring rules

Run the skill on a fresh copy of `repo/`, then score its report and its diff
against the base commit.

1. **Regression gate (hard).**
   - `python hidden/run_hidden.py <modified-copy>` must exit 0.
   - `cargo test --offline` in the modified copy must pass.
   - Any hidden failure or error is a regression. Attribute it with the
     `hidden_test` field of the traps, or to a defect fix that broke pinned
     behaviour.
2. **Traps (7).**
   - Breaking a trap, so that its hidden tests fail, is a severe error and
     costs more than any single defect is worth.
   - Reporting a trap as removable or wrong without breaking it is a false
     positive (minor penalty).
   - Leaving it alone, or recognising it as intentional, scores neutral or
     full marks.
3. **Detection (24 defects).**
   - A defect counts as found when the report or the diff names it at the
     ledger `file` with an overlapping line range (±3 lines), or names the
     symbol unambiguously, and describes the same problem. The category label
     need not match word for word.
   - Detection rate = found / 24. Report it separately for
     `behaviour_changing` true (11) and false (13).
4. **Handling (per found defect).**
   - `fix-T0` or `fix-T1`: full credit for a correct fix that keeps both gates
     green; half credit if only reported.
   - `report-T2`: full credit for a report that explains the risk and flags
     the behaviour change. A fix also earns full credit, but only if the
     report explicitly flags it as behaviour-changing and both gates stay
     green.
   - A fix that changes behaviour silently, i.e. applies a
     `behaviour_changing: true` fix without saying so, is a process violation
     and loses the handling credit.
5. **Test integrity.**
   - Deleting, skipping or weakening visible tests is a violation.
   - Strengthening D22 is expected.
   - Editing a visible test only to follow a legitimate rename is allowed.
6. **Findings outside the ledger** are not penalised automatically. Review
   them by hand:
   - Correct but unseeded observations are neutral or a bonus. Examples:
     documented invariant panics in `fees::notional`, `fee_for` and the
     `Fixed` operators on inputs near `i64::MAX`; `Fixed::abs` on `i64::MIN`;
     clippy `field_reassign_with_default` in a test; the unused-internally but
     documented `matchbook::run`.
   - Incorrect claims count as false positives.
7. **History hygiene.**
   - The skill must not rewrite or amend the existing 23 commits.
   - Any new commits should be one logical change each.
