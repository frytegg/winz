import pino, { type Logger } from "pino";

/**
 * Structured JSON logs in production, human-readable in development.
 * Every entry carries a UTC ISO 8601 timestamp, a level and the module that emitted it.
 */
export function createLogger(options: { level: string; pretty: boolean }): Logger {
  return pino({
    level: options.level,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    ...(options.pretty
      ? {
          transport: {
            target: "pino-pretty",
            options: { translateTime: "UTC:yyyy-mm-dd'T'HH:MM:ss.l'Z'" },
          },
        }
      : {}),
  });
}

/** Child logger bound to one module, so every line says where it came from. */
export function moduleLogger(root: Logger, module: string): Logger {
  return root.child({ module });
}
