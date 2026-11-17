//! Lead market maker priority.
//!
//! Designated LMM accounts first receive up to `lmm_share_pct` percent of the
//! incoming quantity (oldest LMM order first). Whatever is left is allocated
//! price-time across the whole level, LMM orders included.

use super::{Allocation, Strategy, StrategyParams};
use crate::book::RestingOrder;
use crate::fixed::Fixed;

/// Registry entry point.
pub fn build(params: &StrategyParams) -> Box<dyn Strategy> {
    Box::new(LeadMarketMaker {
        accounts: params.lmm_accounts.clone(),
        share_pct: params.lmm_share_pct.min(100),
    })
}

/// LMM-first allocation with a FIFO remainder.
#[derive(Debug, Clone)]
pub struct LeadMarketMaker {
    accounts: Vec<String>,
    share_pct: u32,
}

impl LeadMarketMaker {
    fn is_lmm(&self, account: &str) -> bool {
        self.accounts.iter().any(|a| a == account)
    }
}

impl Strategy for LeadMarketMaker {
    fn name(&self) -> &str {
        "lmm"
    }

    fn allocate(&self, level: &[RestingOrder], qty: Fixed) -> Vec<Allocation> {
        let mut given = vec![Fixed::ZERO; level.len()];
        let mut left = qty;

        let reserved_raw = i128::from(qty.raw()) * i128::from(self.share_pct) / 100;
        let mut reserved = Fixed::from_raw(
            i64::try_from(reserved_raw).expect("the reserved share is at most qty"),
        );
        for (slot, order) in given.iter_mut().zip(level) {
            if !reserved.is_positive() {
                break;
            }
            if self.is_lmm(&order.account) {
                let take = order.remaining.min(reserved);
                *slot += take;
                reserved -= take;
                left -= take;
            }
        }

        for (slot, order) in given.iter_mut().zip(level) {
            if !left.is_positive() {
                break;
            }
            let take = (order.remaining - *slot).min(left);
            *slot += take;
            left -= take;
        }

        given
            .into_iter()
            .enumerate()
            .filter(|(_, qty)| qty.is_positive())
            .map(|(index, qty)| Allocation { index, qty })
            .collect()
    }
}
