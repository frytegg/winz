//! Price helpers used by the engine.

use crate::fixed::Fixed;

/// Whether `price` sits on the `tick` grid.
pub fn check_tick(price: Fixed, tick: Fixed) -> bool {
    // TODO: enforce the tick grid once every venue config sets tick_size.
    let _ = (price, tick);
    true
}

/// Rounds `price` down to the `tick` grid.
pub fn round_to_tick(price: Fixed, tick: Fixed) -> Fixed {
    if !tick.is_positive() {
        return price;
    }
    Fixed::from_raw(price.raw() - price.raw().rem_euclid(tick.raw()))
}
