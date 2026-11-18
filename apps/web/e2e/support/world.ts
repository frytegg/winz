import { appendFileSync } from "node:fs";
import { Writable } from "node:stream";

import pino, { type Logger } from "pino";
import type { Address, Hex } from "viem";

import { winzEscrowAbi } from "@winz/shared";

import { setServerDepsForTesting } from "@/lib/server/deps";
import { FakeIdentity, TEST_CONFIG } from "@/lib/server/testing/fixtures";

import { startEngine, type Engine, type EngineTuning } from "../../../engine/src/app";
import { TEST_SENDER_CONFIG } from "../../../engine/src/chain/test-support";
import { createDb, type Db } from "../../../engine/src/db";
import {
  BookFeed,
  PgBookStore,
  PgCatalogStore,
  PgDemoBookStore,
  startCatalogSync,
} from "../../../engine/src/market-data";
import { DemoPaymentGateway, RoutingPaymentGateway } from "../../../engine/src/payments";
import type { AnvilInstance } from "../../../engine/src/testing/anvil";
import { deployTestEscrow, testUsdcAbi, type TestEscrow } from "../../../engine/src/testing/escrow";
import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import { WorldClock } from "./clock";
import { SilentTransport, SimulatedGemini, newGame, type Game } from "./gemini";
import { SimulatedStripe } from "./stripe";
import { WaitTimeoutError } from "./wait";

/**
 * One whole product on a local chain, for one scenario: a fresh Postgres with every migration, a
 * fresh WinzEscrow and test token (the treasury funded and approving the escrow), the engine as
 * one process (`startEngine`, exactly as `apps/engine/src/index.ts` wires it, with Gemini and
 * Stripe simulated), and the web app's route handlers wired on the same database, the same clock
 * and the same simulated Stripe.
 *
 * A scenario drives the public surface only: HTTP requests to the route handlers, signed Stripe
 * webhooks and what the payer does on Stripe's sheet, books fed to the simulated Gemini, the
 * game's result published by the simulated Gemini, and chain time. It may read the database and
 * the chain to assert, never write them.
 */

export interface EngineLogEntry {
  level: number;
  msg: string;
  module?: string;
  [key: string]: unknown;
}

export interface WorldOptions {
  /** Time from now to the game's start (default three hours: makers are allowed, see H-04). */
  startsInMs?: number;
  /** Extra settings of the engine, merged over the world's short intervals. */
  tuning?: EngineTuning;
}

export interface StartEngineOptions {
  /** Settings of this run only, merged over the world's. */
  tuning?: EngineTuning;
}

export interface World {
  anvil: AnvilInstance;
  escrow: TestEscrow;
  db: Db;
  clock: WorldClock;
  stripe: SimulatedStripe;
  gemini: SimulatedGemini;
  game: Game;
  /** The fake Privy of the web app, also the engine's identity directory: one set of users. */
  identity: FakeIdentity;
  /** Warnings and errors the engine logged, newest last (at most 500). */
  engineLogs: EngineLogEntry[];
  /** Moves chain time forward (and with it every clock of the world); re-delivers the books. */
  advance: (seconds: number) => Promise<void>;
  /** Aborts the running engine and waits until it has stopped. */
  stopEngine: () => Promise<void>;
  /** Starts a new engine on the same database and chain. */
  startEngine: (options?: StartEngineOptions) => Promise<void>;
  /** Aborts the engine without waiting (a crash at a precise point); see `engineStopped`. */
  abortEngine: () => void;
  /** Resolves once the current engine has stopped. */
  engineStopped: () => Promise<void>;
  /** `stopEngine` then `startEngine`. */
  restartEngine: (options?: StartEngineOptions) => Promise<void>;
  /**
   * Polls `condition` every 100 ms until it holds; on timeout, throws with `what`, the last value
   * the condition saw (when it returned a description) and the engine's latest warnings.
   */
  waitFor: (
    what: string,
    condition: () => Promise<boolean | { ok: boolean; seen: unknown }>,
    timeoutMs?: number,
  ) => Promise<void>;
  /** Stops everything: engine, timers, database. Leaves no process, no timer, no temp file. */
  close: () => Promise<void>;
}

/** Short intervals: each one well below the waits of the scenarios. */
const WORLD_TUNING: EngineTuning = {
  txSender: TEST_SENDER_CONFIG,
  chainIngest: { pollIntervalMs: 150, projectIntervalMs: 50 },
  hedging: {
    exposureIntervalMs: 100,
    tickIntervalMs: 100,
    chargeIntervalMs: 200,
    deskMinIntervalMs: 200,
    reconcileTimeoutMs: 10_000,
    finalizeTimeoutMs: 20_000,
  },
  saleStates: { intervalMs: 200 },
  settlement: {
    intervalMs: 250,
    retryBaseMs: 250,
    retryMaxMs: 1_000,
    refundRetryBaseMs: 250,
    refundRetryMaxMs: 1_000,
    treasuryRetryBaseMs: 250,
    treasuryRetryMaxMs: 1_000,
    txWaitTimeoutMs: 15_000,
    finalizeTimeoutMs: 20_000,
  },
  jobs: {
    options: {
      waitTimeoutMs: 20_000,
      retryDelayMs: 100,
      resendDelayMs: 50,
      maxResendDelayMs: 200,
    },
    worker: { pollIntervalMs: 100, shutdownGraceMs: 5_000 },
  },
};

function mergeTuning(base: EngineTuning, extra: EngineTuning | undefined): EngineTuning {
  if (extra === undefined) return base;
  return {
    txSender: { ...base.txSender, ...extra.txSender },
    chainIngest: { ...base.chainIngest, ...extra.chainIngest },
    hedging: { ...base.hedging, ...extra.hedging },
    saleStates: { ...base.saleStates, ...extra.saleStates },
    settlement: { ...base.settlement, ...extra.settlement },
    jobs: {
      options: { ...base.jobs?.options, ...extra.jobs?.options },
      worker: { ...base.jobs?.worker, ...extra.jobs?.worker },
    },
  };
}

/** The engine's logger: warnings and errors kept for failure messages, everything to a file on demand. */
function engineLogger(entries: EngineLogEntry[]): Logger {
  const file = process.env.E2E_LOG_FILE;
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      const text = chunk.toString("utf8");
      if (file !== undefined && file !== "") appendFileSync(file, text);
      for (const line of text.split("\n")) {
        if (line.trim() === "") continue;
        const entry = JSON.parse(line) as EngineLogEntry;
        if (entry.level >= 40) {
          entries.push(entry);
          if (entries.length > 500) entries.shift();
        }
      }
      callback();
    },
  });
  return pino({ level: file !== undefined && file !== "" ? "debug" : "warn" }, stream);
}

function describeLogs(entries: readonly EngineLogEntry[]): string {
  return entries
    .slice(-12)
    .map((entry) => {
      const { level, msg, module, err } = entry;
      const reason =
        typeof err === "object" && err !== null && "message" in err
          ? ` (${String((err as { message: unknown }).message)})`
          : "";
      return `  [${String(level)}] ${String(module ?? "")} ${msg}${reason}`;
    })
    .join("\n");
}

export async function createWorld(
  anvil: AnvilInstance,
  options: WorldOptions = {},
): Promise<World> {
  const escrow = await deployTestEscrow(anvil);
  const database: TestDatabase = await createTestDatabase();
  // The engine's pool (well above the job worker's concurrency), shared with the web routes.
  const db = createDb(database.url, { max: 16 });

  const clock = new WorldClock();
  clock.alignOn(await escrow.latestTimestamp());
  const game = newGame(clock.now(), options.startsInMs ?? 3 * 3_600_000);
  const gemini = new SimulatedGemini(clock, game);
  const stripe = new SimulatedStripe();
  const identity = new FakeIdentity();
  const engineLogs: EngineLogEntry[] = [];
  const logger = engineLogger(engineLogs);
  const baseTuning = mergeTuning(WORLD_TUNING, options.tuning);

  setServerDepsForTesting({
    db,
    verifier: identity,
    directory: identity,
    payments: stripe.web,
    config: () => ({ ...TEST_CONFIG, escrowAddress: escrow.escrow }),
    now: clock.date,
    demoSaleWait: { timeoutMs: 15_000, pollIntervalMs: 100 },
  });

  let controller: AbortController | null = null;
  let engine: Engine | null = null;

  const startEngineRun = async (run: StartEngineOptions = {}): Promise<void> => {
    if (engine !== null) throw new Error("the engine is already running");
    const runController = new AbortController();
    const feed = new BookFeed({
      store: new PgBookStore(db),
      rest: new SilentTransport(),
      ws: gemini.transport(),
      logger: logger.child({ module: "book-feed" }),
      scheduler: clock.scheduler(),
      demo: new PgDemoBookStore(db),
      trackedRefreshMs: 200,
      watchdogMs: 200,
      writeThrottleMs: 100,
      demoRefreshMs: 200,
    });
    const marketDataLog = logger.child({ module: "market-data" });
    engine = await startEngine({
      db,
      logger,
      publicClient: escrow.publicClient,
      accounts: { relayer: escrow.accounts.relayer, oracle: escrow.accounts.oracle },
      chainId: escrow.chainId,
      escrowAddress: escrow.escrow,
      escrowDeployBlock: escrow.deployedAtBlock,
      bookFeed: feed,
      // As in production: card payments go to Stripe, replayed demo sales (pi_demo_…) never do.
      payments: new RoutingPaymentGateway(stripe.engine, new DemoPaymentGateway(db)),
      identity,
      venueName: "paper",
      background: [
        {
          name: "catalog-sync",
          start: (signal) =>
            startCatalogSync({
              client: gemini.client(),
              store: new PgCatalogStore(db, { now: clock.now }),
              logger: marketDataLog,
              signal,
              intervalMs: 300,
              now: clock.now,
            }),
        },
      ],
      signal: runController.signal,
      now: clock.now,
      tuning: mergeTuning(baseTuning, run.tuning),
    });
    controller = runController;
  };

  const engineStopped = async (): Promise<void> => {
    const running = engine;
    if (running === null) return;
    await running.stopped;
    if (engine === running) {
      engine = null;
      controller = null;
    }
  };

  const abortEngine = (): void => {
    controller?.abort();
  };

  const stopEngine = async (): Promise<void> => {
    abortEngine();
    await engineStopped();
  };

  const waitFor: World["waitFor"] = async (what, condition, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    let seen: unknown = undefined;
    for (;;) {
      const result = await condition();
      const ok = typeof result === "boolean" ? result : result.ok;
      if (typeof result !== "boolean") seen = result.seen;
      if (ok) return;
      if (Date.now() >= deadline) {
        throw new WaitTimeoutError(
          `timed out after ${timeoutMs.toString()} ms waiting for ${what}` +
            (seen === undefined ? "" : `\nlast seen: ${stringify(seen)}`) +
            `\nengine warnings and errors (latest):\n${describeLogs(engineLogs)}`,
        );
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
  };

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await stopEngine();
    gemini.close();
    setServerDepsForTesting(undefined);
    await db.end({ timeout: 5 });
    await database.drop();
  };

  try {
    await startEngineRun();
    // The catalogue sync has stored the game and its two instruments.
    await waitFor("the catalogue sync to store the game", async () => {
      const rows = await db<{ symbol: string }[]>`
        select symbol from instruments where event_ticker = ${game.ticker} and active
      `;
      return { ok: rows.length === 2, seen: rows };
    });
  } catch (error: unknown) {
    await close();
    throw error;
  }

  return {
    anvil,
    escrow,
    db,
    clock,
    stripe,
    gemini,
    game,
    identity,
    engineLogs,
    advance: async (seconds) => {
      const timestamp = await escrow.advanceTime(seconds);
      clock.alignOn(timestamp);
      // A live socket keeps sending: the books are fresh at the new time at once.
      gemini.deliverAll();
    },
    stopEngine,
    startEngine: startEngineRun,
    abortEngine,
    engineStopped,
    restartEngine: async (run) => {
      await stopEngine();
      await startEngineRun(run);
    },
    waitFor,
    close,
  };
}

function stringify(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

// ---------------------------------------------------------------------------------------------
// Reading the chain
// ---------------------------------------------------------------------------------------------

export interface OnchainCampaign {
  merchant: Address;
  instrument: Hex;
  salesClose: bigint;
  unitPrice: bigint;
  refundBps: number;
  hedgeBudget: bigint;
  hedgeReserved: bigint;
  hedgeSpent: bigint;
  lockedRefunds: bigint;
  merchantDue: bigint;
  status: number;
  released: boolean;
}

export async function onchainCampaign(world: World, id: bigint): Promise<OnchainCampaign> {
  return world.escrow.publicClient.readContract({
    address: world.escrow.escrow,
    abi: winzEscrowAbi,
    functionName: "getCampaign",
    args: [id],
  });
}

export interface OnchainTicket {
  campaignId: bigint;
  buyer: Address;
  paid: bigint;
  refundable: bigint;
  maxHedgeCost: bigint;
  hedgeCharged: boolean;
  paidOut: boolean;
}

export async function onchainTicket(world: World, id: bigint): Promise<OnchainTicket> {
  return world.escrow.publicClient.readContract({
    address: world.escrow.escrow,
    abi: winzEscrowAbi,
    functionName: "getTicket",
    args: [id],
  });
}

export async function ticketCount(world: World): Promise<bigint> {
  return world.escrow.publicClient.readContract({
    address: world.escrow.escrow,
    abi: winzEscrowAbi,
    functionName: "ticketCount",
  });
}

export async function tokenBalance(world: World, account: Address): Promise<bigint> {
  return world.escrow.publicClient.readContract({
    address: world.escrow.usdc,
    abi: testUsdcAbi,
    functionName: "balanceOf",
    args: [account],
  });
}

export type EscrowEventName =
  | "CampaignCreated"
  | "TicketPurchased"
  | "HedgeCharged"
  | "CampaignPaused"
  | "SalesClosedEarly"
  | "CampaignSettled"
  | "TicketRefunded"
  | "RefundFailed"
  | "MerchantPaid"
  | "CampaignReleased";

/** Every event of that name the escrow emitted, with its decoded arguments. */
export async function escrowEvents(
  world: World,
  eventName: EscrowEventName,
): Promise<Record<string, unknown>[]> {
  const logs = await world.escrow.publicClient.getContractEvents({
    address: world.escrow.escrow,
    abi: winzEscrowAbi,
    eventName,
    fromBlock: world.escrow.deployedAtBlock,
  });
  return logs.map((log) => ({ ...(log.args as Record<string, unknown>) }));
}
