import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import pino, { type Logger } from "pino";
import { getAddress, isHex, size, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_EXPLORER_URL,
  type CampaignDetail,
  type DemoResponse,
  type HedgeInstrument,
  type Outcome,
  winzEscrowAbi,
} from "@winz/shared";

import { setServerDepsForTesting } from "@/lib/server/deps";
import { FakeIdentity, TEST_CONFIG } from "@/lib/server/testing/fixtures";

import { startEngine, type Engine } from "../../../engine/src/app";
import { createArcClients } from "../../../engine/src/chain";
import { createDb, type Db } from "../../../engine/src/db";
import {
  DemoIdentityDirectory,
  demoWalletAddress,
  demoWalletKey,
} from "../../../engine/src/identity";
import { sweepDemoWallets } from "../../../engine/src/identity/sweep-demo-wallets";
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
import { SilentTransport, SimulatedGemini, newGame } from "../support/gemini";
import { SimulatedStripe } from "../support/stripe";
import { WaitTimeoutError, within } from "../support/wait";
import {
  allowanceOf,
  campaignEvents,
  moneyOf,
  moneyModeOf,
  readCampaign,
  readEscrowRoles,
  snapshot,
  sweepTokenOnLocalChain,
  type CampaignEvents,
  type OnchainCampaignState,
  type Party,
} from "./chain";
import { describeEstimate, estimateRun, formatWei } from "./estimate";
import { checkInvariants, type DeskSample, type DemoFlag, type MoneyParty } from "./invariants";
import { redactText, stats, writeReceipt } from "./receipt";
import { buyerEmail, buyerOf, merchantEmail, resolveScenario } from "./scenario";
import {
  InjectedFailureError,
  RehearsalAbortedError,
  RehearsalRefusedError,
  RehearsalStepError,
  type BalanceRow,
  type Estimate,
  type HedgingRecord,
  type MoneyMode,
  type PauseProbe,
  type PurchaseRecord,
  type RefundTiming,
  type RehearsalOptions,
  type RehearsalReceipt,
  type RehearsalStep,
  type RehearsalTimeouts,
  type Scenario,
  type StepRecord,
  type TxRecord,
} from "./types";

/**
 * The rehearsal (gate G2, A-07, Q-03, Q-04): the whole loop in demo mode, on a real chain, in
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
  return new Promise((resolvePause, reject) => {
    if (signal?.aborted === true) {
      reject(new RehearsalAbortedError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolvePause();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new RehearsalAbortedError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
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
  client: PublicClient;
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
  /** Wall clock (ISO) and newest chain_txs row before the engine started. */
  txWatermark: Date | null;
  headers: AuthHeaders | null;
  campaign: { id: string; onchainId: bigint; slug: string; symbol: string } | null;
  budgetPi: string | null;
  pauseThresholdBps: number;
  quiet: { bidBps: number; askBps: number; depth: bigint } | null;
  drivenAsksWhileOpen: number[];
  pauseProbe: PauseProbe | null;
  /** The result this run forced through the demo route, if any. */
  forcedOutcome: Outcome | null;
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
  /** Wall clock (ms) at which the rehearsal saw settle, and then the last refund, on-chain. */
  refundWatch: { settleSeenAtMs: number | null; lastRefundSeenAtMs: number | null } | null;
  /** The Hedge desk's row of the instrument once reconciled at close (it may drop it later). */
  deskAtClose: HedgeInstrument | null;
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

async function waitUntil(
  run: Run,
  what: string,
  condition: () => Promise<boolean | { ok: boolean; seen: unknown }>,
  timeoutMs: number,
  intervalMs = 250,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let seen: unknown = undefined;
  for (;;) {
    if (signalOf(run)?.aborted === true) throw new RehearsalAbortedError();
    const result = await condition();
    const ok = typeof result === "boolean" ? result : result.ok;
    if (typeof result !== "boolean") seen = result.seen;
    if (ok) return;
    if (Date.now() >= deadline) {
      throw new WaitTimeoutError(
        `timed out after ${timeoutMs.toString()} ms waiting for ${what}` +
          (seen === undefined ? "" : `; last seen: ${stringify(seen)}`) +
          (run.engineLogs.length === 0
            ? ""
            : `; engine warnings: ${describeEngineWarnings(run.engineLogs)}`),
      );
    }
    await pause(intervalMs, signalOf(run));
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
    run.options.out(`[${name}] ${record.status} in ${record.durationMs.toString()} ms`);
  }
}

// ---------------------------------------------------------------------------------------------
// Preflight: refusals and the estimate (nothing is sent)
// ---------------------------------------------------------------------------------------------

function refuseEarly(options: RehearsalOptions): Scenario {
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
  const local = chainId !== ARC_TESTNET_CHAIN_ID;
  if (local && options.receiptDir !== undefined && isUnder(options.receiptDir, DOCS_DIR)) {
    reasons.push(
      "a receipt of a run on a local chain is never written under docs/: choose another directory",
    );
  }
  const { scenario, problems } = resolveScenario(options.scenario);
  reasons.push(...problems);
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
    version: 1,
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
    hedging: null,
    invariants: [],
    balances: { before: [], afterSettlement: [], afterSweep: [] },
    netCostWei: null,
    gasWei: 0n,
    sweep: [],
    leftBehind: [],
    recovery: null,
    stranded: false,
  };
}

interface Preflight {
  client: PublicClient;
  chain: ReturnType<typeof createArcClients>["chain"];
  accounts: ReturnType<typeof createArcClients>["accounts"];
  moneyMode: MoneyMode;
  token: Address;
  treasury: Address;
  estimate: Estimate;
}

async function preflight(
  options: RehearsalOptions,
  scenario: Scenario,
  receipt: RehearsalReceipt,
  wallets: { merchant: Wallet; buyers: Wallet[] },
): Promise<Preflight> {
  const out = options.out;
  const arc = createArcClients({
    ARC_CHAIN_ID: options.chainId,
    ARC_RPC_URL: options.rpcUrl,
    // As the engine's environment: Arc's public RPC behind the primary one, unless told otherwise.
    ARC_RPC_FALLBACK_URL:
      options.rpcFallbackUrl ??
      (options.chainId === ARC_TESTNET_CHAIN_ID ? ARC_PUBLIC_RPC_URL : options.rpcUrl),
    ARC_RELAYER_PRIVATE_KEY: options.secrets.relayerKey,
    ARC_ORACLE_PRIVATE_KEY: options.secrets.oracleKey,
  });
  const client = arc.publicClient;
  let nodeChainId: number;
  try {
    nodeChainId = await client.getChainId();
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
    roles = await readEscrowRoles(client, escrow);
  } catch (error: unknown) {
    throw new RehearsalRefusedError([
      `the escrow ${escrow} cannot be read: ${errorMessage(error)}`,
    ]);
  }
  const relayer = arc.accounts.relayer.address;
  const oracle = arc.accounts.oracle.address;
  out(`chain ${options.chainId.toString()} at ${hostOf(options.rpcUrl)}, escrow ${escrow}`);
  out(`relayer ${relayer} (escrow's relayer ${roles.relayer})`);
  out(`oracle ${oracle} (escrow's oracle ${roles.oracle})`);
  out(`treasury ${roles.treasury}, token ${roles.token}`);
  out(`merchant (demo wallet) ${wallets.merchant.address}`);
  for (const buyer of wallets.buyers) out(`${buyer.label} (demo wallet) ${buyer.address}`);
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
  receipt.roles.treasury = roles.treasury;
  if (reasons.length > 0) throw new RehearsalRefusedError(reasons);

  const moneyMode = moneyModeOf(options.chainId, roles.token);
  receipt.chain.moneyMode = moneyMode;
  receipt.chain.token = roles.token;
  const fees = await client.estimateFeesPerGas();
  const estimate = estimateRun({ scenario, nodeMaxFeePerGasWei: fees.maxFeePerGas, moneyMode });
  receipt.estimate = estimate;

  const [treasuryMoney, relayerNative, oracleNative, allowance] = await Promise.all([
    moneyOf(client, moneyMode, roles.token, roles.treasury),
    client.getBalance({ address: relayer }),
    client.getBalance({ address: oracle }),
    allowanceOf(client, roles.token, roles.treasury, escrow),
  ]);
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
  return {
    client,
    chain: arc.chain,
    accounts: arc.accounts,
    moneyMode,
    token: roles.token,
    treasury: roles.treasury,
    estimate,
  };
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
  const db = createDb(options.databaseUrl, { max: 20 });
  run.db = db;
  const stripe = new SimulatedStripe();
  run.stripe = stripe;
  routeDeps(run, db, stripe, identity);
  const logger = engineLogger(run.engineLogs, options.engineLogFile, run.redact);
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
    const gemini = new SimulatedGemini(clock, newGame(Date.now(), SIMULATED_LEAD_MS));
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

  // The newest outbox row before this run: every row after it was written by this run.
  const [watermark] = await db<{ at: Date | null }[]>`select max(created_at) as at from chain_txs`;
  run.txWatermark = watermark?.at ?? new Date(0);
  run.receipt.escrow.runStartBlock = await run.client.getBlockNumber();
  run.receipt.balances.before = await snapshot(run.client, run.moneyMode, run.token, parties(run));

  const controller = new AbortController();
  run.engineController = controller;
  run.engine = await startEngine({
    db,
    logger,
    publicClient: run.client,
    accounts: run.accounts,
    chainId: options.chainId,
    escrowAddress: getAddress(options.escrowAddress),
    escrowDeployBlock: options.escrowDeployBlock,
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
  run.guaranteeLossesBefore = BigInt((await api.hedgeDesk()).totals.guaranteeLosses);
  run.sampler = startDeskSampler(run);
  run.options.out(
    `engine started (production intervals), run start block ${String(run.receipt.escrow.runStartBlock)}`,
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
      ? "a listed game starting in 45 minutes or more with a two-outcome moneyline on a contract the hedging holds nothing of"
      : `the simulated game ${simulated.ticker} to be listed with a contract the hedging holds nothing of`,
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
          -- Never an instrument the hedging already holds or owes on: a campaign settled on a
          -- forced demo result leaves its contracts held on the instrument, and the engine then
          -- counts them against a new campaign's exposure, never hedging nor charging its tickets.
          and not exists (
            select 1 from positions p
            where p.instrument = i.symbol and (p.held > 0 or p.exposure > 0 or p.working > 0)
          )
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

async function purchasesStep(run: Run): Promise<void> {
  const campaign = run.campaign;
  const headers = run.headers;
  if (campaign === null || headers === null) throw new Error("no campaign");
  const scenario = run.scenario;
  const samples: { atMs: number; sales: number }[] = [];
  const baseline = (await api.campaign(headers, campaign.id)).sales;
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

  // Sales waiting to be replayed, and the buyers with a sale in flight. Two sales of one buyer
  // are never replayed at once: the engine's first lookup of a new e-mail (resolveUserWallet)
  // fails with IdentityConflictError when two run concurrently, and the sale ends "failed".
  const pending = Array.from({ length: scenario.purchases }, (_, index) => index);
  const busy = new Set<number>();
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
      const at = pending.findIndex((index) => !busy.has(buyerOf(index, scenario.buyers)));
      if (at === -1) {
        await pause(50, run.options.signal);
        continue;
      }
      const [index] = pending.splice(at, 1);
      if (index === undefined) continue;
      const buyer = buyerOf(index, scenario.buyers);
      busy.add(buyer);
      try {
        await one(index);
      } finally {
        busy.delete(buyer);
      }
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

async function chargedTickets(run: Run): Promise<number> {
  const campaign = run.campaign;
  if (campaign === null) return 0;
  const logs = await run.client.getContractEvents({
    address: getAddress(run.options.escrowAddress),
    abi: winzEscrowAbi,
    eventName: "HedgeCharged",
    args: { id: campaign.onchainId },
    fromBlock: run.receipt.escrow.runStartBlock ?? run.options.escrowDeployBlock,
  });
  return new Set(logs.map((log) => log.args.ticketId)).size;
}

/** Moves the driven book onto the engine's resting makers until `tickets` tickets are charged. */
async function hedgingStep(run: Run, tickets: number = run.scenario.purchases): Promise<void> {
  const campaign = run.campaign;
  const quiet = run.quiet;
  if (campaign === null || quiet === null) throw new Error("no campaign");
  const deadline = Date.now() + run.timeouts.hedgingMs;
  for (;;) {
    if (signalOf(run)?.aborted === true) throw new RehearsalAbortedError();
    const charged = await chargedTickets(run);
    if (charged >= tickets) break;
    if (Date.now() > deadline) {
      throw new WaitTimeoutError(
        `timed out after ${run.timeouts.hedgingMs.toString()} ms waiting for ${tickets.toString()} tickets charged on-chain (${charged.toString()} charged)` +
          (run.engineLogs.length === 0
            ? ""
            : `; engine warnings: ${describeEngineWarnings(run.engineLogs)}`),
      );
    }
    const row = await deskRow(campaign.symbol);
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
    500,
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
    500,
  );
}

/** How often the rehearsal reads new blocks for settle and the refunds (the wall-clock measure). */
const REFUND_WATCH_MS = 100;

/**
 * Reads the escrow's logs of each new block, every 100 ms, and notes the wall-clock moment settle
 * and then the last refund of the campaign were first seen (criterion 6). Block timestamps are in
 * whole seconds, and the outbox's mined_at is the block time, so this is the only wall clock there
 * is; it is late by at most the poll interval and one RPC round trip.
 */
function watchRefunds(run: Run, id: bigint, fromBlock: bigint): { stop: () => Promise<void> } {
  const escrow = getAddress(run.options.escrowAddress);
  const tickets = run.scenario.purchases;
  const watch = {
    settleSeenAtMs: null as number | null,
    lastRefundSeenAtMs: null as number | null,
  };
  run.refundWatch = watch;
  let stopped = false;
  let next = fromBlock;
  let refunded = 0;
  const tick = async (): Promise<void> => {
    try {
      // Uncached: the client otherwise answers the same block number for 300 ms.
      const latest = await run.client.getBlockNumber({ cacheTime: 0 });
      if (latest < next) return;
      const range = {
        address: escrow,
        abi: winzEscrowAbi,
        fromBlock: next,
        toBlock: latest,
      } as const;
      const [settled, refunds] = await Promise.all([
        run.client.getContractEvents({ ...range, eventName: "CampaignSettled", args: { id } }),
        run.client.getContractEvents({ ...range, eventName: "TicketRefunded", args: { id } }),
      ]);
      const seenAt = Date.now();
      if (settled.length > 0) watch.settleSeenAtMs ??= seenAt;
      refunded += refunds.length;
      if (refunds.length > 0 && refunded >= tickets) watch.lastRefundSeenAtMs ??= seenAt;
      next = latest + 1n;
    } catch {
      // A failed read is retried on the next tick, from the same block.
    }
  };
  const loop = (async (): Promise<void> => {
    while (!stopped) {
      await tick();
      await new Promise<void>((resolveTick) => setTimeout(resolveTick, REFUND_WATCH_MS));
    }
  })();
  return {
    stop: async () => {
      stopped = true;
      await loop;
      // One last read, so that blocks mined since the previous tick are not missed.
      await tick();
    },
  };
}

async function settleStep(run: Run): Promise<void> {
  const campaign = run.campaign;
  const headers = run.headers;
  if (campaign === null || headers === null) throw new Error("no campaign");
  const outcome = run.scenario.outcome;
  const watcher = watchRefunds(run, campaign.onchainId, await run.client.getBlockNumber());
  await forceResult(run, outcome);
  await waitSettled(run, outcome).finally(() => watcher.stop());
  // Every answer of the public side about the campaign, once settled.
  const page = await api.publicCampaign(campaign.slug);
  flag(run, "GET /api/c/:slug", page.demo);
  for (const token of run.ticketTokens) {
    const ticket = await api.ticket(token);
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
    500,
  );
}

/**
 * After a failure, while the engine still runs: brings the campaign to a release, so that the
 * escrow holds nothing for it when the run ends. Hedges what was sold (settle needs a zero hedge
 * reservation), closes sales through the merchant's route if they are still open, forces NO
 * through the demo route (no refund to send; the merchant's wallet receives what is left and is
 * swept), unless this run already forced a result, and waits for the release. Ctrl-C does not
 * interrupt it; every wait still has its timeout.
 */
async function recoverStep(run: Run): Promise<void> {
  const campaign = run.campaign;
  const headers = run.headers;
  if (campaign === null || headers === null) throw new Error("no campaign");
  const escrow = getAddress(run.options.escrowAddress);
  const outcome: Outcome = run.forcedOutcome ?? "no";
  const record = { outcome, released: false, reason: null as string | null };
  run.receipt.recovery = record;
  try {
    const detail = await api.campaign(headers, campaign.id);
    const open = detail.status === "live" || detail.status === "paused";
    if (open || detail.status === "sales_closed") {
      const from = run.receipt.escrow.runStartBlock ?? run.options.escrowDeployBlock;
      const sold = (await campaignEvents(run.client, escrow, campaign.onchainId, from)).purchased
        .length;
      if (sold > 0 && run.quiet !== null && (await chargedTickets(run)) < sold) {
        await hedgingStep(run, sold);
      }
      if (open) await api.close(headers, campaign.id);
      await waitClosed(run);
    }
    if (run.forcedOutcome === null) await forceResult(run, outcome);
    await waitSettled(run, outcome);
    record.released = (await readCampaign(run.client, escrow, campaign.onchainId)).released;
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

async function sweepStep(run: Run): Promise<void> {
  const wallets = [run.merchant, ...run.buyers];
  const out = run.options.out;
  if (run.moneyMode === "native-usdc") {
    const results = await sweepDemoWallets({
      seed: run.options.secrets.demoSeed,
      emails: wallets.map((wallet) => wallet.email),
      rpcUrl: run.options.rpcUrl,
      destination: run.treasury,
      out,
    });
    run.receipt.sweep = results.map((result) => ({
      wallet:
        wallets.find((wallet) => wallet.address === getAddress(result.address))?.label ??
        "demo wallet",
      address: getAddress(result.address),
      status: result.status,
      sentWei: result.sentWei,
      gasWei: result.gasWei,
      txHash: result.txHash,
    }));
    return;
  }
  if (!run.receipt.chain.local)
    throw new Error("a token sweep with gas top-ups is for local chains only");
  run.receipt.sweep = await sweepTokenOnLocalChain({
    client: run.client,
    chain: run.chain,
    rpcUrl: run.options.rpcUrl,
    token: run.token,
    seed: run.options.secrets.demoSeed,
    wallets: wallets.map((wallet) => ({ label: wallet.label, email: wallet.email })),
    destination: run.treasury,
    out,
  });
}

// ---------------------------------------------------------------------------------------------
// What is read back once the run is over
// ---------------------------------------------------------------------------------------------

interface OutboxRow {
  id: string;
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

async function collectTransactions(
  run: Run,
  ownTickets: ReadonlySet<string>,
): Promise<{ rows: OutboxRow[]; records: TxRecord[]; gasBySigner: Map<Address, bigint> }> {
  const db = run.db;
  const records: TxRecord[] = [];
  const gasBySigner = new Map<Address, bigint>();
  if (db === null || run.txWatermark === null) return { rows: [], records, gasBySigner };
  const rows = await db<OutboxRow[]>`
    select id, kind, signer, signer_address, status, tx_hash, payload, sent_at, mined_at
    from chain_txs
    where created_at > ${run.txWatermark}
    order by created_at, id
  `;
  const explorer = run.receipt.chain.explorer;
  for (const row of rows) {
    if (row.tx_hash === null) continue;
    const hash = row.tx_hash as Hex;
    let block: bigint | null = null;
    let gasUsed: bigint | null = null;
    let feeWei: bigint | null = null;
    try {
      const receipt = await run.client.getTransactionReceipt({ hash });
      block = receipt.blockNumber;
      gasUsed = receipt.gasUsed;
      feeWei = receipt.gasUsed * receipt.effectiveGasPrice;
      const from = getAddress(receipt.from);
      gasBySigner.set(from, (gasBySigner.get(from) ?? 0n) + feeWei);
    } catch {
      // Not mined (or not found): the row is listed with its status and no receipt.
    }
    records.push({
      kind: row.kind,
      signer: row.signer,
      hash,
      status: row.status,
      block,
      gasUsed,
      feeWei,
      ownCampaign: ownsRow(run, row.payload, ownTickets),
      explorerUrl: explorer === null ? null : `${explorer}/tx/${hash}`,
    });
  }
  return { rows, records, gasBySigner };
}

async function refundTiming(
  run: Run,
  events: CampaignEvents,
  rows: readonly OutboxRow[],
): Promise<RefundTiming | null> {
  const settled = events.settled[0];
  if (settled === undefined || events.refunded.length === 0) return null;
  const lastBlock = events.refunded.reduce(
    (max, refund) => (refund.block > max ? refund.block : max),
    0n,
  );
  const [settleBlock, refundBlock] = await Promise.all([
    run.client.getBlock({ blockNumber: settled.block }),
    run.client.getBlock({ blockNumber: lastBlock }),
  ]);
  const ownTickets = new Set(events.purchased.map((ticket) => ticket.ticketId.toString()));
  const own = rows.filter((row) => ownsRow(run, row.payload, ownTickets));
  const batches = own.filter((row) => row.kind === "refundBatch" && row.tx_hash !== null);
  const batchRecords: RefundTiming["batches"] = [];
  for (const row of batches) {
    const hash = row.tx_hash as Hex;
    const gasUsed = await run.client
      .getTransactionReceipt({ hash })
      .then((receipt) => receipt.gasUsed)
      .catch(() => null);
    const ticketIds = row.payload.ticketIds;
    batchRecords.push({
      hash,
      tickets: Array.isArray(ticketIds) ? ticketIds.length : 0,
      gasUsed,
      sentAt: row.sent_at?.toISOString() ?? null,
      blockTime: row.mined_at?.toISOString() ?? null,
    });
  }
  return {
    settleBlock: settled.block,
    lastRefundBlock: lastBlock,
    blocks: lastBlock - settled.block,
    chainSeconds: refundBlock.timestamp - settleBlock.timestamp,
    wallMs:
      run.refundWatch?.settleSeenAtMs == null || run.refundWatch.lastRefundSeenAtMs === null
        ? null
        : run.refundWatch.lastRefundSeenAtMs - run.refundWatch.settleSeenAtMs,
    batches: batchRecords,
  };
}

async function hedgingRecord(
  run: Run,
  events: CampaignEvents,
  onchain: OnchainCampaignState | null,
): Promise<HedgingRecord | null> {
  const campaign = run.campaign;
  if (campaign === null) return null;
  let latest: HedgeInstrument | null = null;
  let losses: bigint | null = null;
  try {
    const desk = await api.hedgeDesk();
    latest = desk.instruments.find((instrument) => instrument.symbol === campaign.symbol) ?? null;
    losses = BigInt(desk.totals.guaranteeLosses);
  } catch {
    // The desk cannot be read: the row kept at close is used alone.
  }
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

function moneyParties(run: Run, gasBySigner: ReadonlyMap<Address, bigint>): MoneyParty[] {
  const before = run.receipt.balances.before;
  const after = run.receipt.balances.afterSettlement;
  return before.map((row: BalanceRow) => {
    const later = after.find((item) => item.address === row.address);
    return {
      role: row.role,
      address: row.address,
      beforeWei: row.moneyWei,
      afterWei: later?.moneyWei ?? row.moneyWei,
      gasWei: run.moneyMode === "native-usdc" ? (gasBySigner.get(row.address) ?? 0n) : 0n,
    };
  });
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

async function rehearse(input: RehearsalOptions): Promise<RehearsalReceipt> {
  const startedAt = new Date().toISOString();
  const scenario = refuseEarly(input);
  const timeouts: RehearsalTimeouts = { ...DEFAULT_TIMEOUTS, ...input.timeouts };
  const runId = randomBytes(6).toString("hex");
  const seed = input.secrets.demoSeed;
  const merchant: Wallet = {
    label: "merchant",
    email: merchantEmail(runId),
    address: getAddress(demoWalletAddress(seed, merchantEmail(runId))),
  };
  const buyers: Wallet[] = Array.from({ length: scenario.buyers }, (_, index) => {
    const email = buyerEmail(runId, index + 1);
    return {
      label: `buyer ${(index + 1).toString()}`,
      email,
      address: getAddress(demoWalletAddress(seed, email)),
    };
  });
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

  let flight: Preflight;
  try {
    flight = await preflight(options, scenario, receipt, { merchant, buyers });
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
  if (options.estimateOnly) {
    receipt.status = "estimate";
    receipt.finishedAt = new Date().toISOString();
    options.out("estimate only: nothing sent");
    return receipt;
  }

  const run: Run = {
    options,
    redact,
    recovering: false,
    timeouts,
    scenario,
    client: flight.client,
    chain: flight.chain,
    accounts: flight.accounts,
    moneyMode: flight.moneyMode,
    token: flight.token,
    treasury: flight.treasury,
    runId,
    merchant,
    buyers,
    receipt,
    engineLogs: [],
    db: null,
    stripe: null,
    gemini: null,
    engine: null,
    engineController: null,
    txWatermark: null,
    headers: null,
    campaign: null,
    budgetPi: null,
    pauseThresholdBps: 0,
    quiet: null,
    drivenAsksWhileOpen: [],
    pauseProbe: null,
    forcedOutcome: null,
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
    refundWatch: null,
    deskAtClose: null,
  };
  const identity = new FakeIdentity();

  try {
    await step(run, "start-engine", () => startEngineStep(run, identity));
    const { symbol } = await step(run, "choose-game", () => chooseGameStep(run, identity));
    await step(run, "launch-campaign", () => launchCampaignStep(run, symbol));
    await step(run, "drive-book", () => driveBookStep(run));
    await step(run, "pause-probe", () => pauseProbeStep(run));
    await step(run, "purchases", () => purchasesStep(run));
    await step(run, "hedging", () => hedgingStep(run));
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

/** Whatever happened: stop everything, sweep, read the chain back, check, write the receipt. */
async function finish(run: Run): Promise<void> {
  const receipt = run.receipt;
  const out = run.options.out;
  await run.sampler?.stop().catch(() => undefined);
  run.sampler = null;

  // A failure with the engine still running: bring the campaign to a release before anything is
  // reset or stopped (the recovery needs the driven book and the engine).
  if (receipt.failure !== null && run.engine !== null && run.campaign !== null) {
    try {
      const onchain = await readCampaign(
        run.client,
        getAddress(run.options.escrowAddress),
        run.campaign.onchainId,
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

  if (run.demoOverridesSet && !run.resetDone && run.db !== null) {
    try {
      demoAnswer(run, "POST /api/admin/demo/reset", await api.demoReset());
      run.resetDone = true;
    } catch (error: unknown) {
      receipt.leftBehind.push(
        `demo overrides could not be reset: ${run.redact(errorMessage(error))}`,
      );
    }
  }
  if (run.engine !== null) {
    try {
      await stopEngine(run);
    } catch (error: unknown) {
      receipt.leftBehind.push(
        `the engine did not stop in time: ${run.redact(errorMessage(error))}`,
      );
    }
  }

  const escrow = getAddress(run.options.escrowAddress);
  try {
    if (receipt.balances.before.length > 0) {
      receipt.balances.afterSettlement = await snapshot(
        run.client,
        run.moneyMode,
        run.token,
        parties(run),
      );
    }
  } catch (error: unknown) {
    receipt.leftBehind.push(
      `balances after settlement could not be read: ${run.redact(errorMessage(error))}`,
    );
  }

  // The sweep is attempted whatever failed, unless the engine never ran.
  if (run.db !== null) {
    try {
      // Even after Ctrl-C: funds are never left in the demo wallets.
      await step(run, "sweep", () => sweepStep(run), { ignoreAbort: true });
    } catch (error: unknown) {
      const reason = error instanceof RehearsalStepError ? error.message : errorMessage(error);
      receipt.leftBehind.push(`sweep failed: ${run.redact(reason)}`);
      receipt.failure ??= { step: "sweep", reason: run.redact(reason) };
    }
    for (const row of receipt.sweep) {
      if (row.status === "failed")
        receipt.leftBehind.push(`${row.wallet} ${row.address} was not swept`);
    }
    try {
      receipt.balances.afterSweep = await snapshot(
        run.client,
        run.moneyMode,
        run.token,
        parties(run),
      );
    } catch (error: unknown) {
      receipt.leftBehind.push(
        `balances after the sweep could not be read: ${run.redact(errorMessage(error))}`,
      );
    }
  }

  let events: CampaignEvents | null = null;
  let onchain: OnchainCampaignState | null = null;
  let collected: Awaited<ReturnType<typeof collectTransactions>> = {
    rows: [],
    records: [],
    gasBySigner: new Map(),
  };
  try {
    const campaign = run.campaign;
    if (campaign !== null) {
      const from = receipt.escrow.runStartBlock ?? run.options.escrowDeployBlock;
      events = await campaignEvents(run.client, escrow, campaign.onchainId, from);
      onchain = await readCampaign(run.client, escrow, campaign.onchainId);
    }
    const ownTickets = new Set(
      (events?.purchased ?? []).map((ticket) => ticket.ticketId.toString()),
    );
    collected = await collectTransactions(run, ownTickets);
    receipt.transactions = [
      ...collected.records,
      ...receipt.sweep
        .filter((row) => row.txHash !== null)
        .map((row): TxRecord => ({
          kind: "sweep",
          signer: row.wallet,
          hash: row.txHash as Hex,
          status: row.status,
          block: null,
          gasUsed: null,
          feeWei: row.gasWei,
          ownCampaign: true,
          explorerUrl:
            receipt.chain.explorer === null
              ? null
              : `${receipt.chain.explorer}/tx/${String(row.txHash)}`,
        })),
    ];
    for (const tx of receipt.transactions) {
      if (tx.kind === "sweep" && tx.hash !== "0x") {
        const mined = await run.client.getTransactionReceipt({ hash: tx.hash }).catch(() => null);
        if (mined !== null) {
          tx.block = mined.blockNumber;
          tx.gasUsed = mined.gasUsed;
        }
      }
    }
    receipt.gasWei = receipt.transactions.reduce((total, tx) => total + (tx.feeWei ?? 0n), 0n);
    if (campaign !== null && events !== null && onchain !== null) {
      receipt.timings.refunds = await refundTiming(run, events, collected.rows);
      receipt.stranded = !onchain.released;
      if (!onchain.released) {
        receipt.leftBehind.push(
          `campaign ${campaign.onchainId.toString()} is not settled: the escrow still holds its budget (${(onchain.hedgeBudget - onchain.hedgeSpent).toString()} micro-USDC unspent) and locked refunds (${onchain.lockedRefunds.toString()} micro-USDC) until it is`,
        );
      }
    }
    receipt.hedging = events === null ? null : await hedgingRecord(run, events, onchain);
  } catch (error: unknown) {
    receipt.leftBehind.push(`the chain could not be read back: ${run.redact(errorMessage(error))}`);
  }

  receipt.pauseProbe = run.pauseProbe;
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
    for (const row of afterSweep) {
      const wallet = [run.merchant, ...run.buyers].find((item) => item.address === row.address);
      if (wallet !== undefined && row.moneyWei > 0n) {
        receipt.leftBehind.push(
          `${wallet.label} ${row.address} still holds ${formatWei(row.moneyWei, 18)} USDC after the sweep`,
        );
      }
    }
  }

  if (
    receipt.failure === null &&
    events !== null &&
    onchain !== null &&
    run.stripe !== null &&
    run.budgetPi !== null
  ) {
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
      parties: moneyParties(run, collected.gasBySigner),
      deskSamples: run.deskSamples,
      demoFlags: run.demoFlags,
      stripe: {
        budgetPi: run.budgetPi,
        intentIds: [...run.stripe.intents.keys()],
        callIds: run.stripe.calls.map((call) => call.id),
      },
    });
    for (const invariant of receipt.invariants) {
      invariant.details = run.redact(invariant.details);
      out(`${invariant.passed ? "PASSED" : "FAILED"} ${invariant.name}: ${invariant.details}`);
    }
  }
  receipt.status =
    receipt.failure === null &&
    receipt.invariants.length > 0 &&
    receipt.invariants.every((item) => item.passed)
      ? "passed"
      : "failed";
  receipt.finishedAt = new Date().toISOString();

  // Release what the run held in this process.
  setServerDepsForTesting(undefined);
  run.gemini?.close();
  if (run.db !== null) {
    await run.db.end({ timeout: 5 }).catch(() => undefined);
    run.db = null;
  }

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
