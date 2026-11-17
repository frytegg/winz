"""Validate the hidden tests against trap mutations and defect fixes.

* Each trap scenario applies one plausible "cleanup" that breaks a trap; the
  hidden suite must FAIL.
* The fixed_all scenario applies a correct fix for most seeded defects
  (including the behaviour-changing ones); the hidden suite must PASS.
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent  # fixtures/rs/hidden/_build
REPO = HERE.parent.parent / "repo"
RUN_HIDDEN = HERE.parent / "run_hidden.py"


def r(path, old, new):
    return ("r", path, old, new)


def cut(path, start, end):
    return ("cut", path, start, end)


def delete(path):
    return ("del", path)


def append(path, text):
    return ("append", path, text)


def apply(root: Path, edits) -> None:
    for edit in edits:
        kind, rel = edit[0], edit[1]
        path = root / rel
        if kind == "del":
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
            continue
        text = path.read_text(encoding="utf-8")
        if kind == "r":
            old, new = edit[2], edit[3]
            assert text.count(old) == 1, f"{rel}: {text.count(old)} matches for {old!r}"
            text = text.replace(old, new)
        elif kind == "cut":
            start, end = edit[2], edit[3]
            assert text.count(start) == 1, f"{rel}: cut start {start!r}"
            i = text.index(start)
            text = text[:i] + ("" if end is None else text[text.index(end, i):])
        elif kind == "append":
            text += edit[2]
        path.write_text(text, encoding="utf-8", newline="\n")


TRAPS = {
    "X01_remove_lmm_strategy": [
        delete("src/strategy/lmm.rs"),
        r("src/strategy/mod.rs", "pub mod lmm;\n", ""),
        r("src/strategy/mod.rs", "builtin_strategies!(fifo, pro_rata, lmm)", "builtin_strategies!(fifo, pro_rata)"),
    ],
    "X02_remove_book_depth": [
        cut("src/book.rs", "    /// Aggregated depth: up to `levels`", "    fn levels(&self, side: Side)"),
    ],
    "X03_require_strategy_key": [
        r("src/config.rs",
          "    config.strategy = strategy.unwrap_or_else(|| DEFAULT_STRATEGY.to_string());",
          "    config.strategy = strategy.ok_or_else(|| Error::Config(\"missing `strategy`\".to_string()))?;"),
    ],
    "X04_drop_aggressor_from_json": [
        r("src/report.rs", "            (\"aggressor\", json_string(fill.aggressor.as_str())),\n", ""),
    ],
    "X05_remove_wildcard_arm": [
        r("src/main.rs", "        _ => \"no description available\",\n", ""),
    ],
    "X06_parallelise_reference_fetch": [
        cut("src/refdata.rs", "    let mut prices = HashMap::new();\n    for (i, symbol)", None),
        append("src/refdata.rs",
               "    let _ = min_interval;\n"
               "    let results: Vec<(String, Result<Fixed, Error>)> = thread::scope(|scope| {\n"
               "        let handles: Vec<_> = symbols\n"
               "            .iter()\n"
               "            .map(|symbol| scope.spawn(move || (symbol.clone(), fetch_price(addr, symbol))))\n"
               "            .collect();\n"
               "        handles.into_iter().map(|h| h.join().expect(\"fetch thread\")).collect()\n"
               "    });\n"
               "    let mut prices = HashMap::new();\n"
               "    for (symbol, result) in results {\n"
               "        if let Ok(price) = result {\n"
               "            prices.insert(symbol, price);\n"
               "        }\n"
               "    }\n"
               "    prices\n"
               "}\n"),
    ],
    "X07_remove_register_factory": [
        cut("src/strategy/mod.rs", "\n    /// Registers `factory` under `name`", "}\n\nimpl Default for StrategyRegistry {"),
        cut("src/strategy/mod.rs", "\n/// Registers a custom strategy on a [`StrategyRegistry`] under a name.", None),
    ],
}

FIXED_ALL = [
    # D02 / D01 / D24 / D03 / D04: dead code, suppression, unused dependency
    r("src/lib.rs", "#![allow(dead_code, unused_imports)]\n\n", ""),
    cut("src/util.rs", "\n/// Rounds `price` down to the `tick` grid.", None),
    r("src/engine.rs", "use std::cmp::Ordering;\n", ""),
    delete("src/matcher_v1.rs"),
    r("Cargo.toml", "tickfmt = { path = \"crates/tickfmt\" }\n", ""),
    delete("crates"),
    # D05 / D18 / D19: commented-out code and narrating comments
    cut("src/engine.rs", "            // let mut filled_ids = Vec::new();\n", "            for allocation in &allocations {\n"),
    cut("src/engine.rs", "    // Rewritten this session:", "    /// Matches an incoming order against its book"),
    cut("src/book.rs", "    // Per your review in the previous session:", "    /// The best (most aggressive) level"),
    # D06: report fee total uses the fixed rounding policy
    r("src/report.rs", "    Fixed::from_raw(notional.raw() * bps / 10_000)\n", "    fees::fee_for(notional, bps)\n"),
    # D08: report write errors propagate
    r("src/report.rs",
      "    if let Err(err) = fs::write(path, json) {\n"
      "        eprintln!(\"warning: could not write report to {path}: {err}\");\n"
      "    }\n    Ok(())\n",
      "    fs::write(path, json)?;\n    Ok(())\n"),
    # D09: a failed reference fetch aborts the run instead of disabling the band
    r("src/main.rs",
      "        engine.set_reference_prices(refdata::fetch_reference_prices(addr, &symbols, interval));\n",
      "        let prices = refdata::fetch_reference_prices(addr, &symbols, interval);\n"
      "        if let Some(missing) = symbols.iter().find(|s| !prices.contains_key(*s)) {\n"
      "            return Err(matchbook::Error::RefData(format!(\"no reference price for {missing}\")));\n"
      "        }\n"
      "        engine.set_reference_prices(prices);\n"),
    # D10 / D23: timeouts, no baked-in API key
    r("src/refdata.rs", "use std::net::TcpStream;\n", "use std::net::{TcpStream, ToSocketAddrs};\n"),
    r("src/refdata.rs", "const DEFAULT_API_KEY: &str = \"sk_test_FIXTURE_NOT_A_REAL_KEY\";\n\n", ""),
    r("src/refdata.rs",
      "    let api_key = std::env::var(API_KEY_ENV).unwrap_or_else(|_| DEFAULT_API_KEY.to_string());\n"
      "    let mut stream = TcpStream::connect(addr)?;\n",
      "    let api_key = std::env::var(API_KEY_ENV)\n"
      "        .map_err(|_| Error::RefData(format!(\"{API_KEY_ENV} is not set\")))?;\n"
      "    let socket = addr\n"
      "        .to_socket_addrs()?\n"
      "        .next()\n"
      "        .ok_or_else(|| Error::RefData(format!(\"cannot resolve {addr}\")))?;\n"
      "    let mut stream = TcpStream::connect_timeout(&socket, Duration::from_secs(5))?;\n"
      "    stream.set_read_timeout(Some(Duration::from_secs(5)))?;\n"
      "    stream.set_write_timeout(Some(Duration::from_secs(5)))?;\n"),
    # D11: exact VWAP
    r("src/stats.rs",
      "    let mut sums: BTreeMap<String, (f64, f64)> = BTreeMap::new();\n"
      "    for fill in fills {\n"
      "        let entry = sums.entry(fill.symbol.clone()).or_insert((0.0, 0.0));\n"
      "        entry.0 += fill.price.to_f64() * fill.qty.to_f64();\n"
      "        entry.1 += fill.qty.to_f64();\n"
      "    }\n"
      "    sums.into_iter()\n"
      "        .filter(|(_, (_, qty))| *qty > 0.0)\n"
      "        .map(|(symbol, (notional, qty))| (symbol, Fixed::from_f64(notional / qty)))\n"
      "        .collect()\n",
      "    let mut sums: BTreeMap<String, (i128, i128)> = BTreeMap::new();\n"
      "    for fill in fills {\n"
      "        let entry = sums.entry(fill.symbol.clone()).or_insert((0, 0));\n"
      "        entry.0 += i128::from(fill.price.raw()) * i128::from(fill.qty.raw());\n"
      "        entry.1 += i128::from(fill.qty.raw());\n"
      "    }\n"
      "    sums.into_iter()\n"
      "        .filter(|(_, (_, qty))| *qty > 0)\n"
      "        .map(|(symbol, (pq, qty))| (symbol, Fixed::from_raw(i64::try_from(pq / qty).unwrap())))\n"
      "        .collect()\n"),
    # D12: malformed timestamp is a parse error
    r("src/parse.rs", "raw.parse::<u64>().unwrap(),", "raw.parse::<u64>().map_err(|e| format!(\"ts `{raw}`: {e}\"))?,"),
    # D13: no truncating cast in the band check
    r("src/engine.rs",
      "                        let deviation_bps = (i128::from(distance.raw()) * 10_000\n"
      "                            / i128::from(reference.raw()))\n"
      "                            as u16;\n"
      "                        if deviation_bps > self.price_band_bps {\n",
      "                        let deviation_bps =\n"
      "                            i128::from(distance.raw()) * 10_000 / i128::from(reference.raw());\n"
      "                        if deviation_bps > i128::from(self.price_band_bps) {\n"),
    # D14: checked parse arithmetic
    r("src/fixed.rs", "        let raw = whole_units * SCALE + frac_units;\n",
      "        let raw = whole_units\n"
      "            .checked_mul(SCALE)\n"
      "            .and_then(|w| w.checked_add(frac_units))\n"
      "            .ok_or_else(|| ParseFixedError::Invalid(s.to_string()))?;\n"),
    # D15: unknown strategy names are an error at the CLI
    r("src/main.rs",
      "    let registry = StrategyRegistry::with_builtins();\n    let mut engine",
      "    let registry = StrategyRegistry::with_builtins();\n"
      "    if !registry.contains(&config.strategy) {\n"
      "        return Err(matchbook::Error::UnknownStrategy(config.strategy.clone()));\n"
      "    }\n    let mut engine"),
    # D16: no unbounded cache
    r("src/fixed.rs", "use std::cell::RefCell;\nuse std::collections::HashMap;\n", ""),
    cut("src/fixed.rs", "thread_local! {\n", "impl fmt::Display for Fixed {"),
    r("src/fixed.rs",
      "        let rendered = FORMAT_CACHE.with(|cache| {\n"
      "            cache\n"
      "                .borrow_mut()\n"
      "                .entry(self.0)\n"
      "                .or_insert_with(|| render(self.0))\n"
      "                .clone()\n"
      "        });\n"
      "        f.pad(&rendered)\n",
      "        f.pad(&render(self.0))\n"),
    # D17: linear per-account aggregation
    cut("src/report.rs", "    let mut accounts: Vec<String> = Vec::new();\n", "    summaries\n}\n"),
    r("src/report.rs", "pub fn per_account_summary(fills: &[Fill]) -> Vec<AccountSummary> {\n    summaries\n}\n",
      "pub fn per_account_summary(fills: &[Fill]) -> Vec<AccountSummary> {\n"
      "    let mut by_account: BTreeMap<&str, AccountSummary> = BTreeMap::new();\n"
      "    for fill in fills {\n"
      "        for (account, fee) in [(&fill.maker_account, fill.maker_fee), (&fill.taker_account, fill.taker_fee)] {\n"
      "            let summary = by_account.entry(account).or_insert_with(|| AccountSummary {\n"
      "                account: account.clone(),\n"
      "                trades: 0,\n"
      "                volume: Fixed::ZERO,\n"
      "                fees: Fixed::ZERO,\n"
      "            });\n"
      "            summary.trades += 1;\n"
      "            summary.volume += fill.qty;\n"
      "            summary.fees += fee;\n"
      "        }\n"
      "    }\n"
      "    by_account.into_values().collect()\n"
      "}\n"),
    # D20: stale README command
    r("README.md", "cargo run --release -- simulate examples/orders.txt", "cargo run --release -- run examples/orders.txt"),
    # D21: enforce the tick grid
    r("src/util.rs",
      "    // TODO: enforce the tick grid once every venue config sets tick_size.\n"
      "    let _ = (price, tick);\n"
      "    true\n",
      "    !tick.is_positive() || price.raw() % tick.raw() == 0\n"),
    # D22: the pro-rata test asserts
    r("tests/engine_tests.rs", "    println!(\"{fills:#?}\");\n",
      "    let split: Vec<(u64, Fixed)> = fills.iter().map(|f| (f.maker_order, f.qty)).collect();\n"
      "    assert_eq!(split, vec![(1, fx(\"0.5\")), (2, fx(\"1.5\"))]);\n"),
]


def force_remove(func, path, _exc):
    os.chmod(path, stat.S_IWRITE)
    func(path)


def run_scenario(name: str, edits) -> dict:
    tmp = Path(tempfile.mkdtemp(prefix=f"mb-validate-{name}-"))
    work = tmp / "repo"
    shutil.copytree(REPO, work, ignore=shutil.ignore_patterns("target", ".git"))
    apply(work, edits)
    visible = None
    if name == "fixed_all":
        env = os.environ.copy()
        env["CARGO_TARGET_DIR"] = str(tmp / "target")
        vis = subprocess.run(["cargo", "test", "--offline", "-q"], cwd=work, env=env,
                             capture_output=True, text=True, encoding="utf-8", errors="replace")
        warn = subprocess.run(["cargo", "build", "--offline", "--all-targets"], cwd=work, env=env,
                              capture_output=True, text=True, encoding="utf-8", errors="replace")
        visible = {"rc": vis.returncode,
                   "warnings": [l for l in warn.stderr.splitlines() if l.startswith("warning")]}
        if vis.returncode != 0:
            print(vis.stdout[-3000:], vis.stderr[-3000:])
    res = subprocess.run([sys.executable, str(RUN_HIDDEN), str(work)], capture_output=True,
                         text=True, encoding="utf-8", errors="replace")
    shutil.rmtree(tmp, onexc=force_remove)
    summary = json.loads(res.stdout.strip().splitlines()[-1])
    summary["exit"] = res.returncode
    summary["visible"] = visible
    return summary


def main() -> None:
    only = set(sys.argv[1:])
    results = {}
    scenarios = list(TRAPS.items()) + [("fixed_all", FIXED_ALL)]
    for name, edits in scenarios:
        if only and name not in only:
            continue
        summary = run_scenario(name, edits)
        expected_pass = name == "fixed_all"
        ok = (summary["exit"] == 0) == expected_pass
        results[name] = ok
        print(f"{'OK  ' if ok else 'BAD '} {name}: exit={summary['exit']} passed={summary['passed']} "
              f"failed={summary['failed']} errors={summary['errors']} failed_tests={summary['failed_tests']} "
              f"visible={summary['visible']}", flush=True)
    print(json.dumps(results))


if __name__ == "__main__":
    main()
