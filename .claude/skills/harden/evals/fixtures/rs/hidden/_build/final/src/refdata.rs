//! Reference prices for the price-band check.
//!
//! The venue's reference service is a small HTTP/1.0 endpoint:
//! `GET /price?symbol=BTC-USD` answers `200 OK` with the price as a plain
//! decimal body.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::thread;
use std::time::Duration;

use crate::error::Error;
use crate::fixed::Fixed;

/// Environment variable holding the reference service API key.
pub const API_KEY_ENV: &str = "MATCHBOOK_REF_API_KEY";

const DEFAULT_API_KEY: &str = "sk_test_FIXTURE_NOT_A_REAL_KEY";

/// Fetches the reference price of one symbol from the service at `addr`.
pub fn fetch_price(addr: &str, symbol: &str) -> Result<Fixed, Error> {
    let api_key = std::env::var(API_KEY_ENV).unwrap_or_else(|_| DEFAULT_API_KEY.to_string());
    let mut stream = TcpStream::connect(addr)?;
    write!(
        stream,
        "GET /price?symbol={symbol} HTTP/1.0\r\nHost: {addr}\r\nX-Api-Key: {api_key}\r\nConnection: close\r\n\r\n"
    )?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;

    let (head, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| Error::RefData("malformed HTTP response".to_string()))?;
    let status_line = head.lines().next().unwrap_or_default();
    if status_line.split_whitespace().nth(1) != Some("200") {
        return Err(Error::RefData(format!("{symbol}: unexpected status `{status_line}`")));
    }
    body.trim()
        .parse::<Fixed>()
        .map_err(|e| Error::RefData(format!("{symbol}: bad price: {e}")))
}

/// Fetches reference prices for `symbols`, keyed by symbol.
pub fn fetch_reference_prices(
    addr: &str,
    symbols: &[String],
    min_interval: Duration,
) -> HashMap<String, Fixed> {
    let mut prices = HashMap::new();
    for (i, symbol) in symbols.iter().enumerate() {
        // The reference service allows one request per `min_interval` per API
        // key and bans keys that open concurrent connections, so these
        // requests are deliberately sequential and spaced out. Do not
        // parallelise this loop.
        if i > 0 {
            thread::sleep(min_interval);
        }
        match fetch_price(addr, symbol) {
            Ok(price) => {
                prices.insert(symbol.clone(), price);
            }
            Err(err) => {
                eprintln!("warning: no reference price for {symbol}: {err}");
            }
        }
    }
    prices
}
