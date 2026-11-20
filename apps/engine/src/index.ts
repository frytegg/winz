import type { Hex } from "viem";

import { startEngine, type Engine } from "./app";
import {
  ChainIdMismatchError,
  EngineIdentityError,
  EscrowConfigError,
  assertSameIdentity,
  checkEscrowRoles,
  createArcClients,
  defaultCursorName,
  readEngineIdentity,
} from "./chain";
import { EnvValidationError, loadEngineEnv, type EngineEnv } from "./config/env";
import { createDb } from "./db";
import {
  HealthConfigError,
  healthPortFromEnv,
  startHealthServer,
  type HealthServer,
  type ServiceState,
} from "./health/server";
import { LoopMonitor } from "./health/loops";
import { DemoIdentityDirectory, PrivyIdentityDirectory, type IdentityDirectory } from "./identity";
import { EngineLeader, FENCE_MARGIN_MS, newHolderId, PgEngineLease } from "./leader";
import { createLogger, moduleLogger } from "./logger";
import { GeminiRestClient, PgCatalogStore, createBookFeed, startCatalogSync } from "./market-data";
import { DemoPaymentGateway, RoutingPaymentGateway, StripePaymentGateway } from "./payments";
import { PgOrderLinkStore, type GeminiVenueWiring } from "./venues";
import { runBootVenueCheck, sandboxClient, type SandboxSettings } from "./venues/gemini/run";

/** How long subsystems get to finish what they are doing before the process exits anyway. */
const SHUTDOWN_GRACE_MS = 15_000;

/**
 * After this long into a shutdown, the RPC limiter releases the requests still waiting for their
 * turn (`RpcLimiterClosedError`, never sent). viem does not pass the stop signal down to the
 * transport, so a request held by a long cool-down (up to 16 s, several times) would otherwise
 * keep its loop, and the stop, waiting past the grace period. Not at once: the services first get
 * time to stop on their own (the job worker aborts its handlers, the transaction sender finishes
 * the broadcast it started), and 6 s remain to close the database.
 */
const RPC_LIMITER_RELEASE_MS = SHUTDOWN_GRACE_MS - 6_000;

function loadEnvOrExit(): EngineEnv {
  try {
    return loadEngineEnv();
  } catch (error: unknown) {
    if (error instanceof EnvValidationError) {
      // The logger depends on the env, so a configuration failure is reported on stderr directly.
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

/** `PORT` of the health listener, or undefined (no listener). Exits like `loadEnvOrExit`. */
function healthPortOrExit(): number | undefined {
  try {
    return healthPortFromEnv();
  } catch (error: unknown) {
    if (error instanceof HealthConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Buyers' wallets: Privy when it is configured, otherwise wallets derived from the demo seed
 * (the environment schema guarantees one of the two). Demo wallets are not customers' wallets.
 */
function identityDirectory(env: EngineEnv): { directory: IdentityDirectory; demo: boolean } {
  if (env.NEXT_PUBLIC_PRIVY_APP_ID !== undefined && env.PRIVY_APP_SECRET !== undefined) {
    const directory = new PrivyIdentityDirectory({
      appId: env.NEXT_PUBLIC_PRIVY_APP_ID,
      appSecret: env.PRIVY_APP_SECRET,
    });
    return { directory, demo: false };
  }
  if (env.APP_DEMO_WALLET_SEED === undefined) {
    // Unreachable: `loadEngineEnv` refuses an environment with neither Privy nor the seed.
    throw new EnvValidationError(["APP_DEMO_WALLET_SEED: required when Privy is not configured"]);
  }
  return { directory: new DemoIdentityDirectory(env.APP_DEMO_WALLET_SEED as Hex), demo: true };
}

/**
 * Engine entry point: reads the environment, builds the production parts (Postgres, Gemini, Arc,
 * Stripe, Privy), checks that the database answers, and starts as a STANDBY: no service runs
 * until this process holds the engine lease (src/leader). Each time it takes the lease it calls
 * `startEngine`, which runs every subsystem and stops them through one abort signal; it renews the
 * lease while they run and stops them by itself when it can no longer renew it.
 */
async function main(): Promise<void> {
  const startedAt = new Date();
  const env = loadEnvOrExit();
  const healthPort = healthPortOrExit();
  const root = createLogger({ level: env.APP_LOG_LEVEL, pretty: env.APP_ENV === "development" });
  const log = moduleLogger(root, "engine");

  const db = createDb(env.DB_URL, { max: env.DB_POOL_MAX });

  // A standby must have reached its database: an unreachable one stops the start, as before.
  try {
    await db`select 1`;
  } catch (error: unknown) {
    log.fatal({ err: error }, "engine could not start: the database does not answer");
    await db.end({ timeout: 5 }).catch(() => undefined);
    process.exit(1);
  }

  // One Gemini client for the whole engine, so every request shares one rate limiter.
  const marketDataLog = moduleLogger(root, "market-data");
  const gemini = new GeminiRestClient({ baseUrl: env.GEMINI_API_URL, logger: marketDataLog });

  // Card payments go to Stripe; sales replayed by the demo mode (pi_demo_…) never reach it.
  const payments = new RoutingPaymentGateway(
    env.STRIPE_SECRET_KEY !== undefined ? new StripePaymentGateway(env.STRIPE_SECRET_KEY) : null,
    new DemoPaymentGateway(db),
  );
  const identity = identityDirectory(env);
  if (env.STRIPE_SECRET_KEY === undefined) {
    log.warn("Stripe is not configured: only sales replayed by the demo mode can be sold");
  }
  if (identity.demo) {
    log.warn("Privy is not configured: buyers get demo wallets derived from the demo seed");
  }

  // The sandbox (real orders with test funds): the venue of the hedge orders when
  // APP_EXECUTION_VENUE=gemini-sandbox (production stays on paper), and the real-order proof of
  // SPEC HE-10 once at boot when APP_VENUE_CHECK_ON_BOOT=true.
  const sandbox: SandboxSettings = {
    baseUrl: env.GEMINI_SANDBOX_API_URL,
    apiKey: env.GEMINI_SANDBOX_API_KEY,
    apiSecret: env.GEMINI_SANDBOX_API_SECRET,
    nonceMode: env.GEMINI_SANDBOX_NONCE_MODE,
    symbol: env.GEMINI_SANDBOX_CHECK_SYMBOL,
    acceptTerms: env.APP_VENUE_CHECK_ACCEPT_TERMS,
  };
  let geminiVenue: GeminiVenueWiring | undefined;
  if (env.APP_EXECUTION_VENUE === "gemini-sandbox") {
    // The environment schema requires both keys for this venue.
    const client = sandboxClient(sandbox, moduleLogger(root, "gemini-sandbox"));
    if (client !== null) geminiVenue = { client, links: new PgOrderLinkStore(db) };
    log.warn(
      { baseUrl: env.GEMINI_SANDBOX_API_URL },
      "hedge orders go to the Gemini sandbox (APP_EXECUTION_VENUE=gemini-sandbox): real orders, test funds",
    );
  }
  // One process, one check: it runs beside the engine whatever the lease, never blocks it, and is
  // stopped by a shutdown.
  const bootCheckStop = new AbortController();
  const bootCheck: Promise<void> = env.APP_VENUE_CHECK_ON_BOOT
    ? runBootVenueCheck({ settings: sandbox, db, logger: root, signal: bootCheckStop.signal })
    : Promise.resolve();

  // Every request to the node goes through one limiter (ARC_RPC_* variables), shared by every
  // service through this one client.
  const arc = createArcClients(env, { logger: moduleLogger(root, "rpc") });

  // Start checks at boot, read-only, so that a wrong configuration stops the process now rather
  // than when it takes the lease (perhaps hours later, at a failover). `startEngine` runs them
  // again under the lease, and records the database's identity there.
  try {
    const recorded = await readEngineIdentity(db);
    if (recorded !== null) {
      assertSameIdentity(recorded, {
        chainId: env.ARC_CHAIN_ID,
        escrowAddress: env.ARC_ESCROW_ADDRESS as Hex,
      });
    }
  } catch (error: unknown) {
    log.fatal(
      { err: error },
      error instanceof EngineIdentityError
        ? "engine could not start: this database belongs to another chain or escrow"
        : "engine could not start: engine_identity cannot be read (is every migration applied?)",
    );
    await db.end({ timeout: 5 }).catch(() => undefined);
    process.exit(1);
  }
  try {
    await checkEscrowRoles({
      client: arc.publicClient,
      chainId: env.ARC_CHAIN_ID,
      escrowAddress: env.ARC_ESCROW_ADDRESS as Hex,
      accounts: arc.accounts,
    });
  } catch (error: unknown) {
    if (error instanceof EscrowConfigError || error instanceof ChainIdMismatchError) {
      log.fatal(
        { err: error },
        "engine could not start: the keys or the escrow do not fit the chain",
      );
      arc.limiter?.close();
      await db.end({ timeout: 5 }).catch(() => undefined);
      process.exit(1);
    }
    // The node did not answer: not a configuration error. The check runs again under the lease.
    log.warn(
      { err: error },
      "the escrow could not be checked at boot: checked again under the lease",
    );
  }

  // When each of the leader's loops last completed a pass: the engine writes it, /healthz reads it.
  const loops = new LoopMonitor();

  /** The engine's services, started each time this process takes the lease. */
  const startServices = (signal: AbortSignal): Promise<Engine> => {
    // Live order books of the instruments in use: WebSocket first, REST as fallback (SPEC MD-2).
    // A book driven by the demo mode replaces Gemini's for its instrument while it exists. One
    // feed per period of leadership: a feed is started once.
    const bookFeed = createBookFeed({
      db,
      client: gemini,
      logger: moduleLogger(root, "book-feed"),
      socket: {
        url: env.GEMINI_WS_URL,
        proxyUrl: env.APP_HTTPS_PROXY_URL,
        caFile: env.APP_PROXY_CA_FILE,
      },
    });
    return startEngine({
      db,
      logger: root,
      publicClient: arc.publicClient,
      accounts: arc.accounts,
      chainId: env.ARC_CHAIN_ID,
      escrowAddress: env.ARC_ESCROW_ADDRESS as Hex,
      escrowDeployBlock: env.ARC_ESCROW_DEPLOY_BLOCK,
      bookFeed,
      loops,
      payments,
      identity: identity.directory,
      venueName: env.APP_EXECUTION_VENUE,
      ...(geminiVenue === undefined ? {} : { geminiVenue }),
      // ARC_TX_MAX_IN_FLIGHT: how many independent transactions of one signer fly together.
      tuning:
        env.ARC_TX_MAX_IN_FLIGHT === undefined
          ? {}
          : { txSender: { maxInFlight: env.ARC_TX_MAX_IN_FLIGHT } },
      background: [
        {
          // Gemini catalogue and results, refreshed every minute (SPEC MD-1, MD-3).
          name: "catalog-sync",
          start: (serviceSignal) =>
            startCatalogSync({
              client: gemini,
              store: new PgCatalogStore(db),
              logger: marketDataLog,
              signal: serviceSignal,
            }),
        },
      ],
      signal,
    });
  };

  // Only one engine works on this database at a time: this one waits as a standby until it holds
  // the lease (ENGINE_LEASE_* variables).
  const leader = new EngineLeader({
    lease: new PgEngineLease({ db, holder: newHolderId(), ttlMs: env.ENGINE_LEASE_TTL_MS }),
    settings: {
      ttlMs: env.ENGINE_LEASE_TTL_MS,
      renewMs: env.ENGINE_LEASE_RENEW_MS,
      standbyPollMs: env.ENGINE_LEASE_STANDBY_POLL_MS,
      fenceMarginMs: FENCE_MARGIN_MS,
    },
    logger: moduleLogger(root, "leader"),
    startServices,
    // A fenced stop stuck past the lease's expiry (a service waiting on a database that does not
    // answer): the process ends here, before another engine can take the lease, and the platform
    // starts it again as a standby. The leader has logged why, at fatal level.
    onFenceOverrun: () => process.exit(1),
  });

  let health: HealthServer | null = null;
  let stopping = false;
  const shutdown = (signal: string, exitCode: number): void => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "shutdown requested");
    const forced = setTimeout(() => {
      log.warn({ graceMs: SHUTDOWN_GRACE_MS }, "shutdown grace period elapsed, exiting");
      process.exit(exitCode === 0 ? 1 : exitCode);
    }, SHUTDOWN_GRACE_MS);
    forced.unref();
    bootCheckStop.abort();
    arc.limiter?.closeAfter(RPC_LIMITER_RELEASE_MS);
    // A leader stops its services (the probe answers 503 meanwhile), then releases the lease; a
    // standby stops at once.
    void leader
      .stop()
      .then(() => {
        // Nothing uses the node any more: a request still waiting for its turn is released.
        arc.limiter?.close();
        // The probe closes after the services, before the pool.
        return health?.close();
      })
      // A boot check still running finishes its request in flight, then stops (it never rejects).
      .then(() => bootCheck)
      .then(() => db.end({ timeout: 5 }))
      .catch((error: unknown) => log.error({ err: error }, "error while stopping"))
      .finally(() => process.exit(exitCode));
  };

  process.on("SIGINT", () => shutdown("SIGINT", 0));
  process.on("SIGTERM", () => shutdown("SIGTERM", 0));
  process.on("unhandledRejection", (reason) => {
    log.error({ err: reason }, "unhandled rejection");
    shutdown("unhandledRejection", 1);
  });

  // PORT set (Render sets it on a web service): GET /healthz for the platform's health check,
  // from the standby on (a healthy standby answers 200 with role "standby"). Unset: no listener.
  if (healthPort !== undefined) {
    try {
      health = await startHealthServer({
        port: healthPort,
        logger: moduleLogger(root, "health"),
        db,
        chain: arc.publicClient,
        chainId: env.ARC_CHAIN_ID,
        cursorName: defaultCursorName(env.ARC_ESCROW_ADDRESS as Hex),
        startedAt,
        failOnStaleLoops: env.APP_HEALTH_FAIL_ON_STALE_LOOPS,
        services: () => {
          // Stopped as soon as a shutdown begins, not only once the services have stopped: an
          // engine on its way out must not be reported as working.
          const state: ServiceState = !stopping && leader.servicesRunning() ? "running" : "stopped";
          return { sender: state, jobs: state };
        },
        lease: () => leader.view(),
        loops: () => loops.report(),
      });
      // A stop that began while it was binding has already passed the point where it closes it.
      if (stopping) await health.close();
    } catch (error: unknown) {
      log.fatal({ err: error, port: healthPort }, "health listener could not start");
      shutdown("health-listener", 1);
      return;
    }
  }

  if (stopping) return;
  const exit = await leader.run();
  if (exit.kind === "failed") {
    log.fatal({ err: exit.error.cause ?? exit.error }, "engine could not start");
    shutdown("engine-failed", 1);
  }
}

void main();
