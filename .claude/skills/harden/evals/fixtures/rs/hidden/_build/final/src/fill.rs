//! Execution reports produced by the engine.

use crate::fixed::Fixed;
use crate::order::{OrderId, Side};

/// One execution between a resting (maker) order and an incoming (taker) order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fill {
    /// Sequential per engine, starting at 1.
    pub trade_id: u64,
    pub symbol: String,
    /// Execution price, always the maker's price.
    pub price: Fixed,
    pub qty: Fixed,
    pub maker_order: OrderId,
    pub taker_order: OrderId,
    pub maker_account: String,
    pub taker_account: String,
    /// Side of the incoming (taker) order.
    pub aggressor: Side,
    pub maker_fee: Fixed,
    pub taker_fee: Fixed,
    /// Timestamp of the taker order.
    pub ts: u64,
}

/// Why an order or cancel request was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RejectReason {
    DuplicateId,
    PostOnlyWouldCross,
    FokNotFillable,
    OutsidePriceBand,
    OffTick,
    NoLiquidity,
    UnknownOrder,
}

impl RejectReason {
    pub fn as_str(self) -> &'static str {
        match self {
            RejectReason::DuplicateId => "duplicate_id",
            RejectReason::PostOnlyWouldCross => "post_only_would_cross",
            RejectReason::FokNotFillable => "fok_not_fillable",
            RejectReason::OutsidePriceBand => "outside_price_band",
            RejectReason::OffTick => "off_tick",
            RejectReason::NoLiquidity => "no_liquidity",
            RejectReason::UnknownOrder => "unknown_order",
        }
    }
}

/// Why a resting order or an order remainder left the book.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelReason {
    Requested,
    SelfTrade,
    IocRemainder,
    MarketRemainder,
}

impl CancelReason {
    pub fn as_str(self) -> &'static str {
        match self {
            CancelReason::Requested => "requested",
            CancelReason::SelfTrade => "self_trade",
            CancelReason::IocRemainder => "ioc_remainder",
            CancelReason::MarketRemainder => "market_remainder",
        }
    }
}

/// Non-fill outcomes, in processing order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// The order, or its unfilled remainder, now rests on the book.
    Rested { id: OrderId, remaining: Fixed },
    Rejected { id: OrderId, reason: RejectReason },
    Cancelled { id: OrderId, reason: CancelReason },
}
