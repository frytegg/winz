use matchbook::parse::{parse_line, parse_orders};
use matchbook::{Fixed, Instruction, OrderKind, Side};

#[test]
fn parses_a_limit_order() {
    match parse_line("N,7,alice,BTC-USD,buy,limit,30000.5,0.25").unwrap() {
        Instruction::New(order) => {
            assert_eq!(order.id, 7);
            assert_eq!(order.account, "alice");
            assert_eq!(order.symbol, "BTC-USD");
            assert_eq!(order.side, Side::Buy);
            assert_eq!(order.kind, OrderKind::Limit);
            assert_eq!(order.price, Some("30000.5".parse::<Fixed>().unwrap()));
            assert_eq!(order.qty.to_string(), "0.25");
            assert_eq!(order.ts, 0);
        }
        other => panic!("expected a new order, got {other:?}"),
    }
}

#[test]
fn parses_a_market_order_without_price() {
    match parse_line("N,8,bob,ETH-USD,sell,market,,3").unwrap() {
        Instruction::New(order) => {
            assert_eq!(order.kind, OrderKind::Market);
            assert_eq!(order.price, None);
        }
        other => panic!("expected a new order, got {other:?}"),
    }
}

#[test]
fn parses_the_timestamp_column() {
    match parse_line("N,1,alice,X,sell,limit,1,1,1700000000000").unwrap() {
        Instruction::New(order) => assert_eq!(order.ts, 1_700_000_000_000),
        other => panic!("expected a new order, got {other:?}"),
    }
}

#[test]
fn parses_a_cancel() {
    assert_eq!(parse_line("C,42").unwrap(), Instruction::Cancel { id: 42 });
}

#[test]
fn skips_comments_and_blank_lines() {
    let text = "# header\n\nN,1,alice,X,buy,limit,1,1\n   # indented comment\nC,1\n";
    assert_eq!(parse_orders(text).unwrap().len(), 2);
}

#[test]
fn errors_carry_the_line_number() {
    let err = parse_orders("N,1,alice,X,buy,limit,1,1\nN,2,bob,X,up,limit,1,1\n").unwrap_err();
    assert!(err.to_string().starts_with("line 2:"), "{err}");
}

#[test]
fn rejects_malformed_orders() {
    assert!(parse_line("N,1,alice,X,buy,limit,,1").is_err());
    assert!(parse_line("N,1,alice,X,buy,market,10,1").is_err());
    assert!(parse_line("N,1,alice,X,buy,limit,10,0").is_err());
    assert!(parse_line("N,1,,X,buy,limit,10,1").is_err());
    assert!(parse_line("X,1").is_err());
}
