import type { Logger } from "pino";
import type { Address } from "viem";

import type { Db } from "../db";
import { abortableSleep } from "./clock";
import { summarizeError } from "./error-summary";
import { decodeEscrowLogs } from "./events";
import { ChainIngestConfigError } from "./ingest-errors";
import { classifyRpcRefusal, type RpcRefusal } from "./rpc-errors";
import type { DecodedEvent, Queryable, ReceiptLog } from "./types";

/** `chain_events.source` of rows written by the `eth_getLogs` poller (HE-1, the third source). */
export const LOGS_SOURCE = "logs";

/**
 * Default width of one `eth_getLogs` request, in blocks. Arc's public RPC accepts a span of
 * 9 999 blocks and refuses 10 000 (`-32012 requested range too large`).
 */
export const DEFAULT_MAX_BLOCK_RANGE = 2_000n;

/**
 * Default least time between the starts of two `eth_getLogs`: four a second. Arc's public RPC
 * accepted 12 within 1.4 s and refused the 13th (HTTP 429, -32005). A catch-up of 60 000 blocks
 * is then 30 requests in about 7.5 s.
 */
export const DEFAULT_MIN_REQUEST_GAP_MS = 250;

/** Default first wait after a rate-limit answer; doubled each time in a row. */
export const DEFAULT_RATE_LIMIT_BASE_DELAY_MS = 1_000;

/** Default longest wait after rate-limit answers. */
export const DEFAULT_RATE_LIMIT_MAX_DELAY_MS = 30_000;

/** Successful requests in a row after which a range that was halved is doubled again. */
const RANGE_RECOVERY_SUCCESSES = 16;

/**
 * The part of a viem public client the poller uses. A `PublicClient` satisfies it as is; tests
 * wrap one to inject faults.
 */
export interface LogClient {
  /** Called with `cacheTime: 0`: viem otherwise serves a block number up to 4 s old. */
  getBlockNumber(request?: { cacheTime?: number }): Promise<bigint>;
  getLogs(request: {
    address: Address;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<readonly ReceiptLog[]>;
  getBlock(request: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
}

export interface LogPollerConfig {
  /** Only logs emitted by this address are requested and stored. */
  escrowAddress: Address;
  /** First block read when `chain_cursor` has no row for this poller: the escrow's deployment. */
  fromBlock: bigint;
  /** Row of `chain_cursor`. Defaults to `escrow-logs:<lowercase escrow address>`. */
  cursorName?: string;
  /** Widest block range of one request. Default 2 000, halved while the node refuses it. */
  maxBlockRange?: bigint;
  /**
   * Blocks left unread behind the head. Arc has deterministic finality, so the default is 0;
   * there is no reorg handling either way.
   */
  confirmations?: bigint;
  /** Least time between the starts of two `eth_getLogs`, in ms. Default 250 (four a second). */
  minRequestGapMs?: number;
  /**
   * First wait after the node answers "rate limited", in ms, before the same range is asked
   * again. Doubled at each such answer in a row, with jitter. Default 1 000.
   */
  rateLimitBaseDelayMs?: number;
  /** Longest of those waits, in ms. Default 30 000. */
  rateLimitMaxDelayMs?: number;
  /** How a failed `eth_getLogs` is read. Default `classifyRpcRefusal`. */
  classifyError?: (error: unknown) => RpcRefusal;
  /** Source of the jitter, in [0, 1). Default `Math.random`. */
  random?: () => number;
}

export interface PollResult {
  /** Last block read and recorded in the cursor, or null when nothing was read. */
  toBlock: bigint | null;
  /** Requests made to `eth_getLogs` that succeeded. */
  requests: number;
  /** Escrow events found in the range, inserted or already present. */
  events: number;
  /** Of those, rows actually inserted (the others came first from another source). */
  inserted: number;
  /** `eth_getLogs` answered "rate limited" and waited out before asking the same range again. */
  rateLimited: number;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/**
 * Wait before asking again after the `inARow`-th rate-limit answer in a row: `baseMs` doubled
 * each time, at most `maxMs`, of which a random half is taken off ("equal jitter") so that
 * several clients refused together do not come back together. Never below half of the
 * undiscounted wait, so it only grows with `inARow` on average, and never above `maxMs`.
 */
export function rateLimitDelayMs(
  inARow: number,
  baseMs: number,
  maxMs: number,
  random: number,
): number {
  const exponent = Math.min(Math.max(inARow, 1) - 1, 30);
  const full = Math.min(maxMs, baseMs * 2 ** exponent);
  const jitter = Math.min(Math.max(random, 0), 1);
  return Math.round(full / 2 + (full / 2) * jitter);
}

/** Name of the cursor row of the poller of `escrow`, when none is configured. */
export function defaultCursorName(escrow: Address): string {
  return `escrow-logs:${escrow.toLowerCase()}`;
}

/**
 * Whether an `eth_getLogs` failure is the node refusing the size of the request (too many
 * blocks or too many results), as opposed to a rate limit, an unreachable node or a failure.
 * See `classifyRpcRefusal`: a bare -32005 is read as a rate limit, not as a size refusal.
 */
export function isRangeRefusal(error: unknown): boolean {
  return classifyRpcRefusal(error) === "too-large";
}

/**
 * Writes events read by the poller to `chain_events` with source `logs`, once: a row already
 * written by the receipt or by Streams is left as it is. Returns the number of rows inserted.
 */
export async function insertLogEvents(
  db: Queryable,
  events: readonly { event: DecodedEvent; blockTime: Date | null }[],
): Promise<number> {
  let inserted = 0;
  for (const { event, blockTime } of events) {
    const rows = await db<{ tx_hash: string }[]>`
      insert into chain_events (tx_hash, log_index, block_number, block_time, name, args, source)
      values (
        ${event.txHash.toLowerCase()}, ${event.logIndex}, ${event.blockNumber.toString()}::bigint,
        ${blockTime}, ${event.name}, ${db.json(event.args)}, ${LOGS_SOURCE}
      )
      on conflict (tx_hash, log_index) do nothing
      returning tx_hash
    `;
    inserted += rows.length;
  }
  return inserted;
}

/** Last block recorded for `name` in `chain_cursor`, or null when the poller never ran. */
export async function readCursor(db: Queryable, name: string): Promise<bigint | null> {
  const rows = await db<{ block_number: bigint }[]>`
    select block_number from chain_cursor where name = ${name}
  `;
  return rows[0]?.block_number ?? null;
}

/** Records `block` as read. The cursor never moves backwards. */
export async function writeCursor(db: Queryable, name: string, block: bigint): Promise<void> {
  await db`
    insert into chain_cursor (name, block_number)
    values (${name}, ${block.toString()}::bigint)
    on conflict (name) do update
      set block_number = greatest(chain_cursor.block_number, excluded.block_number)
  `;
}

/**
 * Reads the escrow's logs with `eth_getLogs`, from the block after the cursor up to the head
 * (minus the confirmation depth), in bounded ranges, and stores them in `chain_events`. The
 * events of a range and the cursor move are one database transaction: a crash never leaves a
 * cursor past events that were not stored, and a range read twice changes nothing.
 */
export class LogPoller {
  readonly cursorName: string;
  private readonly maxRange: bigint;
  private readonly confirmations: bigint;
  private readonly minGapMs: number;
  private readonly rateLimitBaseMs: number;
  private readonly rateLimitMaxMs: number;
  private readonly classify: (error: unknown) => RpcRefusal;
  private readonly random: () => number;
  private range: bigint;
  private successesSinceShrink = 0;
  /** Start of the last `eth_getLogs`, epoch ms, or null before the first. */
  private lastRequestAt: number | null = null;

  constructor(
    private readonly db: Db,
    private readonly client: LogClient,
    private readonly config: LogPollerConfig,
    private readonly logger: Logger,
  ) {
    this.cursorName = config.cursorName ?? defaultCursorName(config.escrowAddress);
    this.maxRange = config.maxBlockRange ?? DEFAULT_MAX_BLOCK_RANGE;
    this.confirmations = config.confirmations ?? 0n;
    this.minGapMs = config.minRequestGapMs ?? DEFAULT_MIN_REQUEST_GAP_MS;
    this.rateLimitBaseMs = config.rateLimitBaseDelayMs ?? DEFAULT_RATE_LIMIT_BASE_DELAY_MS;
    this.rateLimitMaxMs = config.rateLimitMaxDelayMs ?? DEFAULT_RATE_LIMIT_MAX_DELAY_MS;
    this.classify = config.classifyError ?? classifyRpcRefusal;
    this.random = config.random ?? Math.random;
    if (this.maxRange < 1n) throw new ChainIngestConfigError("maxBlockRange must be at least 1");
    if (this.confirmations < 0n) throw new ChainIngestConfigError("confirmations must be >= 0");
    if (config.fromBlock < 0n) throw new ChainIngestConfigError("fromBlock must be >= 0");
    if (!Number.isFinite(this.minGapMs) || this.minGapMs < 0) {
      throw new ChainIngestConfigError("minRequestGapMs must be >= 0");
    }
    if (!Number.isFinite(this.rateLimitBaseMs) || this.rateLimitBaseMs <= 0) {
      throw new ChainIngestConfigError("rateLimitBaseDelayMs must be positive");
    }
    if (!Number.isFinite(this.rateLimitMaxMs) || this.rateLimitMaxMs < this.rateLimitBaseMs) {
      throw new ChainIngestConfigError("rateLimitMaxDelayMs must be at least rateLimitBaseDelayMs");
    }
    this.range = this.maxRange;
  }

  /** Current width of a request; below the maximum while the node refuses wider ones. */
  get currentRange(): bigint {
    return this.range;
  }

  /**
   * Reads everything between the cursor and the head. Throws the first RPC or database error
   * it cannot handle; what was read before it is stored and the cursor stays there. Stops
   * between two ranges, and at once during a wait, when `signal` aborts.
   *
   * Two `eth_getLogs` start at least `minRequestGapMs` apart. A size refusal halves the range
   * and asks again at once; a rate limit waits (`rateLimitDelayMs`) and asks again for the same
   * range, so that a node that keeps refusing is asked less and less often, never more.
   */
  async pollOnce(signal?: AbortSignal, onProgress?: () => void): Promise<PollResult> {
    const result: PollResult = {
      toBlock: null,
      requests: 0,
      events: 0,
      inserted: 0,
      rateLimited: 0,
    };
    const latest = await this.client.getBlockNumber({ cacheTime: 0 });
    const head = latest - this.confirmations;
    const cursor = await readCursor(this.db, this.cursorName);
    let next = cursor === null ? this.config.fromBlock : cursor + 1n;
    let rateLimitedInARow = 0;

    while (next <= head && signal?.aborted !== true) {
      if (this.lastRequestAt !== null) {
        const gap = this.lastRequestAt + this.minGapMs - Date.now();
        if (gap > 0) {
          await abortableSleep(gap, signal);
          // The sleep returns early on abort; the loop's condition does not see it (narrowed).
          if (isAborted(signal)) break;
        }
      }
      const to = next + this.range - 1n < head ? next + this.range - 1n : head;
      let logs: readonly ReceiptLog[];
      this.lastRequestAt = Date.now();
      try {
        logs = await this.client.getLogs({
          address: this.config.escrowAddress,
          fromBlock: next,
          toBlock: to,
        });
      } catch (error: unknown) {
        const refusal = this.classify(error);
        if (refusal === "rate-limited") {
          rateLimitedInARow += 1;
          result.rateLimited += 1;
          const waitMs = rateLimitDelayMs(
            rateLimitedInARow,
            this.rateLimitBaseMs,
            this.rateLimitMaxMs,
            this.random(),
          );
          this.logger.warn(
            {
              error: summarizeError(error),
              fromBlock: next,
              toBlock: to,
              inARow: rateLimitedInARow,
              waitMs,
            },
            "node rate-limited eth_getLogs, waiting before asking for the same range again",
          );
          await abortableSleep(waitMs, signal);
          continue;
        }
        if (this.range > 1n && refusal === "too-large") {
          const refused = this.range;
          this.range = refused / 2n;
          this.successesSinceShrink = 0;
          this.logger.warn(
            {
              error: summarizeError(error),
              fromBlock: next,
              toBlock: to,
              refused,
              retryWith: this.range,
            },
            "node refused the eth_getLogs range, halving it",
          );
          continue;
        }
        throw error;
      }
      rateLimitedInARow = 0;
      result.requests += 1;
      this.recordSuccess();

      const { events, undecodable } = decodeEscrowLogs(logs, this.config.escrowAddress);
      for (const log of undecodable) {
        this.logger.warn(
          {
            txHash: log.transactionHash,
            logIndex: log.logIndex,
            blockNumber: log.blockNumber,
            topic0: log.topics[0],
          },
          "escrow log that winzEscrowAbi cannot decode, skipped",
        );
      }
      const blockTimes = await this.readBlockTimes(events);
      const rows = events.map((event) => ({
        event,
        blockTime: blockTimes.get(event.blockNumber) ?? null,
      }));
      const inserted = await this.db.begin(async (tx) => {
        const count = await insertLogEvents(tx, rows);
        await writeCursor(tx, this.cursorName, to);
        return count;
      });
      result.toBlock = to;
      result.events += events.length;
      result.inserted += inserted;
      onProgress?.();
      if (events.length > 0) {
        this.logger.debug(
          { fromBlock: next, toBlock: to, events: events.length, inserted },
          "escrow logs stored",
        );
      }
      next = to + 1n;
    }
    return result;
  }

  private recordSuccess(): void {
    if (this.range >= this.maxRange) return;
    this.successesSinceShrink += 1;
    if (this.successesSinceShrink >= RANGE_RECOVERY_SUCCESSES) {
      this.range = this.range * 2n > this.maxRange ? this.maxRange : this.range * 2n;
      this.successesSinceShrink = 0;
    }
  }

  /** Timestamp of every block that holds one of `events`, read once per block. */
  private async readBlockTimes(events: readonly DecodedEvent[]): Promise<Map<bigint, Date>> {
    const times = new Map<bigint, Date>();
    for (const event of events) {
      if (times.has(event.blockNumber)) continue;
      const block = await this.client.getBlock({ blockNumber: event.blockNumber });
      times.set(event.blockNumber, new Date(Number(block.timestamp) * 1000));
    }
    return times;
  }
}
