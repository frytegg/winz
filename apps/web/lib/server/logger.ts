import pino, { type Logger } from "pino";

let root: Logger | undefined;

/** Structured server logger for API routes; every line carries a UTC timestamp, level and module. */
export function serverLogger(module: string): Logger {
  root ??= pino({
    level: process.env.APP_LOG_LEVEL ?? "info",
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  });
  return root.child({ module });
}
