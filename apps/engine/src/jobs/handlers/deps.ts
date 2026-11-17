import type { Logger } from "pino";
import type { Address, LocalAccount, PublicClient } from "viem";

import { BOOK_STALE_AFTER_MS, type Book } from "@winz/shared";

import type { TxSender } from "../../chain";
import type { Db } from "../../db";
import type { IdentityDirectory } from "../../identity";
import type { PaymentGateway } from "../../payments";
import type { Clock } from "../worker";

/** Where the purchase job reads the latest book of an instrument: the engine's `BookFeed`. */
export interface BookSource {
  getBook(symbol: string): Book | null;
}

/** Tunables of the handlers. Every field has a default suited to production. */
export interface JobHandlerOptions {
  /**
   * How long a handler waits for its transaction before giving the job back with a
   * `RetryLaterError` (the transaction is not abandoned: the retry resumes it). Default 75 000,
   * longer than the 60 s life of a quote, so a purchase usually learns its fate in one run.
   */
  waitTimeoutMs?: number;
  /** Delay of a `RetryLaterError` (outage, payment not settled yet, job busy). Default 5 000. */
  retryDelayMs?: number;
  /** `buyFor` transactions a purchase may send, one per quote. Default 3. */
  maxBuyAttempts?: number;
  /** Age after which a book is stale. Default `BOOK_STALE_AFTER_MS` (10 s). */
  staleAfterMs?: number;
  /**
   * A wait for a transaction is made of slices of at most this long, and the job's abort signal
   * is checked between two slices, so a wait the job gave up does not keep polling the database
   * for long after. Default 1 000.
   */
  waitSliceMs?: number;
  /**
   * Delay before a new attempt of a transaction whose last attempt failed for a reason that may
   * change (the treasury short of USDC, the relayer short of gas or not authorised yet). Doubled
   * at each further failed attempt, up to `maxResendDelayMs`. Default 60 000.
   */
  resendDelayMs?: number;
  /** Ceiling of that delay. Default 900 000 (15 minutes). */
  maxResendDelayMs?: number;
}

export interface ResolvedJobHandlerOptions {
  waitTimeoutMs: number;
  retryDelayMs: number;
  maxBuyAttempts: number;
  staleAfterMs: number;
  waitSliceMs: number;
  resendDelayMs: number;
  maxResendDelayMs: number;
}

/** What the four job handlers need (SPEC section 7: the engine does every on-chain write). */
export interface JobHandlerDeps {
  db: Db;
  /** The engine's single transaction sender, already started. */
  txSender: Pick<TxSender, "enqueue" | "waitFor">;
  /** Reads the escrow (`availableBudget`). A viem public client. */
  publicClient: Pick<PublicClient, "readContract">;
  /** Signs quotes (EIP-712). Must be the escrow's oracle key. */
  oracle: LocalAccount;
  escrowAddress: Address;
  chainId: number;
  /** The in-memory books; `book_cache` is read when it has none or a stale one. */
  books: BookSource;
  payments: PaymentGateway;
  identity: IdentityDirectory;
  logger: Logger;
  /** Current time, epoch milliseconds. Prices, quote expiries and sales close are read against it. */
  clock: Clock;
  options?: JobHandlerOptions;
}

export function resolveOptions(options: JobHandlerOptions = {}): ResolvedJobHandlerOptions {
  const resolved: ResolvedJobHandlerOptions = {
    waitTimeoutMs: options.waitTimeoutMs ?? 75_000,
    retryDelayMs: options.retryDelayMs ?? 5_000,
    maxBuyAttempts: options.maxBuyAttempts ?? 3,
    staleAfterMs: options.staleAfterMs ?? BOOK_STALE_AFTER_MS,
    waitSliceMs: options.waitSliceMs ?? 1_000,
    resendDelayMs: options.resendDelayMs ?? 60_000,
    maxResendDelayMs: options.maxResendDelayMs ?? 900_000,
  };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`job handler option ${name} must be a number >= 0`);
    }
  }
  if (!Number.isInteger(resolved.maxBuyAttempts) || resolved.maxBuyAttempts < 1) {
    throw new RangeError("job handler option maxBuyAttempts must be an integer >= 1");
  }
  if (resolved.waitSliceMs <= 0) {
    throw new RangeError("job handler option waitSliceMs must be a number > 0");
  }
  return resolved;
}
