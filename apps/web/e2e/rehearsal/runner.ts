import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import pino, { type Logger } from "pino";
import {
  TransactionReceiptNotFoundError,
  getAddress,
  isHex,
  size,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_EXPLORER_URL,
  type CampaignDetail,
  type DemoResponse,
  type HedgeInstrument,
  type Outcome,
} from "@winz/shared";

import { setServerDepsForTesting } from "@/lib/server/deps";
import { FakeIdentity, TEST_CONFIG } from "@/lib/server/testing/fixtures";

import { startEngine, type Engine } from "../../../engine/src/app";
import {
  createArcClients,
  defaultCursorName,
  readCursor,
  type RpcLimiter,
} from "../../../engine/src/chain";
import { createDb, type Db } from "../../../engine/src/db";
import {
  DemoIdentityDirectory,
  demoWalletAddress,
  demoWalletKey,
} from "../../../engine/src/identity";
import {
  BookFeed,
  GeminiRestClient,
  PgBookStore,
  PgCatalogStore,
  PgDemoBookStore,
  createBookFeed,
  startCatalogSync,
} from "../../../engine/src/market-data";
import { DemoPaymentGateway, RoutingPaymentGateway } from "../../../engine/src/payments";
import { ApiCallError, api, bearer, type AuthHeaders } from "../support/api";
import { WorldClock } from "../support/clock";
import { SilentTransport, SimulatedGemini, newGame, type Game } from "../support/gemini";
import { SimulatedStripe } from "../support/stripe";
import { WaitTimeoutError, within } from "../support/wait";
import {
  BlockClock,
  CampaignLogFollower,
  allowanceOf,
  moneyOf,
  moneyModeOf,
  readCampaign,
  readEscrowRoles,
  snapshot,
  sweepWallets,
  walletsLeftBehind,
  type CampaignEvents,
  type OnchainCampaignState,
  type Party,
} from "./chain";
import { describeEstimate, estimateRun, formatWei } from "./estimate";
import { checkInvariants, type DeskSample, type DemoFlag, type MoneyParty } from "./invariants";
import {
  OddsRangeError,
  drivenNotMeasured,
  drivenOddsBooks,
  liveNotMeasured,
  liveRowSource,
  measureDriven,
  measureLive,
  oddsRecordOf,
  resolveOddsLag,
  type OddsSource,
} from "./odds";
import { describeRpc, redactText, stats, verdictOf, writeReceipt } from "./receipt";
import {
  RecoveryReceiptError,
  campaignState,
  describeState,
  estimateRecovery,
  readRunReceipt,
  recoveryResult,
  writeRecoveryReceipt,
  type RunReceiptFacts,
} from "./recovery";
import {
  RpcMeter,
  classifyFailure,
  describeFailure,
  meteredClient,
  retryPolicy,
  sleep,
  withRetry,
} from "./rpc";
import { buyerEmail, buyerOf, merchantEmail, resolveScenario } from "./scenario";
import {
  InjectedFailureError,
  RehearsalAbortedError,
  RehearsalRefusedError,
  RehearsalStepError,
  type BalanceRow,
  type CampaignStateRecord,
  type DrivenOddsRecord,
  type LiveOddsRecord,
  type OddsLagOptions,
  type HedgingRecord,
  type MoneyMode,
  type PauseProbe,
  type PurchaseRecord,
  type RefundTiming,
  type RehearsalOptions,
  type RehearsalReceipt,
  type RehearsalStep,
  type RehearsalTimeouts,
  type RecoveryOptions,
  type RecoveryReceipt,
  type RecoveryResultSource,
  type RetryPolicy,
  type RpcLimitsInput,
  type Scenario,
  type StepRecord,
  type TxRecord,
} from "./types";

/**
 * The rehearsal: the whole loop in demo mode, on a real chain, in
 * real time, with the engine's production intervals. It drives only the public surface, exactly
 * as the end-to-end tests do (route handlers of the merchant and the admin, the simulated Stripe
 * for the merchant's budget payment and its webhook), measures it, checks its invariants, sweeps
 * the demo wallets back to the treasury and leaves a receipt with every transaction hash.
 *
 * Every on-chain transaction of the loop is sent by the engine. The rehearsal itself only sends
 * the sweep, from demo wallets derived from the demo seed.
 */

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const DOCS_DIR = resolve(REPO_ROOT, "docs");

export const LOCAL_CHAIN_ID = 31_337;
/** The engine's default `ARC_RPC_FALLBACK_URL`. */
const ARC_PUBLIC_RPC_URL = "https://rpc.testnet.arc.io";

export const DEFAULT_TIMEOUTS: RehearsalTimeouts = {
  // A day behind on Arc is about 190 000 blocks: about a minute through the engine's limiter.
  catchUpMs: 600_000,
  catalogMs: 180_000,
  liveMs: 180_000,
  openMs: 90_000,
  saleMs: 120_000,
  hedgingMs: 600_000,
  closeMs: 300_000,
  settleMs: 300_000,
  engineStopMs: 60_000,
};

/** A game must start at least this long after the run starts (live Gemini). */
const MIN_LEAD_MS = 45 * 60_000;
/** The simulated game starts this long after the run starts: makers are allowed (H-04). */
const SIMULATED_LEAD_MS = 3 * 3_600_000;
/** The driven book's ask, unless the pause threshold is lower. */
const QUIET_ASK_BPS = 1_200;
const SPREAD_BPS = 200;
/** One contract, micro-contracts: the reconciliation tolerance of criterion 4. */
const ONE_CONTRACT = 1_000_000n;
const DESK_SAMPLE_MS = 1_000;
const DASHBOARD_POLL_MS = 100;
/**
 * The engine's event reader starts this many blocks before the head on a fresh database (about
 * 20 s on Arc): nothing before the run concerns it.
 */
export const ENGINE_START_MARGIN_BLOCKS = 50n;
/**
 * The runner's own load on the node, kept under about five requests a second in all (the
 * engine's limiter allows ten for the whole process). Its loops that touch the node:
 *
 * - the waits that read the campaign on-chain (closed, reconciled, settled): one `eth_call`, and
 *   for the close one `eth_getBlockByNumber`, every `CHAIN_POLL_MS`: at most 2 a second;
 * - the count of charged tickets while hedging: one `eth_blockNumber` every `HEDGING_POLL_MS`,
 *   and one `eth_getLogs` only when a block was mined since: at most 1 a second;
 * - the block clock of the refund timing, during settle only: one `eth_blockNumber` every
 *   `BLOCK_CLOCK_MS`: 2 a second.
 *
 * The others read the routes and the database in process, not the node: the Hedge desk sampler
 * (once a second), the merchant's detail during the sales (every 100 ms), the demo sale's
 * checkout status. The escrow's logs are never read in a loop otherwise: once per new block while
 * hedging, and once at the end.
 */
const CHAIN_POLL_MS = 1_000;
const HEDGING_POLL_MS = 2_000;
const BLOCK_CLOCK_MS = 500;

let running = false;

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

export interface EngineLogEntry {
  level: number;
  msg: string;
  module?: string;
  [key: string]: unknown;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const short = (error as Error & { shortMessage?: unknown }).shortMessage;
    return typeof short === "string" ? short : error.message;
  }
  return String(error);
}

/** The `ARC_RPC_MAX_*` variables of `createArcClients`, from the options. */
function limiterEnv(limits: RpcLimitsInput | undefined): {
  ARC_RPC_MAX_REQUESTS_PER_SECOND?: number;
  ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND?: number;
  ARC_RPC_HEAVY_METHODS?: string[];
} {
  return {
    ...(limits?.maxRequestsPerSecond === undefined
      ? {}
      : { ARC_RPC_MAX_REQUESTS_PER_SECOND: limits.maxRequestsPerSecond }),
    ...(limits?.maxHeavyRequestsPerSecond === undefined
      ? {}
      : { ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND: limits.maxHeavyRequestsPerSecond }),
    ...(limits?.heavyMethods === undefined ? {} : { ARC_RPC_HEAVY_METHODS: limits.heavyMethods }),
  };
}

function engineLogger(
  entries: EngineLogEntry[],
  file: string | undefined,
  redact: (text: string) => string,
): Logger {
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      const text = redact(chunk.toString("utf8"));
      if (file !== undefined && file !== "") {
        try {
          appendFileSync(file, text);
        } catch {
          // The log file is a convenience: an unwritable path must not stop the engine.
        }
      }
      for (const line of text.split("\n")) {
        if (line.trim() === "") continue;
        try {
          const entry = JSON.parse(line) as EngineLogEntry;
          if (entry.level >= 40) {
            entries.push(entry);
            if (entries.length > 200) entries.shift();
          }
        } catch {
          // Not a JSON line: nothing to keep.
        }
      }
      callback();
    },
  });
  return pino({ level: "info", timestamp: pino.stdTimeFunctions.isoTime }, stream);
}

/**
 * The last engine warnings, one short line each, for a timeout's message. Only an error's short
 * message (viem's `shortMessage`) or the first line of its message is kept: viem's full messages
 * carry the RPC URL ("URL: …"), whose path can be an access token. The caller redacts the result.
 */
export function describeEngineWarnings(entries: readonly EngineLogEntry[]): string {
  return entries
    .slice(-8)
    .map((entry) => {
      const err = entry.err;
      let reason = "";
      if (typeof err === "object" && err !== null) {
        const fields = err as { shortMessage?: unknown; message?: unknown };
        const text =
          typeof fields.shortMessage === "string"
            ? fields.shortMessage
            : typeof fields.message === "string"
              ? fields.message
              : "";
        const first = text.split("\n")[0]?.trim() ?? "";
        if (first !== "") reason = ` (${first})`;
      }
      return `[${String(entry.level)}] ${String(entry.module ?? "")} ${entry.msg}${reason}`;
    })
    .join(" | ");
}

function stringify(value: unknown): string {
  const text = JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  );
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
}

function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return sleep(ms, signal);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unparseable";
  }
}

function isUnder(path: string, dir: string): boolean {
  const resolved = resolve(path);
  return resolved === dir || resolved.startsWith(`${dir}${sep}`);
}

function validKey(value: string): boolean {
  return isHex(value, { strict: true }) && size(value as Hex) === 32;
}

// ---------------------------------------------------------------------------------------------
// The state of one run
// ---------------------------------------------------------------------------------------------

interface Wallet {
  label: string;
  email: string;
  address: Address;
}

interface PurchaseRun {
  index: number;
  buyer: number;
  qty: number;
  callAtMs: number;
  ticketedAtMs: number;
  token: string;
}

interface Run {
  options: RehearsalOptions;
  /** Every secret of the run replaced, and e-mail addresses: for anything printed or written. */
  redact: (text: string) => string;
  /** True while a failed run is being recovered: Ctrl-C no longer interrupts the waits. */
  recovering: boolean;
  timeouts: RehearsalTimeouts;
  scenario: Scenario;
  /** The runner's client: counted, behind the engine's limiter (`meteredClient`). */
  client: PublicClient;
  /** The client of `createArcClients` the engine runs on. */
  engineClient: PublicClient;
  /** Every request of `client`, and the retries of the runner's reads. */
  meter: RpcMeter;
  /** The limiter shared by the engine and the runner; closed when the run ends. */
  limiter: RpcLimiter | null;
  /** The step running now, for the counts of each step. */
  current: { step: RehearsalStep | null };
  retry: RetryPolicy;
  /** The engine's logger (and the limiter's), writing to the engine log file. */
  logger: Logger;
  /** What could not be read back after retries, one line each (goes to the receipt). */
  unread: string[];
  chain: ReturnType<typeof createArcClients>["chain"];
  accounts: ReturnType<typeof createArcClients>["accounts"];
  moneyMode: MoneyMode;
  token: Address;
  treasury: Address;
  runId: string;
  merchant: Wallet;
  buyers: Wallet[];
  receipt: RehearsalReceipt;
  engineLogs: EngineLogEntry[];
  db: Db | null;
  stripe: SimulatedStripe | null;
  gemini: SimulatedGemini | null;
  engine: Engine | null;
  engineController: AbortController | null;
  /** Newest chain_txs row before the engine started. */
  txWatermark: Date | null;
  /**
   * When the engine started, and the head then: a row of an earlier process that this engine
   * sends again is listed when it is mined after that block (its work), not when the earlier
   * process had it mined already and this one only confirmed it.
   */
  txSince: { at: Date; block: bigint } | null;
  headers: AuthHeaders | null;
  campaign: { id: string; onchainId: bigint; slug: string; symbol: string } | null;
  budgetPi: string | null;
  pauseThresholdBps: number;
  quiet: { bidBps: number; askBps: number; depth: bigint } | null;
  drivenAsksWhileOpen: number[];
  pauseProbe: PauseProbe | null;
  /** The result this run forced through the demo route, if any. */
  forcedOutcome: Outcome | null;
  /** Where the result the recovery waits for came from (set by `recoverStep`). */
  resultSource: DecidedSource | null;
  demoFlags: DemoFlag[];
  firstDemoActionDone: boolean;
  demoOverridesSet: boolean;
  resetDone: boolean;
  deskSamples: DeskSample[];
  sampler: { stop: () => Promise<void> } | null;
  purchases: PurchaseRun[];
  ticketTokens: string[];
  guaranteeLossesBefore: bigint | null;
  makersFilled: number;
  heldAtClose: bigint | null;
  exposureAtClose: bigint | null;
  /** The campaign's escrow logs, read once per new block while hedging and once at the end. */
  logs: CampaignLogFollower | null;
  /** When each block was first seen during settle: the wall clock of the refund timing. */
  blockClock: BlockClock | null;
  /** The Hedge desk's row of the instrument once reconciled at close (it may drop it later). */
  deskAtClose: HedgeInstrument | null;
  /** The measure of the ticket's odds lag (Q-03), resolved from `options.oddsLag`. */
  oddsOptions: OddsLagOptions;
  /** The engine's book feed settings, read from the instance the engine runs. */
  feedSettings: { writeThrottleMs: number | null; demoRefreshMs: number | null } | null;
  /** How the live_instruments row was read (as anon, or why not). */
  oddsRowAccess: string | null;
  oddsLive: LiveOddsRecord | null;
  oddsDriven: DrivenOddsRecord | null;
}

function flag(run: Run, source: string, demo: boolean): void {
  if (run.firstDemoActionDone) run.demoFlags.push({ source, demo });
}

function demoAnswer(run: Run, route: string, answer: DemoResponse): void {
  run.demoFlags.push({ source: route, demo: answer.demo });
}

/** The signal the waits obey: none while recovering, so that Ctrl-C cannot strand the funds. */
function signalOf(run: Run): AbortSignal | undefined {
  return run.recovering ? undefined : run.options.signal;
}

/**
 * The message of a wait that ran out of time: what it waited for, what it last saw, the last
 * error its reads met, and the engine's last warnings.
 */
function timeoutMessage(
  run: Run,
  timeoutMs: number,
  what: string,
  seen: unknown,
  lastError: unknown,
): string {
  return (
    `timed out after ${timeoutMs.toString()} ms waiting for ${what}` +
    (seen === undefined ? "" : `; last seen: ${stringify(seen)}`) +
    (lastError === null ? "" : `; last error: ${describeFailure(lastError)}`) +
    (run.engineLogs.length === 0
      ? ""
      : `; engine warnings: ${describeEngineWarnings(run.engineLogs)}`)
  );
}

/**
 * Asks `condition` every `intervalMs` until it holds or `timeoutMs` runs out. A read of the
 * condition that fails for a moment (`classifyFailure`: a rate limit, a timeout, a 5xx, a dropped
 * connection) is not a failure: the wait asks again, and if it runs out of time it says what it
 * waited for and the last error. Any other failure ends the wait at once.
 */
async function waitUntil(
  run: Run,
  what: string,
  condition: () => Promise<boolean | { ok: boolean; seen: unknown }>,
  timeoutMs: number,
  intervalMs = 250,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let seen: unknown = undefined;
  let lastError: unknown = null;
  for (;;) {
    if (signalOf(run)?.aborted === true) throw new RehearsalAbortedError();
    try {
      const result = await condition();
      const ok = typeof result === "boolean" ? result : result.ok;
      if (typeof result !== "boolean") seen = result.seen;
      if (ok) return;
    } catch (error: unknown) {
      if (classifyFailure(error) === "permanent") throw error;
      lastError = error;
    }
    if (Date.now() >= deadline) {
      throw new WaitTimeoutError(timeoutMessage(run, timeoutMs, what, seen, lastError));
    }
    await pause(intervalMs, signalOf(run));
  }
}

/**
 * A read outside a wait: tried again on a transient failure, with doubling delays. It obeys the
 * run's signal, unless `signal` is given (`undefined`: the reads made once the run is over, which
 * must finish even after Ctrl-C).
 */
function read<T>(
  run: Run,
  what: string,
  body: () => Promise<T>,
  signal: AbortSignal | undefined = signalOf(run),
): Promise<T> {
  return withRetry(what, body, {
    policy: run.retry,
    signal,
    onRetry: () => run.meter.noteRetry(),
  });
}

/**
 * A read whose failure must not stop what follows (the reads made once the run is over, which
 * Ctrl-C does not interrupt): its value, or null with a line in `unread` saying what could not
 * be read and why.
 */
async function readOrNote<T>(run: Run, what: string, body: () => Promise<T>): Promise<T | null> {
  try {
    return await read(run, what, body, undefined);
  } catch (error: unknown) {
    run.unread.push(run.redact(`${what}: ${describeFailure(error)}`));
    return null;
  }
}

/**
 * Every party's balances, each request retried on its own (`snapshot`): one refused request
 * never discards the balances already read. `signal` as for `read`.
 */
function balances(
  run: Run,
  signal: AbortSignal | undefined = signalOf(run),
): Promise<BalanceRow[]> {
  return snapshot(run.client, run.moneyMode, run.token, parties(run), (what, body) =>
    read(run, what, body, signal),
  );
}

/** `balances` once the run is over: null with a line in `unread` when a balance could not be read. */
async function balancesOrNote(run: Run, what: string): Promise<BalanceRow[] | null> {
  try {
    return await balances(run, undefined);
  } catch (error: unknown) {
    run.unread.push(run.redact(`${what}: ${describeFailure(error)}`));
    return null;
  }
}

async function step<T>(
  run: Run,
  name: RehearsalStep,
  body: () => Promise<T>,
  options: { ignoreAbort?: boolean } = {},
): Promise<T> {
  const obeysAbort = options.ignoreAbort !== true && !run.recovering;
  if (obeysAbort && run.options.signal?.aborted === true) {
    throw new RehearsalStepError(name, "interrupted", { cause: new RehearsalAbortedError() });
  }
  const record: StepRecord = {
    step: name,
    startedAt: new Date().toISOString(),
    durationMs: null,
    status: "failed",
  };
  run.receipt.steps.push(record);
  run.current.step = name;
  const started = Date.now();
  run.options.out(`[${name}] started`);
  try {
    run.options.onStep?.(name);
    if (obeysAbort && run.options.signal?.aborted === true) {
      throw new RehearsalAbortedError();
    }
    if (run.options.failAtStep === name) throw new InjectedFailureError(name);
    const value = await body();
    record.status = "done";
    return value;
  } catch (error: unknown) {
    if (error instanceof RehearsalStepError) throw error;
    const reason = error instanceof RehearsalAbortedError ? "interrupted" : errorMessage(error);
    throw new RehearsalStepError(name, reason, { cause: error });
  } finally {
    record.durationMs = Date.now() - started;
    run.current.step = null;
    run.options.out(`[${name}] ${record.status} in ${record.durationMs.toString()} ms`);
  }
}

// ---------------------------------------------------------------------------------------------
// Preflight: refusals and the estimate (nothing is sent)
// ---------------------------------------------------------------------------------------------

function refuseEarly(options: RehearsalOptions): Scenario {
  const reasons = refuseChainAndKeys(options);
  const local = options.chainId !== ARC_TESTNET_CHAIN_ID;
  if (local && options.receiptDir !== undefined && isUnder(options.receiptDir, DOCS_DIR)) {
    reasons.push(
      "a receipt of a run on a local chain is never written under docs/: choose another directory",
    );
  }
  const { scenario, problems } = resolveScenario(options.scenario);
  reasons.push(...problems);
  reasons.push(...resolveOddsLag(options.oddsLag).problems);
  if (reasons.length > 0 || scenario === null) throw new RehearsalRefusedError(reasons);
  return scenario;
}

function emptyReceipt(
  options: RehearsalOptions,
  scenario: Scenario,
  startedAt: string,
): RehearsalReceipt {
  const arc = options.chainId === ARC_TESTNET_CHAIN_ID;
  return {
    version: 2,
    runId: "",
    status: "failed",
    failure: null,
    startedAt,
    finishedAt: startedAt,
    chain: {
      chainId: options.chainId,
      name: arc ? "Arc testnet" : "local development chain",
      local: !arc,
      rpcHost: hostOf(options.rpcUrl),
      explorer: arc ? ARC_TESTNET_EXPLORER_URL : null,
      moneyMode: null,
      token: null,
    },
    escrow: {
      address: getAddress(options.escrowAddress),
      deployBlock: options.escrowDeployBlock,
      runStartBlock: null,
      engineStartBlock: null,
    },
    roles: {
      relayer: privateKeyToAccount(options.secrets.relayerKey).address,
      oracle: privateKeyToAccount(options.secrets.oracleKey).address,
      treasury: null,
      merchant: null,
      buyers: [],
    },
    gemini: options.gemini.kind,
    engine: { started: false, stopped: false },
    game: null,
    instrument: null,
    campaign: null,
    scenario,
    driven: null,
    pauseProbe: null,
    estimate: null,
    steps: [],
    transactions: [],
    purchases: [],
    timings: {
      callToTicket: stats([]),
      callToDashboard: stats([]),
      refunds: null,
    },
    odds: null,
    hedging: null,
    invariants: [],
    balances: { before: [], afterSettlement: [], afterSweep: [] },
    netCostWei: null,
    gasWei: 0n,
    sweep: [],
    leftBehind: [],
    unread: [],
    rpc: null,
    recovery: null,
    stranded: false,
  };
}

/** The chain, its clients and its roles, read before anything is sent. */
interface Preflight {
  /** The runner's client (counted); `engineClient` is the engine's. */
  client: PublicClient;
  engineClient: PublicClient;
  limiter: RpcLimiter | null;
  chain: ReturnType<typeof createArcClients>["chain"];
  accounts: ReturnType<typeof createArcClients>["accounts"];
  moneyMode: MoneyMode;
  token: Address;
  treasury: Address;
}

/** What the node must be for a run or a recovery to start; nothing is sent here. */
interface NodeAccess {
  meter: RpcMeter;
  current: { step: RehearsalStep | null };
  logger: Logger;
  retry: RetryPolicy;
  signal: AbortSignal | undefined;
}

/**
 * Builds the clients (`createArcClients`, with the limiter's variables and the engine's logger
 * for its cool-downs; the runner reads through `meteredClient` over the same client), then checks
 * the node's chain id and the escrow's roles against the keys. Throws `RehearsalRefusedError`
 * when they differ or cannot be read (after retries), with the limiter closed.
 */
async function connect(
  options: Pick<
    RehearsalOptions,
    | "chainId"
    | "rpcUrl"
    | "rpcFallbackUrl"
    | "secrets"
    | "escrowAddress"
    | "rpcLimits"
    | "nodeFaults"
    | "out"
  >,
  access: NodeAccess,
): Promise<Preflight> {
  const arc = createArcClients(
    {
      ARC_CHAIN_ID: options.chainId,
      ARC_RPC_URL: options.rpcUrl,
      // As the engine's environment: Arc's public RPC behind the primary one, unless told otherwise.
      ARC_RPC_FALLBACK_URL:
        options.rpcFallbackUrl ??
        (options.chainId === ARC_TESTNET_CHAIN_ID ? ARC_PUBLIC_RPC_URL : options.rpcUrl),
      ARC_RELAYER_PRIVATE_KEY: options.secrets.relayerKey,
      ARC_ORACLE_PRIVATE_KEY: options.secrets.oracleKey,
      ...limiterEnv(options.rpcLimits),
    },
    { logger: access.logger.child({ module: "rpc-limiter" }) },
  );
  const client = meteredClient(arc.publicClient, {
    meter: access.meter,
    step: () => access.current.step,
    ...(options.nodeFaults === undefined ? {} : { fault: options.nodeFaults }),
  });
  const read = <T>(what: string, body: () => Promise<T>): Promise<T> =>
    withRetry(what, body, {
      policy: access.retry,
      signal: access.signal,
      onRetry: () => access.meter.noteRetry(),
    });
  try {
    let nodeChainId: number;
    try {
      nodeChainId = await read("the node's chain id", () => client.getChainId());
    } catch (error: unknown) {
      throw new RehearsalRefusedError([
        `the node at ${hostOf(options.rpcUrl)} cannot be read: ${errorMessage(error)}`,
      ]);
    }
    if (nodeChainId !== options.chainId) {
      throw new RehearsalRefusedError([
        `the node answers chain id ${nodeChainId.toString()}, the run was asked for ${options.chainId.toString()}`,
      ]);
    }
    const escrow = getAddress(options.escrowAddress);
    let roles;
    try {
      roles = await read("the escrow's roles", () => readEscrowRoles(client, escrow));
    } catch (error: unknown) {
      throw new RehearsalRefusedError([
        `the escrow ${escrow} cannot be read: ${errorMessage(error)}`,
      ]);
    }
    const relayer = arc.accounts.relayer.address;
    const oracle = arc.accounts.oracle.address;
    const out = options.out;
    out(`chain ${options.chainId.toString()} at ${hostOf(options.rpcUrl)}, escrow ${escrow}`);
    out(`relayer ${relayer} (escrow's relayer ${roles.relayer})`);
    out(`oracle ${oracle} (escrow's oracle ${roles.oracle})`);
    out(`treasury ${roles.treasury}, token ${roles.token}`);
    const reasons: string[] = [];
    if (roles.relayer !== relayer)
      reasons.push(`the escrow's relayer is ${roles.relayer}, the relayer key given is ${relayer}`);
    if (roles.oracle !== oracle)
      reasons.push(`the escrow's oracle is ${roles.oracle}, the oracle key given is ${oracle}`);
    if (roles.treasury !== relayer) {
      reasons.push(
        `the escrow's treasury is ${roles.treasury}, not the relayer ${relayer} whose key was given`,
      );
    }
    if (reasons.length > 0) throw new RehearsalRefusedError(reasons);
    return {
      client,
      engineClient: arc.publicClient,
      limiter: arc.limiter,
      chain: arc.chain,
      accounts: arc.accounts,
      moneyMode: moneyModeOf(options.chainId, roles.token),
      token: roles.token,
      treasury: roles.treasury,
    };
  } catch (error: unknown) {
    arc.limiter?.close();
    throw error;
  }
}

async function preflight(
  options: RehearsalOptions,
  scenario: Scenario,
  receipt: RehearsalReceipt,
  wallets: { merchant: Wallet; buyers: Wallet[] },
  access: NodeAccess,
): Promise<Preflight> {
  const out = options.out;
  const flight = await connect(options, access);
  try {
    const { client, moneyMode } = flight;
    const escrow = getAddress(options.escrowAddress);
    const relayer = flight.accounts.relayer.address;
    const oracle = flight.accounts.oracle.address;
    out(`merchant (demo wallet) ${wallets.merchant.address}`);
    for (const buyer of wallets.buyers) out(`${buyer.label} (demo wallet) ${buyer.address}`);
    receipt.roles.treasury = flight.treasury;
    receipt.chain.moneyMode = moneyMode;
    receipt.chain.token = flight.token;
    const read = <T>(what: string, body: () => Promise<T>): Promise<T> =>
      withRetry(what, body, {
        policy: access.retry,
        signal: access.signal,
        onRetry: () => access.meter.noteRetry(),
      });
    const fees = await read("the node's fees", () => client.estimateFeesPerGas());
    const estimate = estimateRun({ scenario, nodeMaxFeePerGasWei: fees.maxFeePerGas, moneyMode });
    receipt.estimate = estimate;

    const [treasuryMoney, relayerNative, oracleNative, allowance] = await read(
      "the balances of the treasury, the relayer and the oracle",
      () =>
        Promise.all([
          moneyOf(client, moneyMode, flight.token, flight.treasury),
          client.getBalance({ address: relayer }),
          client.getBalance({ address: oracle }),
          allowanceOf(client, flight.token, flight.treasury, escrow),
        ]),
    );
    out(
      `treasury balance: ${formatWei(treasuryMoney, 18)} USDC; allowance to the escrow: ${formatWei(allowance, 6)} USDC`,
    );
    out(
      `oracle native balance: ${formatWei(oracleNative, 18)}${moneyMode === "native-usdc" ? " USDC" : " (gas coin)"}`,
    );
    if (moneyMode === "erc20")
      out(`relayer native balance: ${formatWei(relayerNative, 18)} (gas coin)`);
    for (const line of describeEstimate(estimate, moneyMode)) out(line);

    const short: string[] = [];
    if (treasuryMoney < estimate.treasuryNeedsWithMargin) {
      short.push(
        `the treasury holds ${formatWei(treasuryMoney, 18)} USDC, the run needs ${formatWei(estimate.treasuryNeedsWithMargin, 18)} with the 20 % margin`,
      );
    }
    if (allowance < estimate.treasuryLocks) {
      short.push(
        `the treasury's allowance to the escrow is ${formatWei(allowance, 6)} USDC, the run fronts up to ${formatWei(estimate.treasuryLocks, 6)}`,
      );
    }
    if (oracleNative < estimate.oracleNeedsWithMarginWei) {
      short.push(
        `the oracle holds ${formatWei(oracleNative, 18)} for gas, the run needs ${formatWei(estimate.oracleNeedsWithMarginWei, 18)} with the 20 % margin`,
      );
    }
    if (moneyMode === "erc20" && relayerNative < estimate.relayerGasNeedsWithMarginWei) {
      short.push(
        `the relayer holds ${formatWei(relayerNative, 18)} for gas, the run needs ${formatWei(estimate.relayerGasNeedsWithMarginWei, 18)} with the 20 % margin`,
      );
    }
    if (short.length > 0) throw new RehearsalRefusedError(short);
    return flight;
  } catch (error: unknown) {
    flight.limiter?.close();
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// The steps
// ---------------------------------------------------------------------------------------------

function routeDeps(run: Run, db: Db, stripe: SimulatedStripe, identity: FakeIdentity): void {
  setServerDepsForTesting({
    db,
    verifier: identity,
    directory: identity,
    payments: stripe.web,
    config: () => ({ ...TEST_CONFIG, escrowAddress: getAddress(run.options.escrowAddress) }),
    now: () => new Date(),
  });
}

function parties(run: Run): Party[] {
  const list: Party[] = [
    { role: "treasury, relayer", address: run.treasury },
    { role: "oracle", address: run.accounts.oracle.address },
    { role: "escrow", address: getAddress(run.options.escrowAddress) },
    { role: "merchant", address: run.merchant.address },
    ...run.buyers.map((buyer) => ({ role: buyer.label, address: buyer.address })),
  ];
  const seen = new Set<Address>();
  return list.filter((party) => {
    if (seen.has(party.address)) return false;
    seen.add(party.address);
    return true;
  });
}

async function startEngineStep(run: Run, identity: FakeIdentity): Promise<void> {
  const options = run.options;
  // A recovery opened the database already, for its checks.
  const db = run.db ?? createDb(options.databaseUrl, { max: 20 });
  run.db = db;
  const stripe = new SimulatedStripe();
  run.stripe = stripe;
  routeDeps(run, db, stripe, identity);
  const logger = run.logger;
  const marketDataLog = logger.child({ module: "market-data" });

  let bookFeed: BookFeed;
  let catalogClient: GeminiRestClient;
  if (options.gemini.kind === "live") {
    catalogClient = new GeminiRestClient({ baseUrl: options.gemini.apiUrl, logger: marketDataLog });
    bookFeed = createBookFeed({
      db,
      client: catalogClient,
      logger: logger.child({ module: "book-feed" }),
      socket: {
        url: options.gemini.wsUrl,
        ...(options.gemini.proxyUrl === undefined ? {} : { proxyUrl: options.gemini.proxyUrl }),
        ...(options.gemini.caFile === undefined ? {} : { caFile: options.gemini.caFile }),
      },
    });
  } else {
    const clock = new WorldClock();
    const gemini = new SimulatedGemini(clock, await simulatedGame(db, Date.now()));
    run.gemini = gemini;
    catalogClient = gemini.client();
    // Production settings of the feed; only the transports are simulated.
    bookFeed = new BookFeed({
      store: new PgBookStore(db),
      rest: new SilentTransport(),
      ws: gemini.transport(),
      logger: logger.child({ module: "book-feed" }),
      demo: new PgDemoBookStore(db),
    });
  }

  run.feedSettings = {
    writeThrottleMs: feedSetting(bookFeed, "writeThrottleMs"),
    demoRefreshMs: feedSetting(bookFeed, "demoRefreshMs"),
  };

  // The newest outbox row before this run: every row after it was written by this run.
  const [watermark] = await read(
    run,
    "the outbox's newest row",
    () => db<{ at: Date | null }[]>`select max(created_at) as at from chain_txs`,
  );
  run.txWatermark = watermark?.at ?? new Date(0);
  const since = new Date();
  const head = await read(run, "the head of the chain", () =>
    run.client.getBlockNumber({ cacheTime: 0 }),
  );
  run.txSince = { at: since, block: head };
  run.receipt.escrow.runStartBlock = run.receipt.escrow.runStartBlock ?? head;
  const engineStartBlock = engineStartBlockOf(options, head);
  run.receipt.escrow.engineStartBlock = engineStartBlock;
  run.options.out(
    options.startNearHead === true
      ? `fresh database: the engine reads the escrow's events from block ${engineStartBlock.toString()} (the head ${head.toString()} minus ${ENGINE_START_MARGIN_BLOCKS.toString()}), not from its deploy block ${options.escrowDeployBlock.toString()}`
      : `the engine reads the escrow's events from block ${engineStartBlock.toString()} on an empty database (it resumes from its cursor otherwise)`,
  );
  run.receipt.balances.before = await balances(run);

  const controller = new AbortController();
  run.engineController = controller;
  run.engine = await startEngine({
    db,
    logger,
    publicClient: run.engineClient,
    accounts: run.accounts,
    chainId: options.chainId,
    escrowAddress: getAddress(options.escrowAddress),
    escrowDeployBlock: engineStartBlock,
    bookFeed,
    // As in production: card payments go to Stripe (simulated here), replayed demo sales never do.
    payments: new RoutingPaymentGateway(stripe.engine, new DemoPaymentGateway(db)),
    identity: new DemoIdentityDirectory(options.secrets.demoSeed),
    venueName: "paper",
    background: [
      {
        name: "catalog-sync",
        start: (signal) =>
          startCatalogSync({
            client: catalogClient,
            store: new PgCatalogStore(db),
            logger: marketDataLog,
            signal,
          }),
      },
    ],
    signal: controller.signal,
  });
  run.receipt.engine.started = true;
  run.options.out(
    `engine started (production intervals), run start block ${String(run.receipt.escrow.runStartBlock)}`,
  );
  await waitCaughtUp(run, head);
  run.guaranteeLossesBefore = BigInt(
    (await read(run, "the Hedge desk", () => api.hedgeDesk())).totals.guaranteeLosses,
  );
  run.sampler = startDeskSampler(run);
}

/**
 * A setting of the engine's book feed as the instance holds it (the runner passes none, so these
 * are the feed's own defaults, as in production). BookFeed exposes no getter for them: the field
 * is read by name and null is reported when it is not a number.
 */
function feedSetting(feed: BookFeed, name: "writeThrottleMs" | "demoRefreshMs"): number | null {
  const value: unknown = Reflect.get(feed, name);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Where the engine's event reader starts on an empty database: near the head for a fresh
 * database (`startNearHead`), never before the escrow's deploy block; the deploy block otherwise.
 */
export function engineStartBlockOf(
  options: Pick<RehearsalOptions, "startNearHead" | "escrowDeployBlock">,
  head: bigint,
): bigint {
  if (options.startNearHead !== true) return options.escrowDeployBlock;
  const near = head > ENGINE_START_MARGIN_BLOCKS ? head - ENGINE_START_MARGIN_BLOCKS : 0n;
  return near > options.escrowDeployBlock ? near : options.escrowDeployBlock;
}

/**
 * Waits for the engine's log cursor to reach `head` (the head when it started). On a database
 * that already has a cursor the engine first catches up on what was mined since, and while it
 * does every request of the process waits behind its eth_getLogs: no sale is measured before.
 */
async function waitCaughtUp(run: Run, head: bigint): Promise<void> {
  const db = run.db;
  if (db === null) throw new Error("no database");
  const name = defaultCursorName(getAddress(run.options.escrowAddress));
  const started = Date.now();
  let cursor: bigint | null = null;
  await waitUntil(
    run,
    `the engine's event reader to reach block ${head.toString()}`,
    async () => {
      cursor = await readCursor(db, name);
      return { ok: cursor !== null && cursor >= head, seen: { cursor } };
    },
    run.timeouts.catchUpMs,
    CHAIN_POLL_MS,
  );
  run.options.out(
    `the engine's event reader is at block ${String(cursor)}, the head when it started (${head.toString()}), after ${(Date.now() - started).toString()} ms: no measure is taken while it catches up`,
  );
}

/** Samples the Hedge desk once a second for the unhedged notional of the run's instrument. */
function startDeskSampler(run: Run): { stop: () => Promise<void> } {
  let stopped = false;
  let wake: (() => void) | null = null;
  const loop = (async (): Promise<void> => {
    while (!stopped) {
      const symbol = run.campaign?.symbol;
      if (symbol !== undefined) {
        try {
          const desk = await api.hedgeDesk();
          const row = desk.instruments.find((instrument) => instrument.symbol === symbol);
          run.deskSamples.push({
            atMs: Date.now(),
            unhedgedNotional: row === undefined ? 0n : BigInt(row.unhedgedNotional),
            uMax: BigInt(desk.params.uMax),
          });
        } catch {
          // A sample that fails is skipped; the invariant reports how many were taken.
        }
      }
      await new Promise<void>((resolveTick) => {
        const timer = setTimeout(resolveTick, DESK_SAMPLE_MS);
        wake = () => {
          clearTimeout(timer);
          resolveTick();
        };
      });
    }
  })();
  return {
    stop: async () => {
      stopped = true;
      (wake as (() => void) | null)?.();
      await loop;
    },
  };
}

/**
 * The game the simulated Gemini lists for this run: the one an earlier run on this database
 * listed, while it has no result and still starts at least `MIN_LEAD_MS` from now, so that a
 * second run replays the demo on the same game and contract, as an operator does before a jury;
 * otherwise a new game starting `SIMULATED_LEAD_MS` from now.
 */
async function simulatedGame(db: Db, nowMs: number): Promise<Game> {
  const rows = await db<{ ticker: string; starts_at: Date }[]>`
    select e.ticker, e.starts_at
    from events e
    where e.ticker like 'NCAAF-%-ARK-TEX-M'
      and e.starts_at >= ${new Date(nowMs + MIN_LEAD_MS)}
      and e.status in ('upcoming', 'active')
      and not exists (
        select 1 from instruments i where i.event_ticker = e.ticker and i.outcome is not null
      )
    order by e.starts_at, e.ticker
    limit 1
  `;
  const listed = rows[0];
  if (listed !== undefined) {
    // `newGame` names a game after its start: the same start gives back the same game.
    const game = newGame(listed.starts_at.getTime() - SIMULATED_LEAD_MS, SIMULATED_LEAD_MS);
    if (game.ticker === listed.ticker) return game;
  }
  return newGame(nowMs, SIMULATED_LEAD_MS);
}

async function chooseGameStep(run: Run, identity: FakeIdentity): Promise<{ symbol: string }> {
  const handle = run.runId;
  const token = `rehearsal-${handle}`;
  identity.addUser(token, `did:privy:rehearsal-${handle}`, {
    email: run.merchant.email,
    walletAddress: run.merchant.address.toLowerCase(),
  });
  const headers = bearer(token);
  run.headers = headers;
  await api.me(headers);
  await api.createMerchant(headers, { name: "Rehearsal merchant", category: "bar" });

  const simulated = run.gemini?.game ?? null;
  let chosen: {
    ticker: string;
    title: string;
    startsAt: string;
    symbol: string;
    label: string;
  } | null = null;
  await waitUntil(
    run,
    simulated === null
      ? "a listed game starting in 45 minutes or more with a two-outcome moneyline"
      : `the simulated game ${simulated.ticker} to be listed`,
    async () => {
      const db = run.db;
      if (db === null) throw new Error("no database");
      // The catalogue as the sync stored it (a read, as the end-to-end tests read rows to assert):
      // games with exactly two moneyline contracts and no draw, starting in 45 minutes or more.
      const earliest = new Date(Date.now() + MIN_LEAD_MS);
      const rows = await db<
        {
          ticker: string;
          title: string;
          starts_at: Date;
          symbol: string;
          label: string;
          ask: number | null;
        }[]
      >`
        select e.ticker, e.title, e.starts_at, i.symbol, i.label, i.best_ask_bps as ask
        from events e
        join instruments i on i.event_ticker = e.ticker
        where i.type = 'moneyline' and i.active and i.outcome is null
          and e.starts_at >= ${earliest}
          and e.status in ('upcoming', 'active')
          and (${simulated?.ticker ?? null}::text is null or e.ticker = ${simulated?.ticker ?? null})
          and e.ticker in (
            select event_ticker from instruments
            where type = 'moneyline' and active
            group by event_ticker
            having count(*) = 2 and count(*) filter (where side = 'tie') = 0
          )
        order by e.starts_at, e.ticker, i.best_ask_bps nulls last, i.symbol
      `;
      const first = rows[0];
      if (first === undefined) return { ok: false, seen: { games: 0 } };
      // The merchant must see the game in the catalogue route too.
      const listed = await api.events(headers);
      if (!listed.events.some((event) => event.ticker === first.ticker)) {
        return { ok: false, seen: { chosen: first.ticker, listed: listed.events.length } };
      }
      // The underdog (lowest ask first): any side works, the book is driven.
      chosen = {
        ticker: first.ticker,
        title: first.title,
        startsAt: first.starts_at.toISOString(),
        symbol: first.symbol,
        label: first.label,
      };
      return true;
    },
    run.timeouts.catalogMs,
    1_000,
  );
  const game = chosen as {
    ticker: string;
    title: string;
    startsAt: string;
    symbol: string;
    label: string;
  } | null;
  if (game === null) throw new Error("no game chosen");
  run.receipt.game = { ticker: game.ticker, title: game.title, startsAt: game.startsAt };
  run.receipt.instrument = {
    symbol: game.symbol,
    conditionLabel: game.label,
    pauseThresholdBps: 0,
  };
  run.options.out(
    `game chosen: ${game.ticker} (${game.title}), starts ${game.startsAt}; instrument ${game.symbol} (${game.label})`,
  );
  return { symbol: game.symbol };
}

async function launchCampaignStep(run: Run, symbol: string): Promise<void> {
  const headers = run.headers;
  const stripe = run.stripe;
  if (headers === null || stripe === null) throw new Error("the merchant is not signed in");
  const scenario = run.scenario;
  const created = await api.createCampaign(headers, {
    instrumentSymbol: symbol,
    unitPrice: scenario.unitPrice.toString(),
    refundBps: scenario.refundBps,
    usualMarginBps: scenario.usualMarginBps,
    minMarginBps: scenario.minMarginBps,
    budget: scenario.budget.toString(),
    product: "Rehearsal item",
    // One requestId per creation, as the front sends it: the creation is idempotent on it.
    requestId: randomUUID(),
  });
  const budgetPi = created.budgetPayment.paymentIntentId;
  run.budgetPi = budgetPi;
  stripe.confirmCard(budgetPi, run.merchant.email);
  await api.stripeWebhook(stripe.webhookDelivery("payment_intent.succeeded", budgetPi));

  let detail: CampaignDetail | null = null;
  await waitUntil(
    run,
    "the campaign to go live on-chain with a slug",
    async () => {
      detail = await api.campaign(headers, created.campaignId);
      return {
        ok: detail.status === "live" && detail.slug !== null && detail.onchain !== null,
        seen: { status: detail.status, slug: detail.slug },
      };
    },
    run.timeouts.liveMs,
    500,
  );
  const live = detail as CampaignDetail | null;
  if (live === null || live.slug === null || live.onchain === null)
    throw new Error("the campaign went live without a slug");
  run.campaign = {
    id: created.campaignId,
    onchainId: BigInt(live.onchain.campaignId),
    slug: live.slug,
    symbol,
  };
  run.pauseThresholdBps = live.pauseThresholdBps;
  run.receipt.campaign = {
    id: created.campaignId,
    onchainId: BigInt(live.onchain.campaignId),
    slug: live.slug,
  };
  if (run.receipt.instrument !== null)
    run.receipt.instrument.pauseThresholdBps = live.pauseThresholdBps;
  run.options.out(
    `campaign ${created.campaignId} live: on-chain id ${live.onchain.campaignId}, slug ${live.slug}, pause threshold ${live.pauseThresholdBps.toString()} bps`,
  );
}

async function setBook(
  run: Run,
  bidBps: number,
  askBps: number,
  salesOpen: boolean,
): Promise<void> {
  const campaign = run.campaign;
  const quiet = run.quiet;
  if (campaign === null || quiet === null) throw new Error("no campaign to drive");
  const answer = await api.demoBook({
    instrumentSymbol: campaign.symbol,
    bidBps,
    askBps,
    depth: quiet.depth.toString(),
  });
  run.demoOverridesSet = true;
  run.firstDemoActionDone = true;
  demoAnswer(run, "POST /api/admin/demo/book", answer);
  if (salesOpen) run.drivenAsksWhileOpen.push(askBps);
}

async function driveBookStep(run: Run): Promise<void> {
  const campaign = run.campaign;
  if (campaign === null) throw new Error("no campaign");
  const threshold = run.pauseThresholdBps;
  const ask = Math.min(QUIET_ASK_BPS, Math.floor((threshold - 100) / 100) * 100);
  const bid = ask - SPREAD_BPS;
  if (bid < 100) {
    throw new Error(
      `the pause threshold (${threshold.toString()} bps) leaves no room for a book under it: widen the margins or lower the refund`,
    );
  }
  // Depth for the whole run: twice the contracts owed if YES, at least 100 contracts.
  const owed =
    BigInt(run.scenario.purchases) * BigInt(run.scenario.unitsPerPurchase) * run.scenario.unitPrice;
  const wanted = owed * 2n > 100n * ONE_CONTRACT ? owed * 2n : 100n * ONE_CONTRACT;
  const depth = ((wanted + 9_999n) / 10_000n) * 10_000n;
  run.quiet = { bidBps: bid, askBps: ask, depth };
  run.receipt.driven = { bidBps: bid, askBps: ask, depth };
  await setBook(run, bid, ask, true);
  run.options.out(
    `driven book: bid ${bid.toString()} bps, ask ${ask.toString()} bps, depth ${depth.toString()} micro-contracts`,
  );
  await waitOpenOnQuietBook(run);
}

/**
 * Open, and priced on the driven book (its mid): the engine's feed holds the demo book, so the
 * first sale is quoted on it rather than refused for want of a book.
 */
async function waitOpenOnQuietBook(run: Run): Promise<void> {
  const campaign = run.campaign;
  const quiet = run.quiet;
  if (campaign === null || quiet === null) throw new Error("no campaign to drive");
  const mid = (quiet.bidBps + quiet.askBps) / 2;
  await waitUntil(
    run,
    `the campaign page to answer open at ${mid.toString()} bps`,
    async () => {
      const page = await api.publicCampaign(campaign.slug);
      flag(run, "GET /api/c/:slug", page.demo);
      return {
        ok: page.saleState === "open" && page.probabilityBps === mid,
        seen: { saleState: page.saleState, probabilityBps: page.probabilityBps },
      };
    },
    run.timeouts.openMs,
    500,
  );
}

/**
 * Before any sale: drives the book a tick above the pause threshold, waits for the campaign page
 * to answer `paused_price`, posts one demo sale (which the route must refuse with 409
 * `sales_paused`, before any payment or transaction), then puts the quiet book back and waits for
 * the campaign to reopen after the engine's resume delay. What it saw goes to the invariant.
 */
async function pauseProbeStep(run: Run): Promise<void> {
  const campaign = run.campaign;
  const quiet = run.quiet;
  const buyer = run.buyers[0];
  if (campaign === null || quiet === null || buyer === undefined) throw new Error("no campaign");
  const threshold = run.pauseThresholdBps;
  const bid = (Math.floor(threshold / 100) + 1) * 100;
  const ask = bid + SPREAD_BPS;
  if (ask > 9_900) {
    run.pauseProbe = {
      bidBps: bid,
      askBps: ask,
      saleState: null,
      saleRefusal: null,
      skipped: `the pause threshold (${threshold.toString()} bps) leaves no book above it under 9900 bps`,
    };
    return;
  }
  const probe: PauseProbe = {
    bidBps: bid,
    askBps: ask,
    saleState: null,
    saleRefusal: null,
    skipped: null,
  };
  run.pauseProbe = probe;
  await setBook(run, bid, ask, false);
  try {
    await waitUntil(
      run,
      `the campaign page to answer paused_price with the book at ${bid.toString()}/${ask.toString()} bps`,
      async () => {
        const page = await api.publicCampaign(campaign.slug);
        flag(run, "GET /api/c/:slug", page.demo);
        if (page.saleState !== "open") probe.saleState = page.saleState;
        return { ok: page.saleState === "paused_price", seen: { saleState: page.saleState } };
      },
      run.timeouts.openMs,
      500,
    );
  } catch (error: unknown) {
    // Not paused in time: the invariant reports what was seen; the probe goes on to the sale.
    if (!(error instanceof WaitTimeoutError)) throw error;
  }
  try {
    const answer = await api.demoSale({
      slug: campaign.slug,
      qty: run.scenario.unitsPerPurchase,
      email: buyer.email,
    });
    demoAnswer(run, "POST /api/admin/demo/sale", answer);
    probe.saleRefusal = null;
  } catch (error: unknown) {
    if (!(error instanceof ApiCallError)) throw error;
    probe.saleRefusal = `${error.status.toString()} ${error.body.error.code}`;
  }
  run.options.out(
    `pause probe: book at ${bid.toString()}/${ask.toString()} bps (threshold ${threshold.toString()}): page ${probe.saleState ?? "open"}, demo sale ${probe.saleRefusal ?? "accepted"}`,
  );
  await setBook(run, quiet.bidBps, quiet.askBps, true);
  await waitOpenOnQuietBook(run);
}

// ---------------------------------------------------------------------------------------------
// The ticket's odds (Q-03, criterion 7): see odds.ts
// ---------------------------------------------------------------------------------------------

/**
 * The live path, before the book is driven: the campaign's own live_instruments row, which the
 * engine's feed writes from Gemini's books since the campaign went live. Another instrument of the
 * catalogue would do only if the feed followed it, and it follows only the instruments of live or
 * paused campaigns and the web's tracked_instruments rows: none is certain to exist.
 */
async function oddsLiveStep(run: Run): Promise<void> {
  const db = run.db;
  const campaign = run.campaign;
  if (db === null || campaign === null) throw new Error("no campaign");
  const options = run.oddsOptions;
  const demo = await read(
    run,
    "the demo overrides of the instrument",
    () => db<{ n: number }[]>`
      select count(*)::int as n from demo_overrides
       where instrument = ${campaign.symbol} and book is not null
    `,
  );
  if ((demo[0]?.n ?? 0) > 0) {
    run.oddsLive = liveNotMeasured(
      "a demo book is in force on the instrument: its row does not follow Gemini",
      campaign.symbol,
      options.liveWindowMs,
    );
    return;
  }
  const { source, access } = await read(run, "the live_instruments row's access", () =>
    liveRowSource(db, campaign.symbol),
  );
  run.oddsRowAccess = access;
  const signal = signalOf(run);
  run.oddsLive = await measureLive({
    instrument: campaign.symbol,
    source,
    windowMs: options.liveWindowMs,
    pollMs: options.pollMs,
    ...(signal === undefined ? {} : { signal }),
    redact: run.redact,
  });
  const live = run.oddsLive;
  const lag = live.readers[0]?.lag;
  run.options.out(
    live.measured && lag !== undefined
      ? `live odds: ${lag.count.toString()} updates of ${campaign.symbol} in ${(options.liveWindowMs / 1_000).toString()} s, seen − observed_at median ${String(lag.medianMs)} ms, p95 ${String(lag.p95Ms)} ms, max ${String(lag.maxMs)} ms`
      : `live odds: not measured (${live.note ?? "–"})`,
  );
}

/**
 * The driven path, once every ticket is hedged and before the sales close: the book is set to
 * `samples` prices under the pause threshold (sales stay open), above any working maker buy
 * (none should be left, and none may be filled by the measure), and after each one the ticket's
 * two sources are read until they show the new mid. The quiet book is put back afterwards, and
 * the campaign must answer open on it again, whatever happened.
 */
async function oddsDrivenStep(run: Run): Promise<void> {
  const db = run.db;
  const campaign = run.campaign;
  const quiet = run.quiet;
  const token = run.ticketTokens[0];
  if (db === null || campaign === null || quiet === null) throw new Error("no campaign");
  const options = run.oddsOptions;
  if (token === undefined) {
    run.oddsDriven = drivenNotMeasured("no ticket was issued", campaign.symbol);
    return;
  }
  const row = await read(run, "the Hedge desk", () => deskRow(campaign.symbol));
  const makerBuys = (row?.orders ?? [])
    .filter((order) => order.side === "buy" && order.status === "working")
    .map((order) => order.priceBps);
  const highestBuy = makerBuys.length === 0 ? 0 : Math.max(...makerBuys);
  let books: { bidBps: number; askBps: number; midBps: number }[];
  try {
    books = drivenOddsBooks(options.samples, {
      minAskBps: Math.max(100 + SPREAD_BPS, highestBuy + 100),
      maxAskBps: Math.floor((run.pauseThresholdBps - 100) / 100) * 100,
      currentAskBps: quiet.askBps,
      spreadBps: SPREAD_BPS,
    });
  } catch (error: unknown) {
    if (!(error instanceof OddsRangeError)) throw error;
    run.oddsDriven = drivenNotMeasured(error.message, campaign.symbol);
    return;
  }
  const rowSource = await read(run, "the live_instruments row's access", () =>
    liveRowSource(db, campaign.symbol),
  );
  run.oddsRowAccess = rowSource.access;
  const ticketSource: OddsSource = {
    name: "GET /api/t/:token",
    read: async () => {
      const ticket = await api.ticket(token);
      flag(run, "GET /api/t/:token", ticket.demo);
      return { valueBps: ticket.probabilityBps, observedAtMs: null };
    },
  };
  const signal = signalOf(run);
  try {
    run.oddsDriven = await measureDriven({
      instrument: campaign.symbol,
      books,
      setBook: (bidBps, askBps) => setBook(run, bidBps, askBps, true),
      sources: [rowSource.source, ticketSource],
      pollMs: options.pollMs,
      sampleTimeoutMs: options.sampleTimeoutMs,
      jitterMs: run.feedSettings?.demoRefreshMs ?? 1_000,
      ...(signal === undefined ? {} : { signal }),
      redact: run.redact,
      onSample: (sample, index) => {
        run.options.out(
          `odds ${(index + 1).toString()}/${books.length.toString()}: book ${sample.bidBps.toString()}/${sample.askBps.toString()} bps (mid ${sample.midBps.toString()}), set in ${sample.callMs.toString()} ms; readable ${sample.lagsMs.map((lag) => (lag === null ? "never" : `after ${lag.toString()} ms`)).join(" (row), ")} (ticket)`,
        );
      },
    });
  } finally {
    await setBook(run, quiet.bidBps, quiet.askBps, true);
    await waitOpenOnQuietBook(run);
  }
}

/** The odds record of the run: null before the engine started; each path not reached said so. */
function oddsOf(run: Run): RehearsalReceipt["odds"] {
  if (run.feedSettings === null) return null;
  const options = run.oddsOptions;
  const instrument = run.campaign?.symbol ?? null;
  const live =
    run.oddsLive ??
    liveNotMeasured(
      run.options.gemini.kind === "simulated"
        ? "the run used the simulated Gemini: there is no live feed to measure"
        : options.liveWindowMs === 0
          ? "the window is 0 (--odds-window 0)"
          : "the run stopped before the live window",
      instrument,
      options.liveWindowMs,
    );
  const driven =
    run.oddsDriven ?? drivenNotMeasured("the run stopped before the driven measure", instrument);
  return oddsRecordOf({
    options,
    writeThrottleMs: run.feedSettings.writeThrottleMs,
    demoRefreshMs: run.feedSettings.demoRefreshMs,
    rowAccess: run.oddsRowAccess,
    driven,
    live,
  });
}

async function purchasesStep(run: Run): Promise<void> {
  const campaign = run.campaign;
  const headers = run.headers;
  if (campaign === null || headers === null) throw new Error("no campaign");
  const scenario = run.scenario;
  const samples: { atMs: number; sales: number }[] = [];
  const baseline = (
    await read(run, "the merchant's detail", () => api.campaign(headers, campaign.id))
  ).sales;
  let polling = true;
  const poller = (async (): Promise<void> => {
    while (polling) {
      try {
        const detail = await api.campaign(headers, campaign.id);
        samples.push({ atMs: Date.now(), sales: detail.sales });
        flag(run, "GET /api/campaigns/:id", detail.demo);
      } catch {
        // A failed poll is a missing sample, nothing more.
      }
      await new Promise<void>((resolveTick) => setTimeout(resolveTick, DASHBOARD_POLL_MS));
    }
  })();

  // Sales waiting to be replayed, in order. Two sales of one buyer may be in flight at once: the
  // engine creates a new buyer's row once however many of their sales arrive together.
  const pending = Array.from({ length: scenario.purchases }, (_, index) => index);
  const one = async (index: number): Promise<void> => {
    const buyer = buyerOf(index, scenario.buyers);
    const wallet = run.buyers[buyer - 1];
    if (wallet === undefined) throw new Error(`no buyer ${buyer.toString()}`);
    if (run.options.failAtSale === index + 1) {
      throw new InjectedFailureError(`sale ${index + 1}`);
    }
    const callAtMs = Date.now();
    const sale = await api.demoSale({
      slug: campaign.slug,
      qty: scenario.unitsPerPurchase,
      email: wallet.email,
    });
    demoAnswer(run, "POST /api/admin/demo/sale", sale);
    const ticket = { token: sale.ticketToken };
    const pi = sale.paymentIntentId;
    if (ticket.token === null) {
      if (pi === null) throw new Error("the demo sale answered no payment id");
      await waitUntil(
        run,
        `the demo sale ${pi} to be ticketed`,
        async () => {
          const status = await api.checkoutStatus(pi);
          if (status.status === "failed" || status.status === "cancelled_paused") {
            throw new Error(`the demo sale ${pi} ended ${status.status}: ${status.message ?? ""}`);
          }
          ticket.token = status.ticketToken;
          return { ok: status.status === "ticketed" && status.ticketToken !== null, seen: status };
        },
        run.timeouts.saleMs,
        100,
      );
    }
    const ticketedAtMs = Date.now();
    const token = ticket.token;
    if (token === null) throw new Error("ticketed without a token");
    run.purchases.push({
      index,
      buyer,
      qty: scenario.unitsPerPurchase,
      callAtMs,
      ticketedAtMs,
      token,
    });
    run.ticketTokens.push(token);
    run.options.out(
      `sale ${(index + 1).toString()}/${scenario.purchases.toString()} (buyer ${buyer.toString()}): ticket in ${(ticketedAtMs - callAtMs).toString()} ms`,
    );
  };
  // Once one sale fails (or the run is interrupted), no worker posts another: the sales in flight
  // are awaited, then the step fails. Nothing is posted after the run is declared FAILED.
  let stopped = false;
  let firstError: unknown = null;
  const worker = async (): Promise<void> => {
    while (!stopped && pending.length > 0) {
      const index = pending.shift();
      if (index === undefined) continue;
      await one(index);
    }
  };
  const guarded = async (): Promise<void> => {
    try {
      await worker();
    } catch (error: unknown) {
      if (!stopped) firstError = error;
      stopped = true;
      throw error;
    }
  };
  try {
    const settled = await Promise.allSettled(
      Array.from({ length: Math.min(scenario.parallel, scenario.purchases) }, guarded),
    );
    if (settled.some((outcome) => outcome.status === "rejected")) {
      throw firstError instanceof Error ? firstError : new Error(String(firstError));
    }
    const units = scenario.purchases * scenario.unitsPerPurchase;
    await waitUntil(
      run,
      `the merchant's detail to show ${units.toString()} more units`,
      () =>
        Promise.resolve({
          ok: (samples[samples.length - 1]?.sales ?? 0) >= baseline + units,
          seen: samples[samples.length - 1],
        }),
      run.timeouts.saleMs,
      DASHBOARD_POLL_MS,
    );
  } finally {
    polling = false;
    await poller;
  }

  // The k-th ticket issued shows on the merchant's detail once its count reaches the first k
  // tickets' units: parallel sales are matched in the order their tickets were issued.
  const ordered = [...run.purchases].sort((a, b) => a.ticketedAtMs - b.ticketedAtMs);
  let cumulative = baseline;
  const dashboardAt = new Map<number, number>();
  for (const purchase of ordered) {
    cumulative += purchase.qty;
    const seen = samples.find(
      (sample) => sample.atMs >= purchase.callAtMs && sample.sales >= cumulative,
    );
    if (seen !== undefined) dashboardAt.set(purchase.index, seen.atMs);
  }
  run.receipt.purchases = [...run.purchases]
    .sort((a, b) => a.index - b.index)
    .map((purchase): PurchaseRecord => ({
      index: purchase.index + 1,
      buyer: purchase.buyer,
      qty: purchase.qty,
      callToTicketMs: purchase.ticketedAtMs - purchase.callAtMs,
      callToDashboardMs:
        dashboardAt.get(purchase.index) === undefined
          ? null
          : (dashboardAt.get(purchase.index) ?? 0) - purchase.callAtMs,
    }));
}

async function deskRow(symbol: string): Promise<HedgeInstrument | null> {
  const desk = await api.hedgeDesk();
  return desk.instruments.find((instrument) => instrument.symbol === symbol) ?? null;
}

/** The campaign's log follower, from the block the run (or the run recovered) started at. */
function logsOf(run: Run): CampaignLogFollower {
  const campaign = run.campaign;
  if (campaign === null) throw new Error("no campaign");
  run.logs ??= new CampaignLogFollower(
    run.client,
    getAddress(run.options.escrowAddress),
    campaign.onchainId,
    run.receipt.escrow.runStartBlock ?? run.options.escrowDeployBlock,
  );
  return run.logs;
}

/**
 * Moves the driven book onto the engine's resting makers until `tickets` tickets are charged.
 * The charges are counted from the escrow's logs, read once per new block at most every
 * `HEDGING_POLL_MS`; a read that fails for a moment is asked again at the next round, and the
 * step runs out of time with the count, the last error and the engine's warnings.
 */
async function hedgingStep(run: Run, tickets: number = run.scenario.purchases): Promise<void> {
  const campaign = run.campaign;
  const quiet = run.quiet;
  if (campaign === null || quiet === null) throw new Error("no campaign");
  const logs = logsOf(run);
  const deadline = Date.now() + run.timeouts.hedgingMs;
  let lastError: unknown = null;
  let lastRead = 0;
  for (;;) {
    if (signalOf(run)?.aborted === true) throw new RehearsalAbortedError();
    if (Date.now() - lastRead >= HEDGING_POLL_MS) {
      lastRead = Date.now();
      try {
        await logs.catchUp();
      } catch (error: unknown) {
        if (classifyFailure(error) === "permanent") throw error;
        lastError = error;
      }
    }
    const charged = logs.chargedTickets();
    if (charged >= tickets) break;
    if (Date.now() > deadline) {
      throw new WaitTimeoutError(
        timeoutMessage(
          run,
          run.timeouts.hedgingMs,
          `${tickets.toString()} tickets charged on-chain`,
          { charged },
          lastError,
        ),
      );
    }
    let row: HedgeInstrument | null = null;
    try {
      row = await deskRow(campaign.symbol);
    } catch (error: unknown) {
      if (classifyFailure(error) === "permanent") throw error;
      lastError = error;
    }
    const maker = row?.orders.find(
      (order) => order.kind === "maker" && order.side === "buy" && order.status === "working",
    );
    if (maker === undefined || maker.priceBps < 200) {
      // Nothing to fill (yet, or a maker at the floor): the engine's taker fallback will hedge it.
      await pause(1_000, signalOf(run));
      continue;
    }
    // Bring the ask down to the maker's price, as a market would, then back to the quiet book.
    await setBook(run, Math.min(quiet.bidBps, maker.priceBps - 100), maker.priceBps, true);
    const state = { filled: false };
    try {
      await waitUntil(
        run,
        `the maker ${maker.id} to be filled`,
        async () => {
          const current = await deskRow(campaign.symbol);
          const order = current?.orders.find((item) => item.id === maker.id);
          state.filled = order?.status === "filled";
          return { ok: order === undefined || order.status !== "working", seen: order };
        },
        60_000,
        500,
      );
    } finally {
      await setBook(run, quiet.bidBps, quiet.askBps, true);
    }
    if (state.filled) run.makersFilled += 1;
  }
  run.options.out(
    `every ticket's hedge charged on-chain (${run.makersFilled.toString()} makers filled by moving the book)`,
  );
}

async function closeSalesStep(run: Run): Promise<void> {
  const campaign = run.campaign;
  const headers = run.headers;
  if (campaign === null || headers === null) throw new Error("no campaign");
  await api.close(headers, campaign.id);
  await waitClosed(run);
}

/** Waits for the close on the route, on-chain, and for the reconciliation that settle needs. */
async function waitClosed(run: Run): Promise<void> {
  const campaign = run.campaign;
  const headers = run.headers;
  if (campaign === null || headers === null) throw new Error("no campaign");
  const escrow = getAddress(run.options.escrowAddress);
  await waitUntil(
    run,
    "the campaign to answer sales_closed",
    async () => {
      const detail = await api.campaign(headers, campaign.id);
      flag(run, "GET /api/campaigns/:id", detail.demo);
      return {
        ok: detail.status === "sales_closed",
        seen: { status: detail.status, saleState: detail.saleState },
      };
    },
    run.timeouts.closeMs,
    500,
  );
  await waitUntil(
    run,
    "the sales closed on-chain",
    async () => {
      const [onchain, block] = await Promise.all([
        readCampaign(run.client, escrow, campaign.onchainId),
        run.client.getBlock({ blockTag: "latest" }),
      ]);
      return {
        ok: onchain.salesClose <= block.timestamp,
        seen: { salesClose: onchain.salesClose, now: block.timestamp },
      };
    },
    run.timeouts.closeMs,
    CHAIN_POLL_MS,
  );
  await waitUntil(
    run,
    "the reconciliation (|held − exposure| ≤ 1 contract) and a zero hedge reservation on-chain",
    async () => {
      const [row, onchain] = await Promise.all([
        deskRow(campaign.symbol),
        readCampaign(run.client, escrow, campaign.onchainId),
      ]);
      const held = row === null ? 0n : BigInt(row.held);
      const exposure = row === null ? 0n : BigInt(row.exposure);
      const gap = held > exposure ? held - exposure : exposure - held;
      run.heldAtClose = held;
      run.exposureAtClose = exposure;
      run.deskAtClose = row;
      return {
        ok: gap <= ONE_CONTRACT && onchain.hedgeReserved === 0n,
        seen: { held, exposure, hedgeReserved: onchain.hedgeReserved },
      };
    },
    run.timeouts.closeMs,
    CHAIN_POLL_MS,
  );
}

async function settleStep(run: Run): Promise<void> {
  const campaign = run.campaign;
  const headers = run.headers;
  if (campaign === null || headers === null) throw new Error("no campaign");
  const outcome = run.scenario.outcome;
  // The wall clock of each new block, from before the result is forced to the release.
  const clock = new BlockClock(run.client, BLOCK_CLOCK_MS);
  run.blockClock = clock;
  await clock.tick();
  clock.start();
  try {
    await forceResult(run, outcome);
    await waitSettled(run, outcome);
  } finally {
    await clock.stop();
  }
  // Every answer of the public side about the campaign, once settled.
  const page = await read(run, "the campaign page", () => api.publicCampaign(campaign.slug));
  flag(run, "GET /api/c/:slug", page.demo);
  for (const token of run.ticketTokens) {
    const ticket = await read(run, "a ticket page", () => api.ticket(token));
    flag(run, "GET /api/t/:token", ticket.demo);
  }
}

async function forceResult(run: Run, outcome: Outcome): Promise<void> {
  const campaign = run.campaign;
  if (campaign === null) throw new Error("no campaign");
  const answer = await api.demoResult({ instrumentSymbol: campaign.symbol, outcome });
  run.forcedOutcome = outcome;
  demoAnswer(run, "POST /api/admin/demo/result", answer);
}

/** Waits for settle on `outcome`, every refund, the merchant's payout and the release. */
async function waitSettled(run: Run, outcome: Outcome): Promise<void> {
  const campaign = run.campaign;
  const headers = run.headers;
  if (campaign === null || headers === null) throw new Error("no campaign");
  const escrow = getAddress(run.options.escrowAddress);
  const status = outcome === "yes" ? "settled_yes" : "settled_no";
  await waitUntil(
    run,
    `the campaign settled ${outcome}, every refund, the merchant's payout and the release`,
    async () => {
      const [detail, onchain] = await Promise.all([
        api.campaign(headers, campaign.id),
        readCampaign(run.client, escrow, campaign.onchainId),
      ]);
      flag(run, "GET /api/campaigns/:id", detail.demo);
      return {
        ok:
          detail.status === status &&
          onchain.released &&
          onchain.merchantDue === 0n &&
          onchain.lockedRefunds === 0n,
        seen: { status: detail.status, onchain },
      };
    },
    run.timeouts.settleMs,
    CHAIN_POLL_MS,
  );
}

/** Where an already decided result comes from: a recovery's sources, or this run's own force. */
type DecidedSource = RecoveryResultSource | "forced by the run";

interface Decided {
  outcome: Outcome;
  source: DecidedSource;
}

/** The first of the database's forced and known results that is a result. Pure. */
function decidedIn(
  row: { forced: string | null; known: string | null } | undefined,
): Decided | null {
  if (row?.forced === "yes" || row?.forced === "no") {
    return { outcome: row.forced, source: "already forced in the database" };
  }
  if (row?.known === "yes" || row?.known === "no") {
    return { outcome: row.known, source: "known in the database" };
  }
  return null;
}

/**
 * The result the campaign settles on, when one is already decided: the merchant's detail says
 * settled, this run forced one, the demo route forced one (a stored override), or the instrument's
 * result is known; with where it came from. Null when none is: the recovery then forces NO.
 */
async function decidedOutcome(run: Run): Promise<Decided | null> {
  const campaign = run.campaign;
  const headers = run.headers;
  const db = run.db;
  if (campaign === null || headers === null || db === null) throw new Error("no campaign");
  const detail = await read(run, "the merchant's detail", () => api.campaign(headers, campaign.id));
  if (detail.status === "settled_yes")
    return { outcome: "yes", source: "already settled on-chain" };
  if (detail.status === "settled_no") return { outcome: "no", source: "already settled on-chain" };
  if (run.forcedOutcome !== null)
    return { outcome: run.forcedOutcome, source: "forced by the run" };
  const [row] = await read(
    run,
    "the campaign's forced or known result",
    () =>
      db<{ forced: string | null; known: string | null }[]>`
      select
        (select forced_result from demo_overrides where instrument = ${campaign.symbol}) as forced,
        (select outcome from instruments where symbol = ${campaign.symbol}) as known
    `,
  );
  return decidedIn(row);
}

/**
 * Brings the campaign to a release while the engine runs, so that the escrow holds nothing for
 * it: hedges what was sold and not yet charged (settle needs a zero hedge reservation), closes
 * sales through the merchant's route if they are still open, forces NO through the demo route
 * (no refund to send; the merchant's wallet receives what is left and is swept) unless a result
 * is already forced or known, and waits for the settlement, any refund, the merchant's payment
 * and the release. Used after a failed step (Ctrl-C does not interrupt it then; every wait keeps
 * its timeout) and by `--recover`. Each thing it does is added to `actions`.
 */
async function recoverStep(run: Run, actions: string[] = []): Promise<void> {
  const campaign = run.campaign;
  const headers = run.headers;
  if (campaign === null || headers === null) throw new Error("no campaign");
  if (run.options.strand === true) throw new InjectedFailureError("recover");
  const escrow = getAddress(run.options.escrowAddress);
  const decided = await decidedOutcome(run);
  const outcome: Outcome = decided?.outcome ?? "no";
  run.resultSource = decided?.source ?? null;
  const record = { outcome, released: false, reason: null as string | null };
  run.receipt.recovery = record;
  try {
    const detail = await read(run, "the merchant's detail", () =>
      api.campaign(headers, campaign.id),
    );
    const open = detail.status === "live" || detail.status === "paused";
    if (open || detail.status === "sales_closed") {
      if (!run.demoOverridesSet && run.quiet !== null) {
        // A recovery in a new process: the run's driven book was reset with the demo overrides,
        // and the engine needs a fresh book to hedge, to reconcile at close and to settle.
        await setBook(run, run.quiet.bidBps, run.quiet.askBps, open);
        actions.push(
          `book driven again at bid ${run.quiet.bidBps.toString()} / ask ${run.quiet.askBps.toString()} bps, as the run drove it`,
        );
      }
      const logs = logsOf(run);
      await read(run, "the campaign's events", () => logs.catchUp());
      const sold = logs.events().purchased.length;
      const charged = logs.chargedTickets();
      if (sold > charged && run.quiet !== null) {
        await hedgingStep(run, sold);
        actions.push(
          `${(sold - charged).toString()} ticket(s) hedged and charged (${sold.toString()} sold)`,
        );
      }
      if (open) {
        await api.close(headers, campaign.id);
        actions.push("sales closed through the merchant's route");
      }
      await waitClosed(run);
    }
    if (decided === null) {
      await forceResult(run, outcome);
      run.resultSource = "forced by this recovery";
      actions.push("result NO forced through the demo route");
    } else {
      actions.push(`result ${outcome.toUpperCase()} already forced or known: not forced again`);
    }
    await waitSettled(run, outcome);
    actions.push(
      `settled ${outcome.toUpperCase()}${outcome === "yes" ? ", refunds and the merchant's due paid" : ""}, released`,
    );
    record.released = (
      await read(run, "the campaign on-chain", () =>
        readCampaign(run.client, escrow, campaign.onchainId),
      )
    ).released;
  } catch (error: unknown) {
    record.reason = run.redact(errorMessage(error));
    throw error;
  }
}

async function stopEngine(run: Run): Promise<void> {
  const engine = run.engine;
  if (engine === null) return;
  run.engineController?.abort();
  await within(engine.stopped, run.timeouts.engineStopMs, "the engine to stop");
  run.engine = null;
  run.receipt.engine.stopped = true;
}

/** Every demo wallet of the run back to the treasury, each tried again for a moment's failure. */
async function sweepStep(run: Run): Promise<void> {
  if (run.options.strand === true) throw new InjectedFailureError("sweep");
  const wallets = [run.merchant, ...run.buyers];
  run.receipt.sweep = await sweepWallets({
    client: run.client,
    chain: run.chain,
    mode: run.moneyMode,
    token: run.token,
    seed: run.options.secrets.demoSeed,
    wallets: wallets.map((wallet) => ({ label: wallet.label, email: wallet.email })),
    destination: run.treasury,
    local: run.receipt.chain.local,
    policy: run.retry,
    out: run.options.out,
    onRetry: () => run.meter.noteRetry(),
  });
}

// ---------------------------------------------------------------------------------------------
// What is read back once the run is over
// ---------------------------------------------------------------------------------------------

interface OutboxRow {
  id: string;
  created_at: Date;
  kind: string;
  signer: string;
  signer_address: string | null;
  status: string;
  tx_hash: string | null;
  payload: Record<string, unknown>;
  sent_at: Date | null;
  mined_at: Date | null;
}

/**
 * Whether an outbox row concerns this run's campaign: by its campaign (creation, close, buys,
 * settlement steps) or, for hedge charges, which batch tickets across campaigns, by its tickets.
 */
function ownsRow(
  run: Run,
  payload: Record<string, unknown>,
  ownTickets: ReadonlySet<string>,
): boolean {
  const campaign = run.campaign;
  if (campaign === null) return false;
  if (
    payload.campaignId === campaign.id ||
    payload.campaignOnchainId === campaign.onchainId.toString()
  ) {
    return true;
  }
  const ticketIds = payload.ticketIds;
  return Array.isArray(ticketIds) && ticketIds.some((id) => ownTickets.has(String(id)));
}

/** The receipt of `hash`; null when the node does not know it (not mined) or it could not be read. */
async function minedReceipt(run: Run, what: string, hash: Hex): Promise<TransactionReceipt | null> {
  try {
    return await read(run, what, () => run.client.getTransactionReceipt({ hash }), undefined);
  } catch (error: unknown) {
    if (error instanceof TransactionReceiptNotFoundError) return null;
    run.unread.push(run.redact(`${what}: ${describeFailure(error)}`));
    return null;
  }
}

/**
 * Every outbox row this engine wrote since `run.txWatermark`, or sent since then (a row left
 * queued by an earlier process and resumed), each with its receipt read from the chain.
 */
async function collectTransactions(
  run: Run,
  ownTickets: ReadonlySet<string>,
): Promise<{ rows: OutboxRow[]; records: TxRecord[]; gasBySigner: Map<Address, bigint> }> {
  const db = run.db;
  const records: TxRecord[] = [];
  const gasBySigner = new Map<Address, bigint>();
  const watermark = run.txWatermark;
  const since = run.txSince;
  if (db === null || watermark === null || since === null) {
    return { rows: [], records, gasBySigner };
  }
  const rows = await readOrNote(
    run,
    "the engine's outbox",
    () =>
      db<OutboxRow[]>`
      select id, created_at, kind, signer, signer_address, status, tx_hash, payload, sent_at,
        mined_at
      from chain_txs
      where created_at > ${watermark} or sent_at > ${since.at}
      order by created_at, id
    `,
  );
  if (rows === null) return { rows: [], records, gasBySigner };
  const explorer = run.receipt.chain.explorer;
  for (const row of rows) {
    if (row.tx_hash === null) continue;
    const hash = row.tx_hash as Hex;
    const receipt = await minedReceipt(run, `the receipt of ${row.kind} ${hash}`, hash);
    const resumed = row.created_at <= watermark;
    if (resumed && receipt !== null && receipt.blockNumber <= since.block) continue;
    let feeWei: bigint | null = null;
    if (receipt !== null) {
      feeWei = receipt.gasUsed * receipt.effectiveGasPrice;
      const from = getAddress(receipt.from);
      gasBySigner.set(from, (gasBySigner.get(from) ?? 0n) + feeWei);
    }
    records.push({
      kind: row.kind,
      signer: row.signer,
      hash,
      status: row.status,
      block: receipt?.blockNumber ?? null,
      gasUsed: receipt?.gasUsed ?? null,
      feeWei,
      ownCampaign: ownsRow(run, row.payload, ownTickets),
      explorerUrl: explorer === null ? null : `${explorer}/tx/${hash}`,
    });
  }
  return { rows, records, gasBySigner };
}

/** The sweep's transfers as transactions of the receipt, with their blocks. */
async function sweepTransactions(run: Run): Promise<TxRecord[]> {
  const explorer = run.receipt.chain.explorer;
  const records: TxRecord[] = [];
  for (const row of run.receipt.sweep) {
    if (row.txHash === null) continue;
    const mined = await minedReceipt(run, `the receipt of the sweep of ${row.wallet}`, row.txHash);
    records.push({
      kind: "sweep",
      signer: row.wallet,
      hash: row.txHash,
      status: row.status,
      block: mined?.blockNumber ?? null,
      gasUsed: mined?.gasUsed ?? null,
      feeWei: row.gasWei,
      ownCampaign: true,
      explorerUrl: explorer === null ? null : `${explorer}/tx/${row.txHash}`,
    });
  }
  return records;
}

/**
 * The refund timing: blocks from the events, chain seconds from the two blocks' timestamps, and
 * the wall clock from the block clock that watched the head during settle.
 */
async function refundTiming(
  run: Run,
  events: CampaignEvents,
  rows: readonly OutboxRow[],
  records: readonly TxRecord[],
): Promise<RefundTiming | null> {
  const settled = events.settled[0];
  if (settled === undefined || events.refunded.length === 0) return null;
  const lastBlock = events.refunded.reduce(
    (max, refund) => (refund.block > max ? refund.block : max),
    0n,
  );
  const blocks = await readOrNote(run, "the blocks of settle and of the last refund", () =>
    Promise.all([
      run.client.getBlock({ blockNumber: settled.block }),
      run.client.getBlock({ blockNumber: lastBlock }),
    ]),
  );
  const ownTickets = new Set(events.purchased.map((ticket) => ticket.ticketId.toString()));
  const batches = rows.filter(
    (row) =>
      ownsRow(run, row.payload, ownTickets) && row.kind === "refundBatch" && row.tx_hash !== null,
  );
  const settleSeen = run.blockClock?.firstSeenAtMs(settled.block) ?? null;
  const lastSeen = run.blockClock?.firstSeenAtMs(lastBlock) ?? null;
  return {
    settleBlock: settled.block,
    lastRefundBlock: lastBlock,
    blocks: lastBlock - settled.block,
    chainSeconds: blocks === null ? null : blocks[1].timestamp - blocks[0].timestamp,
    wallMs: settleSeen === null || lastSeen === null ? null : lastSeen - settleSeen,
    batches: batches.map((row) => {
      const ticketIds = row.payload.ticketIds;
      return {
        hash: row.tx_hash as Hex,
        tickets: Array.isArray(ticketIds) ? ticketIds.length : 0,
        gasUsed: records.find((record) => record.hash === row.tx_hash)?.gasUsed ?? null,
        sentAt: row.sent_at?.toISOString() ?? null,
        blockTime: row.mined_at?.toISOString() ?? null,
      };
    }),
  };
}

async function hedgingRecord(
  run: Run,
  events: CampaignEvents,
  onchain: OnchainCampaignState | null,
): Promise<HedgingRecord | null> {
  const campaign = run.campaign;
  if (campaign === null) return null;
  const desk = await readOrNote(run, "the Hedge desk after the run", () => api.hedgeDesk());
  const latest =
    desk?.instruments.find((instrument) => instrument.symbol === campaign.symbol) ?? null;
  const losses = desk === null ? null : BigInt(desk.totals.guaranteeLosses);
  // The row as it stood at close, when the desk still listed the instrument with its orders.
  const row = run.deskAtClose ?? latest;
  const buys = row?.orders.filter((order) => order.side === "buy") ?? [];
  return {
    orders: row?.orders.length ?? 0,
    makerOrders: buys.filter((order) => order.kind === "maker").length,
    takerOrders: buys.filter((order) => order.kind === "taker").length,
    fills: row?.fills.length ?? 0,
    makersFilledByTheRehearsal: run.makersFilled,
    charges: events.charged.length,
    hedgeSpent:
      onchain?.hedgeSpent ?? events.charged.reduce((total, charge) => total + charge.amount, 0n),
    makerSavings: row === null ? 0n : BigInt(row.makerSavings),
    guaranteeLossesDelta:
      losses === null || run.guaranteeLossesBefore === null
        ? 0n
        : losses - run.guaranteeLossesBefore,
    heldAtClose: run.heldAtClose,
    exposureAtClose: run.exposureAtClose,
  };
}

/**
 * The accounts whose money the invariants follow, from the balances before the run and after
 * settlement. An account missing from `after` is not followed (its change would be invented): it
 * is left out, so that the money check says it was not measured, and named in `unread`. Pure.
 */
export function moneyPartiesOf(
  before: readonly BalanceRow[],
  after: readonly BalanceRow[],
  mode: MoneyMode,
  gasBySigner: ReadonlyMap<Address, bigint>,
): { parties: MoneyParty[]; unread: string[] } {
  const parties: MoneyParty[] = [];
  const unread: string[] = [];
  for (const row of before) {
    const later = after.find((item) => item.address === row.address);
    if (later === undefined) {
      unread.push(`the balance of ${row.role} ${row.address} after settlement: not read`);
      continue;
    }
    parties.push({
      role: row.role,
      address: row.address,
      beforeWei: row.moneyWei,
      afterWei: later.moneyWei,
      gasWei: mode === "native-usdc" ? (gasBySigner.get(row.address) ?? 0n) : 0n,
    });
  }
  return { parties, unread };
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

/**
 * Plays the whole loop once and returns its receipt (also written to `receiptDir` when given).
 *
 * Throws `RehearsalRefusedError` when it refuses to start (wrong chain, keys that are not the
 * escrow's roles, balances that do not cover the worst case with a 20 % margin, a bad scenario):
 * nothing was sent then. Any failure after that does not throw: the engine is stopped, the demo
 * wallets are swept, and the receipt says FAILED with the step and the reason.
 */
export async function runRehearsal(options: RehearsalOptions): Promise<RehearsalReceipt> {
  if (running)
    throw new RehearsalRefusedError(["another rehearsal is already running in this process"]);
  running = true;
  try {
    return await rehearse(options);
  } finally {
    running = false;
  }
}

/** The demo wallets of a run: the merchant and each buyer, derived from the seed and the run id. */
function walletsOf(
  seed: Hex,
  runId: string,
  buyers: number,
): { merchant: Wallet; buyers: Wallet[] } {
  return {
    merchant: {
      label: "merchant",
      email: merchantEmail(runId),
      address: getAddress(demoWalletAddress(seed, merchantEmail(runId))),
    },
    buyers: Array.from({ length: buyers }, (_, index) => {
      const email = buyerEmail(runId, index + 1);
      return {
        label: `buyer ${(index + 1).toString()}`,
        email,
        address: getAddress(demoWalletAddress(seed, email)),
      };
    }),
  };
}

/** The run's state before anything happened, around the clients `flight` connected. */
function newRun(
  options: RehearsalOptions,
  parts: {
    redact: (text: string) => string;
    timeouts: RehearsalTimeouts;
    scenario: Scenario;
    flight: Preflight;
    access: NodeAccess;
    runId: string;
    merchant: Wallet;
    buyers: Wallet[];
    receipt: RehearsalReceipt;
    engineLogs: EngineLogEntry[];
  },
): Run {
  return {
    options,
    redact: parts.redact,
    recovering: false,
    timeouts: parts.timeouts,
    scenario: parts.scenario,
    client: parts.flight.client,
    engineClient: parts.flight.engineClient,
    meter: parts.access.meter,
    limiter: parts.flight.limiter,
    current: parts.access.current,
    retry: parts.access.retry,
    logger: parts.access.logger,
    unread: [],
    chain: parts.flight.chain,
    accounts: parts.flight.accounts,
    moneyMode: parts.flight.moneyMode,
    token: parts.flight.token,
    treasury: parts.flight.treasury,
    runId: parts.runId,
    merchant: parts.merchant,
    buyers: parts.buyers,
    receipt: parts.receipt,
    engineLogs: parts.engineLogs,
    db: null,
    stripe: null,
    gemini: null,
    engine: null,
    engineController: null,
    txWatermark: null,
    txSince: null,
    headers: null,
    campaign: null,
    budgetPi: null,
    pauseThresholdBps: 0,
    quiet: null,
    drivenAsksWhileOpen: [],
    pauseProbe: null,
    forcedOutcome: null,
    resultSource: null,
    demoFlags: [],
    firstDemoActionDone: false,
    demoOverridesSet: false,
    resetDone: false,
    deskSamples: [],
    sampler: null,
    purchases: [],
    ticketTokens: [],
    guaranteeLossesBefore: null,
    makersFilled: 0,
    heldAtClose: null,
    exposureAtClose: null,
    logs: null,
    blockClock: null,
    deskAtClose: null,
    oddsOptions: resolveOddsLag(options.oddsLag).options,
    feedSettings: null,
    oddsRowAccess: null,
    oddsLive: null,
    oddsDriven: null,
  };
}

async function rehearse(input: RehearsalOptions): Promise<RehearsalReceipt> {
  const startedAt = new Date().toISOString();
  const scenario = refuseEarly(input);
  const timeouts: RehearsalTimeouts = { ...DEFAULT_TIMEOUTS, ...input.timeouts };
  const runId = randomBytes(6).toString("hex");
  const { merchant, buyers } = walletsOf(input.secrets.demoSeed, runId, scenario.buyers);
  // Every secret of the run, replaced in every line printed and every text of the receipt.
  const secrets = runSecrets(
    input,
    [merchant, ...buyers].map((wallet) => wallet.email),
  );
  const redact = (text: string): string => redactText(text, secrets);
  const options: RehearsalOptions = { ...input, out: (line) => input.out(redact(line)) };
  const receipt = emptyReceipt(options, scenario, startedAt);
  receipt.runId = runId;
  receipt.roles.merchant = merchant.address;
  receipt.roles.buyers = buyers.map((buyer, index) => ({
    number: index + 1,
    address: buyer.address,
  }));
  const engineLogs: EngineLogEntry[] = [];
  const access: NodeAccess = {
    meter: new RpcMeter(),
    current: { step: "preflight" },
    logger: engineLogger(engineLogs, options.engineLogFile, redact),
    retry: retryPolicy(options.readRetry),
    signal: options.signal,
  };

  let flight: Preflight;
  try {
    flight = await preflight(options, scenario, receipt, { merchant, buyers }, access);
  } catch (error: unknown) {
    // Nothing was sent. A node that cannot be read is a refusal too; no reason may quote a secret
    // (viem's messages carry the RPC URL).
    if (error instanceof RehearsalRefusedError) {
      throw new RehearsalRefusedError(error.reasons.map(redact));
    }
    throw new RehearsalRefusedError([
      `the chain could not be read before the run: ${redact(errorMessage(error))}`,
    ]);
  }
  access.current.step = null;
  if (options.estimateOnly) {
    flight.limiter?.close();
    receipt.status = "estimate";
    receipt.finishedAt = new Date().toISOString();
    options.out("estimate only: nothing sent");
    return receipt;
  }

  const run = newRun(options, {
    redact,
    timeouts,
    scenario,
    flight,
    access,
    runId,
    merchant,
    buyers,
    receipt,
    engineLogs,
  });
  const identity = new FakeIdentity();

  try {
    await step(run, "start-engine", () => startEngineStep(run, identity));
    const { symbol } = await step(run, "choose-game", () => chooseGameStep(run, identity));
    await step(run, "launch-campaign", () => launchCampaignStep(run, symbol));
    if (run.options.gemini.kind === "live" && run.oddsOptions.liveWindowMs > 0) {
      await step(run, "odds-live", () => oddsLiveStep(run));
    }
    await step(run, "drive-book", () => driveBookStep(run));
    await step(run, "pause-probe", () => pauseProbeStep(run));
    await step(run, "purchases", () => purchasesStep(run));
    await step(run, "hedging", () => hedgingStep(run));
    await step(run, "odds-driven", () => oddsDrivenStep(run));
    await step(run, "close-sales", () => closeSalesStep(run));
    await step(run, "settle", () => settleStep(run));
    await step(run, "reset", async () => {
      const answer = await api.demoReset();
      demoAnswer(run, "POST /api/admin/demo/reset", answer);
      run.resetDone = true;
    });
    await step(run, "stop-engine", () => stopEngine(run));
  } catch (error: unknown) {
    const failedStep = error instanceof RehearsalStepError ? error.step : "start-engine";
    const reason = error instanceof RehearsalStepError ? error.message : errorMessage(error);
    receipt.failure = { step: failedStep, reason: redact(reason) };
    options.out(`FAILED at ${failedStep}: ${reason}`);
  }

  await finish(run);
  return receipt;
}

/** After the run or the recovery: the demo overrides reset and the engine stopped, whatever failed. */
async function resetAndStop(run: Run, leftBehind: string[]): Promise<void> {
  if (run.demoOverridesSet && !run.resetDone && run.db !== null) {
    try {
      const answer = await read(run, "the demo reset", () => api.demoReset(), undefined);
      demoAnswer(run, "POST /api/admin/demo/reset", answer);
      run.resetDone = true;
    } catch (error: unknown) {
      leftBehind.push(`demo overrides could not be reset: ${run.redact(errorMessage(error))}`);
    }
  }
  if (run.engine !== null) {
    try {
      await stopEngine(run);
    } catch (error: unknown) {
      leftBehind.push(`the engine did not stop in time: ${run.redact(errorMessage(error))}`);
    }
  }
}

/**
 * The sweep step, whatever failed before. What it left in the wallets is judged afterwards, from
 * the balances read after it (`walletsLeftBehind`), not from its rows alone.
 */
async function sweepAll(
  run: Run,
  leftBehind: string[],
): Promise<{ step: RehearsalStep; reason: string } | null> {
  let failure: { step: RehearsalStep; reason: string } | null = null;
  try {
    // Even after Ctrl-C: funds are never left in the demo wallets.
    await step(run, "sweep", () => sweepStep(run), { ignoreAbort: true });
  } catch (error: unknown) {
    const reason = error instanceof RehearsalStepError ? error.message : errorMessage(error);
    leftBehind.push(`sweep failed: ${run.redact(reason)}`);
    failure = { step: "sweep", reason: run.redact(reason) };
  }
  return failure;
}

/** Releases what the run held in this process: routes' dependencies, Gemini, database, limiter. */
async function release(run: Run): Promise<void> {
  setServerDepsForTesting(undefined);
  run.gemini?.close();
  run.gemini = null;
  if (run.db !== null) {
    await run.db.end({ timeout: 5 }).catch(() => undefined);
    run.db = null;
  }
  // Waiting requests are released and no timer keeps the process alive.
  run.limiter?.close();
}

/** Whatever happened: stop everything, sweep, read the chain back, check, write the receipt. */
async function finish(run: Run): Promise<void> {
  const receipt = run.receipt;
  const out = run.options.out;
  await run.sampler?.stop().catch(() => undefined);
  run.sampler = null;
  const escrow = getAddress(run.options.escrowAddress);

  // A failure with the engine still running: bring the campaign to a release before anything is
  // reset or stopped (the recovery needs the driven book and the engine).
  if (receipt.failure !== null && run.engine !== null && run.campaign !== null) {
    const campaign = run.campaign;
    try {
      const onchain = await read(
        run,
        "the campaign on-chain",
        () => readCampaign(run.client, escrow, campaign.onchainId),
        undefined,
      );
      if (!onchain.released) {
        run.recovering = true;
        await step(run, "recover", () => recoverStep(run), { ignoreAbort: true });
      }
    } catch (error: unknown) {
      const reason = error instanceof RehearsalStepError ? error.message : errorMessage(error);
      receipt.leftBehind.push(`the recovery of the campaign failed: ${run.redact(reason)}`);
    } finally {
      run.recovering = false;
    }
  }

  await resetAndStop(run, receipt.leftBehind);

  if (receipt.balances.before.length > 0) {
    receipt.balances.afterSettlement =
      (await balancesOrNote(run, "the balances after settlement")) ?? [];
  }

  // The sweep is attempted whatever failed, unless the engine never ran.
  if (run.db !== null) {
    const failure = await sweepAll(run, receipt.leftBehind);
    receipt.failure ??= failure;
    const afterSweep = await balancesOrNote(run, "the balances after the sweep");
    receipt.balances.afterSweep = afterSweep ?? [];
    receipt.leftBehind.push(
      ...walletsLeftBehind(receipt.sweep, afterSweep, [run.merchant, ...run.buyers]),
    );
  }

  // The chain read back: each read on its own, so that one that fails does not drop the others.
  const campaign = run.campaign;
  let events: CampaignEvents | null = null;
  let onchain: OnchainCampaignState | null = null;
  if (campaign !== null) {
    const logs = logsOf(run);
    events = await readOrNote(run, "the campaign's events", async () => {
      await logs.catchUp();
      return logs.events();
    });
    onchain = await readOrNote(run, "the campaign on-chain", () =>
      readCampaign(run.client, escrow, campaign.onchainId),
    );
  }
  const ownTickets = new Set((events?.purchased ?? []).map((ticket) => ticket.ticketId.toString()));
  const collected = await collectTransactions(run, ownTickets);
  receipt.transactions = [...collected.records, ...(await sweepTransactions(run))];
  receipt.gasWei = receipt.transactions.reduce((total, tx) => total + (tx.feeWei ?? 0n), 0n);
  if (campaign !== null) {
    if (events !== null) {
      receipt.timings.refunds = await refundTiming(run, events, collected.rows, collected.records);
    }
    if (onchain !== null) {
      receipt.stranded = !onchain.released;
      if (!onchain.released) {
        receipt.leftBehind.push(
          `campaign ${campaign.onchainId.toString()} is not settled: the escrow still holds its budget (${(onchain.hedgeBudget - onchain.hedgeSpent).toString()} micro-USDC unspent) and locked refunds (${onchain.lockedRefunds.toString()} micro-USDC) until it is`,
        );
      }
    } else {
      // Unknown is treated as stranded: the database that knows the campaign is kept.
      receipt.stranded = true;
      receipt.leftBehind.push(
        `campaign ${campaign.onchainId.toString()} could not be read on-chain: the escrow may still hold its funds`,
      );
    }
    receipt.hedging = events === null ? null : await hedgingRecord(run, events, onchain);
  }

  receipt.pauseProbe = run.pauseProbe;
  receipt.odds = oddsOf(run);
  receipt.timings.callToTicket = stats(
    receipt.purchases.flatMap((purchase) =>
      purchase.callToTicketMs === null ? [] : [purchase.callToTicketMs],
    ),
  );
  receipt.timings.callToDashboard = stats(
    receipt.purchases.flatMap((purchase) =>
      purchase.callToDashboardMs === null ? [] : [purchase.callToDashboardMs],
    ),
  );

  const before = receipt.balances.before;
  const afterSweep = receipt.balances.afterSweep;
  if (before.length > 0 && afterSweep.length > 0) {
    const roleMoney = (rows: readonly BalanceRow[]): bigint =>
      rows
        .filter(
          (row) => row.address === run.treasury || row.address === run.accounts.oracle.address,
        )
        .reduce((total, row) => total + row.moneyWei, 0n);
    receipt.netCostWei = roleMoney(before) - roleMoney(afterSweep);
  }

  if (
    receipt.failure === null &&
    events !== null &&
    onchain !== null &&
    receipt.balances.afterSettlement.length > 0 &&
    run.stripe !== null &&
    run.budgetPi !== null
  ) {
    const money = moneyPartiesOf(
      receipt.balances.before,
      receipt.balances.afterSettlement,
      run.moneyMode,
      collected.gasBySigner,
    );
    run.unread.push(...money.unread.map(run.redact));
    receipt.invariants = checkInvariants({
      scenario: run.scenario,
      outcome: run.scenario.outcome,
      pauseThresholdBps: run.pauseThresholdBps,
      drivenAsksWhileOpen: run.drivenAsksWhileOpen,
      pauseProbe: run.pauseProbe,
      events,
      onchain,
      escrow,
      treasury: run.treasury,
      merchant: run.merchant.address,
      parties: money.parties,
      deskSamples: run.deskSamples,
      demoFlags: run.demoFlags,
      stripe: {
        budgetPi: run.budgetPi,
        intentIds: [...run.stripe.intents.keys()],
        callIds: run.stripe.calls.map((call) => call.id),
      },
      odds: receipt.odds ?? null,
    });
    for (const invariant of receipt.invariants) {
      invariant.details = run.redact(invariant.details);
      out(`${verdictOf(invariant)} ${invariant.name}: ${invariant.details}`);
    }
  }
  receipt.unread = [...run.unread];
  for (const line of receipt.unread) out(`could not be read: ${line}`);
  // A pass is a proof: every invariant held and nothing it rests on went unread.
  receipt.status =
    receipt.failure === null &&
    receipt.unread.length === 0 &&
    receipt.invariants.length > 0 &&
    receipt.invariants.every((item) => item.passed)
      ? "passed"
      : "failed";

  await release(run);
  receipt.rpc = run.meter.summary(receipt.steps, run.limiter?.stats ?? null);
  out(`node: ${describeRpc(receipt.rpc)}`);
  receipt.finishedAt = new Date().toISOString();

  if (run.options.receiptDir !== undefined) {
    const secrets = runSecrets(
      run.options,
      [run.merchant, ...run.buyers].map((wallet) => wallet.email),
    );
    try {
      receipt.files = await writeReceipt(receipt, run.options.receiptDir, secrets);
      out(`receipt written: ${receipt.files.json} and ${receipt.files.markdown}`);
    } catch (error: unknown) {
      out(`the receipt could not be written: ${run.redact(errorMessage(error))}`);
    }
  }
  out(`rehearsal ${receipt.status.toUpperCase()}`);
}

// ---------------------------------------------------------------------------------------------
// Recovery of a campaign a run left behind (`--recover`)
// ---------------------------------------------------------------------------------------------

/**
 * Finishes the campaign of a FAILED run from its receipt and the database it kept, with the same
 * steps as the run's own recovery, then sweeps every wallet of the run. Throws
 * `RehearsalRefusedError` before sending anything when the receipt, the database, the chain and
 * the keys do not speak of the same campaign, or the balances do not cover what is left to send.
 * Otherwise returns the recovery's receipt (written next to the run's, which is never
 * rewritten): `recovered` only when the campaign is released and nothing is left behind.
 */
export async function recoverRehearsal(options: RecoveryOptions): Promise<RecoveryReceipt> {
  if (running)
    throw new RehearsalRefusedError(["another rehearsal is already running in this process"]);
  running = true;
  try {
    return await recover(options);
  } finally {
    running = false;
  }
}

/** The refusals of a recovery that need neither the node nor the database. */
function refuseRecoveryEarly(input: RecoveryOptions, facts: RunReceiptFacts): string[] {
  const reasons = refuseChainAndKeys(input);
  if (facts.chainId !== input.chainId) {
    reasons.push(
      `the receipt is of a run on chain ${facts.chainId.toString()}, the command is for chain ${input.chainId.toString()}`,
    );
  }
  if (facts.escrow.address !== getAddress(input.escrowAddress)) {
    reasons.push(
      `the receipt's escrow is ${facts.escrow.address}, the command's is ${getAddress(input.escrowAddress)} (--escrow)`,
    );
  }
  if (validKey(input.secrets.demoSeed)) {
    const derived = walletsOf(input.secrets.demoSeed, facts.runId, facts.roles.buyers.length);
    if (derived.merchant.address !== facts.roles.merchant) {
      reasons.push(
        `the demo wallet seed given derives the merchant wallet ${derived.merchant.address} for run ${facts.runId}, the receipt's is ${facts.roles.merchant}: another seed`,
      );
    } else {
      facts.roles.buyers.forEach((buyer, index) => {
        const address = derived.buyers[index]?.address;
        if (address !== buyer.address) {
          reasons.push(
            `the seed derives ${String(address)} for buyer ${buyer.number.toString()}, the receipt names ${buyer.address}`,
          );
        }
      });
    }
  }
  return reasons;
}

/** Sentences of `RecoveryOptions` checks shared with a run: chain id and keys. */
function refuseChainAndKeys(
  options: Pick<RehearsalOptions, "chainId" | "local" | "secrets">,
): string[] {
  const reasons: string[] = [];
  const { chainId } = options;
  if (chainId === ARC_TESTNET_CHAIN_ID && options.local) {
    reasons.push(
      `chain id ${chainId.toString()} is Arc testnet: --local cannot be used with it (start a local chain with another id, e.g. 31337)`,
    );
  } else if (chainId !== ARC_TESTNET_CHAIN_ID && chainId !== LOCAL_CHAIN_ID && !options.local) {
    reasons.push(
      `chain id ${chainId.toString()} is neither Arc testnet (${ARC_TESTNET_CHAIN_ID.toString()}) nor a local chain (${LOCAL_CHAIN_ID.toString()}, or another id with --local)`,
    );
  }
  const { relayerKey, oracleKey, demoSeed } = options.secrets;
  if (!validKey(relayerKey)) reasons.push("the relayer key is not 0x followed by 64 hex digits");
  if (!validKey(oracleKey)) reasons.push("the oracle key is not 0x followed by 64 hex digits");
  if (!validKey(demoSeed)) reasons.push("the demo wallet seed is not 0x followed by 64 hex digits");
  if (validKey(relayerKey) && relayerKey.toLowerCase() === oracleKey.toLowerCase()) {
    reasons.push("the relayer and the oracle must be two different keys");
  }
  return reasons;
}

/** The campaign's state now, from the escrow, its events (read up to the head) and the head's time. */
async function readState(run: Run): Promise<CampaignStateRecord> {
  const campaign = run.campaign;
  if (campaign === null) throw new Error("no campaign");
  const logs = logsOf(run);
  const head = await logs.catchUp();
  const [onchain, block] = await Promise.all([
    readCampaign(run.client, getAddress(run.options.escrowAddress), campaign.onchainId),
    run.client.getBlock({ blockNumber: head }),
  ]);
  return campaignState(onchain, logs.events(), head, block.timestamp);
}

async function recover(input: RecoveryOptions): Promise<RecoveryReceipt> {
  const startedAt = new Date().toISOString();
  let facts: RunReceiptFacts;
  try {
    facts = readRunReceipt(input.receiptPath);
  } catch (error: unknown) {
    if (error instanceof RecoveryReceiptError) throw new RehearsalRefusedError(error.reasons);
    throw error;
  }
  const early = refuseRecoveryEarly(input, facts);
  if (facts.gemini === "live" && input.gemini.kind !== "live") {
    early.push("the run read live Gemini: recover it with --gemini live");
  }
  const { merchant, buyers } = walletsOf(
    input.secrets.demoSeed,
    facts.runId,
    facts.roles.buyers.length,
  );
  const secrets = runSecrets(
    input,
    [merchant, ...buyers].map((wallet) => wallet.email),
  );
  const redact = (text: string): string => redactText(text, secrets);
  if (early.length > 0) throw new RehearsalRefusedError(early.map(redact));

  const timeouts: RehearsalTimeouts = { ...DEFAULT_TIMEOUTS, ...input.timeouts };
  const options: RehearsalOptions = {
    databaseUrl: input.databaseUrl,
    rpcUrl: input.rpcUrl,
    ...(input.rpcFallbackUrl === undefined ? {} : { rpcFallbackUrl: input.rpcFallbackUrl }),
    chainId: input.chainId,
    local: input.local,
    escrowAddress: getAddress(input.escrowAddress),
    escrowDeployBlock: input.escrowDeployBlock,
    ...(input.rpcLimits === undefined ? {} : { rpcLimits: input.rpcLimits }),
    secrets: input.secrets,
    scenario: facts.scenario,
    gemini: facts.gemini === "simulated" ? { kind: "simulated" } : input.gemini,
    estimateOnly: input.estimateOnly,
    ...(input.engineLogFile === undefined ? {} : { engineLogFile: input.engineLogFile }),
    out: (line) => input.out(redact(line)),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.onStep === undefined ? {} : { onStep: input.onStep }),
    ...(input.nodeFaults === undefined ? {} : { nodeFaults: input.nodeFaults }),
    ...(input.readRetry === undefined ? {} : { readRetry: input.readRetry }),
  };
  const out = options.out;
  out(
    `recovering campaign ${facts.campaign.id} (on-chain id ${facts.campaign.onchainId.toString()}) of run ${facts.runId} from ${basename(facts.file)}`,
  );

  const engineLogs: EngineLogEntry[] = [];
  const access: NodeAccess = {
    meter: new RpcMeter(),
    current: { step: "preflight" },
    logger: engineLogger(engineLogs, options.engineLogFile, redact),
    retry: retryPolicy(options.readRetry),
    signal: options.signal,
  };
  let flight: Preflight;
  try {
    flight = await connect(options, access);
  } catch (error: unknown) {
    if (error instanceof RehearsalRefusedError) {
      throw new RehearsalRefusedError(error.reasons.map(redact));
    }
    throw new RehearsalRefusedError([
      `the chain could not be read before the recovery: ${redact(errorMessage(error))}`,
    ]);
  }

  // The run's receipt, as the working record of the shared steps.
  const work = emptyReceipt(options, facts.scenario, startedAt);
  work.runId = facts.runId;
  work.escrow.runStartBlock = facts.escrow.runStartBlock;
  work.roles.treasury = flight.treasury;
  work.roles.merchant = merchant.address;
  work.roles.buyers = facts.roles.buyers;
  work.chain.moneyMode = flight.moneyMode;
  work.chain.token = flight.token;
  work.campaign = { ...facts.campaign };
  const run = newRun(options, {
    redact,
    timeouts,
    scenario: facts.scenario,
    flight,
    access,
    runId: facts.runId,
    merchant,
    buyers,
    receipt: work,
    engineLogs,
  });
  run.campaign = { ...facts.campaign, symbol: facts.instrument };
  run.quiet = facts.driven;
  const receipt: RecoveryReceipt = {
    version: 2,
    kind: "recovery",
    recovers: {
      file: basename(facts.file),
      runId: facts.runId,
      status: facts.status,
      failure: facts.failure === null ? null : { ...facts.failure },
      startedAt: facts.startedAt,
    },
    status: "failed",
    failure: null,
    startedAt,
    finishedAt: startedAt,
    chain: work.chain,
    escrow: work.escrow,
    roles: work.roles,
    campaign: { ...facts.campaign, instrument: facts.instrument },
    gemini: facts.gemini,
    engine: work.engine,
    outcome: null,
    actions: [],
    stateBefore: null,
    stateAfter: null,
    estimate: null,
    steps: work.steps,
    transactions: [],
    balances: { before: [], after: [] },
    sweep: [],
    leftBehind: [],
    unread: [],
    rpc: null,
  };

  // The checks that need the database and the chain: nothing is sent before they pass.
  try {
    const db = createDb(options.databaseUrl, { max: 20 });
    run.db = db;
    const reasons: string[] = [];
    const rows = await read(
      run,
      "the campaign in the database",
      () =>
        db<{ onchain_id: string | null; instrument: string; wallet: string | null }[]>`
        select c.onchain_id::text as onchain_id, c.instrument, u.wallet
        from campaigns c
        join merchants m on m.id = c.merchant_id
        join users u on u.id = m.user_id
        where c.id = ${facts.campaign.id}
      `,
    ).catch((error: unknown) => {
      throw new RehearsalRefusedError([
        `the database cannot be read: ${redact(describeFailure(error))}`,
      ]);
    });
    const row = rows[0];
    if (row === undefined) {
      reasons.push(
        `the database does not know campaign ${facts.campaign.id}: give the database the run kept (--db-url)`,
      );
    } else {
      if (row.onchain_id !== facts.campaign.onchainId.toString()) {
        reasons.push(
          `the database's campaign ${facts.campaign.id} has on-chain id ${String(row.onchain_id)}, the receipt's has ${facts.campaign.onchainId.toString()}`,
        );
      }
      if (row.instrument !== facts.instrument) {
        reasons.push(
          `the database's campaign is on ${row.instrument}, the receipt's on ${facts.instrument}`,
        );
      }
      if (row.wallet !== merchant.address.toLowerCase()) {
        reasons.push(
          `the database's merchant wallet is ${String(row.wallet)}, the receipt's is ${merchant.address}`,
        );
      }
    }
    const escrow = getAddress(options.escrowAddress);
    const onchain = await read(run, "the campaign on-chain", () =>
      readCampaign(run.client, escrow, facts.campaign.onchainId),
    );
    if (onchain.merchant !== merchant.address) {
      reasons.push(
        `the escrow's campaign ${facts.campaign.onchainId.toString()} belongs to ${onchain.merchant}, the receipt's merchant is ${merchant.address}`,
      );
    }
    if (reasons.length > 0) throw new RehearsalRefusedError(reasons.map(redact));

    const state = await read(run, "the campaign's state", () => readState(run));
    receipt.stateBefore = state;
    out(`campaign ${facts.campaign.onchainId.toString()}: ${describeState(state)}`);

    if (!state.released) {
      const decided = (await decidedBeforeEngine(run))?.outcome ?? null;
      const events = run.logs?.events() ?? null;
      const refunded = new Set(events?.refunded.map((refund) => refund.ticketId) ?? []);
      const fees = await read(run, "the node's fees", () => run.client.estimateFeesPerGas());
      const estimate = estimateRecovery({
        state,
        decided,
        refundableSold: (events?.purchased ?? []).reduce((sum, t) => sum + t.refundable, 0n),
        unrefundedTickets: (events?.purchased ?? []).filter((t) => !refunded.has(t.ticketId))
          .length,
        nodeMaxFeePerGasWei: fees.maxFeePerGas,
        moneyMode: run.moneyMode,
      });
      receipt.estimate = estimate;
      out(
        `left to send at worst: relayer ${estimate.relayerGas.toString()} gas, oracle ${estimate.oracleGas.toString()} gas; the treasury pays ${formatWei(estimate.treasuryPays, 6)} USDC (result ${decided === null ? "NO, to be forced" : `${decided.toUpperCase()}, already forced or known`})`,
      );
      const [treasuryMoney, relayerNative, oracleNative, allowance] = await read(
        run,
        "the balances of the treasury, the relayer and the oracle",
        () =>
          Promise.all([
            moneyOf(run.client, run.moneyMode, run.token, run.treasury),
            run.client.getBalance({ address: run.accounts.relayer.address }),
            run.client.getBalance({ address: run.accounts.oracle.address }),
            allowanceOf(run.client, run.token, run.treasury, escrow),
          ]),
      );
      const short: string[] = [];
      if (treasuryMoney < estimate.treasuryNeedsWithMargin) {
        short.push(
          `the treasury holds ${formatWei(treasuryMoney, 18)} USDC, the recovery needs ${formatWei(estimate.treasuryNeedsWithMargin, 18)} with the 20 % margin`,
        );
      }
      if (allowance < estimate.treasuryPays) {
        short.push(
          `the treasury's allowance to the escrow is ${formatWei(allowance, 6)} USDC, the recovery pays ${formatWei(estimate.treasuryPays, 6)}`,
        );
      }
      if (oracleNative < estimate.oracleNeedsWithMarginWei) {
        short.push(
          `the oracle holds ${formatWei(oracleNative, 18)} for gas, what is left needs ${formatWei(estimate.oracleNeedsWithMarginWei, 18)} with the 20 % margin`,
        );
      }
      if (run.moneyMode === "erc20" && relayerNative < estimate.relayerGasNeedsWithMarginWei) {
        short.push(
          `the relayer holds ${formatWei(relayerNative, 18)} for gas, what is left needs ${formatWei(estimate.relayerGasNeedsWithMarginWei, 18)} with the 20 % margin`,
        );
      }
      if (short.length > 0) throw new RehearsalRefusedError(short.map(redact));
    }
  } catch (error: unknown) {
    run.current.step = null;
    await release(run);
    if (error instanceof RehearsalRefusedError) throw error;
    throw new RehearsalRefusedError([
      `the recovery could not read what it needs before sending anything: ${redact(errorMessage(error))}`,
    ]);
  }
  run.current.step = null;

  if (options.estimateOnly) {
    await release(run);
    receipt.status = "estimate";
    receipt.rpc = run.meter.summary(receipt.steps, run.limiter?.stats ?? null);
    receipt.finishedAt = new Date().toISOString();
    out("estimate only: nothing sent");
    return receipt;
  }

  const actions = receipt.actions;
  receipt.balances.before = (await balancesOrNote(run, "the balances before the recovery")) ?? [];
  if (receipt.stateBefore?.released === true) {
    actions.push("the campaign was already released: nothing to finish, only the sweep");
    out("the campaign is already released: only the demo wallets are swept");
  } else {
    // The merchant signs in again as the run's merchant: same Privy id, same e-mail, same wallet.
    const identity = new FakeIdentity();
    const token = `rehearsal-${facts.runId}`;
    identity.addUser(token, `did:privy:rehearsal-${facts.runId}`, {
      email: merchant.email,
      walletAddress: merchant.address.toLowerCase(),
    });
    run.headers = bearer(token);
    try {
      await step(run, "start-engine", () => startEngineStep(run, identity));
      actions.push("engine started on the kept database with the production wiring");
      await run.sampler?.stop();
      run.sampler = null;
      await step(run, "recover", () => recoverStep(run, actions));
      receipt.outcome = work.recovery?.outcome ?? null;
      await step(run, "reset", async () => {
        demoAnswer(run, "POST /api/admin/demo/reset", await api.demoReset());
        run.resetDone = true;
      });
      await step(run, "stop-engine", () => stopEngine(run));
    } catch (error: unknown) {
      const failedStep = error instanceof RehearsalStepError ? error.step : "start-engine";
      const reason = error instanceof RehearsalStepError ? error.message : errorMessage(error);
      receipt.failure = { step: failedStep, reason: redact(reason) };
      receipt.outcome = work.recovery?.outcome ?? null;
      out(`FAILED at ${failedStep}: ${reason}`);
    }
    await run.sampler?.stop().catch(() => undefined);
    run.sampler = null;
    await resetAndStop(run, receipt.leftBehind);
  }

  const sweepFailure = await sweepAll(run, receipt.leftBehind);
  receipt.failure ??= sweepFailure;
  receipt.sweep = work.sweep;
  const swept = work.sweep.filter((row) => row.status === "swept");
  actions.push(
    swept.length === 0
      ? "nothing left in the demo wallets to sweep"
      : `${swept.length.toString()} demo wallet(s) swept back to the treasury`,
  );
  const after = await balancesOrNote(run, "the balances after the recovery");
  receipt.balances.after = after ?? [];
  receipt.leftBehind.push(...walletsLeftBehind(work.sweep, after, [merchant, ...buyers]));
  receipt.stateAfter = await readOrNote(run, "the campaign's state after the recovery", () =>
    readState(run),
  );
  // The result the campaign was settled with, from its event, and where that result came from.
  const settledEvent = run.logs?.events().settled[0] ?? null;
  const settledBefore =
    receipt.stateBefore !== null &&
    (receipt.stateBefore.released ||
      receipt.stateBefore.stage === "settled yes" ||
      receipt.stateBefore.stage === "settled no" ||
      receipt.stateBefore.stage === "void");
  const source: RecoveryResultSource | null = settledBefore
    ? "already settled on-chain"
    : run.resultSource === null || run.resultSource === "forced by the run"
      ? null
      : run.resultSource;
  receipt.result = recoveryResult({
    settled: settledEvent?.outcome ?? null,
    source,
    scenarioOutcome: facts.scenario.outcome,
    runId: facts.runId,
    runForced: facts.runForced,
  });
  if (receipt.result.differs !== null) out(receipt.result.differs);
  if (receipt.stateAfter !== null) {
    out(`campaign ${facts.campaign.onchainId.toString()}: ${describeState(receipt.stateAfter)}`);
    if (!receipt.stateAfter.released) {
      receipt.leftBehind.push(
        `campaign ${facts.campaign.onchainId.toString()} is not released: the escrow still holds ${formatWei(receipt.stateAfter.escrowHolds, 6)} USDC for it`,
      );
    }
  }
  const ownTickets = new Set(
    (run.logs?.events().purchased ?? []).map((ticket) => ticket.ticketId.toString()),
  );
  const collected = await collectTransactions(run, ownTickets);
  receipt.transactions = [...collected.records, ...(await sweepTransactions(run))];
  receipt.leftBehind.push(...work.leftBehind);
  receipt.unread = [...run.unread];
  receipt.status =
    receipt.failure === null &&
    receipt.stateAfter?.released === true &&
    receipt.leftBehind.length === 0 &&
    receipt.unread.length === 0
      ? "recovered"
      : "failed";

  await release(run);
  receipt.rpc = run.meter.summary(receipt.steps, run.limiter?.stats ?? null);
  out(`node: ${describeRpc(receipt.rpc)}`);
  for (const line of receipt.leftBehind) out(`left behind: ${line}`);
  for (const line of receipt.unread) out(`could not be read: ${line}`);
  receipt.finishedAt = new Date().toISOString();
  try {
    receipt.files = await writeRecoveryReceipt(receipt, input.receiptPath, secrets);
    out(`recovery receipt written: ${receipt.files.json} and ${receipt.files.markdown}`);
  } catch (error: unknown) {
    out(`the recovery receipt could not be written: ${redact(errorMessage(error))}`);
  }
  out(`recovery ${receipt.status.toUpperCase()}`);
  return receipt;
}

/** The result already forced or known, read from the database before the engine starts. */
async function decidedBeforeEngine(run: Run): Promise<Decided | null> {
  const campaign = run.campaign;
  const db = run.db;
  if (campaign === null || db === null) return null;
  const [row] = await read(
    run,
    "the campaign's forced or known result",
    () =>
      db<{ status: string; forced: string | null; known: string | null }[]>`
      select c.status,
        (select forced_result from demo_overrides where instrument = c.instrument) as forced,
        (select outcome from instruments where symbol = c.instrument) as known
      from campaigns c where c.id = ${campaign.id}
    `,
  );
  if (row?.status === "settled_yes") return { outcome: "yes", source: "already settled on-chain" };
  if (row?.status === "settled_no") return { outcome: "no", source: "already settled on-chain" };
  return decidedIn(row);
}

/**
 * The parts of an RPC URL that may be an access token, when long enough: its path, each segment
 * of the path, its query, each value of the query, and the password of its user information.
 */
export function rpcSecrets(url: string): string[] {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/+|\/+$/g, "");
    const candidates = [
      path,
      ...path.split("/"),
      parsed.search.replace(/^\?/, ""),
      ...[...parsed.searchParams.values()],
    ].filter((part) => part.length >= 16);
    const password = decodeURIComponent(parsed.password);
    if (password.length >= 8) candidates.push(password);
    return [...new Set(candidates)];
  } catch {
    return [];
  }
}

/** Every secret of a run: keys, seed, the demo wallets' keys and the RPC URLs' access tokens. */
export function runSecrets(
  options: Pick<RehearsalOptions, "secrets" | "rpcUrl" | "rpcFallbackUrl">,
  emails: readonly string[],
): string[] {
  return [
    ...secretsOf(options, emails),
    ...rpcSecrets(options.rpcUrl),
    ...(options.rpcFallbackUrl === undefined ? [] : rpcSecrets(options.rpcFallbackUrl)),
  ];
}

/** Every secret of a run, for checks: the keys, the seed, and each demo wallet's derived key. */
export function secretsOf(
  options: Pick<RehearsalOptions, "secrets">,
  emails: readonly string[],
): string[] {
  return [
    options.secrets.relayerKey,
    options.secrets.oracleKey,
    options.secrets.demoSeed,
    ...emails.map((email) => demoWalletKey(options.secrets.demoSeed, email)),
  ];
}
