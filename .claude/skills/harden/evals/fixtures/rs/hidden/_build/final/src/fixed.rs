//! Fixed-point decimal amounts.
//!
//! Every price, quantity, notional and fee in matchbook is a [`Fixed`]: an
//! `i64` count of 10^-8 units. Eight decimals is enough for satoshi-sized
//! quantities and keeps the arithmetic exact, which binary floats cannot do.

use std::cell::RefCell;
use std::collections::HashMap;
use std::fmt;
use std::ops::{Add, AddAssign, Neg, Sub, SubAssign};
use std::str::FromStr;

/// Number of decimal places carried by [`Fixed`].
pub const DECIMALS: usize = 8;

/// Raw units per whole unit (`10^DECIMALS`).
pub const SCALE: i64 = 100_000_000;

const UNSIGNED_SCALE: u64 = 100_000_000;

/// A signed fixed-point decimal with eight fractional digits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct Fixed(i64);

/// Why a string could not be parsed as a [`Fixed`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseFixedError {
    /// The input was empty or only whitespace.
    Empty,
    /// The input is not a plain decimal number.
    Invalid(String),
    /// The input has more than [`DECIMALS`] fractional digits.
    TooPrecise(String),
}

impl fmt::Display for ParseFixedError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ParseFixedError::Empty => write!(f, "empty amount"),
            ParseFixedError::Invalid(s) => write!(f, "invalid amount `{s}`"),
            ParseFixedError::TooPrecise(s) => {
                write!(f, "amount `{s}` has more than {DECIMALS} decimal places")
            }
        }
    }
}

impl std::error::Error for ParseFixedError {}

impl Fixed {
    /// Zero.
    pub const ZERO: Fixed = Fixed(0);

    /// Builds an amount from raw 10^-8 units.
    pub const fn from_raw(raw: i64) -> Fixed {
        Fixed(raw)
    }

    /// The raw 10^-8 unit count.
    pub const fn raw(self) -> i64 {
        self.0
    }

    pub fn is_zero(self) -> bool {
        self.0 == 0
    }

    pub fn is_positive(self) -> bool {
        self.0 > 0
    }

    pub fn abs(self) -> Fixed {
        Fixed(self.0.abs())
    }

    pub fn checked_add(self, other: Fixed) -> Option<Fixed> {
        self.0.checked_add(other.0).map(Fixed)
    }

    pub fn checked_sub(self, other: Fixed) -> Option<Fixed> {
        self.0.checked_sub(other.0).map(Fixed)
    }

    /// Multiplies two amounts (price x quantity), truncating toward zero.
    ///
    /// The product is computed in `i128`, so this only fails when the result
    /// itself does not fit in an `i64`.
    pub fn checked_mul(self, other: Fixed) -> Option<Fixed> {
        let wide = i128::from(self.0) * i128::from(other.0) / i128::from(SCALE);
        i64::try_from(wide).ok().map(Fixed)
    }

    /// Lossy conversion, for statistics only.
    pub fn to_f64(self) -> f64 {
        self.0 as f64 / SCALE as f64
    }

    /// Lossy conversion from a float, rounding to the nearest raw unit.
    pub fn from_f64(value: f64) -> Fixed {
        Fixed((value * SCALE as f64).round() as i64)
    }
}

impl Add for Fixed {
    type Output = Fixed;

    /// # Panics
    ///
    /// Panics if the sum overflows `i64` (about 92 billion whole units).
    fn add(self, rhs: Fixed) -> Fixed {
        self.checked_add(rhs).expect("fixed-point addition overflowed")
    }
}

impl Sub for Fixed {
    type Output = Fixed;

    /// # Panics
    ///
    /// Panics if the difference overflows `i64`.
    fn sub(self, rhs: Fixed) -> Fixed {
        self.checked_sub(rhs).expect("fixed-point subtraction overflowed")
    }
}

impl AddAssign for Fixed {
    fn add_assign(&mut self, rhs: Fixed) {
        *self = *self + rhs;
    }
}

impl SubAssign for Fixed {
    fn sub_assign(&mut self, rhs: Fixed) {
        *self = *self - rhs;
    }
}

impl Neg for Fixed {
    type Output = Fixed;

    fn neg(self) -> Fixed {
        Fixed(-self.0)
    }
}

impl std::iter::Sum for Fixed {
    fn sum<I: Iterator<Item = Fixed>>(iter: I) -> Fixed {
        iter.fold(Fixed::ZERO, |acc, x| acc + x)
    }
}

impl FromStr for Fixed {
    type Err = ParseFixedError;

    fn from_str(input: &str) -> Result<Fixed, ParseFixedError> {
        let s = input.trim();
        if s.is_empty() {
            return Err(ParseFixedError::Empty);
        }
        let (negative, body) = match s.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, s),
        };
        let (whole, frac) = body.split_once('.').unwrap_or((body, ""));
        let all_digits = |part: &str| part.bytes().all(|b| b.is_ascii_digit());
        if (whole.is_empty() && frac.is_empty()) || !all_digits(whole) || !all_digits(frac) {
            return Err(ParseFixedError::Invalid(s.to_string()));
        }
        if frac.len() > DECIMALS {
            return Err(ParseFixedError::TooPrecise(s.to_string()));
        }
        let whole_units: i64 = if whole.is_empty() {
            0
        } else {
            whole
                .parse()
                .map_err(|_| ParseFixedError::Invalid(s.to_string()))?
        };
        let mut frac_units: i64 = 0;
        for digit in frac.bytes() {
            frac_units = frac_units * 10 + i64::from(digit - b'0');
        }
        for _ in frac.len()..DECIMALS {
            frac_units *= 10;
        }
        let raw = whole_units * SCALE + frac_units;
        Ok(Fixed(if negative { -raw } else { raw }))
    }
}

thread_local! {
    // Formatting amounts showed up when profiling large JSON reports, so the
    // rendered strings are memoised per raw value.
    static FORMAT_CACHE: RefCell<HashMap<i64, String>> = RefCell::new(HashMap::new());
}

impl fmt::Display for Fixed {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let rendered = FORMAT_CACHE.with(|cache| {
            cache
                .borrow_mut()
                .entry(self.0)
                .or_insert_with(|| render(self.0))
                .clone()
        });
        f.pad(&rendered)
    }
}

/// Canonical decimal rendering: no trailing fractional zeros and no bare dot.
fn render(raw: i64) -> String {
    let magnitude = raw.unsigned_abs();
    let whole = magnitude / UNSIGNED_SCALE;
    let frac = magnitude % UNSIGNED_SCALE;
    let sign = if raw < 0 { "-" } else { "" };
    if frac == 0 {
        format!("{sign}{whole}")
    } else {
        let digits = format!("{frac:08}");
        format!("{sign}{whole}.{}", digits.trim_end_matches('0'))
    }
}
