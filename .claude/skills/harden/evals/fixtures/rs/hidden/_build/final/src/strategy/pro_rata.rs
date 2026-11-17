//! Pro-rata: every order at the level receives a share of the incoming
//! quantity proportional to its remaining size. Shares are rounded down to the
//! raw unit and the units lost to rounding go to the oldest orders first.

use super::{Allocation, Strategy, StrategyParams};
use crate::book::RestingOrder;
use crate::fixed::Fixed;

/// Registry entry point.
pub fn build(_params: &StrategyParams) -> Box<dyn Strategy> {
    Box::new(ProRata)
}

/// Size-proportional allocation.
#[derive(Debug, Clone, Copy, Default)]
pub struct ProRata;

impl Strategy for ProRata {
    fn name(&self) -> &str {
        "pro_rata"
    }

    fn allocate(&self, level: &[RestingOrder], qty: Fixed) -> Vec<Allocation> {
        let total: i128 = level.iter().map(|o| i128::from(o.remaining.raw())).sum();
        if total <= 0 || !qty.is_positive() {
            return Vec::new();
        }
        let target = i128::from(qty.raw()).min(total);
        let mut shares: Vec<i128> = level
            .iter()
            .map(|o| i128::from(o.remaining.raw()) * target / total)
            .collect();

        let mut leftover = target - shares.iter().sum::<i128>();
        for (share, order) in shares.iter_mut().zip(level) {
            if leftover == 0 {
                break;
            }
            let room = i128::from(order.remaining.raw()) - *share;
            let extra = room.min(leftover);
            *share += extra;
            leftover -= extra;
        }

        shares
            .into_iter()
            .enumerate()
            .filter(|(_, share)| *share > 0)
            .map(|(index, share)| Allocation {
                index,
                qty: Fixed::from_raw(
                    i64::try_from(share).expect("a share never exceeds the order size"),
                ),
            })
            .collect()
    }
}
