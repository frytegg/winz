import type { TransactionSql } from "postgres";
import type { Address, Hex, LocalAccount } from "viem";

import type { Db } from "../db";

/** The pool, or a transaction opened on it. */
export type Queryable = Db | TransactionSql;

/** The two keys the engine signs with (SPEC section 7). Same strings as `chain_txs.signer`. */
export const SIGNER_NAMES = ["relayer", "oracle"] as const;
export type SignerName = (typeof SIGNER_NAMES)[number];

/** Same strings as the `chain_txs.status` check. */
export const TX_STATUSES = ["queued", "sent", "mined", "reverted", "failed"] as const;
export type TxStatus = (typeof TX_STATUSES)[number];

/** A status that will never change again. */
export type TerminalTxStatus = "mined" | "reverted" | "failed";

export type JsonValue =
  null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** What a caller describes; nonce, fees, broadcast and receipt belong to the sender. */
export interface TxRequest {
  /** Enqueueing the same key again returns the first row and never sends a second transaction. */
  idempotencyKey: string;
  signer: SignerName;
  /** Free label for logs and dashboards, for example `buyFor` or `settle`. */
  kind: string;
  to: Address;
  /** ABI-encoded call data, `0x` for a plain transfer. */
  data: Hex;
  /** Native value in wei. Defaults to 0; Arc's USDC is moved through its ERC-20 interface. */
  value?: bigint;
  /** Decoded intent (ids, amounts) kept with the row for the logs. Bigints are stored as strings. */
  payload?: Record<string, unknown>;
}

export interface EnqueueResult {
  id: string;
  /** False when the idempotency key already had a row: nothing new was queued. */
  created: boolean;
}

/** One `WinzEscrow` log, in the form stored in `chain_events`. */
export interface DecodedEvent {
  name: string;
  /** Arguments by name; integers wider than 48 bits are decimal strings, addresses are lowercase. */
  args: JsonObject;
  txHash: Hex;
  /** Index of the log in its block, the second half of the `chain_events` key. */
  logIndex: number;
  blockNumber: bigint;
}

/** Final state of a transaction, as returned by `waitFor` and `sendAndWait`. */
export interface TxOutcome {
  id: string;
  /**
   * `mined`: executed. `reverted`: mined, but the call reverted on-chain. `failed`: never sent
   * (the simulation reverted, or the node could not be reached) and no nonce was used.
   */
  status: TerminalTxStatus;
  txHash?: Hex;
  blockNumber?: bigint;
  /** `WinzEscrow` events of the transaction, ordered by log index. Empty unless `mined`. */
  events: DecodedEvent[];
  /** Custom error name of `winzEscrowAbi` when it could be decoded, otherwise the raw reason. */
  error?: string;
}

/** One signed transaction for a nonce. A fee bump adds an attempt; the nonce never changes. */
export interface SignedAttempt {
  hash: Hex;
  /** The signed, serialized transaction, re-broadcast as is after a restart. */
  raw: Hex;
  /** Wei, decimal string. */
  maxFeePerGas: string;
  /** Wei, decimal string. */
  maxPriorityFeePerGas: string;
  /** UTC ISO 8601. */
  signedAt: string;
}

/**
 * What the sender needs to resume a sent transaction, stored under `SENDER_STATE_KEY` in
 * `chain_txs.payload` (the table has no dedicated column for it).
 */
export interface SenderState {
  /** Gas limit, decimal string. Kept identical across fee bumps. */
  gas: string;
  /** Oldest first; the last one is the transaction currently in the mempool. */
  attempts: SignedAttempt[];
}

/** Reserved key of `chain_txs.payload`. A caller's payload may not use it. */
export const SENDER_STATE_KEY = "_txSender";

/** A row of `chain_txs`. */
export interface ChainTx {
  id: string;
  idempotencyKey: string;
  signer: SignerName;
  kind: string;
  to: Address;
  data: Hex;
  value: bigint;
  payload: JsonObject;
  nonce: bigint | null;
  /**
   * Lowercase address of the key that signed the row, and the chain it was signed for. Set
   * together with `nonce`: a nonce belongs to a key on a chain, not to a role.
   */
  signerAddress: Address | null;
  chainId: number | null;
  txHash: Hex | null;
  status: TxStatus;
  attempts: number;
  lastError: string | null;
  blockNumber: bigint | null;
  createdAt: Date;
  sentAt: Date | null;
  minedAt: Date | null;
}

export interface ReceiptLog {
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  logIndex: number | null;
  transactionHash: Hex | null;
  blockNumber: bigint | null;
}

export interface TxReceipt {
  status: "success" | "reverted";
  transactionHash: Hex;
  blockNumber: bigint;
  logs: readonly ReceiptLog[];
}

export interface FeeSuggestion {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface CallRequest {
  account: Address;
  to: Address;
  data: Hex;
  value: bigint;
}

/**
 * The part of a viem public client the sender uses. A `PublicClient` satisfies it as is; tests
 * wrap one to inject faults.
 */
export interface ChainClient {
  getChainId(): Promise<number>;
  /** `eth_call` from the signer; rejects when the call reverts. */
  call(request: CallRequest & { blockNumber?: bigint }): Promise<unknown>;
  estimateGas(request: CallRequest): Promise<bigint>;
  estimateFeesPerGas(): Promise<FeeSuggestion>;
  getTransactionCount(request: {
    address: Address;
    blockTag: "latest" | "pending";
  }): Promise<number>;
  sendRawTransaction(request: { serializedTransaction: Hex }): Promise<Hex>;
  /** Rejects with viem's `TransactionReceiptNotFoundError` while the transaction is not mined. */
  getTransactionReceipt(request: { hash: Hex }): Promise<TxReceipt>;
  getBlock(request: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
}

/** Sleeps `ms`, or less if `signal` aborts. Never rejects. */
export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface Clock {
  now: () => Date;
  sleep: Sleep;
}

export type SignerAccounts = Record<SignerName, LocalAccount>;

export interface TxSenderConfig {
  /** Chain the transactions are signed for. `start()` refuses a node that answers another id. */
  chainId: number;
  /** Only logs emitted by this address are decoded and written to `chain_events`. */
  escrowAddress: Address;
  /** Delay between two receipt lookups. Arc produces a block about every 0.5 s. Default 300. */
  receiptPollMs?: number;
  /** How often an idle worker looks for rows it was not told about. Default 500. */
  idlePollMs?: number;
  /** A transaction not mined after this long is replaced with a higher fee. Default 15 000. */
  replaceAfterMs?: number;
  /** Most fee bumps per transaction. After that the last one is re-broadcast. Default 3. */
  maxFeeBumps?: number;
  /** Fee increase of a replacement, in percent. Nodes require at least 10. Default 25. */
  feeBumpPercent?: number;
  /** Margin added to the gas estimate, in percent. Default 20. */
  gasMarginPercent?: number;
  /** Lowest `maxFeePerGas` ever signed. Default and minimum: Arc's 20 gwei base fee floor. */
  minMaxFeePerGasWei?: bigint;
  /** Lowest priority fee offered when the node suggests less. Default 1 gwei. */
  minPriorityFeePerGasWei?: bigint;
  /** Highest `maxFeePerGas` ever signed, whatever the node suggests. Default 1 000 gwei. */
  maxFeePerGasCapWei?: bigint;
  /**
   * Node failures tolerated while preparing a transaction before it is `failed`. Default 6. A
   * transaction is given up only once both this count and `maxPrepareMs` are reached.
   */
  maxPrepareAttempts?: number;
  /**
   * Least time, from the row's creation, during which node failures while preparing a
   * transaction are retried before it is `failed`, whatever the count. Default 60 000, the life
   * of a quote (SPEC PR-3): an outage shorter than that does not fail a sale. 0 leaves only
   * `maxPrepareAttempts`.
   */
  maxPrepareMs?: number;
  /** First delay of the exponential backoff. Default 250. */
  retryBaseMs?: number;
  /** Longest delay of the exponential backoff. Default 10 000. */
  retryMaxMs?: number;
  /** How often `waitFor` re-reads a row it was not notified about. Default 250. */
  waitPollMs?: number;
  /** Timeout of `sendAndWait` when the caller gives none. Default 60 000. */
  defaultWaitTimeoutMs?: number;
  /**
   * Most transactions of one signer broadcast and not mined yet at the same time
   * (`ARC_TX_MAX_IN_FLIGHT`). Only the kinds of `INDEPENDENT_TX_KINDS` travel together; any other
   * kind always goes alone. 1 sends strictly one transaction at a time. Default 8, at most 64.
   */
  maxInFlight?: number;
  /**
   * With more than one transaction in flight, the earliest unmined one of a signer without a
   * receipt for this long makes the sender ask the node its pending count: transactions the node
   * no longer knows are broadcast again from their stored bytes (never signed again), which does
   * not restart `replaceAfterMs`. Asked again every this long; while every re-sent transaction
   * comes back "already known" (the count is wrong, not the pool), the interval doubles up to
   * `replaceAfterMs`. Never asked with `maxInFlight = 1`. Default 3 000.
   */
  resendCheckMs?: number;
  /**
   * A fee suggestion younger than this is reused for the next transactions instead of being read
   * again (a burst reads it once). Replacements always read a fresh one, and so does every
   * transaction with `maxInFlight = 1`. Default 1 000.
   */
  feeSuggestionMaxAgeMs?: number;
}
