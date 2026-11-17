//! Orders and the instructions read from an order file.

use std::fmt;
use std::str::FromStr;

use crate::fixed::Fixed;

/// Client-assigned order identifier, unique per engine run.
pub type OrderId = u64;

/// Book side of an order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Side {
    Buy,
    Sell,
}

impl Side {
    /// The side an order on `self` trades against.
    pub fn opposite(self) -> Side {
        match self {
            Side::Buy => Side::Sell,
            Side::Sell => Side::Buy,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Side::Buy => "buy",
            Side::Sell => "sell",
        }
    }
}

impl fmt::Display for Side {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for Side {
    type Err = String;

    fn from_str(s: &str) -> Result<Side, String> {
        match s.to_ascii_lowercase().as_str() {
            "buy" | "b" | "bid" => Ok(Side::Buy),
            "sell" | "s" | "ask" => Ok(Side::Sell),
            other => Err(format!("unknown side `{other}`")),
        }
    }
}

/// Execution instruction attached to an order.
///
/// New kinds (stop, iceberg) are planned, so the enum is `#[non_exhaustive]`
/// and code outside this crate has to keep a wildcard arm when matching on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum OrderKind {
    /// Matches what it can and rests the remainder.
    Limit,
    /// Matches at any price and never rests.
    Market,
    /// Immediate-or-cancel: matches what it can and cancels the remainder.
    Ioc,
    /// Fill-or-kill: fills completely on arrival or is rejected.
    Fok,
    /// Rests only; rejected if it would trade on arrival.
    PostOnly,
}

impl OrderKind {
    /// Every kind this version supports, in display order.
    pub const ALL: [OrderKind; 5] = [
        OrderKind::Limit,
        OrderKind::Market,
        OrderKind::Ioc,
        OrderKind::Fok,
        OrderKind::PostOnly,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            OrderKind::Limit => "limit",
            OrderKind::Market => "market",
            OrderKind::Ioc => "ioc",
            OrderKind::Fok => "fok",
            OrderKind::PostOnly => "post_only",
        }
    }

    /// Whether orders of this kind must carry a limit price.
    pub fn requires_price(self) -> bool {
        !matches!(self, OrderKind::Market)
    }
}

impl FromStr for OrderKind {
    type Err = String;

    fn from_str(s: &str) -> Result<OrderKind, String> {
        match s.to_ascii_lowercase().as_str() {
            "limit" => Ok(OrderKind::Limit),
            "market" => Ok(OrderKind::Market),
            "ioc" => Ok(OrderKind::Ioc),
            "fok" => Ok(OrderKind::Fok),
            "post_only" | "postonly" => Ok(OrderKind::PostOnly),
            other => Err(format!("unknown order kind `{other}`")),
        }
    }
}

/// A new order as read from the order file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Order {
    pub id: OrderId,
    pub account: String,
    pub symbol: String,
    pub side: Side,
    pub kind: OrderKind,
    /// Limit price; `None` for market orders.
    pub price: Option<Fixed>,
    pub qty: Fixed,
    /// Client timestamp in milliseconds since the Unix epoch (0 when absent).
    pub ts: u64,
}

/// One instruction from an order file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Instruction {
    New(Order),
    Cancel { id: OrderId },
}
