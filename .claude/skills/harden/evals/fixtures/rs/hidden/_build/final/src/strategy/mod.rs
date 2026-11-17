//! Allocation strategies and the name-keyed registry.
//!
//! A strategy decides how an incoming quantity is split across the resting
//! orders of one price level. Strategies are selected by name from the config
//! file (`strategy = pro_rata`), so the registry below is the only code that
//! refers to each implementation.

pub mod fifo;
pub mod lmm;
pub mod pro_rata;

use std::collections::BTreeMap;
use std::fmt;

use crate::book::RestingOrder;
use crate::fixed::Fixed;

/// Quantity assigned to the resting order at `index` in the level queue.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Allocation {
    pub index: usize,
    pub qty: Fixed,
}

/// Splits an incoming quantity across one price level.
pub trait Strategy: Send + Sync {
    /// Registry name of the strategy.
    fn name(&self) -> &str;

    /// Allocates up to `qty` across `level`, oldest order first.
    ///
    /// Implementations must not allocate more than an order's `remaining`, or
    /// more than `qty` in total, and return allocations in index order.
    fn allocate(&self, level: &[RestingOrder], qty: Fixed) -> Vec<Allocation>;
}

/// Strategy settings read from the config file.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StrategyParams {
    /// Accounts with lead-market-maker priority (`lmm` strategy).
    pub lmm_accounts: Vec<String>,
    /// Share of each incoming order reserved for LMM accounts, in percent.
    pub lmm_share_pct: u32,
}

/// Builds a strategy from its params.
pub type Factory = Box<dyn Fn(&StrategyParams) -> Box<dyn Strategy> + Send + Sync>;

type BuildFn = fn(&StrategyParams) -> Box<dyn Strategy>;

/// Pairs each built-in strategy module with its registry name (the module name).
macro_rules! builtin_strategies {
    ($($module:ident),* $(,)?) => {
        &[$((stringify!($module), $module::build as BuildFn)),*]
    };
}

const BUILTINS: &[(&str, BuildFn)] = builtin_strategies!(fifo, pro_rata, lmm);

/// Name-keyed collection of strategy factories.
pub struct StrategyRegistry {
    factories: BTreeMap<String, Factory>,
}

impl fmt::Debug for StrategyRegistry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("StrategyRegistry")
            .field("names", &self.names())
            .finish()
    }
}

impl StrategyRegistry {
    /// A registry with no strategies.
    pub fn empty() -> StrategyRegistry {
        StrategyRegistry {
            factories: BTreeMap::new(),
        }
    }

    /// A registry holding the built-in strategies.
    pub fn with_builtins() -> StrategyRegistry {
        let mut registry = StrategyRegistry::empty();
        for (name, build) in BUILTINS {
            let factory: Factory = Box::new(*build);
            registry.factories.insert((*name).to_string(), factory);
        }
        registry
    }

    /// Registered names, sorted.
    pub fn names(&self) -> Vec<&str> {
        self.factories.keys().map(String::as_str).collect()
    }

    pub fn contains(&self, name: &str) -> bool {
        self.factories.contains_key(name)
    }

    /// Builds the strategy registered under `name`.
    pub fn build(&self, name: &str, params: &StrategyParams) -> Option<Box<dyn Strategy>> {
        self.factories.get(name).map(|factory| factory(params))
    }

    /// Registers `factory` under `name`, replacing any previous entry.
    /// Returns `false` when an existing strategy was replaced.
    ///
    /// Call it through [`register_strategy!`](crate::register_strategy).
    #[doc(hidden)]
    pub fn __register_factory(&mut self, name: &str, factory: Factory) -> bool {
        self.factories.insert(name.to_string(), factory).is_none()
    }
}

impl Default for StrategyRegistry {
    fn default() -> StrategyRegistry {
        StrategyRegistry::with_builtins()
    }
}

/// Registers a custom strategy on a [`StrategyRegistry`] under a name.
///
/// `$ctor` is called with the `&StrategyParams` from the config each time the
/// strategy is built and must return a type implementing [`Strategy`].
#[macro_export]
macro_rules! register_strategy {
    ($registry:expr, $name:expr, $ctor:expr) => {
        $registry.__register_factory(
            $name,
            ::std::boxed::Box::new(move |params: &$crate::strategy::StrategyParams| {
                let strategy: ::std::boxed::Box<dyn $crate::strategy::Strategy> =
                    ::std::boxed::Box::new(($ctor)(params));
                strategy
            }),
        )
    };
}
