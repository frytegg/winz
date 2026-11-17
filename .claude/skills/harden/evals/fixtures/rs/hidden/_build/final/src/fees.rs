//! Maker/taker fees.

use crate::fixed::Fixed;

/// Fee rates in basis points of notional. A negative rate is a rebate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FeeSchedule {
    pub maker_bps: i64,
    pub taker_bps: i64,
}

impl Default for FeeSchedule {
    fn default() -> FeeSchedule {
        FeeSchedule {
            maker_bps: 2,
            taker_bps: 5,
        }
    }
}

impl FeeSchedule {
    pub fn maker_fee(&self, notional: Fixed) -> Fixed {
        fee_for(notional, self.maker_bps)
    }

    pub fn taker_fee(&self, notional: Fixed) -> Fixed {
        fee_for(notional, self.taker_bps)
    }
}

/// Price x quantity.
///
/// # Panics
///
/// Panics if the notional does not fit in an `i64` of raw units.
pub fn notional(price: Fixed, qty: Fixed) -> Fixed {
    price.checked_mul(qty).expect("notional overflowed i64")
}

/// Fee of `bps` basis points on `notional`.
///
/// Charges are rounded up to the next raw unit so the venue never
/// under-collects; rebates (negative rates) are rounded toward zero so it
/// never over-pays.
pub fn fee_for(notional: Fixed, bps: i64) -> Fixed {
    let scaled = i128::from(notional.raw()) * i128::from(bps);
    let fee = if scaled > 0 {
        (scaled + 9_999) / 10_000
    } else {
        scaled / 10_000
    };
    Fixed::from_raw(i64::try_from(fee).expect("a fee is never larger than its notional"))
}
