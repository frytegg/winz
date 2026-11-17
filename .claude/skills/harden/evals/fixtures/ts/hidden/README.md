# TypeScript fixture: `pricewatch`

Evaluation fixture for a code-hardening skill. `../repo` is a small, finished,
working TypeScript project (Node 24, pnpm, vitest, strict tsconfig): a crypto
price-alert and portfolio CLI and library. It fetches tickers from exchange
REST APIs through an injectable `HttpClient`, values holdings, derives PnL
from trade exports, evaluates alert rules and notifies through plugins loaded
by name from a JSON config. It exposes a public API from `src/index.ts` and a
CLI in `src/cli.ts`.

The repo was written to look like the output of an AI coding agent over
several sessions, and its history is 24 commits from 2026-08-24 to 2026-09-14,
authored by `Fixture Dev <dev@example.com>`. It contains **25 seeded defects**
and **8 traps**. Nothing in the repo marks either. This directory holds the
answer key and must never be shown to the agent under test.

| Path | Purpose |
| --- | --- |
| `ledger.json` | Answer key: defects (`D01` to `D25`) and traps (`X01` to `X08`) with exact line ranges in the final repo state |
| `tests/*.test.ts` | Hidden behaviour tests (vitest), 97 tests in 9 files plus `_support.ts` |
| `run_hidden.py` | Runs the hidden tests against a copy of a repo |

Size: 25 source files, 1,939 lines in `src/`, plus 482 lines of visible tests
in 8 files (38 tests).

## Running the tests

Requirements: Node 24+, pnpm 10, Python 3.11+.

Visible tests (the repo's own suite):

```sh
cd ../repo
pnpm install
pnpm test          # 8 files, 38 tests
pnpm typecheck
```

Hidden tests:

```sh
python run_hidden.py <path-to-repo-copy>
```

`run_hidden.py` never modifies the path it is given. It copies the repo into a
fresh temp directory, leaving out `node_modules`, `.git`, `dist`, `coverage`
and `.pricewatch`. It then copies `tests/` to `tests/hidden/` in the copy and
writes its own `vitest.hidden.config.mjs`, so the repo's vitest config does not
matter. Next it runs `pnpm install --frozen-lockfile --prefer-offline`,
falling back to a non-frozen install if the agent edited `package.json`
without refreshing the lockfile. Finally it runs vitest with the JSON
reporter. It prints one JSON line:

```json
{"passed": 97, "failed": 0, "errors": 0, "total": 97, "failures": []}
```

`errors` counts test files that failed to load (import or syntax errors),
unhandled errors reported by vitest, and infrastructure failures. The exit
code is 0 only if every hidden test passed with no errors. On the unmodified
repo the result is 97 passed, 0 failed, 0 errors, and a run takes about 7 s
with a warm pnpm store.

## What the hidden tests pin

They pin only the observable contract:

- **Public API.** Every function in README "Library usage" is exported, and
  `splitPair`, `formatPair` and `normalizeAsset` behave as documented.
- **Registry and loading.** Importing `src/index.ts` registers `binance` and
  `kraken`; `createExchange` resolves both by name, and both parse their ticker
  payloads.
- **Plugins.** `console`, `file` and `webhook` load by name and do what they
  should; unknown names and path-like names are rejected with `PluginError`.
- **Pegged assets.** A pegged asset with no market is valued at 1 with
  `priceSource: "peg"`, a real market wins over the peg, and the table marks
  such rows with `*`.
- **Snapshot contract.** `snapshot` output includes `schemaVersion: 1`, the
  top-level keys, the holding keys and exact totals, both on stdout and with
  `--out`.
- **Unknown rule kinds.** They throw `UnsupportedRuleError`, both from
  `evaluateRule` and through the engine.
- **Rate limiting.** `getTickers` never has two requests in flight, keeps
  input order, spaces calls with the limiter, and skips failed assets.
- **CLI.** Option parsing (inline and separate values, normalization, every
  error message), `value` (table rows and totals, `--json`, exchange
  override), `pnl`, `alerts` (`--dry-run`, plugin delivery, the drawdown
  rule), `watch`, `plugins`, `--help`, `--version`, and exit codes 0, 1 and 2.
- **Library behaviour.** Trade parsing, deduplication and average-cost
  positions, per-rule cooldowns, and config defaults.

They deliberately **do not** pin anything a correct fix would change. Inputs
are chosen so that results are exact in binary floating point (D11), no test
checks the row order of the `value` table (D25), the representation of
`orderId` (D12), the cooldown state file format (D24), the fallback for an
unreadable config (D08), the zero price for a missing non-pegged ticker (D09),
the `X-MBX-APIKEY` header (D23), timeouts (D10) or notifier-failure handling
(D07). `_build/ts/mutate.py` checked this: applying reference fixes for
D01, D02, D05, D07 to D13, D16, D17 and D23 to D25 in one copy still gives
97/97. Breaking each trap on its own makes the suite fail: between 2 and 29
tests go red, depending on the trap.

## Ledger format

```json
{"fixture": "ts",
 "defects": [{"id", "category", "file", "lines": [start, end], "description",
              "expected": "fix-T0" | "fix-T1" | "report-T2",
              "behaviour_changing": bool, "detection_hint"}],
 "traps":   [{"id", "file", "lines", "description", "why_required", "hidden_test"}]}
```

`file` is relative to the repo root. `lines` is 1-based and inclusive, and was
verified against the final commit (`_build/ts/verify_ledger.py` checks an
anchor string for every entry). Some descriptions name related locations
elsewhere in the code (for example D12 also points at `src/types.ts:8`, and
D21 at the schema and CLI lines).

### Expected handling tiers

| Tier | Meaning | What counts as correct |
| --- | --- | --- |
| `fix-T0` | Safe, local, behaviour-preserving cleanup: dead code, noise comments, stale docs, a missing `await`, a linear-time rewrite, a hollow test | The change is applied, and hidden and visible tests still pass |
| `fix-T1` | Real defect whose fix is local but changes behaviour or needs care, such as error semantics, numeric representation or a public type | The fix is applied and justified, with a test or a clear note of the behaviour change. Reporting it without fixing earns partial credit |
| `report-T2` | Needs an owner decision or a large refactor (D06 complexity, D21 unimplemented `quietHours`) | Reported with location and rationale. A behaviour-preserving change is acceptable; a behaviour change made without a decision counts as overreach |

`behaviour_changing` says whether the correct fix changes observable behaviour
(outputs, errors, exit codes, types or file formats). It tells you whether
visible tests may legitimately need updating and whether the report should say
so.

## Scoring rules

1. **Detection.** A defect is detected when the agent's report or diff names
   the same file and a location overlapping the ledger range. A tolerance of
   ±3 lines, or a related location named in the description, also counts,
   provided the root cause matches. Detection gives 1 point per defect.
2. **Handling.** The handling is correct when it matches the tier as defined
   above, and gives 1 more point per defect. A `fix-T0` or `fix-T1` defect
   that is reported but not fixed gets 0.5. A `report-T2` defect that is
   changed in a way that alters behaviour gets 0.
3. **Traps.**
   - If a hidden test fails, every trap it covers counts as broken. That
     costs −3 per trap and marks the run "regressed".
   - Recommending that a trap be removed, parallelized or collapsed, without
     actually changing it, is a false positive and costs −1.
   - Leaving the trap alone, or noting it as intentional, scores 0 and is the
     correct outcome.
4. **Behaviour preservation.** `run_hidden.py` must exit 0 on the final state
   of the agent's repo, and `pnpm test` and `pnpm typecheck` must pass in it.
   Visible tests may be edited only where a `behaviour_changing: true` fix
   requires it, or to strengthen D22.
5. **Neutral findings.** Findings outside the ledger are neither rewarded nor
   penalised, unless they break a trap or a test. Known neutral items:
   `eslint.config.mjs` imports `typescript-eslint`, which is not installed
   because the fixture keeps devDependencies to typescript, vitest and
   @types/node; `.npmrc` uses `node-linker=hoisted` to keep vitest paths under
   the Windows MAX_PATH limit; and the Kraken ticker `timestamp` uses the
   local clock.

Suggested summary metrics are recall (detected / 25), handling accuracy
(correct handling / detected), trap safety (traps intact / 8), false positives
on traps, and the hidden-test result. Compare runs with and without the skill
on identical copies of `../repo`.

## Defect and trap index

| ID | Category | Location | Expected |
| --- | --- | --- | --- |
| D01 | unused export | src/portfolio/format.ts:23-25 | fix-T0 |
| D02 | unused file | src/util/csv.ts:1-18 | fix-T0 |
| D03 | unused dependency (dotenv) | package.json:30-32 | fix-T0 |
| D04 | commented-out code | src/alerts/engine.ts:95-103 | fix-T0 |
| D05 | duplicate that missed a later fix | src/config/load.ts:22-24 | fix-T1 |
| D06 | over-complex function (parseArgs) | src/cli.ts:83-193 | report-T2 |
| D07 | error swallowed at debug level, cooldown recorded anyway | src/alerts/engine.ts:108-113 | fix-T1 |
| D08 | success-shaped config fallback | src/config/load.ts:32-37 | fix-T1 |
| D09 | missing price valued at 0 | src/portfolio/valuation.ts:35 | fix-T1 |
| D10 | fetch without timeout | src/http/client.ts:36-40 | fix-T1 |
| D11 | float quantities and money, exact compares | src/portfolio/trades.ts:84-105 | fix-T1 |
| D12 | order ids above 2^53 through Number() | src/portfolio/trades.ts:56 | fix-T1 |
| D13 | floating promise | src/alerts/engine.ts:89-90 | fix-T0 |
| D14 | bare @ts-ignore hiding a real error | src/exchange/adapters/kraken.ts:46-47 | fix-T1 |
| D15 | blanket eslint-disable | src/config/schema.ts:1 | fix-T1 |
| D16 | unbounded cache | src/exchange/exchange.ts:89-110 | fix-T1 |
| D17 | quadratic dedupe | src/portfolio/trades.ts:70-72 | fix-T0 |
| D18 | session-referential comment | src/alerts/engine.ts:72-73 | fix-T0 |
| D19 | narrating step comments | src/portfolio/valuation.ts:49-60 | fix-T0 |
| D20 | stale README command (`check`) | README.md:43-51 | fix-T0 |
| D21 | TODO placeholder, `quietHours` ignored | src/alerts/engine.ts:60 | report-T2 |
| D22 | test with no real assertion | tests/engine.test.ts:26-38 | fix-T0 |
| D23 | hardcoded (fake) credential | src/exchange/adapters/binance.ts:6-8 | fix-T1 |
| D24 | locale-dependent timestamp round trip | src/alerts/state.ts:25-35 | fix-T1 |
| D25 | table sorted by formatted string | src/portfolio/format.ts:45 | fix-T1 |
| X01 | plugin loaded only by name | src/plugins/builtin/file.ts:1-23 | keep |
| X02 | side-effect import | src/index.ts:6 | keep |
| X03 | adapter reached only via the registry | src/exchange/adapters/kraken.ts:1-63 | keep |
| X04 | public API unused internally | src/exchange/symbols.ts:23-30 | keep |
| X05 | documented intentional fallback (peg) | src/portfolio/valuation.ts:31-34 | keep |
| X06 | output-contract field never read | src/portfolio/snapshot.ts:46 | keep |
| X07 | exhaustive `default` that looks unreachable | src/alerts/rules.ts:50-53 | keep |
| X08 | intentionally sequential, skip-on-failure loop | src/exchange/exchange.ts:113-126 | keep |

D24 depends on the locale. It shows under fr-FR, the default on the machine
that built the fixture, and under any other locale whose `toLocaleString()` is
not month-first.

## Notes on how the fixture was built

- The commits carry no `Co-Authored-By` or other AI-attribution trailers. The
  operator's standing git rules forbid them in every repository, so the
  AI-agent look comes from the code: narrating and session-referential
  comments, the commented-out block, a hand-rolled parser, an unused leftover
  file and a hollow test.
- Every commit in the history type-checks and passes its own visible tests
  (`_build/ts/check_commits.py`).
- The build scripts live outside the fixture, in `../../../_build/ts/`:
  `build_history.py` rebuilds `.git` from `final/` and `history/`,
  `verify_ledger.py` checks the ledger ranges, and `mutate.py` runs the trap
  mutations and the reference fixes.
