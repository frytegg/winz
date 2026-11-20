import type { Logger } from "pino";
import type { Address, PublicClient } from "viem";

import type { ExecutionVenueName } from "@winz/shared";

import {
  checkEscrowRoles,
  claimEngineIdentity,
  startChainIngest,
  TxSender,
  type ChainIngestOptions,
  type SignerAccounts,
  type TxSenderConfig,
} from "./chain";
import type { Db } from "./db";
import {
  LOOP_STALE_AFTER_MS,
  LoopMonitor,
  watchServiceEnd,
  type EngineLoopName,
  type LoopHandle,
  type LoopHeartbeat,
} from "./health/loops";
import { startHedging, type HedgeBookSource, type StartHedgingOptions } from "./hedging/runtime";
import type { IdentityDirectory } from "./identity";
import { startJobs, type BookSource, type JobHandlerOptions, type JobWorkerConfig } from "./jobs";
import { moduleLogger } from "./logger";
import type { PaymentGateway } from "./payments";
import { startSaleStates, type SaleBookSource, type SaleStatesOptions } from "./sales";
import { startSettlement, type SettlementOptions } from "./settlement";
import type { GeminiVenueWiring } from "./venues";

/** What every subsystem returns: a promise that resolves once it has stopped. Never rejects. */
export interface RunningService {
  stopped: Promise<void>;
}

/** The live order books, as each subsystem reads them. The engine's `BookFeed` satisfies it. */
export interface EngineBookFeed extends HedgeBookSource, SaleBookSource, BookSource {
  /** `heartbeat`: told of every completed refresh of the instruments it follows. */
  start(options: { signal: AbortSignal; heartbeat?: LoopHeartbeat }): RunningService;
}

/**
 * A service that runs beside the core and stops with it, such as the Gemini catalogue sync.
 * `start` must return at once and must not throw once it has started anything.
 */
export interface BackgroundService {
  name: string;
  start(signal: AbortSignal): RunningService;
}

type Tuning<Options, Wired extends keyof Options> = Partial<Omit<Options, Wired>>;

/** Optional settings of each subsystem. Production leaves them unset; tests shorten the waits. */
export interface EngineTuning {
  txSender?: Omit<TxSenderConfig, "chainId" | "escrowAddress">;
  chainIngest?: Tuning<
    ChainIngestOptions,
    "db" | "publicClient" | "escrowAddress" | "fromBlock" | "logger" | "signal" | "heartbeats"
  >;
  hedging?: Tuning<
    StartHedgingOptions,
    | "db"
    | "bookFeed"
    | "txSender"
    | "venueName"
    | "escrowAddress"
    | "logger"
    | "signal"
    | "clock"
    | "heartbeats"
  >;
  saleStates?: Tuning<
    SaleStatesOptions,
    "db" | "bookFeed" | "breakerStatus" | "logger" | "signal" | "clock" | "heartbeat"
  >;
  settlement?: Tuning<
    SettlementOptions,
    | "db"
    | "txSender"
    | "publicClient"
    | "escrowAddress"
    | "hedgeFinalizer"
    | "logger"
    | "signal"
    | "heartbeat"
  >;
  jobs?: { options?: JobHandlerOptions; worker?: Partial<JobWorkerConfig> };
}

/**
 * Everything the engine runs on, built by the caller: the production wiring lives in `index.ts`,
 * the end-to-end tests pass a local chain, a test database and fakes for Gemini and Stripe.
 */
export interface EngineDeps {
  db: Db;
  /** Root logger. Each subsystem logs through a child named after it. */
  logger: Logger;
  /** Reads the chain and broadcasts signed transactions. */
  publicClient: PublicClient;
  /** The relayer and the oracle. Two different keys (the transaction sender checks it). */
  accounts: SignerAccounts;
  chainId: number;
  escrowAddress: Address;
  /** Block the escrow was deployed in: where the event reader starts on an empty database. */
  escrowDeployBlock: bigint;
  /** Not started yet: the engine starts it and stops it with everything else. */
  bookFeed: EngineBookFeed;
  payments: PaymentGateway;
  identity: IdentityDirectory;
  venueName: ExecutionVenueName;
  /** The real Gemini venue's client and order links: required when `venueName` is "gemini-sandbox". */
  geminiVenue?: GeminiVenueWiring;
  /** Services running beside the core. Started last, stopped with the rest. */
  background?: readonly BackgroundService[];
  /** Aborting it stops the engine. */
  signal: AbortSignal;
  /**
   * Where the long-running loops report each pass they complete, for `/healthz`. `index.ts`
   * passes the one its health listener reads; the engine clears it and registers its loops at
   * each start, and clears it once they have stopped. Default: a monitor nobody reads.
   */
  loops?: LoopMonitor;
  /**
   * Current time, epoch milliseconds. Prices, quote expiries, sales close and the hedging timers
   * are read against it. Defaults to the system clock; tests align it with their chain's time.
   */
  now?: () => number;
  tuning?: EngineTuning;
}

export interface Engine {
  /**
   * Resolves once every subsystem has stopped and the transaction sender has been stopped after
   * them: the signal is aborted and nothing is in flight. Never rejects.
   */
  stopped: Promise<void>;
}

/** Resolves when `signal` aborts (at once when it already has). */
function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/**
 * Starts the whole engine and returns once it runs. The order matters:
 *
 * 1. the transaction sender, the only writer on-chain, which resumes what the previous process
 *    left in the outbox;
 * 2. the order books and the chain's events, which everything else reads;
 * 3. hedging, then the two services that depend on it: the sale states (sales of an instrument
 *    stop while its breaker is active) and settlement (which asks hedging to finalize a
 *    campaign's charges before it settles);
 * 4. the jobs the web app enqueues, last, so that no sale is accepted before hedging can see it.
 *
 * Before anything starts, two start checks, each a configuration error that stops the start:
 *
 * - the escrow (`checkEscrowRoles`): the node serves `chainId`, `escrowAddress` holds code there,
 *   and the escrow's `relayer()` and `oracle()` are the addresses of the configured keys;
 * - the database (`claimEngineIdentity`): the first engine on a database records its chain id and
 *   escrow, every later one must have the same pair. Written only once the escrow check passed.
 *
 * Throws when it cannot start (one of those checks, the node answers another chain id, an
 * execution venue without an adapter, a worker concurrency above the database pool): whatever
 * was already started is stopped before the error is thrown.
 *
 * On abort every subsystem finishes what it has in flight, and the transaction sender is stopped
 * only after all of them: a handler waiting on a transaction must still be able to read its
 * outcome. Transactions left in the outbox are resumed by the next start.
 */
export async function startEngine(deps: EngineDeps): Promise<Engine> {
  const log = moduleLogger(deps.logger, "engine");
  const now = deps.now ?? Date.now;
  const tuning = deps.tuning ?? {};

  // The engine's own signal: aborted with the caller's, or by a failed start.
  const internal = new AbortController();
  const forward = (): void => internal.abort();
  if (deps.signal.aborted) internal.abort();
  else deps.signal.addEventListener("abort", forward, { once: true });
  const signal = internal.signal;

  const txSender = new TxSender({
    db: deps.db,
    client: deps.publicClient,
    accounts: deps.accounts,
    logger: moduleLogger(deps.logger, "tx-sender"),
    config: { ...tuning.txSender, chainId: deps.chainId, escrowAddress: deps.escrowAddress },
  });
  try {
    const roles = await checkEscrowRoles({
      client: deps.publicClient,
      chainId: deps.chainId,
      escrowAddress: deps.escrowAddress,
      accounts: deps.accounts,
    });
    const claim = await claimEngineIdentity(deps.db, {
      chainId: deps.chainId,
      escrowAddress: deps.escrowAddress,
    });
    log.info(
      {
        chainId: claim.identity.chainId,
        escrow: claim.identity.escrowAddress.toLowerCase(),
        relayer: roles.relayer.toLowerCase(),
        oracle: roles.oracle.toLowerCase(),
        identityRecordedAt: claim.identity.recordedAt.toISOString(),
      },
      claim.recorded
        ? "start checks passed: this database is now recorded for this chain and escrow"
        : "start checks passed: the keys are the escrow's relayer and oracle, the database is this chain's and escrow's",
    );
    await txSender.start();
  } catch (error: unknown) {
    deps.signal.removeEventListener("abort", forward);
    throw error;
  }

  // Every loop has its whole bound to complete its first pass, counted from here.
  const loops = deps.loops ?? new LoopMonitor(now);
  loops.clear();
  const loop = (name: EngineLoopName): LoopHandle =>
    loops.register(name, LOOP_STALE_AFTER_MS[name]);
  const handles = {
    feedRefresh: loop("feed-refresh"),
    chainLogs: loop("chain-logs"),
    chainProjector: loop("chain-projector"),
    hedgingExposure: loop("hedging-exposure"),
    hedgingTick: loop("hedging-tick"),
    hedgingCharge: loop("hedging-charge"),
    saleStates: loop("sale-states"),
    settlement: loop("settlement"),
    jobs: loop("jobs"),
  };

  const services: { name: string; stopped: Promise<void> }[] = [];
  /**
   * Records a started service. A service ends only when the engine's signal aborts: one whose
   * `stopped` settles before that has stopped by itself, its loops with it. That is logged at
   * error level and its loops are reported stopped at once (`/healthz` answers 503), instead of the
   * engine going on without them and nobody knowing.
   */
  const run = (name: string, service: RunningService, owned: readonly LoopHandle[] = []): void => {
    services.push({ name, stopped: service.stopped });
    watchServiceEnd({
      name,
      stopped: service.stopped,
      loops: owned,
      signal,
      onEnd: (error: unknown) =>
        log.error(
          { service: name, ...(error === undefined ? {} : { err: error }) },
          "a service stopped by itself while the engine runs: its loops no longer run",
        ),
    });
  };

  const stopAll = async (): Promise<void> => {
    const results = await Promise.allSettled(services.map((service) => service.stopped));
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        log.error({ service: services[index]?.name, err: result.reason }, "service stopped badly");
      }
    });
    try {
      await txSender.stop();
    } catch (error: unknown) {
      log.error({ err: error }, "transaction sender stopped badly");
    }
  };

  try {
    run("book-feed", deps.bookFeed.start({ signal, heartbeat: handles.feedRefresh }), [
      handles.feedRefresh,
    ]);

    // The escrow's events, projected into tickets, lots and exposure (SPEC HE-1). The contract
    // is the source of truth of the money; the database follows it.
    run(
      "chain-ingest",
      startChainIngest({
        ...tuning.chainIngest,
        db: deps.db,
        publicClient: deps.publicClient,
        escrowAddress: deps.escrowAddress,
        fromBlock: deps.escrowDeployBlock,
        logger: moduleLogger(deps.logger, "chain-ingest"),
        signal,
        heartbeats: { logs: handles.chainLogs, projector: handles.chainProjector },
      }),
      [handles.chainLogs, handles.chainProjector],
    );

    // One policy runner per instrument with something to hedge (SPEC HE-2 to HE-6).
    const hedging = startHedging({
      ...tuning.hedging,
      db: deps.db,
      bookFeed: deps.bookFeed,
      txSender,
      venueName: deps.venueName,
      ...(deps.geminiVenue === undefined ? {} : { geminiVenue: deps.geminiVenue }),
      escrowAddress: deps.escrowAddress,
      logger: moduleLogger(deps.logger, "hedging"),
      signal,
      clock: { now: () => new Date(now()) },
      heartbeats: {
        exposure: handles.hedgingExposure,
        tick: handles.hedgingTick,
        charge: handles.hedgingCharge,
      },
    });
    run("hedging", hedging, [handles.hedgingExposure, handles.hedgingTick, handles.hedgingCharge]);

    // Whether each campaign can sell right now, and why not (SPEC CA-4, CA-5).
    run(
      "sale-states",
      startSaleStates({
        ...tuning.saleStates,
        db: deps.db,
        bookFeed: deps.bookFeed,
        breakerStatus: hedging.breakerStatus,
        logger: moduleLogger(deps.logger, "sale-states"),
        signal,
        clock: now,
        heartbeat: handles.saleStates,
      }),
      [handles.saleStates],
    );

    // Settles a campaign once its game is decided, then pushes refunds and payouts (SPEC ST-1
    // to ST-4).
    run(
      "settlement",
      startSettlement({
        ...tuning.settlement,
        db: deps.db,
        txSender,
        publicClient: deps.publicClient,
        escrowAddress: deps.escrowAddress,
        hedgeFinalizer: hedging.finalizer,
        logger: moduleLogger(deps.logger, "settlement"),
        signal,
        heartbeat: handles.settlement,
      }),
      [handles.settlement],
    );

    // The work the web app enqueues: create a campaign, sell a ticket, pause, close sales.
    run(
      "jobs",
      startJobs({
        db: deps.db,
        txSender,
        publicClient: deps.publicClient,
        oracle: deps.accounts.oracle,
        escrowAddress: deps.escrowAddress,
        chainId: deps.chainId,
        books: deps.bookFeed,
        payments: deps.payments,
        identity: deps.identity,
        logger: moduleLogger(deps.logger, "jobs"),
        clock: now,
        options: tuning.jobs?.options,
        worker: tuning.jobs?.worker,
        signal,
        heartbeat: handles.jobs,
      }),
      [handles.jobs],
    );

    for (const service of deps.background ?? []) run(service.name, service.start(signal));
  } catch (error: unknown) {
    deps.signal.removeEventListener("abort", forward);
    internal.abort();
    await stopAll();
    loops.clear();
    throw error;
  }

  log.info(
    {
      chainId: deps.chainId,
      escrow: deps.escrowAddress.toLowerCase(),
      venue: deps.venueName,
      relayer: deps.accounts.relayer.address.toLowerCase(),
      oracle: deps.accounts.oracle.address.toLowerCase(),
      services: services.map((service) => service.name),
    },
    "engine running",
  );

  const stopped = aborted(signal).then(async () => {
    log.info("engine stopping");
    await stopAll();
    loops.clear();
    log.info("engine stopped");
  });
  return { stopped };
}
