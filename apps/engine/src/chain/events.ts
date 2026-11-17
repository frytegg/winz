import { decodeEventLog, isAddress, type Address, type Hex } from "viem";

import { winzEscrowAbi } from "@winz/shared";

import { UnserializableValueError } from "./errors";
import type { DecodedEvent, JsonObject, JsonValue, Queryable, ReceiptLog } from "./types";

/** `chain_events.source` of rows written from a transaction receipt (HE-1, the fast path). */
export const RECEIPT_SOURCE = "receipt";

/**
 * Turns a decoded value into what `chain_events.args` stores: bigints become decimal strings
 * (JSON numbers lose precision above 2^53), addresses are lowercased like every address in the
 * database, the rest is kept. Throws `UnserializableValueError` on anything JSON cannot hold.
 */
export function toJsonValue(value: unknown, path = "$"): JsonValue {
  if (value === null) return null;
  switch (typeof value) {
    case "bigint":
      return value.toString(10);
    case "string":
      return isAddress(value, { strict: false }) ? value.toLowerCase() : value;
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) throw new UnserializableValueError(path);
      return value;
    case "object": {
      if (Array.isArray(value)) {
        return value.map((item, index) => toJsonValue(item, `${path}[${index.toString()}]`));
      }
      if (value instanceof Date) return value.toISOString();
      const result: JsonObject = {};
      for (const [key, item] of Object.entries(value)) {
        if (item === undefined) continue;
        result[key] = toJsonValue(item, `${path}.${key}`);
      }
      return result;
    }
    default:
      throw new UnserializableValueError(path);
  }
}

/** Event arguments as a JSON object keyed by argument name (by position for unnamed ones). */
export function serializeEventArgs(args: unknown): JsonObject {
  if (args === undefined || args === null) return {};
  const serialized = toJsonValue(args, "args");
  if (Array.isArray(serialized)) {
    return Object.fromEntries(serialized.map((item, index) => [index.toString(), item]));
  }
  if (typeof serialized === "object" && serialized !== null) return serialized;
  throw new UnserializableValueError("args");
}

export interface DecodeResult {
  events: DecodedEvent[];
  /** Logs of the escrow that are not events of `winzEscrowAbi`, or lack their position. */
  undecodable: ReceiptLog[];
}

/**
 * Decodes the logs emitted by the escrow, in log order. Logs of any other address are ignored:
 * on Arc a USDC transfer emits two `Transfer` logs, and only `WinzEscrow` events are indexed
 * (SPEC section 8).
 */
export function decodeEscrowLogs(
  logs: readonly ReceiptLog[],
  escrowAddress: Address,
): DecodeResult {
  const escrow = escrowAddress.toLowerCase();
  const events: DecodedEvent[] = [];
  const undecodable: ReceiptLog[] = [];
  for (const log of logs) {
    if (log.address.toLowerCase() !== escrow) continue;
    const [signature, ...indexed] = log.topics;
    if (
      signature === undefined ||
      log.logIndex === null ||
      log.transactionHash === null ||
      log.blockNumber === null
    ) {
      undecodable.push(log);
      continue;
    }
    try {
      const decoded = decodeEventLog({
        abi: winzEscrowAbi,
        topics: [signature, ...indexed],
        data: log.data,
        strict: true,
      });
      events.push({
        name: decoded.eventName,
        args: serializeEventArgs(decoded.args),
        txHash: log.transactionHash.toLowerCase() as Hex,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
      });
    } catch {
      // An event the ABI does not know, or one whose data does not match its definition.
      undecodable.push(log);
    }
  }
  events.sort((a, b) => a.logIndex - b.logIndex);
  return { events, undecodable };
}

/**
 * Writes events to `chain_events`, once: the key is `(tx_hash, log_index)`, so a receipt read
 * twice, or an event already written by Streams or the log poller, changes nothing. Returns
 * the number of rows actually inserted.
 */
export async function insertChainEvents(
  db: Queryable,
  events: readonly DecodedEvent[],
  blockTime: Date | null,
): Promise<number> {
  let inserted = 0;
  for (const event of events) {
    const rows = await db<{ tx_hash: string }[]>`
      insert into chain_events (tx_hash, log_index, block_number, block_time, name, args, source)
      values (
        ${event.txHash.toLowerCase()}, ${event.logIndex}, ${event.blockNumber.toString()}::bigint,
        ${blockTime}, ${event.name}, ${db.json(event.args)}, ${RECEIPT_SOURCE}
      )
      on conflict (tx_hash, log_index) do nothing
      returning tx_hash
    `;
    inserted += rows.length;
  }
  return inserted;
}

interface ChainEventRow {
  tx_hash: string;
  log_index: number;
  block_number: bigint;
  name: string;
  args: JsonObject;
}

/** Events stored for a transaction, whatever source wrote them, ordered by log index. */
export async function readChainEvents(db: Queryable, txHash: Hex): Promise<DecodedEvent[]> {
  const rows = await db<ChainEventRow[]>`
    select tx_hash, log_index, block_number, name, args
    from chain_events
    where tx_hash = ${txHash.toLowerCase()}
    order by log_index asc
  `;
  return rows.map((row) => ({
    name: row.name,
    args: row.args,
    txHash: row.tx_hash as Hex,
    logIndex: row.log_index,
    blockNumber: row.block_number,
  }));
}
