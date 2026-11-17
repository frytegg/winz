"""Build the `rs` fixture repo with a plausible git history.

Every historical file version is derived from the final files in ./final by
exact, asserted text edits (or taken from ./history for the README), so the
last commit reproduces ./final byte for byte. Each commit is `cargo check`ed.
"""

from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent  # fixtures/rs/hidden/_build
FINAL = HERE / "final"
HIST = HERE / "history"
REPO = HERE.parent.parent / "repo"
TARGET = Path(os.environ.get("MATCHBOOK_BUILD_TARGET", HERE / "target_hist"))

AUTHOR = ("Fixture Dev", "dev@example.com")


def read(rel: str) -> str:
    return (FINAL / rel).read_text(encoding="utf-8")


def replace_once(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one occurrence, found {count}:\n{old!r}")
    return text.replace(old, new)


def cut(text: str, start: str, end: str | None) -> str:
    """Remove text from `start` (inclusive) to `end` (exclusive, or EOF)."""
    if text.count(start) != 1:
        raise SystemExit(f"cut start not unique ({text.count(start)}): {start!r}")
    i = text.index(start)
    if end is None:
        return text[:i]
    j = text.index(end, i)
    return text[:i] + text[j:]


def apply(text: str, edits: list) -> str:
    for edit in edits:
        kind = edit[0]
        if kind == "r":
            text = replace_once(text, edit[1], edit[2])
        elif kind == "cut":
            text = cut(text, edit[1], edit[2])
        else:
            raise SystemExit(f"unknown edit {kind}")
    return text


# ----------------------------------------------------------------- lib.rs --

FINAL_LIB = read("src/lib.rs")
LIB_HEADER_FULL = FINAL_LIB[: FINAL_LIB.index("\n#![allow")]
LIB_HEADER_SHORT = "//! # matchbook\n//!\n//! A small limit order book and trade matching engine.\n"
LIB_VERSION = FINAL_LIB[FINAL_LIB.index("\n/// Crate version") : FINAL_LIB.index("\n/// Parses `orders`")]
LIB_RUN = FINAL_LIB[FINAL_LIB.index("\n/// Parses `orders`") :]


def lib(pub, priv, uses, *, version=False, run=False, allow=False, full=False) -> str:
    out = LIB_HEADER_FULL if full else LIB_HEADER_SHORT
    if allow:
        out += "\n#![allow(dead_code, unused_imports)]\n"
    out += "\n" + "".join(f"pub mod {m};\n" for m in pub)
    if priv:
        out += "\n" + "".join(f"mod {m};\n" for m in priv)
    out += "\n" + "".join(f"pub use {u};\n" for u in uses)
    if version:
        out += LIB_VERSION
    if run:
        out += LIB_RUN
    return out


U_BOOK = "book::{OrderBook, RestingOrder}"
U_CONFIG = "config::{Config, DEFAULT_STRATEGY}"
U_ENGINE = "engine::Engine"
U_ERROR = "error::Error"
U_FEES = "fees::FeeSchedule"
U_FILL1 = "fill::Fill"
U_FILL = "fill::{CancelReason, Event, Fill, RejectReason}"
U_FIXED = "fixed::Fixed"
U_MATCHER = "matcher_v1::match_order"
U_ORDER = "order::{Instruction, Order, OrderId, OrderKind, Side}"
U_STRATEGY = "strategy::{Allocation, Strategy, StrategyParams, StrategyRegistry}"

L1 = lib(["fixed"], [], [U_FIXED])
L2 = lib(["error", "fixed", "order", "parse"], [], [U_ERROR, U_FIXED, U_ORDER])
L3 = lib(["book", "error", "fixed", "order", "parse"], [], [U_BOOK, U_ERROR, U_FIXED, U_ORDER])
L4 = lib(
    ["book", "error", "fill", "fixed", "order", "parse"],
    ["matcher_v1"],
    [U_BOOK, U_ERROR, U_FILL1, U_FIXED, U_MATCHER, U_ORDER],
)
L5 = lib(
    ["book", "error", "fees", "fill", "fixed", "order", "parse"],
    ["matcher_v1"],
    [U_BOOK, U_ERROR, U_FEES, U_FILL1, U_FIXED, U_MATCHER, U_ORDER],
)
MODS6 = ["book", "engine", "error", "fees", "fill", "fixed", "order", "parse", "strategy"]
USES6 = [U_BOOK, U_ENGINE, U_ERROR, U_FEES, U_FILL, U_FIXED, U_ORDER, U_STRATEGY]
L6 = lib(MODS6, [], USES6)
MODS7 = ["book", "engine", "error", "fees", "fill", "fixed", "order", "parse", "report", "strategy"]
L7 = lib(MODS7, ["stats"], USES6, version=True)
MODS8 = ["book", "config", "engine", "error", "fees", "fill", "fixed", "order", "parse", "report", "strategy"]
USES8 = [U_BOOK, U_CONFIG, U_ENGINE, U_ERROR, U_FEES, U_FILL, U_FIXED, U_ORDER, U_STRATEGY]
L8 = lib(MODS8, ["stats"], USES8, version=True, run=True, full=True)
MODS9 = ["book", "config", "engine", "error", "fees", "fill", "fixed", "order", "parse", "refdata", "report", "strategy"]
L9 = lib(MODS9, ["stats", "util"], USES8, version=True, run=True, full=True)
L10 = lib(MODS9, ["stats", "util"], USES8, version=True, run=True, full=True, allow=True)
assert L10 == FINAL_LIB, "lib.rs builder does not reproduce the final file"

# ------------------------------------------------------------- Cargo.toml --

FINAL_CARGO = read("Cargo.toml")


def cargo(version: str, tickfmt: bool) -> str:
    text = FINAL_CARGO.replace('version = "0.4.0"', f'version = "{version}"', 1)
    if not tickfmt:
        text = replace_once(text, 'tickfmt = { path = "crates/tickfmt" }\n', "")
    return text


# --------------------------------------------------------------- fixed.rs --

F_TOOPRECISE = [
    ("r", "    Invalid(String),\n    /// The input has more than [`DECIMALS`] fractional digits.\n    TooPrecise(String),\n",
     "    Invalid(String),\n"),
    ("r", "            ParseFixedError::TooPrecise(s) => {\n"
          "                write!(f, \"amount `{s}` has more than {DECIMALS} decimal places\")\n"
          "            }\n", ""),
    ("r", "        if frac.len() > DECIMALS {\n"
          "            return Err(ParseFixedError::TooPrecise(s.to_string()));\n"
          "        }\n", ""),
]
F_CACHE = [
    ("r", "use std::cell::RefCell;\nuse std::collections::HashMap;\n", ""),
    ("cut", "thread_local! {\n", "impl fmt::Display for Fixed {"),
    ("r", "        let rendered = FORMAT_CACHE.with(|cache| {\n"
          "            cache\n"
          "                .borrow_mut()\n"
          "                .entry(self.0)\n"
          "                .or_insert_with(|| render(self.0))\n"
          "                .clone()\n"
          "        });\n"
          "        f.pad(&rendered)\n",
     "        f.pad(&render(self.0))\n"),
]
FIXED_FINAL = read("src/fixed.rs")
FIXED_V2 = apply(FIXED_FINAL, F_TOOPRECISE)
FIXED_V1 = apply(FIXED_V2, F_CACHE)

FIXED_TESTS_FINAL = read("tests/fixed_tests.rs")
FIXED_TESTS_V1 = apply(FIXED_TESTS_FINAL, [
    ("cut", "#[test]\nfn rejects_more_than_eight_decimals() {", "#[test]\nfn multiplication_is_exact"),
])

# --------------------------------------------------------------- parse.rs --

PARSE_FINAL = read("src/parse.rs")
PARSE_V1 = apply(PARSE_FINAL, [
    ("r", "//! N,<id>,<account>,<symbol>,<side>,<kind>,<price>,<qty>[,<ts_ms>]\n",
     "//! N,<id>,<account>,<symbol>,<side>,<kind>,<price>,<qty>\n"),
    ("r", "    if fields.len() < 8 || fields.len() > 9 {\n"
          "        return Err(format!(\n"
          "            \"expected 8 or 9 fields for a new order, got {}\",\n",
     "    if fields.len() != 8 {\n"
     "        return Err(format!(\n"
     "            \"expected 8 fields for a new order, got {}\",\n"),
    ("r", "    let ts = match fields.get(8) {\n"
          "        Some(raw) if !raw.is_empty() => raw.parse::<u64>().unwrap(),\n"
          "        _ => 0,\n"
          "    };\n",
     "    let ts = 0;\n"),
])
PARSE_TESTS_FINAL = read("tests/parse_tests.rs")
PARSE_TESTS_V1 = apply(PARSE_TESTS_FINAL, [
    ("cut", "#[test]\nfn parses_the_timestamp_column()", "#[test]\nfn parses_a_cancel()"),
])

# ---------------------------------------------------------------- error.rs --

ERROR_FINAL = read("src/error.rs")
ERROR_V2 = apply(ERROR_FINAL, [
    ("r", "    /// The reference price service failed or answered garbage.\n    RefData(String),\n", ""),
    ("r", "            Error::RefData(msg) => write!(f, \"reference data: {msg}\"),\n", ""),
])
ERROR_V1 = apply(ERROR_V2, [
    ("r", "    /// The config file is malformed.\n    Config(String),\n"
          "    /// The configured strategy is not registered.\n    UnknownStrategy(String),\n", ""),
    ("r", "            Error::Config(msg) => write!(f, \"config: {msg}\"),\n"
          "            Error::UnknownStrategy(name) => write!(f, \"unknown strategy `{name}`\"),\n", ""),
])

# ----------------------------------------------------------------- book.rs --

BOOK_FINAL = read("src/book.rs")
BOOK_V1 = apply(BOOK_FINAL, [
    ("cut", "    /// Aggregated depth: up to `levels`", "    fn levels(&self, side: Side)"),
])

# ---------------------------------------------------------------- fill.rs --

FILL_FINAL = read("src/fill.rs")
FILL_V1 = apply(FILL_FINAL, [("cut", "\n/// Why an order or cancel request was refused.", None)])

# ---------------------------------------------------------------- fees.rs --

FEES_FINAL = read("src/fees.rs")
FEES_V1 = apply(FEES_FINAL, [
    ("cut", "/// Fee of `bps` basis points on `notional`.\n", None),
    # re-append the pre-fix version at the end of the file
])
FEES_V1 += (
    "/// Fee of `bps` basis points on `notional`, truncated to the raw unit.\n"
    "pub fn fee_for(notional: Fixed, bps: i64) -> Fixed {\n"
    "    Fixed::from_raw(notional.raw() * bps / 10_000)\n"
    "}\n"
)

# -------------------------------------------------------------- engine.rs --

ENGINE_FINAL = read("src/engine.rs")
E_V3 = [
    ("cut", "        if let Some(limit) = order.price {\n            if !util::check_tick", "        match order.kind {\n"),
    ("r", "    price_band_bps: u16,\n    tick_size: Fixed,\n    reference: HashMap<String, Fixed>,\n", ""),
    ("r", "            price_band_bps: 0,\n            tick_size: Fixed::from_raw(1),\n            reference: HashMap::new(),\n", ""),
    ("cut", "    /// Reference prices for the price-band check, keyed by symbol.\n", "    /// Name of the strategy actually in use.\n"),
    ("r", "        let mut engine = Engine::new(strategy, config.fees);\n"
          "        engine.price_band_bps = config.price_band_bps;\n"
          "        engine.tick_size = config.tick_size;\n"
          "        engine\n",
     "        Engine::new(strategy, config.fees)\n"),
    ("r", "use std::collections::{BTreeMap, HashMap, HashSet};", "use std::collections::{BTreeMap, HashSet};"),
    ("r", "use crate::fixed::Fixed;\n", ""),
    ("r", "use crate::util;\n", ""),
]
E_V2 = [
    ("cut", "            // Self-trade prevention (cancel resting)", "            let allocations = self.strategy.allocate("),
]
E_V1 = [
    ("cut", "    /// Builds an engine from a parsed config, resolving the strategy by name.\n", "    /// Name of the strategy actually in use.\n"),
    ("r", "use crate::config::Config;\n", ""),
    ("r", "use crate::strategy::{fifo, Strategy, StrategyRegistry};", "use crate::strategy::Strategy;"),
]
ENGINE_V3 = apply(ENGINE_FINAL, E_V3)
ENGINE_V2 = apply(ENGINE_V3, E_V2)
ENGINE_V1 = apply(ENGINE_V2, E_V1)

# ------------------------------------------------------ strategy/mod.rs --

STRAT_FINAL = read("src/strategy/mod.rs")
STRAT_V2 = apply(STRAT_FINAL, [
    ("cut", "\n    /// Registers `factory` under `name`", "}\n\nimpl Default for StrategyRegistry {"),
    ("cut", "\n/// Registers a custom strategy on a [`StrategyRegistry`] under a name.", None),
])
STRAT_V1 = apply(STRAT_V2, [
    ("r", "pub mod fifo;\npub mod lmm;\npub mod pro_rata;\n", "pub mod fifo;\npub mod pro_rata;\n"),
    ("r", "builtin_strategies!(fifo, pro_rata, lmm)", "builtin_strategies!(fifo, pro_rata)"),
    ("r", "pub struct StrategyParams {\n"
          "    /// Accounts with lead-market-maker priority (`lmm` strategy).\n"
          "    pub lmm_accounts: Vec<String>,\n"
          "    /// Share of each incoming order reserved for LMM accounts, in percent.\n"
          "    pub lmm_share_pct: u32,\n"
          "}\n",
     "pub struct StrategyParams {}\n"),
])

# --------------------------------------------------------------- config.rs --

CONFIG_FINAL = read("src/config.rs")
CONFIG_V2 = apply(CONFIG_FINAL, [
    ("r", "    /// Maximum distance from the reference price, in basis points; 0 disables the check.\n"
          "    pub price_band_bps: u16,\n"
          "    /// Minimum price increment.\n"
          "    pub tick_size: Fixed,\n"
          "    /// `host:port` of the reference price service.\n"
          "    pub ref_addr: Option<String>,\n"
          "    /// Minimum spacing between two reference price requests.\n"
          "    pub ref_interval_ms: u64,\n", ""),
    ("r", "            price_band_bps: 0,\n"
          "            tick_size: Fixed::from_raw(1),\n"
          "            ref_addr: None,\n"
          "            ref_interval_ms: DEFAULT_REF_INTERVAL_MS,\n", ""),
    ("r", "            \"price_band_bps\" => config.price_band_bps = number(line_no, key, value)?,\n"
          "            \"tick_size\" => config.tick_size = number(line_no, key, value)?,\n"
          "            \"ref_addr\" => config.ref_addr = Some(value.to_string()),\n"
          "            \"ref_interval_ms\" => config.ref_interval_ms = number(line_no, key, value)?,\n", ""),
    ("r", "/// Default spacing between reference price requests, in milliseconds.\n"
          "pub const DEFAULT_REF_INTERVAL_MS: u64 = 250;\n\n", ""),
    ("r", "use crate::fixed::Fixed;\n", ""),
])
CONFIG_V1 = apply(CONFIG_V2, [
    ("r", "            strategy_params: StrategyParams {\n"
          "                lmm_accounts: Vec::new(),\n"
          "                lmm_share_pct: 40,\n"
          "            },\n",
     "            strategy_params: StrategyParams::default(),\n"),
    ("cut", "            \"lmm_accounts\" => {\n", "            other => {\n"),
])

# --------------------------------------------------------------- report.rs --

REPORT_FINAL = read("src/report.rs")
REPORT_V1 = apply(REPORT_FINAL, [
    ("cut", "/// Per-account totals for the report.\n", "/// Human-readable summary printed by the CLI.\n"),
    ("cut", "    let accounts: Vec<String> = per_account_summary(fills)\n", "    let root = object(\n"),
    ("r", "            (\"accounts\", array(&accounts, 2)),\n", ""),
    ("cut", "/// Trade count, volume and fees per account, sorted by account name.\n", "// Fee total for the summary block"),
])

# ----------------------------------------------------------------- main.rs --

MAIN_FINAL = read("src/main.rs")
MAIN_V2 = apply(MAIN_FINAL, [
    ("r", "  strategies              list the registered allocation strategies\n"
          "  explain                 describe the supported order kinds\n", ""),
    ("cut", "        Some(\"strategies\") => {\n", "        Some(\"--version\") | Some(\"-V\") => {\n"),
    ("cut", "\n/// One-line description for `matchbook explain`.", None),
    ("r", "use matchbook::{parse, refdata, report, Engine, Instruction, OrderKind, StrategyRegistry};",
     "use matchbook::{parse, refdata, report, Engine, Instruction, StrategyRegistry};"),
    ("r", "  run <orders-file>       match the orders in <orders-file>\n",
     "  simulate <orders-file>  match the orders in <orders-file>\n"),
    ("r", "        Some(\"run\") => match parse_run_args", "        Some(\"simulate\") => match parse_run_args"),
])
MAIN_V1 = apply(MAIN_V2, [
    ("cut", "    if let Some(addr) = &config.ref_addr {\n", "    engine.run(instructions);\n"),
    ("r", "use matchbook::{parse, refdata, report, Engine, Instruction, StrategyRegistry};",
     "use matchbook::{parse, report, Engine, StrategyRegistry};"),
    ("r", "use std::time::Duration;\n", ""),
    ("r", "engine config (strategy, fees, price band, ...)", "engine config (strategy, fees, ...)"),
])

# ------------------------------------------------------------------- tests --

ENGINE_TESTS_FINAL = read("tests/engine_tests.rs")
ENGINE_TESTS_V3 = apply(ENGINE_TESTS_FINAL, [("cut", "\n#[test]\nfn pro_rata_splits_across_the_level()", None)])
ENGINE_TESTS_V2 = apply(ENGINE_TESTS_V3, [
    ("cut", "\n#[test]\nfn self_trade_prevention_cancels_the_resting_order()", None),
    ("r", "use matchbook::{run, CancelReason, Config, Event, Fixed, RejectReason, Side};",
     "use matchbook::{run, CancelReason, Config, Event, Fixed, RejectReason};"),
])
ENGINE_TESTS_V1 = apply(ENGINE_TESTS_V2, [
    ("cut", "\n#[test]\nfn fees_are_basis_points_of_notional_rounded_up()", None),
])
CLI_TESTS_FINAL = read("tests/cli_tests.rs")
CLI_TESTS_V1 = apply(CLI_TESTS_FINAL, [("r", "fills: 5\\n", "fills: 4\\n")])

# ---------------------------------------------------------------- examples --

ORDERS_FINAL = read("examples/orders.txt")


def orders_v1() -> str:
    lines = []
    for line in ORDERS_FINAL.splitlines():
        if line.startswith("# N,"):
            line = line.replace("[,<ts_ms>]", "")
        if line.startswith("N,"):
            if line.split(",")[1] in {"10", "11", "12"}:
                continue
            line = re.sub(r",\d{13}$", "", line)
        lines.append(line)
    return "\n".join(lines) + "\n"


CONF_FINAL = read("examples/matchbook.conf")
CONF_V2 = replace_once(CONF_FINAL, "`matchbook run --config`", "`matchbook simulate --config`")
CONF_V1 = "".join(CONF_V2.splitlines(keepends=True)[:4])

# ------------------------------------------------------------------ README --

README_FINAL = read("README.md")
README_V1 = (HIST / "README_v1.md").read_text(encoding="utf-8")
README_V2 = (HIST / "README_v2.md").read_text(encoding="utf-8")


def section(text: str, heading: str) -> str:
    start = text.index(f"\n## {heading}\n")
    end = text.index("\n## ", start + 1)
    return text[start:end]


README_V3 = replace_once(README_V2, section(README_V2, "Command line"), section(README_FINAL, "Command line"))

GITATTRIBUTES = "* text=auto eol=lf\n"

# ----------------------------------------------------------------- commits --

F = "final"  # marker: copy the final file

COMMITS = [
    ("2026-08-31T10:12:04+02:00", "chore: scaffold matchbook crate with fixed-point amounts",
     "Fixed is an i64 count of 1e-8 units so prices, quantities and fees stay\nexact; floats are only used for display-free statistics.",
     {"Cargo.toml": cargo("0.1.0", False), ".gitignore": F, ".gitattributes": GITATTRIBUTES,
      "rustfmt.toml": F, "src/lib.rs": L1, "src/fixed.rs": FIXED_V1,
      "tests/fixed_tests.rs": FIXED_TESTS_V1}),
    ("2026-08-31T16:47:31+02:00", "feat(order): order model and order-file parser", "",
     {"src/order.rs": F, "src/error.rs": ERROR_V1, "src/parse.rs": PARSE_V1,
      "tests/parse_tests.rs": PARSE_TESTS_V1, "src/lib.rs": L2}),
    ("2026-09-01T11:05:12+02:00", "feat(book): per-symbol order book with price levels and id index",
     "Bids and asks are BTreeMaps keyed by price with a FIFO queue per level;\nthe id index makes cancels O(log n) in the number of levels.",
     {"src/book.rs": BOOK_V1, "src/lib.rs": L3}),
    ("2026-09-01T18:22:47+02:00", "feat: first price-time matcher and fill type", "",
     {"src/fill.rs": FILL_V1, "src/matcher_v1.rs": F, "src/lib.rs": L4}),
    ("2026-09-02T10:31:09+02:00", "feat(fees): maker/taker fee schedule in basis points", "",
     {"src/fees.rs": FEES_V1, "src/lib.rs": L5}),
    ("2026-09-02T17:54:26+02:00", "refactor(engine): strategy-driven Engine replaces matcher_v1",
     "Follow-up to the matcher review from the previous session. Allocation at\n"
     "a price level is delegated to a Strategy looked up by name (fifo and\n"
     "pro_rata built in), and Engine::submit handles the order kinds: limit,\n"
     "market, IOC, FOK and post-only. matcher_v1 is no longer compiled.",
     {"src/engine.rs": ENGINE_V1, "src/strategy/mod.rs": STRAT_V1, "src/strategy/fifo.rs": F,
      "src/strategy/pro_rata.rs": F, "src/fill.rs": F, "src/lib.rs": L6}),
    ("2026-09-03T14:08:55+02:00", "feat(report): text summary and JSON report",
     "The JSON layout carries schema_version so downstream consumers can\ndetect incompatible changes.",
     {"src/report.rs": REPORT_V1, "src/stats.rs": F, "src/lib.rs": L7}),
    ("2026-09-04T11:26:40+02:00", "feat(config): key=value config file and matchbook::run helper",
     "Omitting `strategy` selects fifo, the documented default.",
     {"src/config.rs": CONFIG_V1, "src/error.rs": ERROR_V2, "src/engine.rs": ENGINE_V2,
      "src/lib.rs": L8, "tests/engine_tests.rs": ENGINE_TESTS_V1}),
    ("2026-09-04T18:40:13+02:00", "feat(cli): matchbook binary with simulate command", "",
     {"src/main.rs": MAIN_V1, "examples/orders.txt": orders_v1(), "examples/matchbook.conf": CONF_V1,
      "README.md": README_V1, "Cargo.toml": cargo("0.2.0", False)}),
    ("2026-09-07T09:55:38+02:00", "fix(fees): round fee charges up to the next raw unit",
     "Truncating let the venue under-collect on small notionals. Rebates now\nround toward zero so the venue never over-pays either.",
     {"src/fees.rs": F, "tests/engine_tests.rs": ENGINE_TESTS_V2}),
    ("2026-09-08T15:12:20+02:00", "feat(engine): self-trade prevention (cancel resting)", "",
     {"src/engine.rs": ENGINE_V3, "tests/engine_tests.rs": ENGINE_TESTS_V3}),
    ("2026-09-09T10:43:57+02:00", "feat(strategy): lead market maker allocation",
     "Registered as `lmm` and selected from the config file; examples/lmm.conf\nshows the settings.",
     {"src/strategy/lmm.rs": F, "src/strategy/mod.rs": STRAT_V2, "src/config.rs": CONFIG_V2,
      "examples/lmm.conf": F}),
    ("2026-09-10T16:20:02+02:00", "feat(refdata): price band against a reference price service",
     "Reference prices are fetched once per symbol before matching. The service\nrate-limits per API key, so requests are sequential and spaced by\nref_interval_ms.",
     {"src/refdata.rs": F, "src/util.rs": F, "src/engine.rs": F, "src/config.rs": F,
      "src/error.rs": F, "src/main.rs": MAIN_V2, "examples/matchbook.conf": CONF_V2,
      "README.md": README_V2, "src/lib.rs": L9, "Cargo.toml": cargo("0.3.0", False)}),
    ("2026-09-11T11:03:44+02:00", "perf(fixed): memoise amount formatting for large reports", "",
     {"src/fixed.rs": FIXED_V2}),
    ("2026-09-11T17:36:18+02:00", "feat(cli): rename simulate to run; add strategies and explain", "",
     {"src/main.rs": F, "tests/cli_tests.rs": CLI_TESTS_V1, "README.md": README_V3,
      "examples/matchbook.conf": F}),
    ("2026-09-14T10:15:51+02:00", "feat(api): register_strategy! macro and OrderBook::depth for library users", "",
     {"src/strategy/mod.rs": F, "src/book.rs": F, "Cargo.toml": cargo("0.4.0", False)}),
    ("2026-09-14T15:48:09+02:00", "fix(fixed): reject amounts with more than eight decimals",
     "Extra digits were folded into the value: 0.123456789 parsed as 1.23456789.",
     {"src/fixed.rs": F, "tests/fixed_tests.rs": F}),
    ("2026-09-15T09:37:26+02:00", "feat(parse): optional timestamp column", "",
     {"src/parse.rs": F, "tests/parse_tests.rs": F, "examples/orders.txt": F, "tests/cli_tests.rs": F}),
    ("2026-09-16T14:02:33+02:00", "build: add tickfmt helper crate for tick-aware formatting",
     "Shared with the market-data tooling; Fixed's Display impl is meant to move\nonto it.",
     {"crates/tickfmt/Cargo.toml": F, "crates/tickfmt/src/lib.rs": F, "Cargo.toml": F}),
    ("2026-09-17T11:25:17+02:00", "chore: silence dead-code and unused-import warnings", "",
     {"src/lib.rs": F}),
    ("2026-09-18T16:40:05+02:00", "feat(report): per-account summary in the JSON report", "",
     {"src/report.rs": F}),
    ("2026-09-21T10:12:48+02:00", "test(engine): cover pro-rata allocation", "",
     {"tests/engine_tests.rs": F}),
    ("2026-09-21T15:30:21+02:00", "docs: README for the 0.4 CLI, JSON report and library API", "",
     {"README.md": F}),
]


def run(cmd: list[str], env: dict | None = None, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(cmd, cwd=REPO, env=env, capture_output=True, text=True,
                            encoding="utf-8", errors="replace")
    if check and result.returncode != 0:
        raise SystemExit(f"{' '.join(cmd)} failed:\n{result.stdout}\n{result.stderr}")
    return result


def _force_remove(func, path, _exc) -> None:
    # git marks object files read-only; clear the flag and retry.
    os.chmod(path, stat.S_IWRITE)
    func(path)


def main() -> None:
    if REPO.exists():
        shutil.rmtree(REPO, onexc=_force_remove)
    REPO.mkdir(parents=True)
    run(["git", "init", "-q", "-b", "main"])
    run(["git", "config", "user.name", AUTHOR[0]])
    run(["git", "config", "user.email", AUTHOR[1]])
    run(["git", "config", "core.autocrlf", "false"])
    run(["git", "config", "commit.gpgsign", "false"])

    cargo_env = os.environ.copy()
    cargo_env["CARGO_TARGET_DIR"] = str(TARGET)
    cargo_env["CARGO_TERM_COLOR"] = "never"

    for index, (date, subject, body, files) in enumerate(COMMITS, start=1):
        for rel, content in files.items():
            if content == F:
                content = read(rel)
            path = REPO / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(content)
        check = run(["cargo", "check", "--offline", "--all-targets", "--message-format=short"],
                    env=cargo_env, check=False)
        warnings = [l for l in check.stderr.splitlines() if ": warning: " in l]
        status = "ok" if check.returncode == 0 else "FAILED"
        print(f"C{index:02d} {status} warnings={len(warnings)} {subject}")
        for w in warnings:
            print(f"      {w}")
        if check.returncode != 0:
            print(check.stderr)
            raise SystemExit(1)
        run(["git", "add", "-A"])
        message = subject + ("\n\n" + body if body else "")
        env = os.environ.copy()
        env.update({
            "GIT_AUTHOR_NAME": AUTHOR[0], "GIT_AUTHOR_EMAIL": AUTHOR[1],
            "GIT_COMMITTER_NAME": AUTHOR[0], "GIT_COMMITTER_EMAIL": AUTHOR[1],
            "GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date,
        })
        run(["git", "commit", "-q", "--date", date, "-m", message], env=env)

    # The final tree must match ./final exactly (plus the generated lockfile).
    mismatches = []
    for src in FINAL.rglob("*"):
        if src.is_dir() or "target" in src.relative_to(FINAL).parts or src.name == "Cargo.lock":
            continue
        rel = src.relative_to(FINAL)
        dest = REPO / rel
        if not dest.exists() or dest.read_bytes() != src.read_bytes():
            mismatches.append(str(rel))
    for dest in REPO.rglob("*"):
        rel = dest.relative_to(REPO)
        if dest.is_dir() or rel.parts[0] == ".git" or rel.name in {"Cargo.lock", ".gitattributes"}:
            continue
        if not (FINAL / rel).exists():
            mismatches.append(f"extra: {rel}")
    if mismatches:
        raise SystemExit(f"final tree differs from ./final: {mismatches}")
    print("final tree matches ./final")


if __name__ == "__main__":
    main()
