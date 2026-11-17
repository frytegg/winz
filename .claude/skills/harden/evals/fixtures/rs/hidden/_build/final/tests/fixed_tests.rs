use matchbook::fixed::ParseFixedError;
use matchbook::Fixed;

fn fx(s: &str) -> Fixed {
    s.parse().expect("valid amount")
}

#[test]
fn parses_and_renders_canonical_form() {
    assert_eq!(fx("30000.5").raw(), 3_000_050_000_000);
    assert_eq!(fx("30000.50000000").to_string(), "30000.5");
    assert_eq!(fx("0.00000001").raw(), 1);
    assert_eq!(fx(".25").to_string(), "0.25");
    assert_eq!(fx("7").to_string(), "7");
    assert_eq!(fx("-1.5").to_string(), "-1.5");
}

#[test]
fn rejects_garbage() {
    assert_eq!("".parse::<Fixed>(), Err(ParseFixedError::Empty));
    assert!(matches!("abc".parse::<Fixed>(), Err(ParseFixedError::Invalid(_))));
    assert!(matches!("1.2.3".parse::<Fixed>(), Err(ParseFixedError::Invalid(_))));
    assert!(matches!("-".parse::<Fixed>(), Err(ParseFixedError::Invalid(_))));
    assert!(matches!("1e5".parse::<Fixed>(), Err(ParseFixedError::Invalid(_))));
}

#[test]
fn rejects_more_than_eight_decimals() {
    assert!(matches!(
        "0.123456789".parse::<Fixed>(),
        Err(ParseFixedError::TooPrecise(_))
    ));
}

#[test]
fn multiplication_is_exact_for_price_times_quantity() {
    let notional = fx("30005.5").checked_mul(fx("0.25")).unwrap();
    assert_eq!(notional.to_string(), "7501.375");
}

#[test]
fn arithmetic_ordering_and_padding() {
    assert_eq!((fx("1.1") + fx("2.2")).to_string(), "3.3");
    assert_eq!((fx("1") - fx("0.00000001")).to_string(), "0.99999999");
    assert!(fx("2") > fx("1.99999999"));
    assert_eq!(format!("{:>6}", fx("1.5")), "   1.5");
}
