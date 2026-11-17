//! Parser for the order file format.
//!
//! One instruction per line, comma separated. Blank lines and lines starting
//! with `#` are ignored.
//!
//! ```text
//! N,<id>,<account>,<symbol>,<side>,<kind>,<price>,<qty>[,<ts_ms>]
//! C,<id>
//! ```
//!
//! `<price>` is left empty for market orders.

use crate::error::Error;
use crate::fixed::Fixed;
use crate::order::{Instruction, Order, OrderId, OrderKind, Side};

/// Parses a whole order file, stopping at the first malformed line.
pub fn parse_orders(input: &str) -> Result<Vec<Instruction>, Error> {
    let mut instructions = Vec::new();
    for (index, raw) in input.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let instruction = parse_line(line).map_err(|msg| Error::Parse {
            line: index + 1,
            msg,
        })?;
        instructions.push(instruction);
    }
    Ok(instructions)
}

/// Parses a single non-comment line.
pub fn parse_line(line: &str) -> Result<Instruction, String> {
    let fields: Vec<&str> = line.split(',').map(str::trim).collect();
    match fields[0] {
        "N" | "n" => parse_new(&fields),
        "C" | "c" => parse_cancel(&fields),
        other => Err(format!("unknown record type `{other}`")),
    }
}

fn parse_new(fields: &[&str]) -> Result<Instruction, String> {
    if fields.len() < 8 || fields.len() > 9 {
        return Err(format!(
            "expected 8 or 9 fields for a new order, got {}",
            fields.len()
        ));
    }
    let id = parse_id(fields[1])?;
    let account = non_empty(fields[2], "account")?;
    let symbol = non_empty(fields[3], "symbol")?;
    let side: Side = fields[4].parse()?;
    let kind: OrderKind = fields[5].parse()?;
    let price = if fields[6].is_empty() {
        None
    } else {
        let price: Fixed = fields[6].parse().map_err(|e| format!("price: {e}"))?;
        if !price.is_positive() {
            return Err(format!("price must be positive, got {price}"));
        }
        Some(price)
    };
    match (kind.requires_price(), price) {
        (true, None) => return Err(format!("{} orders need a price", kind.as_str())),
        (false, Some(_)) => return Err("market orders must not carry a price".to_string()),
        _ => {}
    }
    let qty: Fixed = fields[7].parse().map_err(|e| format!("qty: {e}"))?;
    if !qty.is_positive() {
        return Err(format!("qty must be positive, got {qty}"));
    }
    let ts = match fields.get(8) {
        Some(raw) if !raw.is_empty() => raw.parse::<u64>().unwrap(),
        _ => 0,
    };
    Ok(Instruction::New(Order {
        id,
        account,
        symbol,
        side,
        kind,
        price,
        qty,
        ts,
    }))
}

fn parse_cancel(fields: &[&str]) -> Result<Instruction, String> {
    if fields.len() != 2 {
        return Err(format!(
            "expected 2 fields for a cancel, got {}",
            fields.len()
        ));
    }
    Ok(Instruction::Cancel {
        id: parse_id(fields[1])?,
    })
}

fn parse_id(raw: &str) -> Result<OrderId, String> {
    raw.parse::<OrderId>()
        .map_err(|e| format!("order id `{raw}`: {e}"))
}

fn non_empty(raw: &str, what: &str) -> Result<String, String> {
    if raw.is_empty() {
        Err(format!("{what} must not be empty"))
    } else {
        Ok(raw.to_string())
    }
}
