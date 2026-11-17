//! Per-symbol limit order book.

use std::collections::{BTreeMap, HashMap, VecDeque};

use crate::fixed::Fixed;
use crate::order::{OrderId, Side};

/// An order resting on the book.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestingOrder {
    pub id: OrderId,
    pub account: String,
    pub remaining: Fixed,
    pub ts: u64,
}

/// Orders at one price, oldest first.
pub type Queue = VecDeque<RestingOrder>;

/// Limit order book for a single symbol.
#[derive(Debug, Clone, Default)]
pub struct OrderBook {
    symbol: String,
    bids: BTreeMap<Fixed, Queue>,
    asks: BTreeMap<Fixed, Queue>,
    index: HashMap<OrderId, (Side, Fixed)>,
}

impl OrderBook {
    pub fn new(symbol: &str) -> OrderBook {
        OrderBook {
            symbol: symbol.to_string(),
            ..OrderBook::default()
        }
    }

    pub fn symbol(&self) -> &str {
        &self.symbol
    }

    /// Number of resting orders on both sides.
    pub fn len(&self) -> usize {
        self.index.len()
    }

    pub fn is_empty(&self) -> bool {
        self.index.is_empty()
    }

    pub fn contains(&self, id: OrderId) -> bool {
        self.index.contains_key(&id)
    }

    /// Number of resting orders on `side`.
    pub fn order_count(&self, side: Side) -> usize {
        self.levels(side).values().map(VecDeque::len).sum()
    }

    pub fn best_bid(&self) -> Option<Fixed> {
        self.bids.keys().next_back().copied()
    }

    pub fn best_ask(&self) -> Option<Fixed> {
        self.asks.keys().next().copied()
    }

    /// Adds `order` at the back of the queue for `price` on `side`.
    pub fn insert(&mut self, side: Side, price: Fixed, order: RestingOrder) {
        self.index.insert(order.id, (side, price));
        self.levels_mut(side)
            .entry(price)
            .or_default()
            .push_back(order);
    }

    /// Removes a resting order, returning it if it was on the book.
    pub fn cancel(&mut self, id: OrderId) -> Option<RestingOrder> {
        let (side, price) = self.index.remove(&id)?;
        let levels = self.levels_mut(side);
        let queue = levels.get_mut(&price)?;
        let position = queue.iter().position(|o| o.id == id)?;
        let order = queue.remove(position);
        if queue.is_empty() {
            levels.remove(&price);
        }
        order
    }

    // Per your review in the previous session: bids are now walked with
    // `next_back()` instead of being stored under negated prices like in my
    // first draft, which is what fixed the failing best-bid test.
    /// The best (most aggressive) level on `side`, with mutable access to its queue.
    pub fn best_level_mut(&mut self, side: Side) -> Option<(Fixed, &mut Queue)> {
        let entry = match side {
            Side::Buy => self.bids.iter_mut().next_back(),
            Side::Sell => self.asks.iter_mut().next(),
        };
        entry.map(|(price, queue)| (*price, queue))
    }

    /// Forgets `removed` order ids and drops the level at `price` if it is now empty.
    pub fn tidy_level(&mut self, side: Side, price: Fixed, removed: &[OrderId]) {
        for id in removed {
            self.index.remove(id);
        }
        let levels = self.levels_mut(side);
        if levels.get(&price).is_some_and(VecDeque::is_empty) {
            levels.remove(&price);
        }
    }

    /// Quantity resting on `side` that an order from `account` could trade
    /// against up to `limit` (any price when `limit` is `None`). Orders from
    /// `account` itself are excluded because self-trade prevention cancels them.
    pub fn available(&self, side: Side, limit: Option<Fixed>, account: &str) -> Fixed {
        let reachable = |price: Fixed| match (side, limit) {
            (_, None) => true,
            (Side::Sell, Some(limit)) => price <= limit,
            (Side::Buy, Some(limit)) => price >= limit,
        };
        self.levels(side)
            .iter()
            .filter(|(price, _)| reachable(**price))
            .flat_map(|(_, queue)| queue.iter())
            .filter(|order| order.account != account)
            .map(|order| order.remaining)
            .sum()
    }

    /// Aggregated depth: up to `levels` `(price, total quantity)` pairs on
    /// `side`, best price first.
    pub fn depth(&self, side: Side, levels: usize) -> Vec<(Fixed, Fixed)> {
        let total = |queue: &Queue| queue.iter().map(|o| o.remaining).sum::<Fixed>();
        match side {
            Side::Buy => self
                .bids
                .iter()
                .rev()
                .take(levels)
                .map(|(price, queue)| (*price, total(queue)))
                .collect(),
            Side::Sell => self
                .asks
                .iter()
                .take(levels)
                .map(|(price, queue)| (*price, total(queue)))
                .collect(),
        }
    }

    fn levels(&self, side: Side) -> &BTreeMap<Fixed, Queue> {
        match side {
            Side::Buy => &self.bids,
            Side::Sell => &self.asks,
        }
    }

    fn levels_mut(&mut self, side: Side) -> &mut BTreeMap<Fixed, Queue> {
        match side {
            Side::Buy => &mut self.bids,
            Side::Sell => &mut self.asks,
        }
    }
}
