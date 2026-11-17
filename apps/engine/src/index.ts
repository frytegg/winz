import { EnvValidationError, loadEngineEnv, type EngineEnv } from "./config/env";
import { createDb } from "./db";
import { createLogger, moduleLogger } from "./logger";
import { GeminiRestClient, PgCatalogStore, startCatalogSync } from "./market-data";

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

  // Gemini catalogue and results, refreshed every minute (SPEC MD-1, MD-3).
  const marketDataLog = moduleLogger(root, "market-data");
  const catalogSync = startCatalogSync({
    client: new GeminiRestClient({ baseUrl: env.GEMINI_API_URL, logger: marketDataLog }),
    store: new PgCatalogStore(db),
    logger: marketDataLog,
    signal: stop.signal,
  });

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
    void catalogSync.stopped
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
