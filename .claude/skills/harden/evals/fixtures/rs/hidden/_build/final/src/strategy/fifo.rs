//! Price-time priority: the oldest order at the level fills first.

use super::{Allocation, Strategy, StrategyParams};
use crate::book::RestingOrder;
use crate::fixed::Fixed;

/// Registry entry point.
pub fn build(_params: &StrategyParams) -> Box<dyn Strategy> {
    Box::new(Fifo)
}

/// First in, first out.
#[derive(Debug, Clone, Copy, Default)]
pub struct Fifo;

impl Strategy for Fifo {
    fn name(&self) -> &str {
        "fifo"
    }

    fn allocate(&self, level: &[RestingOrder], qty: Fixed) -> Vec<Allocation> {
        let mut left = qty;
        let mut allocations = Vec::new();
        for (index, order) in level.iter().enumerate() {
            if !left.is_positive() {
                break;
            }
            let take = order.remaining.min(left);
            if take.is_positive() {
                allocations.push(Allocation { index, qty: take });
                left -= take;
            }
        }
        allocations
    }
}
