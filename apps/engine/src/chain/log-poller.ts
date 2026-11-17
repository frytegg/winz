import type { Logger } from "pino";
import type { Address } from "viem";

import type { Db } from "../db";
import { summarizeError } from "./error-summary";
import { decodeEscrowLogs } from "./events";
import { ChainIngestConfigError } from "./ingest-errors";
import type { DecodedEvent, Queryable, ReceiptLog } from "./types";

/** `chain_events.source` of rows written by the `eth_getLogs` poller (HE-1, the third source). */
export const LOGS_SOURCE = "logs";

/** Default width of one `eth_getLogs` request, in blocks. */
export const DEFAULT_MAX_BLOCK_RANGE = 2_000n;

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
}

/** Name of the cursor row of the poller of `escrow`, when none is configured. */
export function defaultCursorName(escrow: Address): string {
  return `escrow-logs:${escrow.toLowerCase()}`;
}

/** Messages and codes of an error and of every error in its `cause` chain. */
function errorChain(error: unknown): { messages: string[]; codes: number[] } {
  const messages: string[] = [];
  const codes: number[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current !== undefined && current !== null; depth += 1) {
    if (typeof current === "string") {
      messages.push(current);
      break;
    }
    if (typeof current !== "object") break;
    const record = current as Record<string, unknown>;
    for (const key of ["message", "shortMessage", "details"] as const) {
      const value = record[key];
      if (typeof value === "string") messages.push(value);
    }
    if (typeof record.code === "number") codes.push(record.code);
    current = record.cause;
  }
  return { messages, codes };
}

const RANGE_REFUSAL_PATTERNS: readonly RegExp[] = [
  /block range/i,
  /range (is )?too (large|wide|big)/i,
  /exceeds? .*range/i,
  /max(imum)? .*range/i,
  /too many (results|logs|blocks)/i,
  /more than \d+ (results|logs|blocks)/i,
  /query returned more than/i,
  /response (size|is too)/i,
  /log response size exceeded/i,
];

/**
 * Whether an `eth_getLogs` failure is the node refusing the size of the request (too many
 * blocks or too many results), as opposed to the node being unreachable or failing. Nodes word
 * it differently; EIP-1474 reserves code -32005 for "limit exceeded".
 */
export function isRangeRefusal(error: unknown): boolean {
  const { messages, codes } = errorChain(error);
  if (codes.includes(-32005)) return true;
  return messages.some((message) =>
    RANGE_REFUSAL_PATTERNS.some((pattern) => pattern.test(message)),
  );
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
  private range: bigint;
  private successesSinceShrink = 0;

  constructor(
    private readonly db: Db,
    private readonly client: LogClient,
    private readonly config: LogPollerConfig,
    private readonly logger: Logger,
  ) {
    this.cursorName = config.cursorName ?? defaultCursorName(config.escrowAddress);
    this.maxRange = config.maxBlockRange ?? DEFAULT_MAX_BLOCK_RANGE;
    this.confirmations = config.confirmations ?? 0n;
    if (this.maxRange < 1n) throw new ChainIngestConfigError("maxBlockRange must be at least 1");
    if (this.confirmations < 0n) throw new ChainIngestConfigError("confirmations must be >= 0");
    if (config.fromBlock < 0n) throw new ChainIngestConfigError("fromBlock must be >= 0");
    this.range = this.maxRange;
  }

  /** Current width of a request; below the maximum while the node refuses wider ones. */
  get currentRange(): bigint {
    return this.range;
  }

  /**
   * Reads everything between the cursor and the head. Throws the first RPC or database error
   * it cannot handle; what was read before it is stored and the cursor stays there. Stops
   * between two ranges when `signal` aborts.
   */
  async pollOnce(signal?: AbortSignal): Promise<PollResult> {
    const result: PollResult = { toBlock: null, requests: 0, events: 0, inserted: 0 };
    const latest = await this.client.getBlockNumber({ cacheTime: 0 });
    const head = latest - this.confirmations;
    const cursor = await readCursor(this.db, this.cursorName);
    let next = cursor === null ? this.config.fromBlock : cursor + 1n;

    while (next <= head && signal?.aborted !== true) {
      const to = next + this.range - 1n < head ? next + this.range - 1n : head;
      let logs: readonly ReceiptLog[];
      try {
        logs = await this.client.getLogs({
          address: this.config.escrowAddress,
          fromBlock: next,
          toBlock: to,
        });
      } catch (error: unknown) {
        if (this.range > 1n && isRangeRefusal(error)) {
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
