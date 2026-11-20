import type { Logger } from "pino";
import type { Address, Hex } from "viem";

import type { Outcome } from "@winz/shared";

import type { EnqueueResult, TxOutcome, TxRequest } from "../chain";
import type { Clock } from "../chain/types";
import type { Db } from "../db";
import type { LoopHeartbeat } from "../health/loops";

/** A campaign the watcher settles: its rows' ids and the result it is settled with. */
export interface SettlementCampaign {
  /** `campaigns.id`. */
  id: string;
  /** `campaigns.onchain_id`: the escrow's campaign id. */
  onchainId: bigint;
  /** `campaigns.instrument`, the Gemini symbol. */
  instrument: string;
  /** `demo_overrides.forced_result` when present, `instruments.outcome` otherwise. */
  outcome: Outcome;
  /** True when the result comes from `demo_overrides`: the campaign is then a demo campaign. */
  forced: boolean;
}

/**
 * Implemented by the hedging lane. Called before the safety net and before `settle`: it
 * reconciles the position of the campaign's instrument and charges every lot of the campaign its
 * allocated cost (`chargeHedge`). Called again at every pass until the campaign is settled, so it
 * must be idempotent. Whatever it leaves uncharged, the settlement watcher charges itself (the lot
 * cost capped at the guarantee, zero when nothing was allocated).
 */
export interface HedgeFinalizer {
  finalize(campaign: SettlementCampaign): Promise<void>;
}

/** The part of `TxSender` the watcher uses. */
export interface SettlementTxSender {
  enqueue(request: TxRequest): Promise<EnqueueResult>;
  waitFor(id: string, options: { timeoutMs: number }): Promise<TxOutcome>;
}

/** Reads of the chain. A viem `PublicClient` satisfies it as is; tests wrap one to inject faults. */
export interface SettlementReadClient {
  /** `eth_call`; rejects when the call reverts or the node cannot be reached. */
  call(request: { to: Address; data: Hex }): Promise<{ data?: Hex | undefined }>;
  getBlock(request: { blockTag: "latest" }): Promise<{ timestamp: bigint }>;
}

/** The steps of the sequence, in their order (brief R-01 / R-02, steps a to e). */
export const SETTLEMENT_STEPS = [
  "finalize",
  "charge",
  "settle",
  "refund",
  "pay-merchant",
  "release",
] as const;
export type SettlementStep = (typeof SETTLEMENT_STEPS)[number];

/**
 * Reported to `onStep` as the sequence moves: `enqueued` once the step's transactions are in the
 * outbox (not for `finalize`), `done` once they are final. Used for metrics and, in tests, to stop
 * the watcher at a precise point.
 */
export interface SettlementStepEvent {
  campaignId: string;
  onchainId: bigint;
  step: SettlementStep;
  phase: "enqueued" | "done";
}

/**
 * Where a campaign stands after one run of its sequence.
 * - `not-ready`: nothing to do yet (sales open on-chain, the database lags behind the chain, the
 *   hedge finalizer asked for another pass).
 * - `in-progress`: settled or being settled, with work left for a later pass.
 * - `finished`: settled, released, nothing due by the treasury, and no ticket owed except those
 *   whose refund keeps failing (they are still retried on later passes, with backoff).
 * - `emergency`: the emergency window is open; `settle` is never sent, the emergency exits are
 *   the only path left.
 * - `aborted`: the watcher stopped during the run.
 */
export type CampaignSettlementStatus =
  "not-ready" | "in-progress" | "finished" | "emergency" | "aborted";

export interface CampaignSettlementResult {
  campaignId: string;
  onchainId: bigint | null;
  status: CampaignSettlementStatus;
  /** Why the run stopped where it did, for logs and the demo route. */
  detail: string;
  /** Tickets still owed a refund on-chain, as far as this run knows. */
  owedTickets: bigint[];
}

export interface SettlementOptions {
  db: Db;
  txSender: SettlementTxSender;
  publicClient: SettlementReadClient;
  escrowAddress: Address;
  hedgeFinalizer: HedgeFinalizer;
  logger: Logger;
  /**
   * Aborting it stops the loop; transactions in the outbox are resumed by the next start. Stop
   * the transaction sender only after `stopped` resolves: a wait on the sender that was in flight
   * at the abort may poll the database for up to one wait slice (1 s) after that.
   */
  signal: AbortSignal;
  /** Told of every pass that ran to its end without failing (`/healthz`, `health/loops.ts`). */
  heartbeat?: LoopHeartbeat;
  /** Time between two passes. Default 15 000. */
  intervalMs?: number;
  /** Transactions of one step that may revert (or fail simulation) before it is given up. Default 3. */
  maxAttempts?: number;
  /** Longest wait for one transaction before the pass moves on (it is resumed later). Default 120 000. */
  txWaitTimeoutMs?: number;
  /** First delay before a campaign that failed is tried again, doubled per failure. Default 15 000. */
  retryBaseMs?: number;
  /** Longest such delay. Default 600 000. */
  retryMaxMs?: number;
  /** First delay before a failed refund is retried, doubled per failure. Default 60 000. */
  refundRetryBaseMs?: number;
  /** Longest delay between two refund attempts of one ticket. Default 3 600 000. */
  refundRetryMaxMs?: number;
  /** First delay before `payMerchant` is tried again after the treasury could not pay. Default 60 000. */
  treasuryRetryBaseMs?: number;
  /** Longest such delay. Default 1 800 000. */
  treasuryRetryMaxMs?: number;
  /**
   * Passes on which the hedge finalizer may fail before the safety net charges without it.
   * Default 3: a transient failure of the hedging lane does not make the platform pay the hedge,
   * and a lasting one does not hold the customers' refunds hostage.
   */
  finalizeFailuresBeforeSafetyNet?: number;
  /**
   * Longest wait for one call of the hedge finalizer. A call that has not answered by then counts
   * as a failure of the finalizer (towards `finalizeFailuresBeforeSafetyNet`); it is not called
   * again for that campaign while that call is still pending. Default 60 000.
   */
  finalizeTimeoutMs?: number;
  /**
   * Campaign runs in flight at once. A pass starts runs in the free slots and does not wait for
   * them: a run that hangs holds one slot, never the later passes. Default 4.
   */
  campaignConcurrency?: number;
  /** Defaults to the system clock. Only used for delays, never for money. */
  clock?: Clock;
  /** Called at each step of each campaign. A rejection stops that campaign's run. */
  onStep?: (event: SettlementStepEvent) => void | Promise<void>;
}

export interface Settlement {
  /** Resolves once the loop has stopped and no campaign run is in flight. */
  stopped: Promise<void>;
  /**
   * Runs the sequence of one campaign now, whatever its backoff (demo mode, tests). Resolves with
   * where the campaign stands; rejects with `CampaignNotFoundError` for an unknown id.
   */
  settleCampaignNow(campaignId: string): Promise<CampaignSettlementResult>;
}
