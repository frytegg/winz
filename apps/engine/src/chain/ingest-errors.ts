/** Base class of everything the event ingestion (log poller and projector) throws on purpose. */
export class ChainIngestError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ChainIngestError";
  }
}

/** The ingestion was configured with values that cannot work. */
export class ChainIngestConfigError extends ChainIngestError {
  constructor(message: string) {
    super(message);
    this.name = "ChainIngestConfigError";
  }
}

/**
 * The arguments stored in `chain_events.args` do not have the shape of the event's definition
 * in `winzEscrowAbi`. Needs a human: the row is left unprocessed and retried at every pass.
 */
export class InvalidEventArgsError extends ChainIngestError {
  constructor(
    public readonly eventName: string,
    public readonly txHash: string,
    public readonly logIndex: number,
    reason: string,
  ) {
    super(`${eventName} at ${txHash}:${logIndex.toString()} has invalid arguments: ${reason}`);
    this.name = "InvalidEventArgsError";
  }
}

/**
 * An event cannot be applied to the database as it stands (for example a `HedgeCharged` whose
 * ticket was never projected). The row is left unprocessed and retried at the next pass.
 */
export class ProjectionError extends ChainIngestError {
  constructor(
    public readonly eventName: string,
    public readonly txHash: string,
    public readonly logIndex: number,
    reason: string,
  ) {
    super(`Cannot project ${eventName} at ${txHash}:${logIndex.toString()}: ${reason}`);
    this.name = "ProjectionError";
  }
}
