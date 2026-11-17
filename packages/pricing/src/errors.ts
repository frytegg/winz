/**
 * Thrown when a pricing function is called with an argument that can never be valid (a negative
 * quantity, a price outside 0..10 000 bps, asks that are not sorted). These are programming or
 * data-normalisation errors, not market conditions: a market condition (stale book, thin book,
 * price above the threshold, budget exhausted) is returned as a value, never thrown.
 */
export class PricingInputError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "PricingInputError";
  }
}

/** Throws unless `min <= value <= max`. */
export function assertInRange(name: string, value: bigint, min: bigint, max: bigint): void {
  if (value < min || value > max) {
    throw new PricingInputError(
      `${name} must be between ${min.toString()} and ${max.toString()}, got ${value.toString()}`,
    );
  }
}

/** Throws when `value` is negative. */
export function assertNonNegative(name: string, value: bigint): void {
  if (value < 0n) {
    throw new PricingInputError(`${name} must not be negative, got ${value.toString()}`);
  }
}
