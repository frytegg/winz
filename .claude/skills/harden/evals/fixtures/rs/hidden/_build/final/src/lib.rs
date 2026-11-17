//! # matchbook
//!
//! A small limit order book and trade matching engine.
//!
//! * [`parse::parse_orders`] reads the order file format.
//! * [`Engine`] matches orders per symbol, splitting each price level with a
//!   [`Strategy`] chosen by name from a [`StrategyRegistry`].
//! * [`report`] renders the text summary and the JSON report.
//!
//! Every amount is a [`Fixed`] eight-decimal integer.

#![allow(dead_code, unused_imports)]

pub mod book;
pub mod config;
pub mod engine;
pub mod error;
pub mod fees;
pub mod fill;
pub mod fixed;
pub mod order;
pub mod parse;
pub mod refdata;
pub mod report;
pub mod strategy;

mod stats;
mod util;

pub use book::{OrderBook, RestingOrder};
pub use config::{Config, DEFAULT_STRATEGY};
pub use engine::Engine;
pub use error::Error;
pub use fees::FeeSchedule;
pub use fill::{CancelReason, Event, Fill, RejectReason};
pub use fixed::Fixed;
pub use order::{Instruction, Order, OrderId, OrderKind, Side};
pub use strategy::{Allocation, Strategy, StrategyParams, StrategyRegistry};

/// Crate version, as printed by `matchbook --version` and the JSON report.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Parses `orders` and runs them through a new engine built from `config`
/// with the built-in strategies.
pub fn run(orders: &str, config: &Config) -> Result<Engine, Error> {
    let instructions = parse::parse_orders(orders)?;
    let registry = StrategyRegistry::with_builtins();
    let mut engine = Engine::from_config(config, &registry);
    engine.run(instructions);
    Ok(engine)
}
