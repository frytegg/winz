//! The matching engine.

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};

use crate::book::{OrderBook, RestingOrder};
use crate::config::Config;
use crate::fees::{self, FeeSchedule};
use crate::fill::{CancelReason, Event, Fill, RejectReason};
use crate::fixed::Fixed;
use crate::order::{Instruction, Order, OrderId, OrderKind, Side};
use crate::strategy::{fifo, Strategy, StrategyRegistry};
use crate::util;

/// Continuous matching across any number of symbols with one allocation strategy.
pub struct Engine {
    books: BTreeMap<String, OrderBook>,
    strategy: Box<dyn Strategy>,
    fees: FeeSchedule,
    price_band_bps: u16,
    tick_size: Fixed,
    reference: HashMap<String, Fixed>,
    seen: HashSet<OrderId>,
    fills: Vec<Fill>,
    events: Vec<Event>,
    next_trade_id: u64,
}

impl Engine {
    /// An engine using `strategy` and `fees`, with the price band disabled.
    pub fn new(strategy: Box<dyn Strategy>, fees: FeeSchedule) -> Engine {
        Engine {
            books: BTreeMap::new(),
            strategy,
            fees,
            price_band_bps: 0,
            tick_size: Fixed::from_raw(1),
            reference: HashMap::new(),
            seen: HashSet::new(),
            fills: Vec::new(),
            events: Vec::new(),
            next_trade_id: 1,
        }
    }

    /// Builds an engine from a parsed config, resolving the strategy by name.
    pub fn from_config(config: &Config, registry: &StrategyRegistry) -> Engine {
        // Fall back to FIFO when the name is not registered, so that a typo in
        // the config never stops the engine from matching.
        let strategy = registry
            .build(&config.strategy, &config.strategy_params)
            .unwrap_or_else(|| fifo::build(&config.strategy_params));
        let mut engine = Engine::new(strategy, config.fees);
        engine.price_band_bps = config.price_band_bps;
        engine.tick_size = config.tick_size;
        engine
    }

    /// Reference prices for the price-band check, keyed by symbol.
    pub fn set_reference_prices(&mut self, prices: HashMap<String, Fixed>) {
        self.reference = prices;
    }

    /// Name of the strategy actually in use.
    pub fn strategy_name(&self) -> &str {
        self.strategy.name()
    }

    pub fn fees(&self) -> FeeSchedule {
        self.fees
    }

    pub fn fills(&self) -> &[Fill] {
        &self.fills
    }

    pub fn events(&self) -> &[Event] {
        &self.events
    }

    pub fn book(&self, symbol: &str) -> Option<&OrderBook> {
        self.books.get(symbol)
    }

    /// All books, ordered by symbol.
    pub fn books(&self) -> impl Iterator<Item = &OrderBook> {
        self.books.values()
    }

    /// Processes `instructions` in order.
    pub fn run<I: IntoIterator<Item = Instruction>>(&mut self, instructions: I) {
        for instruction in instructions {
            self.process(instruction);
        }
    }

    pub fn process(&mut self, instruction: Instruction) {
        match instruction {
            Instruction::New(order) => self.submit(order),
            Instruction::Cancel { id } => self.cancel(id),
        }
    }

    /// Cancels a resting order.
    pub fn cancel(&mut self, id: OrderId) {
        for book in self.books.values_mut() {
            if book.cancel(id).is_some() {
                self.events.push(Event::Cancelled {
                    id,
                    reason: CancelReason::Requested,
                });
                return;
            }
        }
        self.events.push(Event::Rejected {
            id,
            reason: RejectReason::UnknownOrder,
        });
    }

    // Rewritten this session: matching now goes through the Strategy trait
    // instead of the hard-coded FIFO walk from matcher_v1. I moved the fee
    // maths in here as well so the fee tests pass again, and kept the old loop
    // below (commented out) until pro-rata has been checked against it.
    /// Matches an incoming order against its book, then rests, cancels or
    /// rejects whatever is left according to the order kind.
    pub fn submit(&mut self, order: Order) {
        if !self.seen.insert(order.id) {
            self.events.push(Event::Rejected {
                id: order.id,
                reason: RejectReason::DuplicateId,
            });
            return;
        }
        let mut book = self
            .books
            .remove(&order.symbol)
            .unwrap_or_else(|| OrderBook::new(&order.symbol));
        let resting_side = order.side.opposite();

        if let Some(limit) = order.price {
            if !util::check_tick(limit, self.tick_size) {
                self.events.push(Event::Rejected {
                    id: order.id,
                    reason: RejectReason::OffTick,
                });
                self.books.insert(order.symbol.clone(), book);
                return;
            }
            if self.price_band_bps > 0 {
                if let Some(reference) = self.reference.get(&order.symbol) {
                    if reference.is_positive() {
                        let distance = (limit - *reference).abs();
                        let deviation_bps = (i128::from(distance.raw()) * 10_000
                            / i128::from(reference.raw()))
                            as u16;
                        if deviation_bps > self.price_band_bps {
                            self.events.push(Event::Rejected {
                                id: order.id,
                                reason: RejectReason::OutsidePriceBand,
                            });
                            self.books.insert(order.symbol.clone(), book);
                            return;
                        }
                    }
                }
            }
        }

        match order.kind {
            OrderKind::PostOnly => {
                let would_cross = match (order.side, order.price) {
                    (Side::Buy, Some(limit)) => book.best_ask().is_some_and(|ask| limit >= ask),
                    (Side::Sell, Some(limit)) => book.best_bid().is_some_and(|bid| limit <= bid),
                    _ => false,
                };
                if would_cross {
                    self.events.push(Event::Rejected {
                        id: order.id,
                        reason: RejectReason::PostOnlyWouldCross,
                    });
                    self.books.insert(order.symbol.clone(), book);
                    return;
                }
            }
            OrderKind::Fok => {
                if book.available(resting_side, order.price, &order.account) < order.qty {
                    self.events.push(Event::Rejected {
                        id: order.id,
                        reason: RejectReason::FokNotFillable,
                    });
                    self.books.insert(order.symbol.clone(), book);
                    return;
                }
            }
            _ => {}
        }

        let mut remaining = order.qty;
        while remaining.is_positive() {
            let Some((level_price, queue)) = book.best_level_mut(resting_side) else {
                break;
            };
            let crosses = match order.price {
                None => true,
                Some(limit) => match order.side {
                    Side::Buy => limit >= level_price,
                    Side::Sell => limit <= level_price,
                },
            };
            if !crosses {
                break;
            }

            let mut removed: Vec<OrderId> = Vec::new();
            // Self-trade prevention (cancel resting): resting orders from the
            // incoming order's account leave the book instead of trading.
            queue.retain(|resting| {
                if resting.account == order.account {
                    removed.push(resting.id);
                    false
                } else {
                    true
                }
            });
            for id in &removed {
                self.events.push(Event::Cancelled {
                    id: *id,
                    reason: CancelReason::SelfTrade,
                });
            }

            let allocations = self.strategy.allocate(queue.make_contiguous(), remaining);
            // let mut filled_ids = Vec::new();
            // for (idx, resting) in queue.iter_mut().enumerate() {
            //     if remaining.is_zero() {
            //         break;
            //     }
            //     let take = resting.remaining.min(remaining);
            //     resting.remaining -= take;
            //     remaining -= take;
            //     if resting.remaining.is_zero() {
            //         filled_ids.push(idx);
            //     }
            // }
            for allocation in &allocations {
                if let Some(resting) = queue.get_mut(allocation.index) {
                    let qty = allocation.qty.min(resting.remaining).min(remaining);
                    if qty.is_positive() {
                        let notional = fees::notional(level_price, qty);
                        self.fills.push(Fill {
                            trade_id: self.next_trade_id,
                            symbol: order.symbol.clone(),
                            price: level_price,
                            qty,
                            maker_order: resting.id,
                            taker_order: order.id,
                            maker_account: resting.account.clone(),
                            taker_account: order.account.clone(),
                            aggressor: order.side,
                            maker_fee: self.fees.maker_fee(notional),
                            taker_fee: self.fees.taker_fee(notional),
                            ts: order.ts,
                        });
                        self.next_trade_id += 1;
                        resting.remaining -= qty;
                        remaining -= qty;
                    }
                }
            }
            queue.retain(|resting| {
                if resting.remaining.is_positive() {
                    true
                } else {
                    removed.push(resting.id);
                    false
                }
            });
            let level_empty = queue.is_empty();
            book.tidy_level(resting_side, level_price, &removed);
            if allocations.is_empty() && !level_empty {
                // The strategy allocated nothing at a non-empty level; stop
                // instead of spinning on it.
                break;
            }
        }

        if remaining.is_positive() {
            match order.kind {
                OrderKind::Limit | OrderKind::PostOnly => {
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
                        self.events.push(Event::Rested {
                            id: order.id,
                            remaining,
                        });
                    }
                }
                OrderKind::Market => {
                    let outcome = if remaining == order.qty {
                        Event::Rejected {
                            id: order.id,
                            reason: RejectReason::NoLiquidity,
                        }
                    } else {
                        Event::Cancelled {
                            id: order.id,
                            reason: CancelReason::MarketRemainder,
                        }
                    };
                    self.events.push(outcome);
                }
                OrderKind::Ioc | OrderKind::Fok => {
                    self.events.push(Event::Cancelled {
                        id: order.id,
                        reason: CancelReason::IocRemainder,
                    });
                }
            }
        }
        self.books.insert(order.symbol.clone(), book);
    }
}
