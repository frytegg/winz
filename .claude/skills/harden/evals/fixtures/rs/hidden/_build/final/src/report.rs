//! Text and JSON reports.
//!
//! The JSON layout is a published contract (README, "JSON report"). Bump
//! [`SCHEMA_VERSION`] for any incompatible change.

use std::collections::BTreeMap;
use std::fs;

use crate::engine::Engine;
use crate::error::Error;
use crate::fees;
use crate::fill::{Event, Fill};
use crate::fixed::Fixed;
use crate::order::Side;
use crate::stats;

/// Version of the JSON report layout.
pub const SCHEMA_VERSION: u32 = 1;

/// Per-account totals for the report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountSummary {
    pub account: String,
    /// Number of fills the account took part in, on either side.
    pub trades: usize,
    /// Quantity traded, both sides.
    pub volume: Fixed,
    /// Fees paid (negative for net rebates).
    pub fees: Fixed,
}

/// Human-readable summary printed by the CLI.
pub fn render_text(strategy: &str, engine: &Engine) -> String {
    let mut out = String::new();
    out.push_str(&format!("strategy: {strategy}\n"));
    out.push_str(&format!("fills: {}\n", engine.fills().len()));
    for fill in engine.fills() {
        out.push_str(&format!(
            "  #{:<3} {:<8} {:>12} @ {:<10} maker {}({}) taker {}({}) fees {}/{}\n",
            fill.trade_id,
            fill.symbol,
            fill.qty,
            fill.price,
            fill.maker_order,
            fill.maker_account,
            fill.taker_order,
            fill.taker_account,
            fill.maker_fee,
            fill.taker_fee,
        ));
    }
    for event in engine.events() {
        match event {
            Event::Rejected { id, reason } => {
                out.push_str(&format!("rejected: order {id} ({})\n", reason.as_str()));
            }
            Event::Cancelled { id, reason } => {
                out.push_str(&format!("cancelled: order {id} ({})\n", reason.as_str()));
            }
            Event::Rested { .. } => {}
        }
    }
    for book in engine.books() {
        out.push_str(&format!(
            "resting: {} bids={} asks={}\n",
            book.symbol(),
            book.order_count(Side::Buy),
            book.order_count(Side::Sell),
        ));
    }
    out
}

/// The JSON report for a finished run.
pub fn render_json(strategy: &str, engine: &Engine) -> String {
    let fills = engine.fills();
    let schedule = engine.fees();

    let fill_objects: Vec<String> = fills.iter().map(fill_json).collect();
    let mut rejections = Vec::new();
    let mut cancellations = Vec::new();
    for event in engine.events() {
        match event {
            Event::Rejected { id, reason } => rejections.push(object(
                &[
                    ("order", id.to_string()),
                    ("reason", json_string(reason.as_str())),
                ],
                4,
            )),
            Event::Cancelled { id, reason } => cancellations.push(object(
                &[
                    ("order", id.to_string()),
                    ("reason", json_string(reason.as_str())),
                ],
                4,
            )),
            Event::Rested { .. } => {}
        }
    }

    let total_fees = fills.iter().fold(Fixed::ZERO, |acc, fill| {
        let notional = fees::notional(fill.price, fill.qty);
        acc + estimate_fee(notional, schedule.maker_bps) + estimate_fee(notional, schedule.taker_bps)
    });
    let summary = object(
        &[
            ("fill_count", fills.len().to_string()),
            ("total_fees", json_string(&total_fees.to_string())),
            ("volume", amount_map(&stats::volume_by_symbol(fills), 4)),
            ("vwap", amount_map(&stats::vwap_by_symbol(fills), 4)),
        ],
        2,
    );
    let accounts: Vec<String> = per_account_summary(fills)
        .iter()
        .map(|summary| {
            object(
                &[
                    ("account", json_string(&summary.account)),
                    ("trades", summary.trades.to_string()),
                    ("volume", json_string(&summary.volume.to_string())),
                    ("fees", json_string(&summary.fees.to_string())),
                ],
                4,
            )
        })
        .collect();

    let root = object(
        &[
            ("schema_version", SCHEMA_VERSION.to_string()),
            ("generator", json_string(&format!("matchbook {}", crate::VERSION))),
            ("strategy", json_string(strategy)),
            ("fills", array(&fill_objects, 2)),
            ("rejections", array(&rejections, 2)),
            ("cancellations", array(&cancellations, 2)),
            ("summary", summary),
            ("accounts", array(&accounts, 2)),
        ],
        0,
    );
    format!("{root}\n")
}

/// Writes a rendered report to `path`, or to stdout when `path` is `-`.
pub fn write_json_report(path: &str, json: &str) -> Result<(), Error> {
    if path == "-" {
        print!("{json}");
        return Ok(());
    }
    if let Err(err) = fs::write(path, json) {
        eprintln!("warning: could not write report to {path}: {err}");
    }
    Ok(())
}

/// Trade count, volume and fees per account, sorted by account name.
pub fn per_account_summary(fills: &[Fill]) -> Vec<AccountSummary> {
    let mut accounts: Vec<String> = Vec::new();
    for fill in fills {
        for account in [&fill.maker_account, &fill.taker_account] {
            if !accounts.contains(account) {
                accounts.push(account.clone());
            }
        }
    }
    accounts.sort();

    let mut summaries = Vec::with_capacity(accounts.len());
    for account in accounts {
        let mut summary = AccountSummary {
            account: account.clone(),
            trades: 0,
            volume: Fixed::ZERO,
            fees: Fixed::ZERO,
        };
        for fill in fills {
            if fill.maker_account == account {
                summary.trades += 1;
                summary.volume += fill.qty;
                summary.fees += fill.maker_fee;
            }
            if fill.taker_account == account {
                summary.trades += 1;
                summary.volume += fill.qty;
                summary.fees += fill.taker_fee;
            }
        }
        summaries.push(summary);
    }
    summaries
}

// Fee total for the summary block: `bps` of the notional, truncated to the raw unit.
fn estimate_fee(notional: Fixed, bps: i64) -> Fixed {
    Fixed::from_raw(notional.raw() * bps / 10_000)
}

fn fill_json(fill: &Fill) -> String {
    object(
        &[
            ("trade_id", fill.trade_id.to_string()),
            ("symbol", json_string(&fill.symbol)),
            ("price", json_string(&fill.price.to_string())),
            ("qty", json_string(&fill.qty.to_string())),
            ("maker_order", fill.maker_order.to_string()),
            ("taker_order", fill.taker_order.to_string()),
            ("maker_account", json_string(&fill.maker_account)),
            ("taker_account", json_string(&fill.taker_account)),
            ("aggressor", json_string(fill.aggressor.as_str())),
            ("maker_fee", json_string(&fill.maker_fee.to_string())),
            ("taker_fee", json_string(&fill.taker_fee.to_string())),
            ("ts", fill.ts.to_string()),
        ],
        4,
    )
}

fn amount_map(values: &BTreeMap<String, Fixed>, indent: usize) -> String {
    let fields: Vec<(&str, String)> = values
        .iter()
        .map(|(key, value)| (key.as_str(), json_string(&value.to_string())))
        .collect();
    object(&fields, indent)
}

/// A JSON object whose closing brace sits at `indent` spaces. The opening
/// brace is not indented so the object can follow a key.
fn object(fields: &[(&str, String)], indent: usize) -> String {
    if fields.is_empty() {
        return "{}".to_string();
    }
    let inner = " ".repeat(indent + 2);
    let body: Vec<String> = fields
        .iter()
        .map(|(key, value)| format!("{inner}{}: {value}", json_string(key)))
        .collect();
    format!("{{\n{}\n{}}}", body.join(",\n"), " ".repeat(indent))
}

fn array(items: &[String], indent: usize) -> String {
    if items.is_empty() {
        return "[]".to_string();
    }
    let inner = " ".repeat(indent + 2);
    let body: Vec<String> = items.iter().map(|item| format!("{inner}{item}")).collect();
    format!("[\n{}\n{}]", body.join(",\n"), " ".repeat(indent))
}

fn json_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if u32::from(c) < 0x20 => out.push_str(&format!("\\u{:04x}", u32::from(c))),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_json_strings() {
        assert_eq!(json_string("a\"b\\c\n"), "\"a\\\"b\\\\c\\n\"");
    }

    #[test]
    fn empty_collections_render_compactly() {
        assert_eq!(object(&[], 2), "{}");
        assert_eq!(array(&[], 2), "[]");
    }
}
