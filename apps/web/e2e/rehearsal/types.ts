import type { Address, Hex } from "viem";

import type { Outcome } from "@winz/shared";

/**
 * Types of the rehearsal (gate G2, tasks A-07, Q-03, Q-04): what it is asked to play, and the
 * receipt it leaves. Money is micro-USDC (`bigint`), prices basis points, quantities units.
 */

/** The steps of a run, in order. A failure names the step it happened in. */
export const REHEARSAL_STEPS = [
  "preflight",
  "start-engine",
  "choose-game",
  "launch-campaign",
  "drive-book",
  "pause-probe",
  "purchases",
  "hedging",
  "close-sales",
  "settle",
  /** Only after a failure: close the campaign and force a NO, so the escrow releases its funds. */
  "recover",
  "reset",
  "stop-engine",
  "sweep",
] as const;
export type RehearsalStep = (typeof REHEARSAL_STEPS)[number];

/** What the rehearsal plays. Every amount is micro-USDC. */
export interface Scenario {
  /** Number of demo sales replayed (1 to 300). */
  purchases: number;
  /** Units bought by each sale (1 to 20, the demo sale route's limit). */
  unitsPerPurchase: number;
  unitPrice: bigint;
  refundBps: number;
  usualMarginBps: number;
  minMarginBps: number;
  /** The merchant's hedge budget. */
  budget: bigint;
  outcome: Outcome;
  /** Distinct buyers the sales are spread over (1 to `purchases`). */
  buyers: number;
  /** Sales replayed at the same time (the engine still sells them one transaction at a time). */
  parallel: number;
}

/** A scenario as asked: every field optional, the defaults filled in by `resolveScenario`. */
export type ScenarioInput = Partial<Scenario>;

/** Where the engine reads Gemini. */
export type GeminiMode =
  | {
      kind: "live";
      apiUrl: string;
      wsUrl: string;
      /** Only where direct connections are blocked (`APP_HTTPS_PROXY_URL`). */
      proxyUrl?: string;
      /** CA bundle trusted for that proxy (`APP_PROXY_CA_FILE`). */
      caFile?: string;
    }
  | { kind: "simulated" };

/** The secrets of a run. Read from the environment only; never printed, logged or written. */
export interface RehearsalSecrets {
  relayerKey: Hex;
  oracleKey: Hex;
  demoSeed: Hex;
}

/** Longest waits of each step, in milliseconds. */
export interface RehearsalTimeouts {
  /** The engine's event reader reaching the head of the chain after it starts. */
  catchUpMs: number;
  catalogMs: number;
  liveMs: number;
  openMs: number;
  saleMs: number;
  hedgingMs: number;
  closeMs: number;
  settleMs: number;
  engineStopMs: number;
}

export interface RehearsalOptions {
  /** A Postgres database with every migration of supabase/migrations applied. */
  databaseUrl: string;
  rpcUrl: string;
  /**
   * Second RPC, tried when the first fails (`ARC_RPC_FALLBACK_URL`). Defaults to Arc's public RPC
   * on Arc testnet, as in the engine's environment, and to `rpcUrl` elsewhere.
   */
  rpcFallbackUrl?: string;
  /** The chain id the run expects: 5042002 (Arc testnet), 31337, or another one with `local`. */
  chainId: number;
  /** The chain is a local development chain (the `--local` flag). */
  local: boolean;
  escrowAddress: Address;
  escrowDeployBlock: bigint;
  /**
   * Start the engine's event reader near the head (the head at the start of the run minus
   * `ENGINE_START_MARGIN_BLOCKS`) instead of at `escrowDeployBlock`: for a fresh database, which
   * needs nothing that happened before the run (`--throwaway-db` without `--deploy-block`).
   */
  startNearHead?: boolean;
  /** Limits of the request limiter shared by the engine and the runner (`ARC_RPC_MAX_*`). */
  rpcLimits?: RpcLimitsInput;
  secrets: RehearsalSecrets;
  scenario: ScenarioInput;
  gemini: GeminiMode;
  /** Stop after printing the addresses, the balances and the estimate (the `--estimate` flag). */
  estimateOnly: boolean;
  /**
   * Where the JSON and Markdown receipts are written. Never under docs/ for a local chain.
   * Absent: nothing is written (the receipt is only returned).
   */
  receiptDir?: string;
  /** Appends every line the engine logs (JSON) to this file. */
  engineLogFile?: string;
  /** Receives every line the rehearsal prints. Never a key, never the seed. */
  out: (line: string) => void;
  /** Aborting it (Ctrl-C) stops the run: engine stopped, sweep attempted, FAILED receipt. */
  signal?: AbortSignal;
  timeouts?: Partial<RehearsalTimeouts>;
  /** Called when each step starts. */
  onStep?: (step: RehearsalStep) => void;
  /** Test only: makes this step throw as it starts, to prove the failure path. */
  failAtStep?: RehearsalStep;
  /** Test only: makes the sale with this number (1-based) throw before it is posted. */
  failAtSale?: number;
  /**
   * Test only: the recovery after a failure and the sweep fail as they start, as they did on Arc
   * when the node rate-limited them, so that the run leaves its campaign stranded.
   */
  strand?: boolean;
  /**
   * Test only: answers a request of the runner's own client with this error instead of sending
   * it (the engine keeps its own client). Called for every request, with the step it belongs to.
   */
  nodeFaults?: NodeFault;
  /** Retries of the reads made outside the waits (and of each wallet of the sweep). */
  readRetry?: Partial<RetryPolicy>;
}

/** The variables `ARC_RPC_MAX_REQUESTS_PER_SECOND`, `…_HEAVY_REQUESTS_PER_SECOND`, `ARC_RPC_HEAVY_METHODS`. */
export interface RpcLimitsInput {
  maxRequestsPerSecond?: number;
  maxHeavyRequestsPerSecond?: number;
  heavyMethods?: string[];
}

/** One request of the runner's client, as a fault injector sees it. */
export interface NodeRequestInfo {
  method: string;
  step: string | null;
  atMs: number;
}

/** Returns the error the node answers instead, or null to send the request. */
export type NodeFault = (request: NodeRequestInfo) => Error | null;

/** How a read made outside a wait is tried again: `attempts` in all, delays doubling. */
export interface RetryPolicy {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/** What `--recover` is given: the command's chain, keys and database, and the receipt to finish. */
export interface RecoveryOptions {
  /** The FAILED receipt (JSON) of the run whose campaign is to be finished. */
  receiptPath: string;
  /** The database the run kept. */
  databaseUrl: string;
  rpcUrl: string;
  rpcFallbackUrl?: string;
  chainId: number;
  local: boolean;
  escrowAddress: Address;
  escrowDeployBlock: bigint;
  rpcLimits?: RpcLimitsInput;
  secrets: RehearsalSecrets;
  /** Used when the run read live Gemini (the recovery reads Gemini as the run did). */
  gemini: GeminiMode;
  /** Stop after the checks and the campaign's state: nothing is sent. */
  estimateOnly: boolean;
  engineLogFile?: string;
  out: (line: string) => void;
  /** Aborting it stops the recovery: engine stopped, sweep attempted, receipt written. */
  signal?: AbortSignal;
  timeouts?: Partial<RehearsalTimeouts>;
  onStep?: (step: RehearsalStep) => void;
  /** Test only, as in `RehearsalOptions`. */
  nodeFaults?: NodeFault;
  readRetry?: Partial<RetryPolicy>;
}

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

/** The rehearsal refuses to start: nothing was sent. `reasons` says why, one line each. */
export class RehearsalRefusedError extends Error {
  constructor(public readonly reasons: readonly string[]) {
    super(
      `the rehearsal refuses to start:\n${reasons.map((reason) => `  - ${reason}`).join("\n")}`,
    );
    this.name = "RehearsalRefusedError";
  }
}

/** A step of the rehearsal failed. */
export class RehearsalStepError extends Error {
  constructor(
    public readonly step: RehearsalStep,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "RehearsalStepError";
  }
}

/** The run was interrupted (Ctrl-C, or the caller's signal). */
export class RehearsalAbortedError extends Error {
  constructor() {
    super("interrupted");
    this.name = "RehearsalAbortedError";
  }
}

/** A failure injected by `failAtStep` or `failAtSale` (tests only). */
export class InjectedFailureError extends Error {
  constructor(at: RehearsalStep | `sale ${number}`) {
    super(`failure injected at ${at.startsWith("sale ") ? at : `step ${at}`}`);
    this.name = "InjectedFailureError";
  }
}

/** A receipt would carry a secret: it is not written. The message never quotes the secret. */
export class SecretLeakError extends Error {
  constructor(where: string) {
    super(`${where} contains a secret: refused`);
    this.name = "SecretLeakError";
  }
}

// ---------------------------------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------------------------------

/** How money is measured on the chain. */
export type MoneyMode =
  /** Arc: USDC is the native coin (18 decimals) behind an ERC-20 interface (6); gas is USDC. */
  | "native-usdc"
  /** A local chain: an ERC-20 test token; gas is paid in the native coin, which is not money. */
  | "erc20";

export interface Stats {
  count: number;
  minMs: number | null;
  medianMs: number | null;
  maxMs: number | null;
}

export interface Estimate {
  /** Fee per gas used for the estimate (the node's current `maxFeePerGas`, at least Arc's floor). */
  feePerGasWei: bigint;
  /** Money the treasury fronts at worst: budget, every sale, and the merchant's due on YES. */
  treasuryLocks: bigint;
  /** Gas units, worst case, by payer. */
  relayerGas: bigint;
  oracleGas: bigint;
  sweepGas: bigint;
  relayerGasWei: bigint;
  oracleGasWei: bigint;
  sweepGasWei: bigint;
  /** What the treasury needs, gas included where gas is money, with the 20 % margin. */
  treasuryNeedsWithMargin: bigint;
  /** Native balance the relayer needs for gas when gas is not money (local chain), with margin. */
  relayerGasNeedsWithMarginWei: bigint;
  /** Native balance the oracle needs for gas, with margin. */
  oracleNeedsWithMarginWei: bigint;
}

export interface BalanceRow {
  role: string;
  address: Address;
  /** Money, in micro-USDC units scaled to 18 decimals (wei of USDC on Arc). */
  moneyWei: bigint;
  /** Native balance, wei (the same thing as `moneyWei` on Arc). */
  nativeWei: bigint;
}

export interface TxRecord {
  kind: string;
  signer: string;
  hash: Hex;
  status: string;
  block: bigint | null;
  gasUsed: bigint | null;
  /** gasUsed × effectiveGasPrice, wei of the native coin. */
  feeWei: bigint | null;
  /** Whether the transaction concerns this run's campaign (false: another campaign's work). */
  ownCampaign: boolean;
  explorerUrl: string | null;
}

export interface InvariantResult {
  name: string;
  passed: boolean;
  /** What was measured, in numbers. */
  details: string;
}

/**
 * What the run saw when it drove the book above the campaign's pause threshold, before any sale:
 * the sale state the campaign page answered, and how the demo sale route answered a sale then.
 */
export interface PauseProbe {
  bidBps: number;
  askBps: number;
  /** The campaign page's `saleState` once it stopped answering open (null: it never did). */
  saleState: string | null;
  /** The demo sale route's refusal, "409 sales_paused"; null when it accepted the sale. */
  saleRefusal: string | null;
  /** Why the probe could not be made (no tick above the threshold), or null. */
  skipped: string | null;
}

/** The attempt, after a failure, to close the campaign and force a result so the escrow releases. */
export interface RecoveryRecord {
  /** The result forced (NO unless the run had already forced one). */
  outcome: Outcome;
  released: boolean;
  /** Why it did not end released, or null. */
  reason: string | null;
}

export interface PurchaseRecord {
  index: number;
  buyer: number;
  qty: number;
  callToTicketMs: number | null;
  callToDashboardMs: number | null;
}

export interface RefundTiming {
  settleBlock: bigint;
  lastRefundBlock: bigint;
  blocks: bigint;
  /** Null when the two blocks' timestamps could not be read. */
  chainSeconds: bigint | null;
  /**
   * Wall clock from the moment the rehearsal first saw the head reach the block of settle to the
   * moment it first saw it reach the block of the last refund (the head is read every 500 ms
   * during settle: about one block of precision on Arc).
   */
  wallMs: number | null;
  /** `sentAt`: when the engine broadcast the batch; `blockTime`: its block's timestamp (seconds). */
  batches: {
    hash: Hex;
    tickets: number;
    gasUsed: bigint | null;
    sentAt: string | null;
    blockTime: string | null;
  }[];
}

export interface HedgingRecord {
  orders: number;
  makerOrders: number;
  takerOrders: number;
  fills: number;
  makersFilledByTheRehearsal: number;
  charges: number;
  hedgeSpent: bigint;
  makerSavings: bigint;
  guaranteeLossesDelta: bigint;
  heldAtClose: bigint | null;
  exposureAtClose: bigint | null;
}

export interface SweepRecordRow {
  wallet: string;
  address: Address;
  status: string;
  sentWei: bigint;
  gasWei: bigint;
  txHash: Hex | null;
}

/** The runner's own requests to the node, and the shared limiter's counts. */
export interface RpcRecord {
  /** Requests the runner's client made (an answer refused counts as a request). */
  requests: number;
  /** Requests answered with an error. */
  refused: number;
  /** Of those, the answers that were a rate limit. */
  rateLimited: number;
  /** Reads sent again after a failure (outside the waits, which simply ask again). */
  retried: number;
  /** Requests of each step and its duration. */
  perStep: { step: string; requests: number; durationMs: number }[];
  /** The limiter shared by the engine and the runner: every request of the process. */
  limiter: { started: number; rateLimited: number; coolDowns: number } | null;
}

export interface StepRecord {
  step: RehearsalStep;
  startedAt: string;
  durationMs: number | null;
  status: "done" | "failed";
}

export interface RehearsalReceipt {
  /** 2 since the runner counts its requests (`rpc`), its unread facts and its engine start block. */
  version: 2;
  /** Names the run's demo wallets (their e-mails are derived from it); not a secret. */
  runId: string;
  status: "passed" | "failed" | "estimate";
  failure: { step: RehearsalStep; reason: string } | null;
  startedAt: string;
  finishedAt: string;
  chain: {
    chainId: number;
    name: string;
    local: boolean;
    /** Host of the RPC only: its path may hold an access token. */
    rpcHost: string;
    explorer: string | null;
    moneyMode: MoneyMode | null;
    token: Address | null;
  };
  escrow: {
    address: Address;
    deployBlock: bigint;
    /** The head when the engine started: where the run's own reads of the escrow's logs start. */
    runStartBlock: bigint | null;
    /** Where the engine's event reader started on an empty database. */
    engineStartBlock: bigint | null;
  };
  roles: {
    relayer: Address;
    oracle: Address;
    treasury: Address | null;
    merchant: Address | null;
    buyers: { number: number; address: Address }[];
  };
  gemini: "live" | "simulated";
  /** Whether the engine was started, and stopped cleanly before the receipt was written. */
  engine: { started: boolean; stopped: boolean };
  game: { ticker: string; title: string; startsAt: string } | null;
  instrument: { symbol: string; conditionLabel: string; pauseThresholdBps: number } | null;
  campaign: { id: string; onchainId: bigint; slug: string } | null;
  scenario: Scenario | null;
  driven: { bidBps: number; askBps: number; depth: bigint } | null;
  pauseProbe: PauseProbe | null;
  estimate: Estimate | null;
  steps: StepRecord[];
  transactions: TxRecord[];
  purchases: PurchaseRecord[];
  timings: {
    callToTicket: Stats;
    callToDashboard: Stats;
    refunds: RefundTiming | null;
  };
  hedging: HedgingRecord | null;
  invariants: InvariantResult[];
  balances: {
    before: BalanceRow[];
    afterSettlement: BalanceRow[];
    afterSweep: BalanceRow[];
  };
  /** Money that left the treasury and the oracle over the whole run, sweep included (micro-USDC × 10^12). */
  netCostWei: bigint | null;
  /** Gas paid over the run, wei of the native coin. */
  gasWei: bigint;
  sweep: SweepRecordRow[];
  /** What the run could not bring back, one sentence each (empty when nothing). */
  leftBehind: string[];
  /** What could not be read back from the node or the database after retries, one line each. */
  unread: string[];
  rpc: RpcRecord | null;
  /** Present when a failure left the campaign open or unsettled and its recovery was attempted. */
  recovery: RecoveryRecord | null;
  /** The campaign exists on-chain and was not released when the run ended: the escrow holds funds. */
  stranded: boolean;
  /** Where the receipt was written; not part of the written files. */
  files?: { json: string; markdown: string };
}

// ---------------------------------------------------------------------------------------------
// Recovery of a stranded campaign (`--recover`)
// ---------------------------------------------------------------------------------------------

/** Where a campaign stands on-chain. */
export type CampaignStage =
  "selling" | "paused" | "sales closed" | "settled yes" | "settled no" | "void" | "released";

/** The campaign as the escrow and its events say, at one moment. Money is micro-USDC. */
export interface CampaignStateRecord {
  stage: CampaignStage;
  /** Block whose state this is, and its timestamp (seconds). */
  block: bigint;
  blockTimestamp: bigint;
  salesClose: bigint;
  released: boolean;
  ticketsSold: number;
  ticketsCharged: number;
  /** HedgeCharged events: one per ticket charged when no ticket was charged twice. */
  hedgeCharges: number;
  ticketsRefunded: number;
  hedgeBudget: bigint;
  hedgeSpent: bigint;
  hedgeReserved: bigint;
  lockedRefunds: bigint;
  merchantDue: bigint;
  /** Unspent budget (until released), locked refunds and the merchant's due. */
  escrowHolds: bigint;
}

/** What is left to send, at worst, before a recovery sends anything. */
export interface RecoveryEstimate {
  feePerGasWei: bigint;
  /** What the treasury pays out at worst: the merchant's due on YES. Micro-USDC. */
  treasuryPays: bigint;
  relayerGas: bigint;
  oracleGas: bigint;
  treasuryNeedsWithMargin: bigint;
  relayerGasNeedsWithMarginWei: bigint;
  oracleNeedsWithMarginWei: bigint;
}

/**
 * Where the result a campaign was settled with came from: it was settled on-chain before the
 * recovery started; a result was forced in the database (`demo_overrides`, still set); the
 * instrument's result was known in the database; the recovery forced NO itself because none of
 * those held (for example after the run's own reset cleared the result it had forced).
 */
export type RecoveryResultSource =
  | "already settled on-chain"
  | "already forced in the database"
  | "known in the database"
  | "forced by this recovery";

/** The result a recovery settled the campaign with, and how it compares with the run's. */
export interface RecoveryResult {
  /** From the campaign's `CampaignSettled` event; null when the campaign is not settled. */
  settledWith: Outcome | "void" | null;
  /** Where the result came from; null when the recovery stopped before it was decided. */
  source: RecoveryResultSource | null;
  /** The outcome the original receipt's scenario asked for. */
  scenarioOutcome: Outcome;
  /** One plain sentence when `settledWith` differs from `scenarioOutcome`, else null. */
  differs: string | null;
}

export interface RecoveryReceipt {
  /** 2: `result` was added as an optional field (absent from the receipts written before it). */
  version: 2;
  kind: "recovery";
  /** The receipt this recovery finishes (never rewritten). */
  recovers: {
    file: string;
    runId: string;
    status: string;
    failure: { step: string; reason: string } | null;
    startedAt: string;
  };
  /** `recovered`: released and nothing left behind; `estimate`: nothing was sent. */
  status: "recovered" | "failed" | "estimate";
  failure: { step: RehearsalStep; reason: string } | null;
  startedAt: string;
  finishedAt: string;
  chain: RehearsalReceipt["chain"];
  escrow: RehearsalReceipt["escrow"];
  roles: RehearsalReceipt["roles"];
  campaign: { id: string; onchainId: bigint; slug: string; instrument: string };
  gemini: "live" | "simulated";
  engine: { started: boolean; stopped: boolean };
  /** The result waited for: the one already forced or known, else NO, forced by the recovery. */
  outcome: Outcome | null;
  /** The result the campaign was settled with, where it came from, and whether it is the run's. */
  result?: RecoveryResult | null;
  /** What the recovery did, in order, one sentence each. */
  actions: string[];
  stateBefore: CampaignStateRecord | null;
  stateAfter: CampaignStateRecord | null;
  estimate: RecoveryEstimate | null;
  steps: StepRecord[];
  transactions: TxRecord[];
  balances: { before: BalanceRow[]; after: BalanceRow[] };
  sweep: SweepRecordRow[];
  leftBehind: string[];
  unread: string[];
  rpc: RpcRecord | null;
  files?: { json: string; markdown: string };
}
