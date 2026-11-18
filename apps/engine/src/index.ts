import type { Hex } from "viem";

import { startEngine, type Engine } from "./app";
import { createArcClients } from "./chain";
import { EnvValidationError, loadEngineEnv, type EngineEnv } from "./config/env";
import { createDb } from "./db";
import { DemoIdentityDirectory, PrivyIdentityDirectory, type IdentityDirectory } from "./identity";
import { createLogger, moduleLogger } from "./logger";
import { GeminiRestClient, PgCatalogStore, createBookFeed, startCatalogSync } from "./market-data";
import { DemoPaymentGateway, RoutingPaymentGateway, StripePaymentGateway } from "./payments";

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
 * Stripe, Privy) and hands them to `startEngine`, which runs every subsystem and stops them
 * through one abort signal.
 */
async function main(): Promise<void> {
  const env = loadEnvOrExit();
  const root = createLogger({ level: env.APP_LOG_LEVEL, pretty: env.APP_ENV === "development" });
  const log = moduleLogger(root, "engine");

  const db = createDb(env.DB_URL, { max: env.DB_POOL_MAX });
  const stop = new AbortController();

  // One Gemini client for the whole engine, so every request shares one rate limiter.
  const marketDataLog = moduleLogger(root, "market-data");
  const gemini = new GeminiRestClient({ baseUrl: env.GEMINI_API_URL, logger: marketDataLog });

  // Live order books of the instruments in use: WebSocket first, REST as fallback (SPEC MD-2).
  // A book driven by the demo mode replaces Gemini's for its instrument while it exists.
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

  // Every request to the node goes through one limiter (ARC_RPC_* variables), shared by every
  // service through this one client.
  const arc = createArcClients(env, { logger: moduleLogger(root, "rpc") });
  let engine: Engine;
  try {
    engine = await startEngine({
      db,
      logger: root,
      publicClient: arc.publicClient,
      accounts: arc.accounts,
      chainId: env.ARC_CHAIN_ID,
      escrowAddress: env.ARC_ESCROW_ADDRESS as Hex,
      escrowDeployBlock: env.ARC_ESCROW_DEPLOY_BLOCK,
      bookFeed,
      payments,
      identity: identity.directory,
      venueName: env.APP_EXECUTION_VENUE,
      // ARC_TX_MAX_IN_FLIGHT: how many independent transactions of one signer fly together.
      tuning:
        env.ARC_TX_MAX_IN_FLIGHT === undefined
          ? {}
          : { txSender: { maxInFlight: env.ARC_TX_MAX_IN_FLIGHT } },
      background: [
        {
          // Gemini catalogue and results, refreshed every minute (SPEC MD-1, MD-3).
          name: "catalog-sync",
          start: (signal) =>
            startCatalogSync({
              client: gemini,
              store: new PgCatalogStore(db),
              logger: marketDataLog,
              signal,
            }),
        },
      ],
      signal: stop.signal,
    });
  } catch (error: unknown) {
    log.fatal({ err: error }, "engine could not start");
    arc.limiter?.close();
    await db.end({ timeout: 5 }).catch(() => undefined);
    process.exit(1);
  }

  let stopping = false;
  const shutdown = (signal: string, exitCode: number): void => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "shutdown requested");
    stop.abort();
    const forced = setTimeout(() => {
      log.warn({ graceMs: SHUTDOWN_GRACE_MS }, "shutdown grace period elapsed, exiting");
      process.exit(exitCode === 0 ? 1 : exitCode);
    }, SHUTDOWN_GRACE_MS);
    forced.unref();
    arc.limiter?.closeAfter(RPC_LIMITER_RELEASE_MS);
    void engine.stopped
      .then(() => {
        // Nothing uses the node any more: a request still waiting for its turn is released.
        arc.limiter?.close();
        return db.end({ timeout: 5 });
      })
      .catch((error: unknown) => log.error({ err: error }, "error while stopping"))
      .finally(() => process.exit(exitCode));
  };

  process.on("SIGINT", () => shutdown("SIGINT", 0));
  process.on("SIGTERM", () => shutdown("SIGTERM", 0));
  process.on("unhandledRejection", (reason) => {
    log.error({ err: reason }, "unhandled rejection");
    shutdown("unhandledRejection", 1);
  });
}

void main();
