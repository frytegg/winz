//! Hidden behaviour tests for the matchbook library API.
//!
//! These pin observable behaviour that a behaviour-preserving hardening pass
//! must keep: registry resolution by name, the name-only strategies, the
//! documented config default, the public book/registry API used by library
//! consumers, and the engine's order-kind semantics. They deliberately do not
//! pin values that a correct behaviour-changing fix would alter (report fee
//! totals, float VWAP, off-tick handling, unknown strategy names, overflow or
//! malformed-input paths).

use std::collections::HashMap;

use matchbook::config::parse_config;
use matchbook::{
    register_strategy, run, Allocation, CancelReason, Config, Engine, Event, Fixed, OrderBook,
    RejectReason, RestingOrder, Side, Strategy, StrategyParams, StrategyRegistry,
    DEFAULT_STRATEGY,
};

fn fx(s: &str) -> Fixed {
    s.parse().unwrap()
}

fn maker_allocations(engine: &Engine) -> Vec<(u64, Fixed)> {
    engine
        .fills()
        .iter()
        .map(|fill| (fill.maker_order, fill.qty))
        .collect()
}

fn resting(id: u64, account: &str, remaining: &str) -> RestingOrder {
    RestingOrder {
        id,
        account: account.to_string(),
        remaining: fx(remaining),
        ts: 0,
    }
}

// ---------------------------------------------------------------- registry --

#[test]
fn registry_resolves_every_builtin_by_name() {
    let registry = StrategyRegistry::with_builtins();
    assert_eq!(registry.names(), vec!["fifo", "lmm", "pro_rata"]);
    for name in ["fifo", "pro_rata", "lmm"] {
        assert!(registry.contains(name), "{name} missing from the registry");
        let strategy = registry
            .build(name, &StrategyParams::default())
            .unwrap_or_else(|| panic!("{name} did not build"));
        assert_eq!(strategy.name(), name);
    }
    assert!(StrategyRegistry::empty().names().is_empty());
    assert_eq!(StrategyRegistry::default().names(), registry.names());
}

#[test]
fn lmm_strategy_is_loadable_by_name_and_allocates_lmm_first() {
    let registry = StrategyRegistry::with_builtins();
    let params = StrategyParams {
        lmm_accounts: vec!["mm1".to_string()],
        lmm_share_pct: 40,
    };
    let lmm = registry.build("lmm", &params).expect("lmm is registered");
    let level = [
        resting(1, "bob", "1"),
        resting(2, "mm1", "2"),
        resting(3, "carol", "1"),
    ];
    let allocations = lmm.allocate(&level, fx("1"));
    assert_eq!(
        allocations,
        vec![
            Allocation { index: 0, qty: fx("0.6") },
            Allocation { index: 1, qty: fx("0.4") },
        ]
    );
}

#[test]
fn lmm_selected_from_config_text_drives_the_engine() {
    let config = parse_config("strategy = lmm\nlmm_accounts = mm1\nlmm_share_pct = 40\n").unwrap();
    assert_eq!(config.strategy, "lmm");
    let engine = run(
        "N,1,bob,X,sell,limit,100,1\nN,2,mm1,X,sell,limit,100,2\nN,3,carol,X,sell,limit,100,1\nN,4,taker,X,buy,limit,100,1\n",
        &config,
    )
    .unwrap();
    assert_eq!(engine.strategy_name(), "lmm");
    assert_eq!(maker_allocations(&engine), vec![(1, fx("0.6")), (2, fx("0.4"))]);
}

#[test]
fn pro_rata_splits_by_size_and_hands_rounding_units_to_the_oldest() {
    let mut config = Config::default();
    config.strategy = "pro_rata".to_string();
    let engine = run(
        "N,1,alice,X,sell,limit,100,1\nN,2,carol,X,sell,limit,100,3\nN,3,bob,X,buy,limit,100,2\n",
        &config,
    )
    .unwrap();
    assert_eq!(engine.strategy_name(), "pro_rata");
    assert_eq!(maker_allocations(&engine), vec![(1, fx("0.5")), (2, fx("1.5"))]);

    let registry = StrategyRegistry::with_builtins();
    let pro_rata = registry.build("pro_rata", &StrategyParams::default()).unwrap();
    // Three orders of one raw unit sharing two raw units: every exact share
    // rounds down to zero and the two leftover units go to the two oldest.
    let level = [
        resting(1, "a", "0.00000001"),
        resting(2, "b", "0.00000001"),
        resting(3, "c", "0.00000001"),
    ];
    assert_eq!(
        pro_rata.allocate(&level, Fixed::from_raw(2)),
        vec![
            Allocation { index: 0, qty: Fixed::from_raw(1) },
            Allocation { index: 1, qty: Fixed::from_raw(1) },
        ]
    );
}

#[test]
fn fifo_allocates_in_time_priority() {
    let registry = StrategyRegistry::with_builtins();
    let fifo = registry.build("fifo", &StrategyParams::default()).unwrap();
    let level = [resting(1, "a", "1"), resting(2, "b", "3")];
    assert_eq!(
        fifo.allocate(&level, fx("2")),
        vec![
            Allocation { index: 0, qty: fx("1") },
            Allocation { index: 1, qty: fx("1") },
        ]
    );
}

// ------------------------------------------------------- documented default --

#[test]
fn config_without_strategy_uses_the_documented_default() {
    assert_eq!(DEFAULT_STRATEGY, "fifo");
    let config = parse_config("maker_fee_bps = 3\ntaker_fee_bps = 7\n").unwrap();
    assert_eq!(config.strategy, "fifo");
    assert_eq!(config.fees.maker_bps, 3);
    assert_eq!(config.fees.taker_bps, 7);
    assert_eq!(parse_config("").unwrap().strategy, "fifo");
    assert_eq!(parse_config("# only a comment\n").unwrap(), Config::default());

    let engine = Engine::from_config(&config, &StrategyRegistry::with_builtins());
    assert_eq!(engine.strategy_name(), "fifo");
}

#[test]
fn config_parses_every_documented_key() {
    let config = parse_config(
        "strategy = pro_rata\nmaker_fee_bps = -1\ntaker_fee_bps = 6\nlmm_accounts = mm1, mm2\n\
         lmm_share_pct = 25\nprice_band_bps = 500\ntick_size = 0.01\nref_addr = 127.0.0.1:9100\n\
         ref_interval_ms = 100 # trailing comment\n",
    )
    .unwrap();
    assert_eq!(config.strategy, "pro_rata");
    assert_eq!(config.fees.maker_bps, -1);
    assert_eq!(config.fees.taker_bps, 6);
    assert_eq!(config.strategy_params.lmm_accounts, vec!["mm1", "mm2"]);
    assert_eq!(config.strategy_params.lmm_share_pct, 25);
    assert_eq!(config.price_band_bps, 500);
    assert_eq!(config.tick_size, fx("0.01"));
    assert_eq!(config.ref_addr.as_deref(), Some("127.0.0.1:9100"));
    assert_eq!(config.ref_interval_ms, 100);
    assert!(parse_config("no_such_key = 1\n").is_err());
    assert!(parse_config("strategy fifo\n").is_err());
}

// ------------------------------------------------ public API for consumers --

#[test]
fn order_book_depth_aggregates_levels_best_first() {
    let engine = run(
        "N,1,a,X,sell,limit,101,1\nN,2,b,X,sell,limit,101,2\nN,3,c,X,sell,limit,102,1\n\
         N,4,d,X,sell,limit,103,5\nN,5,e,X,buy,limit,99,1\nN,6,f,X,buy,limit,98,2\nN,7,g,X,buy,limit,98,1\n",
        &Config::default(),
    )
    .unwrap();
    let book = engine.book("X").expect("book for X");
    assert_eq!(book.depth(Side::Sell, 2), vec![(fx("101"), fx("3")), (fx("102"), fx("1"))]);
    assert_eq!(book.depth(Side::Buy, 5), vec![(fx("99"), fx("1")), (fx("98"), fx("3"))]);
    assert!(book.depth(Side::Buy, 0).is_empty());

    let mut manual = OrderBook::new("Y");
    manual.insert(Side::Sell, fx("10"), resting(1, "a", "1.5"));
    manual.insert(Side::Sell, fx("10"), resting(2, "b", "0.5"));
    manual.insert(Side::Buy, fx("9"), resting(3, "c", "4"));
    assert_eq!(manual.depth(Side::Sell, 10), vec![(fx("10"), fx("2"))]);
    assert_eq!(manual.depth(Side::Buy, 10), vec![(fx("9"), fx("4"))]);
    assert_eq!(manual.cancel(1).map(|o| o.id), Some(1));
    assert_eq!(manual.depth(Side::Sell, 10), vec![(fx("10"), fx("0.5"))]);
    assert_eq!(manual.len(), 2);
}

/// Allocates everything to the largest resting order first.
struct LargestFirst;

impl Strategy for LargestFirst {
    fn name(&self) -> &str {
        "largest_first"
    }

    fn allocate(&self, level: &[RestingOrder], qty: Fixed) -> Vec<Allocation> {
        let mut order: Vec<usize> = (0..level.len()).collect();
        order.sort_by(|a, b| level[*b].remaining.cmp(&level[*a].remaining).then(a.cmp(b)));
        let mut left = qty;
        let mut allocations = Vec::new();
        for index in order {
            if !left.is_positive() {
                break;
            }
            let take = level[index].remaining.min(left);
            allocations.push(Allocation { index, qty: take });
            left -= take;
        }
        allocations.sort_by_key(|a| a.index);
        allocations
    }
}

#[test]
fn register_strategy_macro_adds_a_strategy_resolvable_by_name() {
    let mut registry = StrategyRegistry::with_builtins();
    assert!(register_strategy!(registry, "largest_first", |_params: &StrategyParams| LargestFirst));
    assert!(registry.contains("largest_first"));
    assert!(!register_strategy!(registry, "largest_first", |_params: &StrategyParams| LargestFirst));

    let mut config = Config::default();
    config.strategy = "largest_first".to_string();
    let mut engine = Engine::from_config(&config, &registry);
    assert_eq!(engine.strategy_name(), "largest_first");
    engine.run(
        matchbook::parse::parse_orders(
            "N,1,a,X,sell,limit,100,1\nN,2,b,X,sell,limit,100,3\nN,3,c,X,buy,limit,100,2\n",
        )
        .unwrap(),
    );
    assert_eq!(maker_allocations(&engine), vec![(2, fx("2"))]);
}

// --------------------------------------------------------- engine semantics --

#[test]
fn engine_order_kind_semantics() {
    let engine = run(
        "N,1,alice,X,sell,limit,100,1\n\
         N,1,bob,X,sell,limit,100,1\n\
         C,99\n\
         N,2,bob,X,sell,limit,101,1\n\
         N,3,carol,X,buy,market,,3\n\
         N,4,dave,X,buy,post_only,90,1\n\
         C,4\n\
         N,5,erin,X,sell,limit,110,2\n\
         N,6,frank,X,buy,fok,110,2\n",
        &Config::default(),
    )
    .unwrap();
    let events = engine.events();
    assert!(events.contains(&Event::Rejected { id: 1, reason: RejectReason::DuplicateId }));
    assert!(events.contains(&Event::Rejected { id: 99, reason: RejectReason::UnknownOrder }));
    assert!(events.contains(&Event::Cancelled { id: 3, reason: CancelReason::MarketRemainder }));
    assert!(events.contains(&Event::Rested { id: 4, remaining: fx("1") }));
    assert!(events.contains(&Event::Cancelled { id: 4, reason: CancelReason::Requested }));

    let fills: Vec<(u64, u64, Fixed, Fixed)> = engine
        .fills()
        .iter()
        .map(|f| (f.maker_order, f.taker_order, f.price, f.qty))
        .collect();
    assert_eq!(
        fills,
        vec![
            (1, 3, fx("100"), fx("1")),
            (2, 3, fx("101"), fx("1")),
            (5, 6, fx("110"), fx("2")),
        ]
    );
    let trade_ids: Vec<u64> = engine.fills().iter().map(|f| f.trade_id).collect();
    assert_eq!(trade_ids, vec![1, 2, 3]);
    assert!(engine.fills().iter().all(|f| f.aggressor == Side::Buy));
    assert!(engine.book("X").unwrap().is_empty());
}

#[test]
fn self_trade_prevention_only_cancels_the_same_account() {
    let engine = run(
        "N,1,alice,X,sell,limit,100,1\nN,2,bob,X,sell,limit,100,1\nN,3,alice,X,buy,limit,100,2\n",
        &Config::default(),
    )
    .unwrap();
    assert_eq!(maker_allocations(&engine), vec![(2, fx("1"))]);
    assert!(engine
        .events()
        .contains(&Event::Cancelled { id: 1, reason: CancelReason::SelfTrade }));
    assert!(engine.events().contains(&Event::Rested { id: 3, remaining: fx("1") }));
}

#[test]
fn fees_follow_the_documented_rounding_policy() {
    let config = parse_config("maker_fee_bps = -1\ntaker_fee_bps = 6\n").unwrap();
    let engine = run(
        "N,1,alice,X,sell,limit,1,0.00012345\nN,2,bob,X,buy,limit,1,0.00012345\n\
         N,3,carol,X,sell,limit,100,0.4\nN,4,dave,X,buy,limit,100,0.4\n",
        &config,
    )
    .unwrap();
    let fills = engine.fills();
    // Notional 12345 raw units: the rebate of -1.2345 rounds toward zero, the
    // charge of 7.407 rounds up.
    assert_eq!(fills[0].maker_fee, Fixed::from_raw(-1));
    assert_eq!(fills[0].taker_fee, Fixed::from_raw(8));
    assert_eq!(fills[1].maker_fee, fx("-0.004"));
    assert_eq!(fills[1].taker_fee, fx("0.024"));
}

#[test]
fn price_band_rejects_orders_far_from_the_reference() {
    let config = parse_config("price_band_bps = 500\n").unwrap();
    let mut engine = Engine::from_config(&config, &StrategyRegistry::with_builtins());
    let mut reference = HashMap::new();
    reference.insert("X".to_string(), fx("100"));
    engine.set_reference_prices(reference);
    engine.run(
        matchbook::parse::parse_orders(
            "N,1,a,X,sell,limit,106,1\nN,2,b,X,sell,limit,104,1\nN,3,c,X,buy,limit,94,1\n",
        )
        .unwrap(),
    );
    let events = engine.events();
    assert!(events.contains(&Event::Rejected { id: 1, reason: RejectReason::OutsidePriceBand }));
    assert!(events.contains(&Event::Rested { id: 2, remaining: fx("1") }));
    assert!(events.contains(&Event::Rejected { id: 3, reason: RejectReason::OutsidePriceBand }));
}
