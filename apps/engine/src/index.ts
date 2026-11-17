import { EnvValidationError, loadEngineEnv, type EngineEnv } from "./config/env";
import { createDb } from "./db";
import { createLogger, moduleLogger } from "./logger";
import { GeminiRestClient, PgCatalogStore, createBookFeed, startCatalogSync } from "./market-data";

/** How long subsystems get to finish what they are doing before the process exits anyway. */
const SHUTDOWN_GRACE_MS = 15_000;

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
 * Engine entry point. Each subsystem (market data, chain, jobs, hedging, settlement) is started
 * here as it lands, and stopped through one abort signal.
 */
function main(): void {
  const env = loadEnvOrExit();
  const root = createLogger({ level: env.APP_LOG_LEVEL, pretty: env.APP_ENV === "development" });
  const log = moduleLogger(root, "engine");
  log.info(
    { chainId: env.ARC_CHAIN_ID, venue: env.APP_EXECUTION_VENUE, escrow: env.ARC_ESCROW_ADDRESS },
    "engine started",
  );

  const db = createDb(env.DB_URL);
  const stop = new AbortController();

  // One Gemini client for the whole engine, so every request shares one rate limiter.
  const marketDataLog = moduleLogger(root, "market-data");
  const gemini = new GeminiRestClient({ baseUrl: env.GEMINI_API_URL, logger: marketDataLog });

  // Gemini catalogue and results, refreshed every minute (SPEC MD-1, MD-3).
  const catalogSync = startCatalogSync({
    client: gemini,
    store: new PgCatalogStore(db),
    logger: marketDataLog,
    signal: stop.signal,
  });

  // Live order books of the instruments in use: WebSocket first, REST as fallback (SPEC MD-2).
  const bookFeed = createBookFeed({
    db,
    client: gemini,
    logger: moduleLogger(root, "book-feed"),
    socket: {
      url: env.GEMINI_WS_URL,
      proxyUrl: env.APP_HTTPS_PROXY_URL,
      caFile: env.APP_PROXY_CA_FILE,
    },
  }).start({ signal: stop.signal });

  let stopping = false;
  const shutdown = (signal: string, exitCode: number): void => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "engine stopping");
    stop.abort();
    const forced = setTimeout(() => {
      log.warn({ graceMs: SHUTDOWN_GRACE_MS }, "shutdown grace period elapsed, exiting");
      process.exit(exitCode === 0 ? 1 : exitCode);
    }, SHUTDOWN_GRACE_MS);
    forced.unref();
    void Promise.allSettled([catalogSync.stopped, bookFeed.stopped])
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
}

main();
