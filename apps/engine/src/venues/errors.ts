/** Base class of everything the execution venues throw on purpose. */
export class VenueError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VenueError";
  }
}

/**
 * The owner of a venue fed it something it cannot trust: an unsorted book, a negative quantity, a
 * trade print outside 0..10 000 bps, an invalid configuration. A programming error, never a
 * market condition: market conditions are typed rejections, not exceptions.
 */
export class VenueInputError extends VenueError {
  constructor(message: string) {
    super(message);
    this.name = "VenueInputError";
  }
}

/**
 * `createVenue` was asked for a venue this deployment must never use: Gemini production orders
 * (real money). SPEC section 1, point 3: Gemini production is read-only; real orders go to the
 * sandbox only.
 */
export class VenueNotAllowedError extends VenueError {
  constructor(public readonly venue: string) {
    super(
      `execution venue "${venue}" is refused on purpose: Gemini production is read-only (SPEC section 1); real orders go to "gemini-sandbox" only`,
    );
    this.name = "VenueNotAllowedError";
  }
}

/** A fill's book reference does not support the fill: the fill cannot be replayed. */
export class FillReplayError extends VenueError {
  constructor(
    public readonly fillId: string,
    message: string,
  ) {
    super(`fill ${fillId} cannot be replayed: ${message}`);
    this.name = "FillReplayError";
  }
}
