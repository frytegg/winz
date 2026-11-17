# matchbook

A limit order book and trade matching engine with pluggable allocation
strategies, plus a small command-line tool to replay order files through it.

- Exact eight-decimal fixed-point amounts (`Fixed`) for prices, quantities and fees.
- Order kinds: limit, market, immediate-or-cancel (IOC), fill-or-kill (FOK) and post-only.
- Self-trade prevention: a resting order from the same account is cancelled instead of traded.
- Allocation strategies chosen by name: `fifo`, `pro_rata` and `lmm` (lead market maker).
- Maker/taker fees in basis points, with maker rebates.
- Optional price band around a reference price fetched from a pricing service.
- A text summary and a versioned JSON report.

No external crates: the project builds offline with a stock Rust toolchain.

## Quick start

```sh
cargo build --release
cargo run --release -- simulate examples/orders.txt --config examples/matchbook.conf
```

## Requirements

- Rust 1.74 or newer (edition 2021)

## Building and testing

```sh
cargo build            # debug build
cargo build --release  # optimised binary in target/release/matchbook
cargo test             # unit and integration tests
cargo clippy --all-targets
```

## Command line

```text
matchbook run <orders-file> [--config <file>] [--strategy <name>] [--json <path>] [--quiet]
matchbook strategies
matchbook explain
matchbook --version
```

| Command | What it does |
|---|---|
| `run` | Replays an order file and prints a summary of fills, rejections, cancellations and resting orders. `--json <path>` also writes the JSON report (`-` writes it to stdout; combine with `--quiet`). `--strategy` overrides the strategy from the config. |
| `strategies` | Lists the registered allocation strategies. |
| `explain` | Describes every supported order kind. |

Examples:

```sh
cargo run -- run examples/orders.txt --config examples/matchbook.conf
cargo run -- run examples/orders.txt --config examples/lmm.conf --json reports/lmm.json
cargo run -- run examples/orders.txt --quiet --json -
cargo run -- strategies
```

Exit status: 0 on success, 1 when the run fails (unreadable file, parse error), 2 for usage errors.

## Order file format

One instruction per line, comma separated. Blank lines and lines starting
with `#` are ignored.

```text
N,<id>,<account>,<symbol>,<side>,<kind>,<price>,<qty>[,<ts_ms>]
C,<id>
```

- `side`: `buy` or `sell` (`b`/`s` and `bid`/`ask` also work).
- `kind`: `limit`, `market`, `ioc`, `fok` or `post_only`.
- `price`: required for every kind except `market`, where it must be empty.
- `qty`: positive, at most eight decimals.
- `ts_ms`: optional client timestamp in milliseconds since the Unix epoch.
- `C,<id>` cancels a resting order.

Order ids must be unique within a run; a repeated id is rejected
(`duplicate_id`). Fills always execute at the resting (maker) order's price.

## Configuration

`--config` takes a `key = value` file; `#` starts a comment. Every key is optional.

| Key | Default | Meaning |
|---|---|---|
| `strategy` | `fifo` | Allocation strategy, by registry name. If the key is omitted the engine uses `fifo`. Run `matchbook strategies` for the valid names. |
| `maker_fee_bps` | `2` | Maker fee in basis points of notional. Negative values are rebates. |
| `taker_fee_bps` | `5` | Taker fee in basis points of notional. |
| `lmm_accounts` | (none) | Comma-separated accounts with lead-market-maker priority (`lmm` strategy). |
| `lmm_share_pct` | `40` | Percentage of each incoming order reserved for LMM accounts. |
| `tick_size` | `0.00000001` | Minimum price increment. Limit prices that are not a multiple of the tick are rejected with `off_tick`. |
| `price_band_bps` | `0` | Maximum distance from the reference price, in basis points. `0` disables the band. |
| `ref_addr` | (none) | `host:port` of the reference price service. Required for the price band. |
| `ref_interval_ms` | `250` | Minimum spacing between two reference price requests. |

Fees are rounded in the venue's favour: charges round up to the next
0.00000001, rebates round toward zero.

### Allocation strategies

| Name | Behaviour |
|---|---|
| `fifo` | Price-time priority: the oldest order at a price level fills first. |
| `pro_rata` | Each order at the level receives a share proportional to its remaining size; rounding leftovers go to the oldest orders. |
| `lmm` | Accounts in `lmm_accounts` first receive `lmm_share_pct`% of the incoming quantity, then the rest is allocated FIFO. |

### Reference prices

When `ref_addr` is set, `matchbook run` asks the service for one reference
price per symbol in the order file before matching:

```text
GET /price?symbol=BTC-USD HTTP/1.0
X-Api-Key: <MATCHBOOK_REF_API_KEY>
```

The service answers `200 OK` with a plain decimal body. It rate-limits each
API key, so requests are sent one at a time and at least `ref_interval_ms`
apart. Set the key in the `MATCHBOOK_REF_API_KEY` environment variable.

## JSON report

`--json` writes a single object. The layout is versioned by `schema_version`;
fields are only added within a version.

```json
{
  "schema_version": 1,
  "generator": "matchbook 0.4.0",
  "strategy": "fifo",
  "fills": [
    {
      "trade_id": 1,
      "symbol": "BTC-USD",
      "price": "30005.5",
      "qty": "0.25",
      "maker_order": 2,
      "taker_order": 4,
      "maker_account": "bob",
      "taker_account": "dave",
      "aggressor": "buy",
      "maker_fee": "1.500275",
      "taker_fee": "3.7506875",
      "ts": 1700000000300
    }
  ],
  "rejections": [{ "order": 7, "reason": "post_only_would_cross" }],
  "cancellations": [{ "order": 6, "reason": "ioc_remainder" }],
  "summary": {
    "fill_count": 5,
    "total_fees": "24.24200741",
    "volume": { "BTC-USD": "0.9", "ETH-USD": "4.12345678" },
    "vwap": { "BTC-USD": "30002.08333333", "ETH-USD": "1850.28353293" }
  },
  "accounts": [{ "account": "alice", "trades": 1, "volume": "0.35", "fees": "2.1007" }]
}
```

- Amounts are strings in canonical decimal form (no trailing zeros), so no
  precision is lost in JSON consumers.
- `aggressor` is the side of the incoming (taker) order. Trade-tape consumers
  use it to classify prints as buyer- or seller-initiated.
- `generator` identifies the matchbook version that produced the file.
- Rejection reasons: `duplicate_id`, `post_only_would_cross`,
  `fok_not_fillable`, `outside_price_band`, `off_tick`, `no_liquidity`,
  `unknown_order`. Cancellation reasons: `requested`, `self_trade`,
  `ioc_remainder`, `market_remainder`.

## Library usage

The crate is also a library. The main entry points:

```rust
use matchbook::{Config, Side};

let orders = std::fs::read_to_string("examples/orders.txt")?;
let engine = matchbook::run(&orders, &Config::default())?;

for fill in engine.fills() {
    println!("{} {} @ {}", fill.symbol, fill.qty, fill.price);
}

// Aggregated depth, best price first: Vec<(price, total quantity)>.
if let Some(book) = engine.book("BTC-USD") {
    for (price, qty) in book.depth(Side::Buy, 5) {
        println!("bid {qty} @ {price}");
    }
}
```

For more control, build the engine yourself with `Engine::from_config(&config, &registry)`,
call `set_reference_prices` if you use the price band, then `run` or `process`
instructions from `matchbook::parse::parse_orders`.

### Custom strategies

Implement `Strategy` and register it by name with the `register_strategy!`
macro. The name can then be used in a config file like the built-ins.

```rust
use matchbook::{register_strategy, Allocation, Config, Engine, Fixed, RestingOrder, Strategy, StrategyRegistry};

struct OldestOnly;

impl Strategy for OldestOnly {
    fn name(&self) -> &str { "oldest_only" }

    fn allocate(&self, level: &[RestingOrder], qty: Fixed) -> Vec<Allocation> {
        level.first()
            .map(|order| vec![Allocation { index: 0, qty: order.remaining.min(qty) }])
            .unwrap_or_default()
    }
}

let mut registry = StrategyRegistry::with_builtins();
register_strategy!(registry, "oldest_only", |_params| OldestOnly);

let mut config = Config::default();
config.strategy = "oldest_only".to_string();
let engine = Engine::from_config(&config, &registry);
```

## Project layout

```text
src/
  main.rs          CLI
  lib.rs           public API and `run`
  fixed.rs         fixed-point amounts
  order.rs         orders, sides, kinds
  parse.rs         order file parser
  book.rs          per-symbol order book
  engine.rs        matching engine
  fill.rs          fills and events
  fees.rs          fee schedule and rounding
  config.rs        config file
  refdata.rs       reference price client
  report.rs        text and JSON reports
  stats.rs         volume and VWAP
  strategy/        allocation strategies and registry
examples/          sample order file and configs
tests/             integration tests
```

## License

MIT
