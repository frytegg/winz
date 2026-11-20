/**
 * The real-order proof on Gemini's sandbox (SPEC HE-10, task H-07):
 *
 *   GEMINI_SANDBOX_API_KEY=… GEMINI_SANDBOX_API_SECRET=… DB_URL=postgres://… \
 *     pnpm --filter @winz/engine venue:check [--symbol <instrumentSymbol>] [--accept-terms] [--no-record]
 *
 * Places one maker-or-cancel order that rests, cancels it, and fills one small marketable order,
 * on a crypto contract of the sandbox, reading each back from Gemini; prints the order ids, sides,
 * prices, quantities and statuses, and records the run in `venue_check_runs` / `venue_checks` for
 * the Hedge desk. The variables it reads are listed in src/venues/gemini/check-env.ts; the keys
 * are never printed nor logged. See docs/gemini-sandbox.md.
 *
 * Exit code 0 when proven, 1 when the check failed (or could not be recorded), 2 on a usage error.
 */
import { createDb } from "./db";
import { createLogger, moduleLogger } from "./logger";
import { CheckUsageError, parseCheckCommand } from "./venues/gemini/check-env";
import { PgVenueCheckRecorder } from "./venues/gemini/check-store";
import { formatVenueCheckReport, runAndRecordVenueCheck, sandboxClient } from "./venues/gemini/run";

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<number> {
  let command;
  try {
    command = parseCheckCommand(process.env, process.argv.slice(2));
  } catch (error: unknown) {
    if (error instanceof CheckUsageError) {
      process.stderr.write(`venue:check: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
  const logger = moduleLogger(
    createLogger({ level: command.logLevel, pretty: false }),
    "venue-check",
  );
  const db = command.dbUrl === null ? null : createDb(command.dbUrl, { max: 2 });
  try {
    out(`Sending real orders to ${command.settings.baseUrl} (sandbox, test funds)…`);
    const outcome = await runAndRecordVenueCheck({
      api: sandboxClient(command.settings, logger),
      recorder: db === null ? null : new PgVenueCheckRecorder(db),
      logger,
      options: {
        trigger: "command",
        acceptTerms: command.settings.acceptTerms,
        ...(command.settings.symbol === undefined ? {} : { symbol: command.settings.symbol }),
      },
    });
    out(formatVenueCheckReport(outcome));
    return outcome.report.outcome === "proven" && outcome.recordError === null ? 0 : 1;
  } finally {
    await db?.end({ timeout: 5 }).catch(() => undefined);
  }
}

main().then(
  (code) => {
    // Not process.exit at once: the report written to a pipe must be flushed first. A connection
    // kept alive by fetch could hold the process a few seconds: the timer ends it regardless.
    process.exitCode = code;
    setTimeout(() => process.exit(code), 5_000).unref();
  },
  (error: unknown) => {
    process.stderr.write(
      `venue:check failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`,
    );
    process.exit(1);
  },
);
