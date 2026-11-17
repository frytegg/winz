import type { Logger } from "pino";
import type { Address } from "viem";

import type { Db } from "../db";
import { abortableSleep } from "./clock";
import { backoffDelayMs } from "./fees";
import { summarizeError } from "./error-summary";
import { ChainIngestConfigError } from "./ingest-errors";
import { LogPoller, type LogClient } from "./log-poller";
import { ChainProjector } from "./projector";

export interface ChainIngestOptions {
  db: Db;
  /** Reads the escrow's logs. A viem `PublicClient` satisfies it. */
  publicClient: LogClient;
  escrowAddress: Address;
  /** Block the escrow was deployed in: where the poller starts when it has no cursor yet. */
  fromBlock: bigint;
  logger: Logger;
  /** Aborting it stops both loops; work in flight finishes first. */
  signal: AbortSignal;
  /** Time between two `eth_getLogs` polls (SPEC HE-1: 5 s). Default 5 000. */
  pollIntervalMs?: number;
  /**
   * Time between two projection passes. Default 1 000: events written by the receipt path are
   * projected within about a second (a sale visible in 3 s), not at the next poll.
   */
  projectIntervalMs?: number;
  /** Widest `eth_getLogs` range, in blocks. Default 2 000. */
  maxBlockRange?: bigint;
  /** Blocks left unread behind the head. Default 0 (Arc has deterministic finality). */
  confirmations?: bigint;
  /** Row of `chain_cursor`. Default `escrow-logs:<lowercase escrow address>`. */
  cursorName?: string;
  /** First delay after a failure, doubled at each failure in a row. Default 1 000. */
  retryBaseMs?: number;
  /** Longest delay after failures. Default 30 000. */
  retryMaxMs?: number;
  /** Unprocessed events read per query by the projector. Default 500. */
  projectBatchSize?: number;
}

export interface ChainIngest {
  /** Resolves once both loops have stopped: the signal is aborted and nothing is in flight. */
  stopped: Promise<void>;
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ChainIngestConfigError(`startChainIngest: ${name} must be a positive number`);
  }
  return value;
}

/**
 * Runs `step` until `signal` aborts: `intervalMs` after a success, with exponential backoff
 * after failures. Never rejects, whatever `step` or the logger throw.
 */
async function runLoop(
  name: string,
  step: () => Promise<void>,
  options: {
    signal: AbortSignal;
    intervalMs: number;
    retryBaseMs: number;
    retryMaxMs: number;
    logger: Logger;
  },
): Promise<void> {
  const { signal, logger } = options;
  let failures = 0;
  while (!signal.aborted) {
    let delayMs = options.intervalMs;
    try {
      await step();
      if (failures > 0) {
        try {
          logger.info({ loop: name, failures }, "chain ingest loop recovered");
        } catch {
          // A failing logger must not stop the loop.
        }
      }
      failures = 0;
    } catch (error: unknown) {
      failures += 1;
      delayMs = backoffDelayMs(failures, options.retryBaseMs, options.retryMaxMs);
      try {
        logger.error(
          { error: summarizeError(error), loop: name, failures, retryInMs: delayMs },
          "chain ingest step failed, retrying",
        );
      } catch {
        // A failing logger must not stop the loop.
      }
    }
    await abortableSleep(delayMs, signal);
  }
}

/**
 * Event ingestion of the escrow (SPEC HE-1, the `eth_getLogs` source, and the projection of
 * every source): a poller that copies the escrow's logs into `chain_events` every
 * `pollIntervalMs`, and a projector that applies the unprocessed rows of `chain_events` to the
 * database every `projectIntervalMs`. Both start at once, never throw out of their loops, and
 * stop on abort with no timer left running.
 */
export function startChainIngest(options: ChainIngestOptions): ChainIngest {
  const { db, publicClient, escrowAddress, fromBlock, logger, signal } = options;
  const pollIntervalMs = positive(options.pollIntervalMs ?? 5_000, "pollIntervalMs");
  const projectIntervalMs = positive(options.projectIntervalMs ?? 1_000, "projectIntervalMs");
  const retryBaseMs = positive(options.retryBaseMs ?? 1_000, "retryBaseMs");
  const retryMaxMs = positive(options.retryMaxMs ?? 30_000, "retryMaxMs");

  const poller = new LogPoller(
    db,
    publicClient,
    {
      escrowAddress,
      fromBlock,
      cursorName: options.cursorName,
      maxBlockRange: options.maxBlockRange,
      confirmations: options.confirmations,
    },
    logger,
  );
  const projector = new ChainProjector(db, logger, { batchSize: options.projectBatchSize });

  const pollLoop = runLoop(
    "logs",
    async () => {
      const result = await poller.pollOnce(signal);
      if (result.inserted > 0) {
        logger.info(
          { toBlock: result.toBlock, events: result.events, inserted: result.inserted },
          "escrow events read from logs",
        );
      }
    },
    { signal, intervalMs: pollIntervalMs, retryBaseMs, retryMaxMs, logger },
  );
  const projectLoop = runLoop(
    "projector",
    async () => {
      const result = await projector.runPass(signal);
      if (result.applied + result.ignored + result.failed > 0) {
        logger.debug(
          { ...result, failingEvents: projector.failingEvents },
          "chain events projected",
        );
      }
    },
    { signal, intervalMs: projectIntervalMs, retryBaseMs, retryMaxMs, logger },
  );

  try {
    logger.info(
      {
        escrow: escrowAddress.toLowerCase(),
        fromBlock: fromBlock.toString(),
        cursor: poller.cursorName,
      },
      "chain ingest started",
    );
  } catch {
    // A failing logger must not prevent the start.
  }

  const stopped = Promise.all([pollLoop, projectLoop]).then(() => {
    try {
      logger.info("chain ingest stopped");
    } catch {
      // Nothing left to stop.
    }
  });
  return { stopped };
}
