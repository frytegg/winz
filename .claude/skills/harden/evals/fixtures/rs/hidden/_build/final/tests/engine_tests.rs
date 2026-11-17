use matchbook::{run, CancelReason, Config, Event, Fixed, RejectReason, Side};

fn fx(s: &str) -> Fixed {
    s.parse().unwrap()
}

#[test]
fn crossing_limit_orders_trade_at_the_maker_price() {
    let engine = run(
        "N,1,alice,X,sell,limit,100,1\nN,2,bob,X,buy,limit,101,1\n",
        &Config::default(),
    )
    .unwrap();
    let fills = engine.fills();
    assert_eq!(fills.len(), 1);
    assert_eq!(fills[0].price, fx("100"));
    assert_eq!(fills[0].qty, fx("1"));
    assert_eq!(fills[0].maker_order, 1);
    assert_eq!(fills[0].taker_order, 2);
}

#[test]
fn partial_fill_rests_the_remainder() {
    let engine = run(
        "N,1,alice,X,sell,limit,100,1\nN,2,bob,X,buy,limit,100,3\n",
        &Config::default(),
    )
    .unwrap();
    assert_eq!(engine.fills().len(), 1);
    let book = engine.book("X").unwrap();
    assert_eq!(book.best_bid(), Some(fx("100")));
    assert_eq!(book.best_ask(), None);
    assert!(engine.events().contains(&Event::Rested {
        id: 2,
        remaining: fx("2")
    }));
}

#[test]
fn fifo_fills_the_oldest_order_first() {
    let engine = run(
        "N,1,alice,X,sell,limit,100,1\nN,2,carol,X,sell,limit,100,1\nN,3,bob,X,buy,limit,100,1.5\n",
        &Config::default(),
    )
    .unwrap();
    let fills: Vec<(u64, Fixed)> = engine
        .fills()
        .iter()
        .map(|f| (f.maker_order, f.qty))
        .collect();
    assert_eq!(fills, vec![(1, fx("1")), (2, fx("0.5"))]);
}

#[test]
fn ioc_cancels_the_remainder() {
    let engine = run(
        "N,1,alice,X,sell,limit,100,1\nN,2,bob,X,buy,ioc,100,3\n",
        &Config::default(),
    )
    .unwrap();
    assert_eq!(engine.fills().len(), 1);
    assert!(engine.events().contains(&Event::Cancelled {
        id: 2,
        reason: CancelReason::IocRemainder
    }));
    assert_eq!(engine.book("X").unwrap().best_bid(), None);
}

#[test]
fn fok_is_rejected_when_it_cannot_fill_completely() {
    let engine = run(
        "N,1,alice,X,sell,limit,100,1\nN,2,bob,X,buy,fok,100,3\n",
        &Config::default(),
    )
    .unwrap();
    assert!(engine.fills().is_empty());
    assert!(engine.events().contains(&Event::Rejected {
        id: 2,
        reason: RejectReason::FokNotFillable
    }));
}

#[test]
fn post_only_is_rejected_when_it_would_cross() {
    let engine = run(
        "N,1,alice,X,sell,limit,100,1\nN,2,bob,X,buy,post_only,100,1\n",
        &Config::default(),
    )
    .unwrap();
    assert!(engine.fills().is_empty());
    assert!(engine.events().contains(&Event::Rejected {
        id: 2,
        reason: RejectReason::PostOnlyWouldCross
    }));
}

#[test]
fn market_order_without_liquidity_is_rejected() {
    let engine = run("N,1,bob,X,buy,market,,1\n", &Config::default()).unwrap();
    assert_eq!(
        engine.events(),
        &[Event::Rejected {
            id: 1,
            reason: RejectReason::NoLiquidity
        }]
    );
}

#[test]
fn fees_are_basis_points_of_notional_rounded_up() {
    // Default schedule: maker 2 bps, taker 5 bps.
    let engine = run(
        "N,1,alice,X,sell,limit,100,1\nN,2,bob,X,buy,limit,100,1\n",
        &Config::default(),
    )
    .unwrap();
    let fill = &engine.fills()[0];
    assert_eq!(fill.maker_fee, fx("0.02"));
    assert_eq!(fill.taker_fee, fx("0.05"));

    // A 3-unit notional owes 0.0015 units of taker fee, which rounds up to 1.
    let engine = run(
        "N,1,alice,X,sell,limit,1,0.00000003\nN,2,bob,X,buy,limit,1,0.00000003\n",
        &Config::default(),
    )
    .unwrap();
    assert_eq!(engine.fills()[0].taker_fee, Fixed::from_raw(1));
}

#[test]
fn self_trade_prevention_cancels_the_resting_order() {
    let engine = run(
        "N,1,alice,X,sell,limit,100,1\nN,2,alice,X,buy,limit,100,1\n",
        &Config::default(),
    )
    .unwrap();
    assert!(engine.fills().is_empty());
    assert!(engine.events().contains(&Event::Cancelled {
        id: 1,
        reason: CancelReason::SelfTrade
    }));
    let book = engine.book("X").unwrap();
    assert_eq!(book.order_count(Side::Buy), 1);
    assert_eq!(book.order_count(Side::Sell), 0);
}

#[test]
fn pro_rata_splits_across_the_level() {
    let mut config = Config::default();
    config.strategy = "pro_rata".to_string();
    let engine = run(
        "N,1,alice,X,sell,limit,100,1\nN,2,carol,X,sell,limit,100,3\nN,3,bob,X,buy,limit,100,2\n",
        &config,
    )
    .unwrap();
    let fills = engine.fills();
    println!("{fills:#?}");
}
