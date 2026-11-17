//! Formatting helpers for scaled integer amounts.
//!
//! An amount is an integer count of `10^-decimals` units, the representation
//! used by matchbook's `Fixed` type.

/// Formats `raw` with exactly `decimals` fractional digits.
pub fn format_scaled(raw: i64, decimals: u32) -> String {
    let sign = if raw < 0 { "-" } else { "" };
    let magnitude = raw.unsigned_abs();
    if decimals == 0 {
        return format!("{sign}{magnitude}");
    }
    let scale = 10_u64.pow(decimals);
    let width = decimals as usize;
    format!(
        "{sign}{}.{:0width$}",
        magnitude / scale,
        magnitude % scale,
        width = width
    )
}

/// Number of fractional digits needed to show multiples of `tick_raw` exactly.
pub fn tick_decimals(tick_raw: i64, decimals: u32) -> u32 {
    let mut digits = decimals;
    let mut tick = tick_raw;
    while digits > 0 && tick != 0 && tick % 10 == 0 {
        tick /= 10;
        digits -= 1;
    }
    digits
}

/// Formats `raw` with just enough digits for the `tick_raw` grid.
pub fn format_on_tick(raw: i64, tick_raw: i64, decimals: u32) -> String {
    let shown = tick_decimals(tick_raw, decimals);
    let drop = 10_i64.pow(decimals - shown);
    format_scaled(raw / drop, shown)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_with_fixed_width() {
        assert_eq!(format_scaled(150_000_000, 8), "1.50000000");
        assert_eq!(format_scaled(-5, 2), "-0.05");
        assert_eq!(format_scaled(42, 0), "42");
    }

    #[test]
    fn tick_grid_digits() {
        assert_eq!(tick_decimals(1_000_000, 8), 2);
        assert_eq!(format_on_tick(3_000_050_000_000, 1_000_000, 8), "30000.50");
    }
}
