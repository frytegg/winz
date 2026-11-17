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
```

## Command line

```text
matchbook simulate <orders-file> [--config <file>] [--strategy <name>] [--json <path>] [--quiet]
matchbook --version
```

`simulate` replays an order file and prints a summary of fills, rejections,
cancellations and resting orders. `--json <path>` also writes the JSON report
(`-` writes it to stdout; combine with `--quiet`).

## Order file format

One instruction per line, comma separated. Blank lines and lines starting
with `#` are ignored.

```text
N,<id>,<account>,<symbol>,<side>,<kind>,<price>,<qty>
C,<id>
```

- `side`: `buy` or `sell`.
- `kind`: `limit`, `market`, `ioc`, `fok` or `post_only`.
- `price`: required for every kind except `market`, where it must be empty.
- `C,<id>` cancels a resting order.

## Configuration

`--config` takes a `key = value` file; `#` starts a comment. Every key is optional.

| Key | Default | Meaning |
|---|---|---|
| `strategy` | `fifo` | Allocation strategy, by registry name. If the key is omitted the engine uses `fifo`. |
| `maker_fee_bps` | `2` | Maker fee in basis points of notional. Negative values are rebates. |
| `taker_fee_bps` | `5` | Taker fee in basis points of notional. |
| `lmm_accounts` | (none) | Comma-separated accounts with lead-market-maker priority (`lmm` strategy). |
| `lmm_share_pct` | `40` | Percentage of each incoming order reserved for LMM accounts. |
| `tick_size` | `0.00000001` | Minimum price increment. Limit prices that are not a multiple of the tick are rejected with `off_tick`. |
| `price_band_bps` | `0` | Maximum distance from the reference price, in basis points. `0` disables the band. |
| `ref_addr` | (none) | `host:port` of the reference price service. Required for the price band. |
| `ref_interval_ms` | `250` | Minimum spacing between two reference price requests. |

### Reference prices

When `ref_addr` is set, matchbook asks the service for one reference price per
symbol in the order file before matching (`GET /price?symbol=<symbol>`). The
service rate-limits each API key, so requests are sent one at a time and at
least `ref_interval_ms` apart. Set the key in `MATCHBOOK_REF_API_KEY`.

## JSON report

`--json` writes a single object with `schema_version`, `generator`,
`strategy`, `fills`, `rejections`, `cancellations` and `summary`. Amounts are
strings in canonical decimal form.

## License

MIT
