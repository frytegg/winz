import type { TxStatus } from "./types";

/** Base class of everything the transaction sender throws on purpose. */
export class TxSenderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TxSenderError";
  }
}

/** The request can never be sent as described: bad address, bad call data, value out of range. */
export class InvalidTxRequestError extends TxSenderError {
  constructor(public readonly reason: string) {
    super(`Invalid transaction request: ${reason}`);
    this.name = "InvalidTxRequestError";
  }
}

/** The sender was built with a configuration that cannot work. */
export class TxSenderConfigError extends TxSenderError {
  constructor(message: string) {
    super(message);
    this.name = "TxSenderConfigError";
  }
}

/** The node answers for another chain than the one transactions are signed for. */
export class ChainIdMismatchError extends TxSenderError {
  constructor(
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(
      `The node is on chain ${actual.toString()}, the sender signs for chain ${expected.toString()}`,
    );
    this.name = "ChainIdMismatchError";
  }
}

export class TxNotFoundError extends TxSenderError {
  constructor(public readonly id: string) {
    super(`No chain_txs row with id ${id}`);
    this.name = "TxNotFoundError";
  }
}

/** `waitFor` gave up. The transaction is not cancelled: it may still be sent and mined later. */
export class TxWaitTimeoutError extends TxSenderError {
  constructor(
    public readonly id: string,
    public readonly timeoutMs: number,
    public readonly status: TxStatus,
  ) {
    super(`Transaction ${id} is still '${status}' after ${timeoutMs.toString()} ms`);
    this.name = "TxWaitTimeoutError";
  }
}

/** The sender stopped while the transaction was not final. It resumes at the next `start()`. */
export class TxSenderStoppedError extends TxSenderError {
  constructor(
    public readonly id: string,
    public readonly status: TxStatus,
  ) {
    super(`The sender stopped while transaction ${id} was '${status}'`);
    this.name = "TxSenderStoppedError";
  }
}

/** A `sent` row does not hold what the sender wrote in it. Needs a human: nothing is re-signed. */
export class CorruptSenderStateError extends TxSenderError {
  constructor(
    public readonly id: string,
    reason: string,
  ) {
    super(`Transaction ${id} is 'sent' but its stored state is unusable: ${reason}`);
    this.name = "CorruptSenderStateError";
  }
}

/** The row changed under the worker (a second sender on the same database?). It is re-read. */
export class ConcurrentTxUpdateError extends TxSenderError {
  constructor(
    public readonly id: string,
    step: string,
  ) {
    super(`Transaction ${id} was modified by someone else during '${step}'`);
    this.name = "ConcurrentTxUpdateError";
  }
}

/** A value that cannot be written as JSON (a function, a symbol, a non-finite number). */
export class UnserializableValueError extends TxSenderError {
  constructor(public readonly path: string) {
    super(`Value at '${path}' cannot be stored as JSON`);
    this.name = "UnserializableValueError";
  }
}
