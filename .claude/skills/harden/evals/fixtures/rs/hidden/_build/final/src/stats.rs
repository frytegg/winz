//! Aggregate statistics for reports.

use std::collections::BTreeMap;

use crate::fill::Fill;
use crate::fixed::Fixed;

/// Total traded quantity per symbol.
pub fn volume_by_symbol(fills: &[Fill]) -> BTreeMap<String, Fixed> {
    let mut volume: BTreeMap<String, Fixed> = BTreeMap::new();
    for fill in fills {
        *volume.entry(fill.symbol.clone()).or_default() += fill.qty;
    }
    volume
}

/// Volume-weighted average price per symbol.
pub fn vwap_by_symbol(fills: &[Fill]) -> BTreeMap<String, Fixed> {
    let mut sums: BTreeMap<String, (f64, f64)> = BTreeMap::new();
    for fill in fills {
        let entry = sums.entry(fill.symbol.clone()).or_insert((0.0, 0.0));
        entry.0 += fill.price.to_f64() * fill.qty.to_f64();
        entry.1 += fill.qty.to_f64();
    }
    sums.into_iter()
        .filter(|(_, (_, qty))| *qty > 0.0)
        .map(|(symbol, (notional, qty))| (symbol, Fixed::from_f64(notional / qty)))
        .collect()
}
