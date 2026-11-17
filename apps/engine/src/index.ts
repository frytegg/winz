import { EnvValidationError, loadEngineEnv } from "./config/env";
import { createLogger, moduleLogger } from "./logger";

/**
 * Engine entry point. Each subsystem (market data, chain, jobs, hedging, settlement)
 * registers itself here as it lands; until then the process only validates its
 * configuration and stays up, so deployment can be wired early.
 */
function main(): void {
  let env;
  try {
    env = loadEngineEnv();
  } catch (error: unknown) {
    if (error instanceof EnvValidationError) {
      // The logger depends on the env, so a configuration failure is reported on stderr directly.
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const root = createLogger({ level: env.APP_LOG_LEVEL, pretty: env.APP_ENV === "development" });
  const log = moduleLogger(root, "engine");
  log.info(
    { chainId: env.ARC_CHAIN_ID, venue: env.APP_EXECUTION_VENUE, escrow: env.ARC_ESCROW_ADDRESS },
    "engine started",
  );

  const shutdown = (signal: string): void => {
    log.info({ signal }, "engine stopping");
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    log.error({ err: reason }, "unhandled rejection");
    process.exit(1);
  });

  // Keeps the event loop alive until subsystems hold their own handles.
  setInterval(() => log.debug("heartbeat"), 60_000);
}

main();
