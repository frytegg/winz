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
  chainSeconds: bigint;
  /**
   * Wall clock from the moment the rehearsal saw settle on-chain to the moment it saw the last
   * refund (it reads each new block every 100 ms).
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

export interface StepRecord {
  step: RehearsalStep;
  startedAt: string;
  durationMs: number | null;
  status: "done" | "failed";
}

export interface RehearsalReceipt {
  version: 1;
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
  escrow: { address: Address; deployBlock: bigint; runStartBlock: bigint | null };
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
  /** Present when a failure left the campaign open or unsettled and its recovery was attempted. */
  recovery: RecoveryRecord | null;
  /** The campaign exists on-chain and was not released when the run ended: the escrow holds funds. */
  stranded: boolean;
  /** Where the receipt was written; not part of the written files. */
  files?: { json: string; markdown: string };
}
