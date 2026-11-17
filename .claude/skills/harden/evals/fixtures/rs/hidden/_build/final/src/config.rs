//! Engine configuration file.
//!
//! A plain `key = value` file where `#` starts a comment. Every key is
//! optional; see the README for the full list and the defaults.

use std::fmt::Display;
use std::fs;
use std::path::Path;
use std::str::FromStr;

use crate::error::Error;
use crate::fees::FeeSchedule;
use crate::fixed::Fixed;
use crate::strategy::StrategyParams;

/// Strategy used when the config does not name one.
pub const DEFAULT_STRATEGY: &str = "fifo";

/// Default spacing between reference price requests, in milliseconds.
pub const DEFAULT_REF_INTERVAL_MS: u64 = 250;

/// Parsed engine configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// Registry name of the allocation strategy.
    pub strategy: String,
    pub strategy_params: StrategyParams,
    pub fees: FeeSchedule,
    /// Maximum distance from the reference price, in basis points; 0 disables the check.
    pub price_band_bps: u16,
    /// Minimum price increment.
    pub tick_size: Fixed,
    /// `host:port` of the reference price service.
    pub ref_addr: Option<String>,
    /// Minimum spacing between two reference price requests.
    pub ref_interval_ms: u64,
}

impl Default for Config {
    fn default() -> Config {
        Config {
            strategy: DEFAULT_STRATEGY.to_string(),
            strategy_params: StrategyParams {
                lmm_accounts: Vec::new(),
                lmm_share_pct: 40,
            },
            fees: FeeSchedule::default(),
            price_band_bps: 0,
            tick_size: Fixed::from_raw(1),
            ref_addr: None,
            ref_interval_ms: DEFAULT_REF_INTERVAL_MS,
        }
    }
}

/// Reads and parses a config file.
pub fn load_config(path: &Path) -> Result<Config, Error> {
    let text = fs::read_to_string(path)?;
    parse_config(&text)
}

/// Parses config text. Unknown keys are an error so that typos surface.
pub fn parse_config(text: &str) -> Result<Config, Error> {
    let mut config = Config::default();
    let mut strategy: Option<String> = None;
    for (index, raw) in text.lines().enumerate() {
        let line = raw.split('#').next().unwrap_or_default().trim();
        if line.is_empty() {
            continue;
        }
        let line_no = index + 1;
        let (key, value) = line
            .split_once('=')
            .map(|(k, v)| (k.trim(), v.trim()))
            .ok_or_else(|| Error::Config(format!("line {line_no}: expected `key = value`")))?;
        match key {
            "strategy" => strategy = Some(value.to_string()),
            "maker_fee_bps" => config.fees.maker_bps = number(line_no, key, value)?,
            "taker_fee_bps" => config.fees.taker_bps = number(line_no, key, value)?,
            "lmm_accounts" => {
                config.strategy_params.lmm_accounts = value
                    .split(',')
                    .map(str::trim)
                    .filter(|account| !account.is_empty())
                    .map(String::from)
                    .collect();
            }
            "lmm_share_pct" => {
                config.strategy_params.lmm_share_pct = number(line_no, key, value)?;
            }
            "price_band_bps" => config.price_band_bps = number(line_no, key, value)?,
            "tick_size" => config.tick_size = number(line_no, key, value)?,
            "ref_addr" => config.ref_addr = Some(value.to_string()),
            "ref_interval_ms" => config.ref_interval_ms = number(line_no, key, value)?,
            other => {
                return Err(Error::Config(format!("line {line_no}: unknown key `{other}`")));
            }
        }
    }
    // `strategy` is optional by design: without it the engine runs the
    // documented default (FIFO). This is not an error path.
    config.strategy = strategy.unwrap_or_else(|| DEFAULT_STRATEGY.to_string());
    Ok(config)
}

fn number<T>(line_no: usize, key: &str, value: &str) -> Result<T, Error>
where
    T: FromStr,
    T::Err: Display,
{
    value
        .parse()
        .map_err(|e| Error::Config(format!("line {line_no}: {key}: {e}")))
}
