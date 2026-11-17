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

/**
 * `chain_txs` holds transactions of a signer role that were signed by another key or for
 * another chain than the configured ones, and the sender cannot go on from them safely: a `sent`
 * row it would drive forever, or stored nonces the configured key has not reached on this chain
 * (its first nonce would either leave a gap that is never mined or collide with the unique
 * `(signer, nonce)` index). Needs a human: see the message.
 */
export class SignerHistoryMismatchError extends TxSenderError {
  constructor(
    public readonly signer: string,
    public readonly txId: string,
    public readonly stored: { address: string; chainId: number; nonce: bigint; status: TxStatus },
    public readonly configured: { address: string; chainId: number; pendingCount: bigint | null },
  ) {
    const problem =
      stored.status === "sent"
        ? `transaction ${txId} is still 'sent' and can only be completed by that key on that chain`
        : `the configured key's next nonce on this chain (${String(configured.pendingCount)}) is not above the stored nonce ${stored.nonce.toString()}, so its transactions would wait behind a nonce gap or hit the (signer, nonce) index`;
    super(
      `chain_txs rows of the '${signer}' signer were signed by ${stored.address} for chain ${stored.chainId.toString()}, ` +
        `but the sender is configured with ${configured.address} on chain ${configured.chainId.toString()}: ${problem}. ` +
        "Nonces are tracked per signer role, not per key and chain: before switching key or chain on this database, " +
        "let the old key's sent transactions finish and move its rows out of chain_txs, or migrate chain_txs to " +
        "store signer_address and chain_id per row.",
    );
    this.name = "SignerHistoryMismatchError";
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
