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

/** `createVenue` was asked for a venue whose adapter is not built yet. */
export class VenueNotImplementedError extends VenueError {
  constructor(
    public readonly venue: string,
    public readonly task: string,
  ) {
    super(
      `execution venue "${venue}" is not implemented yet: the real Gemini order adapter is task ${task}`,
    );
    this.name = "VenueNotImplementedError";
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
