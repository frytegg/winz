import type { Logger } from "pino";

import { abortableSleep, summarizeError, systemClock, type Clock } from "../chain";
import type { Db } from "../db";
import {
  CampaignNotFoundError,
  SettlementAbortedError,
  SettlementConfigError,
  SettlementStepError,
} from "./errors";
import { EscrowReader } from "./escrow-reader";
import { retryDelayMs } from "./plan";
import { CampaignSettler } from "./sequence";
import { StepRunner } from "./steps";
import { findCampaign, findCandidates } from "./store";
import type {
  CampaignSettlementResult,
  Settlement,
  SettlementCampaign,
  SettlementOptions,
} from "./types";

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new SettlementConfigError(`startSettlement: ${name} must be a positive number`);
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new SettlementConfigError(`startSettlement: ${name} must be a positive integer`);
  }
  return value;
}

/** Logs without letting a failing logger stop the loop. */
function safely(write: () => void): void {
  try {
    write();
  } catch {
    // A failing logger must not stop the watcher.
  }
}

interface Backoff {
  failures: number;
  nextAtMs: number;
}

/**
 * Finds the campaigns to settle and runs their sequences, one run per campaign at a time. Shared
 * by the loop of `startSettlement` and by `settleCampaignNow`.
 */
class SettlementService {
  private readonly settler: CampaignSettler;
  private readonly reader: EscrowReader;
  private readonly running = new Map<string, Promise<CampaignSettlementResult>>();
  private readonly backoff = new Map<string, Backoff>();
  private readonly db: Db;
  private readonly log: Logger;
  private readonly clock: Clock;
  private readonly signal: AbortSignal;
  private readonly concurrency: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  /** Last status logged per campaign, so a pass that changes nothing logs nothing. */
  private readonly lastStatus = new Map<string, string>();

  constructor(options: SettlementOptions) {
    this.db = options.db;
    this.log = options.logger;
    this.clock = options.clock ?? systemClock;
    this.signal = options.signal;
    this.concurrency = positiveInteger(options.campaignConcurrency ?? 4, "campaignConcurrency");
    this.retryBaseMs = positive(options.retryBaseMs ?? 15_000, "retryBaseMs");
    this.retryMaxMs = positive(options.retryMaxMs ?? 600_000, "retryMaxMs");
    const txWaitTimeoutMs = positive(options.txWaitTimeoutMs ?? 120_000, "txWaitTimeoutMs");
    this.reader = new EscrowReader(options.publicClient, options.escrowAddress);
    this.settler = new CampaignSettler({
      db: options.db,
      reader: this.reader,
      steps: new StepRunner(options.db, options.txSender, txWaitTimeoutMs, options.signal),
      escrow: options.escrowAddress,
      hedgeFinalizer: options.hedgeFinalizer,
      logger: options.logger,
      clock: this.clock,
      signal: options.signal,
      onStep: options.onStep,
      settings: {
        maxAttempts: positiveInteger(options.maxAttempts ?? 3, "maxAttempts"),
        txWaitTimeoutMs,
        refundRetryBaseMs: positive(options.refundRetryBaseMs ?? 60_000, "refundRetryBaseMs"),
        refundRetryMaxMs: positive(options.refundRetryMaxMs ?? 3_600_000, "refundRetryMaxMs"),
        treasuryRetryBaseMs: positive(options.treasuryRetryBaseMs ?? 60_000, "treasuryRetryBaseMs"),
        treasuryRetryMaxMs: positive(options.treasuryRetryMaxMs ?? 1_800_000, "treasuryRetryMaxMs"),
        finalizeFailuresBeforeSafetyNet: positiveInteger(
          options.finalizeFailuresBeforeSafetyNet ?? 3,
          "finalizeFailuresBeforeSafetyNet",
        ),
        finalizeTimeoutMs: positive(options.finalizeTimeoutMs ?? 60_000, "finalizeTimeoutMs"),
      },
    });
  }

  /**
   * One pass: starts a run for every candidate whose backoff has elapsed, in the slots left free
   * by the runs still in flight (at most `concurrency` at once), and returns without waiting for
   * them. A run that hangs therefore holds one slot, never the later passes; the next pass skips
   * the campaigns whose run is still in flight. `drain` waits for them.
   */
  async runPass(): Promise<void> {
    const chainNow = await this.reader.latestTimestamp();
    const candidates = await findCandidates(this.db, new Date(Number(chainNow) * 1000));
    const nowMs = this.clock.now().getTime();
    const ready = candidates.filter((campaign) => {
      if (this.running.has(campaign.id)) return false;
      const backoff = this.backoff.get(campaign.id);
      return backoff === undefined || backoff.nextAtMs <= nowMs;
    });
    for (const campaign of ready) {
      if (this.signal.aborted || this.running.size >= this.concurrency) return;
      void this.runGuarded(campaign);
    }
  }

  /** A run that never rejects: failures are logged and push the campaign's next try back. */
  private async runGuarded(campaign: SettlementCampaign): Promise<void> {
    try {
      await this.runExclusive(campaign);
    } catch {
      // Logged by runExclusive.
    }
  }

  /**
   * Runs one campaign's sequence, after any run of the same campaign in flight. Logs the result
   * when it changes, and failures with the campaign, the step and the error.
   */
  private async runExclusive(campaign: SettlementCampaign): Promise<CampaignSettlementResult> {
    const previous = this.running.get(campaign.id);
    const run = (async (): Promise<CampaignSettlementResult> => {
      if (previous !== undefined) await previous.catch(() => undefined);
      return this.settler.run(campaign);
    })();
    this.running.set(campaign.id, run);
    try {
      const result = await run;
      this.backoff.delete(campaign.id);
      const signature = `${result.status}:${result.detail}`;
      if (this.lastStatus.get(campaign.id) !== signature) {
        this.lastStatus.set(campaign.id, signature);
        safely(() =>
          this.log.info(
            {
              campaignId: campaign.id,
              onchainId: campaign.onchainId.toString(),
              status: result.status,
              detail: result.detail,
              owedTickets: result.owedTickets.map(String),
            },
            "campaign settlement pass",
          ),
        );
      }
      return result;
    } catch (error: unknown) {
      if (error instanceof SettlementAbortedError) {
        return {
          campaignId: campaign.id,
          onchainId: campaign.onchainId,
          status: "aborted",
          detail: "the watcher stopped",
          owedTickets: [],
        };
      }
      const failures = (this.backoff.get(campaign.id)?.failures ?? 0) + 1;
      const delay = retryDelayMs(failures, this.retryBaseMs, this.retryMaxMs);
      this.backoff.set(campaign.id, { failures, nextAtMs: this.clock.now().getTime() + delay });
      this.lastStatus.delete(campaign.id);
      const step = error instanceof SettlementStepError ? error.step : "unknown";
      const cause = error instanceof SettlementStepError ? error.cause : error;
      safely(() =>
        this.log.error(
          {
            campaignId: campaign.id,
            onchainId: campaign.onchainId.toString(),
            step,
            error: summarizeError(cause),
            failures,
            retryInMs: delay,
          },
          "campaign settlement failed, retried with backoff",
        ),
      );
      throw error;
    } finally {
      if (this.running.get(campaign.id) === run) this.running.delete(campaign.id);
    }
  }

  async settleCampaignNow(campaignId: string): Promise<CampaignSettlementResult> {
    const lookup = await findCampaign(this.db, campaignId);
    if (!lookup.exists) throw new CampaignNotFoundError(campaignId);
    if (lookup.campaign === null) {
      return {
        campaignId,
        onchainId: lookup.onchainId,
        status: "not-ready",
        detail:
          lookup.onchainId === null
            ? "the campaign is not on-chain yet"
            : "its instrument has no result, real or forced",
        owedTickets: [],
      };
    }
    return this.runExclusive(lookup.campaign);
  }

  /** Resolves once no campaign run is in flight. */
  async drain(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.allSettled([...this.running.values()]);
    }
  }
}

/**
 * The settlement watcher (SPEC MD-3 → ST-1 to ST-4, EC-7; tasks R-01, R-02). Every `intervalMs`
 * it finds the campaigns whose game is decided and whose sales are closed, and runs for each the
 * sequence: hedge charges, `settle`, refunds in batches of 50 enqueued at once, `payMerchant`,
 * `release`. The oracle signs `chargeHedge` and `settle`, the relayer the rest, all through the
 * transaction sender under idempotency keys, so the watcher can crash anywhere and resume.
 *
 * The first pass starts at once. The loop never throws: a failing pass is retried with backoff,
 * a failing campaign is retried with its own backoff while the others go on.
 */
export function startSettlement(options: SettlementOptions): Settlement {
  const intervalMs = positive(options.intervalMs ?? 15_000, "intervalMs");
  const retryBaseMs = positive(options.retryBaseMs ?? 15_000, "retryBaseMs");
  const retryMaxMs = positive(options.retryMaxMs ?? 600_000, "retryMaxMs");
  const service = new SettlementService(options);
  const { logger, signal } = options;

  const loop = (async (): Promise<void> => {
    let failures = 0;
    while (!signal.aborted) {
      let delayMs = intervalMs;
      try {
        await service.runPass();
        if (failures > 0) safely(() => logger.info({ failures }, "settlement pass recovered"));
        failures = 0;
        safely(() => options.heartbeat?.beat());
      } catch (error: unknown) {
        failures += 1;
        delayMs = retryDelayMs(failures, retryBaseMs, retryMaxMs);
        safely(() =>
          logger.error(
            { error: summarizeError(error), failures, retryInMs: delayMs },
            "settlement pass failed, retrying",
          ),
        );
      }
      await abortableSleep(delayMs, signal);
    }
  })();

  safely(() =>
    logger.info(
      { escrow: options.escrowAddress.toLowerCase(), intervalMs },
      "settlement watcher started",
    ),
  );

  const stopped = loop
    .then(() => service.drain())
    .then(() => safely(() => logger.info("settlement watcher stopped")));

  return {
    stopped,
    settleCampaignNow: (campaignId: string) => service.settleCampaignNow(campaignId),
  };
}
