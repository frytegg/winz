/** Base class of everything the hedging service throws on purpose. */
export class HedgingRuntimeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HedgingRuntimeError";
  }
}

/** `startHedging` was given an option it cannot run with. A programming or configuration error. */
export class HedgingConfigError extends HedgingRuntimeError {
  constructor(message: string) {
    super(message);
    this.name = "HedgingConfigError";
  }
}

/** The service was stopped (its signal aborted) while a caller was waiting on it. */
export class HedgingStoppedError extends HedgingRuntimeError {
  constructor(what: string) {
    super(`the hedging service stopped while ${what}`);
    this.name = "HedgingStoppedError";
  }
}

/**
 * `finalize` could not bring the instrument within one step of its exposure: the book is missing
 * or stale, the breaker is active, or the book is too thin. Retryable: the next call tries again.
 */
export class HedgeNotReconciledError extends HedgingRuntimeError {
  constructor(
    readonly instrument: string,
    detail: string,
  ) {
    super(`${instrument}: the position could not be reconciled with the exposure (${detail})`);
    this.name = "HedgeNotReconciledError";
  }
}

/**
 * `finalize` could not get every lot of the campaign charged on-chain in time. Retryable: what was
 * sent stays in the outbox and the next call waits for it.
 */
export class HedgeFinalizeError extends HedgingRuntimeError {
  constructor(
    readonly campaignId: string,
    detail: string,
  ) {
    super(`campaign ${campaignId}: hedge charges not final (${detail})`);
    this.name = "HedgeFinalizeError";
  }
}

/** A policy event refers to an order the database does not hold: nothing can be recorded for it. */
export class UnknownOrderError extends HedgingRuntimeError {
  constructor(
    readonly clientOrderId: string,
    readonly venue: string,
  ) {
    super(`no order ${clientOrderId} of venue ${venue} in the database`);
    this.name = "UnknownOrderError";
  }
}

/**
 * An order was refused because a fill (or a recovered position) of its instrument is not written
 * yet: placing more before the database knows what is held could buy twice after a restart.
 */
export class PositionEventsPendingError extends HedgingRuntimeError {
  constructor(
    readonly instrument: string,
    readonly pending: number,
  ) {
    super(
      `${instrument}: ${pending.toString()} fill(s) not written to the database yet: no new order until they are`,
    );
    this.name = "PositionEventsPendingError";
  }
}
