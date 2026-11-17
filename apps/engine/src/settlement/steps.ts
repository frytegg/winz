import { decodeErrorResult, isHex, parseAbi, type Hex } from "viem";

import { TxWaitTimeoutError, type TxOutcome, type TxRequest } from "../chain";
import type { Db } from "../db";
import { attemptKey, attemptOf } from "./plan";
import { stepTxs, type StepTxRow } from "./store";
import type { SettlementTxSender } from "./types";

/** Errors of the token that `winzEscrowAbi` does not carry, so they can be named in logs. */
const tokenErrorsAbi = parseAbi([
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error AccountBlocked(address account)",
]);

/**
 * The name of an error stored by the transaction sender. The sender decodes `winzEscrowAbi`
 * errors itself; a token error bubbled up through SafeERC20 arrives as raw revert data, decoded
 * here when it is one of the token's.
 */
export function revertName(error: string | null | undefined): string {
  if (error === null || error === undefined || error === "") return "unknown error";
  if (isHex(error) && error.length >= 10) {
    try {
      return decodeErrorResult({ abi: tokenErrorsAbi, data: error as Hex }).errorName;
    } catch {
      return error;
    }
  }
  return error;
}

/** Failures that say nothing about the call itself: the node, or the signer's gas money. */
export function isInfrastructureFailure(error: string | null | undefined): boolean {
  const name = revertName(error);
  return name.startsWith("NodeUnavailable") || name === "InsufficientFunds";
}

/** Failures of `payMerchant` that a funded treasury (or an unblocked merchant) cures. */
export function isTreasuryFailure(error: string | null | undefined): boolean {
  const name = revertName(error);
  return (
    name === "ERC20InsufficientBalance" ||
    name === "ERC20InsufficientAllowance" ||
    name === "SafeERC20FailedOperation" ||
    name === "AccountBlocked"
  );
}

/** Longest single call to `txSender.waitFor`; see `StepRunner`. */
export const WAIT_SLICE_MS = 1_000;

/** What `prepare` decided for one step. */
export type PreparedStep =
  /** A transaction of the step is in the outbox (queued, sent, or just enqueued). */
  | { kind: "pending"; id: string; key: string; created: boolean }
  /** The latest transaction of the step is already mined; nothing new was sent. */
  | { kind: "mined"; id: string; key: string }
  /** The step reverted `attempts` times for reasons that will not change: given up. */
  | { kind: "exhausted"; attempts: number; lastError: string };

/** How one step ended this time. */
export type StepResult =
  | { kind: "mined"; outcome: TxOutcome }
  /** Reverted on-chain or refused at simulation (`outcome.error` says why). */
  | { kind: "failed"; outcome: TxOutcome; countsAsAttempt: boolean }
  | { kind: "exhausted"; attempts: number; lastError: string }
  /** Still in the outbox after the wait (timeout, watcher stopping): resumed by a later pass. */
  | { kind: "unfinished"; id: string };

export interface StepSpec {
  /** Idempotency key without its attempt suffix. */
  base: string;
  /** The call; the idempotency key is added here. */
  request: Omit<TxRequest, "idempotencyKey">;
  /** Reverted or refused attempts, infrastructure failures excluded, before the step is given up. */
  maxAttempts: number;
  /**
   * True for steps that are legitimately sent again with the same content after a mined
   * attempt (a refund batch whose transfer failed). Default false: a mined attempt ends the step.
   */
  newAttemptAfterMined?: boolean;
  /** Failures that do not count towards `maxAttempts` (besides infrastructure ones). */
  isTransient?: (error: string | null) => boolean;
}

/**
 * Sends the transactions of the settlement steps under idempotency keys `<base>:a<n>`, so that a
 * watcher that crashed at any point finds what it already sent: a transaction still in the
 * outbox is waited for, never sent again; a mined one ends the step; a reverted or refused one is
 * retried under the next attempt number, at most `maxAttempts` times. Failures caused by the node
 * or the signer's gas, and those a spec marks transient, are retried without that bound.
 */
export class StepRunner {
  /**
   * @param waitTimeoutMs Longest wait for one transaction.
   * @param waitSliceMs The wait is made of calls to `txSender.waitFor` of at most this long, the
   *   abort checked between two: once the watcher stops, no wait outlives it by more than a slice.
   */
  constructor(
    private readonly db: Db,
    private readonly txSender: SettlementTxSender,
    private readonly waitTimeoutMs: number,
    private readonly signal: AbortSignal,
    private readonly waitSliceMs: number = WAIT_SLICE_MS,
  ) {}

  /** The transactions of a base key, by attempt number. */
  private async attempts(base: string): Promise<{ attempt: number; row: StepTxRow }[]> {
    const rows = await stepTxs(this.db, `${base}:a`);
    return rows
      .map((row) => ({ attempt: attemptOf(base, row.idempotencyKey), row }))
      .filter((entry): entry is { attempt: number; row: StepTxRow } => entry.attempt !== null)
      .sort((a, b) => a.attempt - b.attempt);
  }

  /** Finds the step's transaction in the outbox, or enqueues the next attempt. */
  async prepare(spec: StepSpec): Promise<PreparedStep> {
    const history = await this.attempts(spec.base);
    const latest = history[history.length - 1];
    if (latest !== undefined) {
      const { row } = latest;
      if (row.status === "queued" || row.status === "sent") {
        return { kind: "pending", id: row.id, key: row.idempotencyKey, created: false };
      }
      if (row.status === "mined" && spec.newAttemptAfterMined !== true) {
        return { kind: "mined", id: row.id, key: row.idempotencyKey };
      }
    }
    const counted = history.filter(
      ({ row }) =>
        (row.status === "failed" || row.status === "reverted") &&
        !isInfrastructureFailure(row.lastError) &&
        !(spec.isTransient?.(row.lastError) ?? false),
    );
    if (counted.length >= spec.maxAttempts) {
      const last = counted[counted.length - 1];
      return {
        kind: "exhausted",
        attempts: counted.length,
        lastError: revertName(last?.row.lastError),
      };
    }
    const key = attemptKey(spec.base, (latest?.attempt ?? 0) + 1);
    const { id, created } = await this.txSender.enqueue({ ...spec.request, idempotencyKey: key });
    return { kind: "pending", id, key, created };
  }

  /** Waits for a prepared step, or returns at once when it is already final. */
  async finish(prepared: PreparedStep, spec: StepSpec): Promise<StepResult> {
    if (prepared.kind === "exhausted") return prepared;
    const outcome = await this.waitForTx(prepared.id);
    if (outcome === null) return { kind: "unfinished", id: prepared.id };
    if (outcome.status === "mined") return { kind: "mined", outcome };
    return {
      kind: "failed",
      outcome,
      countsAsAttempt:
        !isInfrastructureFailure(outcome.error) &&
        !(spec.isTransient?.(outcome.error ?? null) ?? false),
    };
  }

  /** `prepare` then `finish`. */
  async run(spec: StepSpec): Promise<StepResult> {
    return this.finish(await this.prepare(spec), spec);
  }

  /**
   * The outcome of a transaction, or null when it is not final within the wait or the watcher is
   * stopping. The transaction stays in the outbox either way.
   */
  async waitForTx(id: string): Promise<TxOutcome | null> {
    if (this.signal.aborted) return null;
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<null>((resolve) => {
      onAbort = (): void => resolve(null);
      this.signal.addEventListener("abort", onAbort, { once: true });
    });
    const waited = this.waitInSlices(id);
    // The losing promise must not reject unobserved.
    waited.catch(() => undefined);
    try {
      return await Promise.race([waited, aborted]);
    } finally {
      if (onAbort !== undefined) this.signal.removeEventListener("abort", onAbort);
    }
  }

  /** Waits slice after slice until the transaction is final, the timeout passes or the abort. */
  private async waitInSlices(id: string): Promise<TxOutcome | null> {
    const deadline = performance.now() + this.waitTimeoutMs;
    for (;;) {
      if (this.signal.aborted) return null;
      const remaining = deadline - performance.now();
      if (remaining <= 0) return null;
      try {
        return await this.txSender.waitFor(id, {
          timeoutMs: Math.ceil(Math.min(remaining, this.waitSliceMs)),
        });
      } catch (error: unknown) {
        if (!(error instanceof TxWaitTimeoutError)) throw error;
      }
    }
  }
}
