/** Base class of everything the execution policy throws on purpose. */
export class PolicyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PolicyError";
  }
}

/**
 * The owner of the policy fed it something it cannot trust: a negative exposure, a book of another
 * instrument, an invalid parameter. A programming error, never a market condition: market
 * conditions (no book, stale book, venue rejections, venue failures) never throw.
 */
export class PolicyInputError extends PolicyError {
  constructor(message: string) {
    super(message);
    this.name = "PolicyInputError";
  }
}
