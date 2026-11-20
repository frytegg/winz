import type { Logger } from "pino";

import { formatContracts } from "@winz/shared";

import type { Db } from "../../db";
import {
  runVenueCheck,
  type GeminiCheckApi,
  type VenueCheckOptions,
  type VenueCheckReport,
} from "./check";
import { PgVenueCheckRecorder, type VenueCheckRecorder } from "./check-store";
import { GeminiPrivateClient, type GeminiFetch } from "./client";
import type { NonceMode } from "./nonce";

/** What the sandbox check needs from the environment. Keys may be missing: then it cannot run. */
export interface SandboxSettings {
  /** `GEMINI_SANDBOX_API_URL`. */
  baseUrl: string;
  /** `GEMINI_SANDBOX_API_KEY`. */
  apiKey: string | undefined;
  /** `GEMINI_SANDBOX_API_SECRET`. */
  apiSecret: string | undefined;
  /** `GEMINI_SANDBOX_NONCE_MODE`. */
  nonceMode: NonceMode;
  /** `GEMINI_SANDBOX_CHECK_SYMBOL`: a contract to use instead of choosing one. */
  symbol: string | undefined;
  /** `APP_VENUE_CHECK_ACCEPT_TERMS`. */
  acceptTerms: boolean;
}

export const KEYS_MISSING =
  "GEMINI_SANDBOX_API_KEY and GEMINI_SANDBOX_API_SECRET are not both set: no request was sent";

/** The sandbox's private client, or null when a key is missing. */
export function sandboxClient(
  settings: SandboxSettings,
  logger: Logger,
  fetchImpl?: GeminiFetch,
): GeminiPrivateClient | null {
  if (settings.apiKey === undefined || settings.apiSecret === undefined) return null;
  return new GeminiPrivateClient({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    apiSecret: settings.apiSecret,
    nonceMode: settings.nonceMode,
    logger,
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
}

/** A failed report for a check that could not even start (missing keys). */
export function notStartedReport(
  trigger: VenueCheckOptions["trigger"],
  failure: string,
  nowMs: number,
): VenueCheckReport {
  return {
    venue: "gemini-sandbox",
    trigger,
    startedAtMs: nowMs,
    finishedAtMs: nowMs,
    outcome: "failed",
    failedStep: "preflight",
    failure,
    instrument: null,
    orders: [],
  };
}

export interface CheckOutcome {
  report: VenueCheckReport;
  /** The recorded run's id; null when nothing was recorded (no recorder, or it failed). */
  runId: string | null;
  /** Why recording failed, when it did. */
  recordError: string | null;
}

/** Runs the check (or reports it could not start) and records the report. Never throws. */
export async function runAndRecordVenueCheck(deps: {
  api: GeminiCheckApi | null;
  recorder: VenueCheckRecorder | null;
  logger: Logger;
  options: VenueCheckOptions;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<CheckOutcome> {
  const now = deps.now ?? Date.now;
  const report =
    deps.api === null
      ? notStartedReport(deps.options.trigger, KEYS_MISSING, now())
      : await runVenueCheck(
          {
            api: deps.api,
            logger: deps.logger,
            now,
            ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
            ...(deps.signal === undefined ? {} : { signal: deps.signal }),
          },
          deps.options,
        );
  if (deps.recorder === null) return { report, runId: null, recordError: null };
  try {
    const runId = await deps.recorder.record(report);
    return { report, runId, recordError: null };
  } catch (error: unknown) {
    const recordError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    deps.logger.error({ err: recordError }, "the venue check could not be recorded");
    return { report, runId: null, recordError };
  }
}

/**
 * The check once at boot (`APP_VENUE_CHECK_ON_BOOT=true`), for a host without a shell (Render's
 * free plan): the human sets the two sandbox keys and the flag, redeploys, and this run is the
 * receipt, recorded for the Hedge desk and logged. It runs beside the engine and never blocks or
 * stops it: a refusal of the sandbox is logged at ERROR with its reason and recorded as a failed
 * run. Resolves when done; never rejects.
 */
export async function runBootVenueCheck(deps: {
  settings: SandboxSettings;
  db: Db;
  logger: Logger;
  signal: AbortSignal;
  /** Tests only: a client of a simulated server instead of the sandbox's, and no pauses. */
  testing?: { api: GeminiCheckApi; sleep: (ms: number) => Promise<void> };
}): Promise<void> {
  const logger = deps.logger.child({ module: "venue-check" });
  try {
    const keys = deps.settings.apiKey !== undefined && deps.settings.apiSecret !== undefined;
    const api = !keys ? null : (deps.testing?.api ?? sandboxClient(deps.settings, logger));
    if (api === null) {
      logger.error(
        { reason: KEYS_MISSING },
        "APP_VENUE_CHECK_ON_BOOT is set but the check cannot run",
      );
    } else {
      logger.info(
        { baseUrl: deps.settings.baseUrl },
        "venue check at boot: real orders on the Gemini sandbox",
      );
    }
    const outcome = await runAndRecordVenueCheck({
      api,
      recorder: new PgVenueCheckRecorder(deps.db),
      logger,
      signal: deps.signal,
      ...(deps.testing === undefined ? {} : { sleep: deps.testing.sleep }),
      options: {
        trigger: "boot",
        acceptTerms: deps.settings.acceptTerms,
        ...(deps.settings.symbol === undefined ? {} : { symbol: deps.settings.symbol }),
      },
    });
    const { report } = outcome;
    const orders = report.orders.map((order) => ({
      action: order.action,
      venueOrderId: order.venueOrderId,
      status: order.status,
    }));
    if (report.outcome === "proven") {
      logger.info(
        { runId: outcome.runId, instrument: report.instrument?.symbol ?? null, orders },
        "venue check at boot PROVEN: maker placed, cancelled, and an order filled on the Gemini sandbox",
      );
    } else {
      logger.error(
        {
          runId: outcome.runId,
          step: report.failedStep,
          reason: report.failure,
          instrument: report.instrument?.symbol ?? null,
          orders,
        },
        "venue check at boot FAILED",
      );
    }
  } catch (error: unknown) {
    // runAndRecordVenueCheck never throws; this only guards the guarantee.
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "venue check at boot crashed",
    );
  }
}

function priceText(bps: bigint): string {
  return `${(Number(bps) / 100).toFixed(0)}¢`;
}

/** The report as the command prints it: one line per order, then the verdict. */
export function formatVenueCheckReport(outcome: CheckOutcome): string {
  const { report } = outcome;
  const lines: string[] = [];
  lines.push(`Gemini sandbox order check (${report.trigger})`);
  lines.push(
    `  started  ${new Date(report.startedAtMs).toISOString()}   finished ${new Date(report.finishedAtMs).toISOString()}`,
  );
  if (report.instrument !== null) {
    lines.push(
      `  contract ${report.instrument.symbol} (${report.instrument.eventTitle}), bid ${priceText(report.instrument.bestBidBps)}, ask ${priceText(report.instrument.bestAskBps)}`,
    );
  }
  for (const order of report.orders) {
    lines.push(
      `  ${order.action.padEnd(12)} order ${order.venueOrderId}  ${order.kind} ${order.side} ${formatContracts(order.qty)} @ ${priceText(order.limitPriceBps)}  filled ${formatContracts(order.filledQty)}${order.avgPrice === null ? "" : ` avg ${order.avgPrice}`}  status ${order.status}`,
    );
  }
  if (report.outcome === "proven") {
    lines.push("  PROVEN: a maker order rested, was cancelled, and an order was filled.");
  } else {
    lines.push(`  FAILED at ${report.failedStep ?? "?"}: ${report.failure ?? "no reason"}`);
  }
  if (outcome.runId !== null) lines.push(`  recorded as venue_check_runs ${outcome.runId}`);
  else if (outcome.recordError !== null) lines.push(`  NOT recorded: ${outcome.recordError}`);
  else lines.push("  not recorded (--no-record)");
  return lines.join("\n");
}
