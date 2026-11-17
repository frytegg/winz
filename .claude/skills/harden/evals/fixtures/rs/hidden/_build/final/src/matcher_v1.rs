//! First matching loop: strict price-time priority, no fees, no order kinds.

use crate::book::{OrderBook, RestingOrder};
use crate::fill::Fill;
use crate::fixed::Fixed;
use crate::order::{Order, OrderId, Side};

/// Matches `order` against `book` and rests any remainder.
pub fn match_order(book: &mut OrderBook, order: &Order, next_trade_id: &mut u64) -> Vec<Fill> {
    let mut fills = Vec::new();
    let mut remaining = order.qty;
    let resting_side = order.side.opposite();

    while remaining.is_positive() {
        let Some((level_price, queue)) = book.best_level_mut(resting_side) else {
            break;
        };
        let crosses = match (order.side, order.price) {
            (_, None) => true,
            (Side::Buy, Some(limit)) => limit >= level_price,
            (Side::Sell, Some(limit)) => limit <= level_price,
        };
        if !crosses {
            break;
        }

        let mut filled: Vec<OrderId> = Vec::new();
        for resting in queue.iter_mut() {
            if !remaining.is_positive() {
                break;
            }
            let take = resting.remaining.min(remaining);
            resting.remaining -= take;
            remaining -= take;
            fills.push(Fill {
                trade_id: *next_trade_id,
                symbol: order.symbol.clone(),
                price: level_price,
                qty: take,
                maker_order: resting.id,
                taker_order: order.id,
                maker_account: resting.account.clone(),
                taker_account: order.account.clone(),
                aggressor: order.side,
                maker_fee: Fixed::ZERO,
                taker_fee: Fixed::ZERO,
                ts: order.ts,
            });
            *next_trade_id += 1;
            if resting.remaining.is_zero() {
                filled.push(resting.id);
            }
        }
        queue.retain(|resting| resting.remaining.is_positive());
        book.tidy_level(resting_side, level_price, &filled);
    }

    if remaining.is_positive() {
        if let Some(price) = order.price {
            book.insert(
                order.side,
                price,
                RestingOrder {
                    id: order.id,
                    account: order.account.clone(),
                    remaining,
                    ts: order.ts,
                },
            );
        }
    }
    fills
}
