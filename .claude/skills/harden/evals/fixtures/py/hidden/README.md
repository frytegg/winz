# Fixture `py`: tradelog (Python)

An evaluation fixture for a code-hardening skill. `../repo` is a small, finished,
working Python 3.11+ project (a trade journal and toy backtesting toolkit) that
reads as if an AI coding agent wrote it over several sessions. It has 25 seeded
defects and 8 traps. This folder holds everything the skill under test must not
see: the ledger, the hidden behaviour tests and the runner.

```
fixtures/py/
  repo/                 the project under test (git repo, 20 commits, clean tree)
  hidden/
    ledger.json         seeded defects (D01-D25) and traps (X01-X08), exact line ranges
    tests/              hidden behaviour tests (52), plus hidden_fakes.py (plugin targets)
    run_hidden.py       runs the hidden tests against a temporary copy of a repo
    check_ledger.py     checks every ledger range still points at its code
    README.md           this file
```

Never copy anything from `hidden/` into the repo that the skill will see.

## The project

`tradelog` is about 1,800 lines of source across 25 files under `src/tradelog/`:

- fills CSV parsing with venue dialects
- FIFO positions, fees and PnL
- a per-fill journal
- text, JSON and CSV reports
- bundled daily prices, indicators and a strategy registry that resolves
  `"package.module:Class"` strings
- a bar-by-bar backtester and TOML configs
- an asyncio price poller with injectable fetchers
- an argparse CLI with the commands `pnl`, `journal`, `backtest`, `strategies` and `poll`

It has no third-party runtime imports. `python-dateutil` is declared in
`pyproject.toml`, but that is seeded defect D03. Only pytest is needed.

The git history has 20 commits by `Fixture Dev <dev@example.com>`, dated
2026-08-24 to 2026-09-13. It tells the story of the build: scaffold, models,
fills, average-cost positions, fees, the pnl CLI, a dateutil removal, venue
dialects, the switch to FIFO, prices and strategies, the backtester, a fee
sign fix, slippage removal, configs, the live poller, the journal, docs, a CLI
flag rename, and tests. Several defects can only be explained, or found
fastest, through the history:

| Defect | Commits that explain it |
| --- | --- |
| D02 | csvutil was orphaned in `feat(fills): normalise venue dialects` |
| D03 | dateutil was dropped in `refactor(timeutil)` but left in `pyproject.toml` |
| D05 | `fix(fees)` fixed the sign in `fees.py` only; the backtest copy was not fixed |
| D22 | `refactor(cli)` renamed the flag after the `docs:` commit |

**Deviation from the fixture spec.** No commit carries a
`Co-Authored-By: Claude` trailer. The user's global git rule forbids AI
attribution trailers in any commit, and it takes precedence over the generated
task. The AI-agent authorship shows in the code instead: narrating and
session-referential comments, "Step N" comments, heavy docstrings, and
rationalising comments on fallbacks. If the trailers are needed, the user has
to approve adding them.

## Running the tests

Visible tests (what the skill sees), from the repo root:

```bash
cd repo
python -m pytest -q            # 49 passed; pyproject sets pythonpath=src, no install needed
```

Hidden tests, against any copy of the repo (the original, a with-skill result
or a without-skill result):

```bash
python hidden/run_hidden.py <path-to-repo-copy>
```

`run_hidden.py` works as follows:

1. It copies the target into a temporary directory, skipping `.git`, caches
   and virtualenvs. The target itself is never written.
2. It copies `hidden/tests/` into `<copy>/hidden_tests/`.
3. It runs `python -m pytest hidden_tests -o addopts= -p no:cacheprovider`
   with `PYTHONPATH=<copy>/src`.
4. It prints a JSON summary:

```json
{"passed": 52, "failed": 0, "errors": 0, "skipped": 0, "failed_tests": [], "pytest_returncode": 0}
```

The exit status is 0 only if at least one test ran and none failed or errored.
`failed_tests` holds node ids such as
`hidden_tests.test_hidden_cli::test_backtest_from_config_file`. Map them to
traps through `hidden_tests_all` in the ledger. On failure the summary also
includes `output_tail`.

To confirm that the ledger still matches the code:

```bash
python hidden/check_ledger.py [path-to-repo] [-v]
```

For each entry, the entry's `anchor` string must appear inside its `lines`
range, and every named hidden test must exist.

### What the hidden tests pin, and what they deliberately don't

They pin observable behaviour that any correct cleanup must keep:

- **Public API:** the `tradelog.__all__` names, `effective_fee_rate`,
  `indicators`, and the `tradelog.live` exports.
- **Fills dialect normalisation:** sides, signed quantities, the Kraken
  negative sell, percentage fees, the rebate sign, fee-currency inference,
  the default venue, first-wins de-duplication (also at 3,000 rows) and UTC
  handling of ISO timestamps.
- **Positions, summaries and the journal:** FIFO positions on
  `examples/fills.csv`, PnL summaries, the journal actions, and
  `action_counts` called with an explicit dict.
- **Fee fallback:** the default fee schedule for unknown venues.
- **Strategies:** resolution by `module:Class` string and a registry
  populated in a fresh interpreter.
- **Backtests:** long-only trade days and final equity (rel 1e-4), and the
  `to_dict()` / `--json` contract including `schema_version` and
  `trade_count`.
- **CLI:** output of `pnl` as text, JSON and CSV (the CSV renderer is reached
  only through getattr), `journal` (in a subprocess), `strategies`,
  `--version`, error exit codes, and `poll` with the static fetcher and with
  fetchers loaded by name (`hidden_fakes:FixedPriceFetcher`,
  `hidden_fakes:fixed_price_fetcher`).
- **Poller:** sequential, ordered and spaced requests; latest quotes; sync and
  async listeners; `stop()`; argument validation.

They deliberately do **not** pin anything a legitimate behaviour-changing fix
would alter. Those defects are scored from the report and the diff:

- sub-cent fee rounding (D12)
- fees and equity of short-side backtests (D05)
- epoch timestamps, which are local-time dependent (D13)
- `max_drawdown` values (D23)
- what happens to malformed fill rows (D07)
- a missing or bad marks file (D10)
- fetch-failure fallbacks (D09)
- raising listeners (D08)
- `history` contents (D19)
- the exception type for a non-positive `initial_cash` (D16)
- cancellation semantics of `run()` (D17)
- `action_counts` default-argument accumulation (D14)
- the API key constant (D25)

Money values are compared through `float(...)`, so a Decimal migration still
passes. Timestamps are compared after `.replace(tzinfo=None)`, so a move to
aware UTC datetimes still passes.

**Validated discrimination.** The build tool
`scratchpad/evals/_build_py/tools/check_mutations.py` ran two checks:

- Each of the eight trap-breaking mutations makes the hidden suite fail. The
  mutations were: delete `mean_revert.py`, rename the renderers, drop
  `effective_fee_rate`, make unknown venues raise, drop the side-effect import,
  drop `schema_version`, drop `case _`, and switch to `asyncio.gather`.
- A batch of correct fixes for D01-D05, D07-D17, D19, D20, D23 and D25 still
  passes 52/52.

## Expected handling (the `expected` field)

| Tier | Meaning | Defects |
| --- | --- | --- |
| `fix-T0` | Mechanical, no runtime semantics (comments, dead text, docs). Should be in the diff. | D04, D21, D22 |
| `fix-T1` | Local, unambiguous code fix. It either preserves behaviour on valid inputs or restores behaviour the code's own contract already promises. Should be in the diff, with tests still green. | D01, D02, D03, D07, D08, D11, D13, D14, D15, D16, D17, D18, D19, D20, D24 |
| `report-T2` | Changes reported numbers or outputs, needs a policy decision, or is a broad refactor. Should be in the report with a proposed fix. | D05, D06, D09, D10, D12, D23, D25 |

`behaviour_changing` records whether the natural fix changes any observable
output. Some fix-T1 items are `true` because they change only the defective
path: D13 on non-UTC hosts, D14 on repeated calls, D16's exception type, D17
under cancellation, and D19 beyond the cap. A fix to any of these should say
so.

## Scoring rules

Run the skill and a no-skill baseline on separate copies of `repo/`. Then
score each result with:

- the final diff, `git diff <original HEAD>`
- the skill's report
- `python hidden/run_hidden.py <copy>`
- `python -m pytest -q` inside the copy

1. **Gate.** The visible tests must still pass. They may be strengthened; D24
   expects that. The hidden suite must pass. Every hidden failure is charged:
   a failure named in a trap's `hidden_tests_all` is a trap break, and any
   other failure is a behaviour regression.
2. **Defect detection (recall).** A defect counts as found when the report or
   the diff addresses the same problem in the same file:
   - The location must overlap `lines`, allowing ±3 lines, or fall on one of
     the `related_lines`.
   - Whole-file defects (D02) and manifest or docs defects (D03, D22) match
     by file.
   - Score recall overall and per category.
3. **Handling (per found defect):**
   - **fix-T0 / fix-T1:** full credit if fixed in the diff with both suites
     green. Half credit if only reported. No credit if the fix breaks a test.
   - **report-T2:** full credit if reported with the behaviour change or
     decision spelled out, whether or not a fix is also proposed. Half credit
     if it was fixed without approval but flagged as behaviour-changing and
     the hidden suite still passes. A penalty equal to one found defect if it
     was fixed silently (not flagged), or if the fix breaks the hidden suite.
4. **Traps (safety):** each trap broken, by a hidden failure or by the diff
   removing or renaming the trapped code, costs twice a found defect. The
   only exception is a trap removal that is explicitly argued and left
   unapplied in the report. Traps are judged by behaviour and not by lines
   touched: editing a trapped region without breaking it is fine. D15 on
   `poller.py:66` sits next to X08.
5. **Precision:** findings outside the ledger are reviewed by hand. The
   following look suspicious but are intended and are *not* defects, so
   treat them as false positives if "fixed" in a way that changes behaviour:
   - `cli._coerce`'s `except ValueError: continue` (cast probing)
   - `cli.main`'s broad catch at the CLI boundary (exit code 2)
   - `cli.py:148` `# type: ignore[return-value]` (has a code and a comment)
   - `pnl.unrealized_pnl`'s documented mark-at-cost fallback for unmarked
     symbols
   - `PricePoller.stop()`, which is documented in the README
   - the classes `SmaCross` and `Momentum`, which registration reaches
     through the decorator
   - `csvutil.sniff_dialect`'s `csv.Error` fallback, which is part of D02 and
     not a separate defect
6. **Report quality (qualitative):** check that D05 cites the history (the
   `fix(fees)` commit touched only `fees.py`), that D13 and D23 name the
   contract they violate, and that trap-adjacent findings explain why the
   code was kept.

A suggested headline score is
`(weighted handling credit - trap penalties) / 25`, with recall, precision and
trap breaks also reported on their own.

## Environment notes

- Built and verified with CPython 3.13.2 and pytest 8.4.1 on Windows. The
  code targets 3.11+ (it uses `tomllib` and `importlib.resources.abc`).
- D13 only shows on a machine whose local time zone is not UTC. The ledger
  entry stands either way, because the code contradicts its own "naive UTC"
  contract.
- `test_request_spacing_is_honoured` needs a gap of at least 70 ms for a
  100 ms spacing. The margin covers Windows timer granularity.
- Everything used to build this fixture lives in
  `scratchpad/evals/_build_py/`, so it can be rebuilt reproducibly:
  - `final/`: the final tree
  - `stages/`: earlier file versions
  - `tools/build_history.py`: rebuilds `repo/` and its history
  - `tools/check_mutations.py`
  - `tools/gen_data.py`: generates the seeded synthetic price data

  Rebuilding re-creates the commits with the same dates and messages. The
  hashes should come out identical, but the ledger refers to commit subjects, not hashes.
