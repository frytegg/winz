import { createHmac, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";

import type { Logger } from "pino";
import { decodeEventLog, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";

import { winzEscrowAbi } from "@winz/shared";

import type { Db } from "./db";
import type { ServerConfig } from "./deps";
import { DEFAULT_QUICKNODE_STREAMS_NETWORK } from "./env";
import { serverLogger } from "./logger";
import { ApiRouteError, type RouteResponse } from "./route";

/**
 * POST /api/webhooks/quicknode (SPEC HE-1 and section 10, task A-06): a QuickNode Streams
 * delivery, verified on its raw body, whose `WinzEscrow` logs are written to `chain_events` with
 * source `streams`, in exactly the form the engine's two other sources write them (the relayer's
 * receipt and the `eth_getLogs` poller), once per `(tx_hash, log_index)`. The engine's projector
 * applies every unprocessed row whatever process wrote it, so nothing here waits for the engine.
 *
 * QuickNode's documented scheme (docs/quicknode.md cites the pages): three headers, `x-qn-nonce`,
 * `x-qn-timestamp` and `x-qn-signature`; the signature is the hex HMAC-SHA256, keyed with the
 * stream's security token, of nonce + timestamp + the uncompressed JSON body, concatenated with
 * no separator. A gzip-compressed delivery says so with `Content-Encoding: gzip`. The timestamp
 * is a Unix time in seconds (the guide's sample delivery shows `1735613672`).
 *
 * No freshness window on that timestamp: QuickNode does not document whether a retry is signed
 * again, nor how a stream resumed after a pause re-sends the batch it paused on, and a window
 * that refused those would pause the stream for good after its retries (3 by default). A replayed
 * delivery is harmless here: it can only carry logs the signature covers, and storing them again
 * changes nothing (`on conflict do nothing` on `(tx_hash, log_index)`).
 */

/** `webhookAckSchema`. */
export type QuicknodeWebhookAck = RouteResponse<"quicknodeWebhook">;

/** `chain_events.source` of rows written from a QuickNode Streams delivery. */
export const STREAMS_SOURCE = "streams";

/**
 * Largest delivery read, compressed or not, in bytes: 4 MiB. A full Arc block (30 M gas) of
 * purchases is about 120 `buyFor` (about 244 000 gas each, docs/arc-testnet.md), that is about 360
 * logs with the two USDC transfers of each, about 450 kB of JSON unfiltered and 150 kB once the
 * stream's filter keeps the escrow's logs only. 4 MiB holds several such blocks in one batch and
 * stays under the 4.5 MB a Vercel function accepts as a request body.
 */
export const MAX_DELIVERY_BYTES = 4 * 1024 * 1024;

/**
 * QuickNode's name of Arc testnet in a delivery's metadata, unless `QUICKNODE_STREAMS_NETWORK`
 * says otherwise: env.ts's default, the one value. QuickNode's documentation names networks
 * `<chain>-<network>` (`ethereum-mainnet`) without listing Arc's: the first recorded delivery
 * (apps/engine/fixtures/quicknode) confirms it.
 */
export const DEFAULT_STREAMS_NETWORK = DEFAULT_QUICKNODE_STREAMS_NETWORK;

/** Header names, lowercase as `Headers` returns them. */
export const QUICKNODE_HEADERS = {
  nonce: "x-qn-nonce",
  timestamp: "x-qn-timestamp",
  signature: "x-qn-signature",
  /** The stream's network: QuickNode sends every metadata field as a header too. */
  network: "stream-network",
} as const;

/** What the route needs from the server's configuration. */
export interface StreamsSettings {
  /** `QUICKNODE_STREAMS_TOKEN`, the stream's security token; null while not configured. */
  token: string | null;
  /** `ARC_ESCROW_ADDRESS`; null while not configured. */
  escrowAddress: string | null;
  /** `QUICKNODE_STREAMS_NETWORK`, default `arc-testnet`. */
  network: string;
}

/**
 * The route's settings, from the server's configuration (deps.ts `serverConfigOf`, the one reader
 * of the environment), read at each call, never at import time.
 */
export function streamsSettingsOf(
  config: Pick<ServerConfig, "streamsToken" | "streamsNetwork" | "escrowAddress">,
): StreamsSettings {
  return {
    token: config.streamsToken,
    escrowAddress: config.escrowAddress,
    network: config.streamsNetwork,
  };
}

// ---------------------------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------------------------

/**
 * The hex signature QuickNode puts in `x-qn-signature`: HMAC-SHA256 keyed with the token, of
 * nonce + timestamp + payload. Exported for the tests and the fixtures' replay.
 */
export function signStreamsPayload(
  token: string,
  nonce: string,
  timestamp: string,
  payload: Uint8Array,
): string {
  return createHmac("sha256", token)
    .update(nonce, "utf8")
    .update(timestamp, "utf8")
    .update(payload)
    .digest("hex");
}

/** Whether `signature` is the signature of `payload`, compared in constant time. */
export function streamsSignatureMatches(
  token: string,
  nonce: string,
  timestamp: string,
  payload: Uint8Array,
  signature: string,
): boolean {
  if (!/^[0-9a-fA-F]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signStreamsPayload(token, nonce, timestamp, payload), "hex");
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

/**
 * `x-qn-timestamp` in milliseconds; null when the header is not a decimal number. QuickNode
 * documents a Unix time in seconds (its sample shows `1735613672`). A value of 13 digits or more
 * can only be milliseconds (10^12 s is the year 33658): it is read so rather than refused, since
 * the value gates nothing. Only logged, as the delivery's age when received: no window applies.
 */
export function streamsTimestampMs(header: string): number | null {
  if (!/^[0-9]{1,16}$/.test(header)) return null;
  const value = Number(header);
  return value < 1e12 ? value * 1000 : value;
}

// ---------------------------------------------------------------------------------------------
// The engine's encoding, mirrored
// ---------------------------------------------------------------------------------------------
//
// apps/web never imports apps/engine in production code (it is not a dependency of the web app
// and Next.js only transpiles @winz/shared and @winz/pricing), so the three functions below are
// copies of `toJsonValue`, `serializeEventArgs` and `decodeEscrowLogs` of
// apps/engine/src/chain/events.ts. quicknode-webhook.contract.test.ts fails the day the two
// forms differ: every event of `winzEscrowAbi` through both gives byte-identical rows.

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

/** A value JSON cannot hold in an event's arguments. Mirrors the engine's error of that name. */
export class UnserializableValueError extends Error {
  constructor(public readonly path: string) {
    super(`value at ${path} cannot be stored as JSON`);
    this.name = "UnserializableValueError";
  }
}

/** Mirror of the engine's `toJsonValue`: bigints as decimal strings, addresses lowercase. */
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

/** Mirror of the engine's `serializeEventArgs`. */
export function serializeEventArgs(args: unknown): JsonObject {
  if (args === undefined || args === null) return {};
  const serialized = toJsonValue(args, "args");
  if (Array.isArray(serialized)) {
    return Object.fromEntries(serialized.map((item, index) => [index.toString(), item]));
  }
  if (typeof serialized === "object" && serialized !== null) return serialized;
  throw new UnserializableValueError("args");
}

/** One log of a delivery, with the time of its block when the delivery carries it. */
export interface StreamsLog {
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  logIndex: number;
  transactionHash: Hex;
  blockNumber: bigint;
  /** The block's timestamp; null when the delivery does not carry it. */
  blockTime: Date | null;
  /** True when QuickNode flags the log as removed by a reorganisation. */
  removed: boolean;
}

/** One `WinzEscrow` event, in the form stored in `chain_events` (the engine's `DecodedEvent`). */
export interface StreamsEvent {
  name: string;
  args: JsonObject;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTime: Date | null;
}

/**
 * Mirror of the engine's `decodeEscrowLogs`: the logs of `escrowAddress` decoded with
 * `winzEscrowAbi` (strict), the others ignored; a log of the escrow the ABI cannot decode is
 * returned apart. Ordered by block, then log index.
 */
export function decodeEscrowLogs(
  logs: readonly StreamsLog[],
  escrowAddress: string,
): { events: StreamsEvent[]; undecodable: StreamsLog[] } {
  const escrow = escrowAddress.toLowerCase();
  const events: StreamsEvent[] = [];
  const undecodable: StreamsLog[] = [];
  for (const log of logs) {
    if (log.address.toLowerCase() !== escrow) continue;
    const [signature, ...indexed] = log.topics;
    if (signature === undefined) {
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
        blockTime: log.blockTime,
      });
    } catch {
      // An event the ABI does not know, or one whose data does not match its definition.
      undecodable.push(log);
    }
  }
  events.sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1,
  );
  return { events, undecodable };
}

/**
 * Writes the events to `chain_events` with source `streams`, the engine's columns and encoding
 * (`insertChainEvents`, `insertLogEvents`), `on conflict do nothing` on `(tx_hash, log_index)`:
 * an event already stored by any source changes nothing. One database transaction for the whole
 * delivery: a failure leaves nothing of it. Returns the number of rows inserted.
 */
export async function insertStreamsEvents(
  db: Db,
  events: readonly StreamsEvent[],
): Promise<number> {
  return db.begin(async (tx) => {
    let inserted = 0;
    for (const event of events) {
      const rows = await tx<{ tx_hash: string }[]>`
        insert into chain_events (tx_hash, log_index, block_number, block_time, name, args, source)
        values (
          ${event.txHash.toLowerCase()}, ${event.logIndex}, ${event.blockNumber.toString()}::bigint,
          ${event.blockTime}, ${event.name}, ${tx.json(event.args)}, ${STREAMS_SOURCE}
        )
        on conflict (tx_hash, log_index) do nothing
        returning tx_hash
      `;
      inserted += rows.length;
    }
    return inserted;
  });
}

// ---------------------------------------------------------------------------------------------
// The delivery's shape
// ---------------------------------------------------------------------------------------------

const hexData = z.string().regex(/^0x([0-9a-fA-F]{2})*$/, "hex bytes");
const hash32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "a 32-byte hash");
const addressString = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "an address");

/** Largest block number stored: `chain_events.block_number` is a Postgres `bigint`. */
export const MAX_BLOCK_NUMBER = 2n ** 63n - 1n;
/** Largest log index stored: `chain_events.log_index` is a Postgres `integer`. */
export const MAX_LOG_INDEX = 2n ** 31n - 1n;
/**
 * Largest block time accepted, in Unix seconds: 9999-12-31T23:59:59Z, the last second whose ISO
 * form (four-digit year, how the client sends a `Date`) both JavaScript and Postgres's
 * `timestamptz` read. Arc's blocks are dated 2026.
 */
export const MAX_BLOCK_TIMESTAMP = 253_402_300_799n;

/**
 * A JSON-RPC quantity (`0x`-prefixed hex), or a plain non-negative integer, as a bigint no larger
 * than `max`: a value out of range is a malformed delivery (400), never a database failure (500)
 * that QuickNode would retry until the stream pauses.
 */
function quantity(max: bigint, what: string): z.ZodType<bigint, string | number> {
  const outOfRange = `${what} out of range (at most ${max.toString()})`;
  return z
    .union([
      z.string().regex(/^0x[0-9a-fA-F]{1,64}$/, "a hex quantity"),
      // A JSON number past 2^53 has lost its digits already: out of range too.
      z
        .number()
        .nonnegative()
        .refine((value) => Number.isInteger(value), "an integer")
        .refine((value) => Number.isSafeInteger(value), outOfRange),
    ])
    .transform((value) => BigInt(value))
    .refine((value) => value <= max, outOfRange);
}

/** A log as `eth_getLogs` returns it (QuickNode's `logs` dataset, and every receipt's `logs`). */
const logSchema = z.object({
  address: addressString,
  topics: z.array(hash32).max(4),
  data: hexData,
  blockNumber: quantity(MAX_BLOCK_NUMBER, "block number"),
  transactionHash: hash32,
  logIndex: quantity(MAX_LOG_INDEX, "log index"),
  removed: z.boolean().optional(),
  /** Sent by recent nodes; the block's Unix time. */
  blockTimestamp: quantity(MAX_BLOCK_TIMESTAMP, "block timestamp").nullish(),
});

/** A receipt as `eth_getBlockReceipts` returns it (`receipts` dataset); only its logs count. */
const receiptSchema = z.object({ logs: z.array(logSchema) });

/** One block of the `block_with_receipts` dataset: `{ block, receipts }`. */
const blockWithReceiptsSchema = z.object({
  block: z.object({
    number: quantity(MAX_BLOCK_NUMBER, "block number"),
    timestamp: quantity(MAX_BLOCK_TIMESTAMP, "block timestamp"),
  }),
  receipts: z.array(receiptSchema),
});

const metadataSchema = z
  .object({
    network: z.string().nullish(),
    dataset: z.string().nullish(),
    stream_id: z.string().nullish(),
    batch_start_range: z.union([z.number(), z.string()]).nullish(),
    batch_end_range: z.union([z.number(), z.string()]).nullish(),
  })
  .nullish();

type Metadata = z.output<typeof metadataSchema>;
type LogJson = z.output<typeof logSchema>;

function toStreamsLog(log: LogJson, blockTimestamp: bigint | null): StreamsLog {
  const timestamp = log.blockTimestamp ?? blockTimestamp;
  return {
    address: log.address as Address,
    topics: log.topics as Hex[],
    data: log.data as Hex,
    logIndex: Number(log.logIndex),
    transactionHash: log.transactionHash as Hex,
    blockNumber: log.blockNumber,
    // As the engine stores a block's time: its Unix seconds times 1000.
    blockTime: timestamp === null ? null : new Date(Number(timestamp) * 1000),
    removed: log.removed === true,
  };
}

/** A delivery's data is not of a documented shape: where, and why. */
export class DeliveryShapeError extends Error {
  constructor(
    public readonly path: string,
    public readonly issue: string,
  ) {
    super(`${path}: ${issue}`);
    this.name = "DeliveryShapeError";
  }
}

/** How deep arrays and filter answers may nest in a delivery's data. */
const MAX_NESTING = 6;

interface Walked {
  logs: StreamsLog[];
  /** Every metadata object found, outermost first. */
  metadata: NonNullable<Metadata>[];
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, path: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const where = [path, ...(issue?.path ?? []).map(String)].join(".");
  throw new DeliveryShapeError(where, issue?.message ?? "invalid");
}

function metadataOf(value: unknown, path: string, out: Walked): void {
  const metadata = metadataSchema.safeParse(value);
  if (!metadata.success) throw new DeliveryShapeError(`${path}.metadata`, "malformed metadata");
  if (metadata.data) out.metadata.push(metadata.data);
}

/**
 * Collects the logs of one node of a delivery's `data`. QuickNode documents the datasets as
 * arrays nested per block (`logs`: an array of arrays of log objects, its sample nests three deep;
 * `receipts`: an array per block of receipts; `block_with_receipts`: one `{ block, receipts }`
 * per block), and a stream's filter returns any JSON, delivered under `data`: so any nesting of
 * arrays, logs, receipts, blocks with receipts, nulls (nothing for that block) and filter answers
 * `{ data, metadata? }` is read, at most `MAX_NESTING` deep. Anything else is not a delivery.
 */
function walk(node: unknown, path: string, depth: number, out: Walked): void {
  if (node === null) return;
  if (depth > MAX_NESTING) throw new DeliveryShapeError(path, "nested too deep");
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, `${path}.${index.toString()}`, depth + 1, out));
    return;
  }
  if (typeof node !== "object") {
    throw new DeliveryShapeError(path, "expected a log, a receipt, a block or an array");
  }
  if ("block" in node && "receipts" in node) {
    const block = parseOrThrow(blockWithReceiptsSchema, node, path);
    for (const receipt of block.receipts) {
      for (const log of receipt.logs) out.logs.push(toStreamsLog(log, block.block.timestamp));
    }
  } else if ("logs" in node) {
    const receipt = parseOrThrow(receiptSchema, node, path);
    for (const log of receipt.logs) out.logs.push(toStreamsLog(log, null));
  } else if ("address" in node) {
    out.logs.push(toStreamsLog(parseOrThrow(logSchema, node, path), null));
  } else if ("data" in node) {
    // A filter's answer: `{ data, metadata }`, as the filter of docs/quicknode.md once returned.
    const record = node as { data: unknown; metadata?: unknown };
    metadataOf(record.metadata, path, out);
    walk(record.data, `${path}.data`, depth + 1, out);
  } else {
    throw new DeliveryShapeError(path, "expected a log, a receipt, a block or an array");
  }
}

/**
 * The delivery's logs and every metadata object it carries. The body is `{ data, metadata }`
 * (QuickNode puts the metadata in the body and in headers on every delivery), or, from an older
 * stream or a filter, the bare data, or a filter's `{ data, metadata }` once more inside `data`.
 */
function readDelivery(body: unknown): Walked {
  const out: Walked = { logs: [], metadata: [] };
  if (Array.isArray(body)) {
    walk(body, "data", 1, out);
    return out;
  }
  if (typeof body !== "object" || body === null || !("data" in body)) {
    throw new DeliveryShapeError("$", "not a Streams delivery: no data");
  }
  const record = body as { data: unknown; metadata?: unknown };
  metadataOf(record.metadata, "$", out);
  if (!Array.isArray(record.data) && !(typeof record.data === "object" && record.data !== null)) {
    throw new DeliveryShapeError("data", "expected an array of blocks");
  }
  walk(record.data, "data", 1, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Reading the body
// ---------------------------------------------------------------------------------------------

/** The body was larger than `MAX_DELIVERY_BYTES`. */
export class DeliveryTooLargeError extends Error {
  constructor(public readonly limit: number) {
    super(`delivery larger than ${limit.toString()} bytes`);
    this.name = "DeliveryTooLargeError";
  }
}

/** The request's body as bytes, refused as soon as it passes `limit`. */
async function readBodyLimited(request: Request, limit: number): Promise<Buffer> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^[0-9]+$/.test(declared) && Number(declared) > limit) {
    throw new DeliveryTooLargeError(limit);
  }
  if (request.body === null) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new DeliveryTooLargeError(limit);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** True when the bytes start with gzip's magic number. */
function looksGzipped(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * The uncompressed payload. With `Content-Encoding: gzip` the body is inflated, at most to
 * `limit` bytes; a body that does not start with gzip's magic number is taken as already
 * inflated (a proxy on the way may have done it).
 */
function inflate(raw: Buffer, contentEncoding: string | null, limit: number): Buffer {
  const encodings = (contentEncoding ?? "").toLowerCase();
  if (!encodings.includes("gzip") || !looksGzipped(raw)) return raw;
  try {
    return gunzipSync(raw, { maxOutputLength: limit });
  } catch (error: unknown) {
    if (
      error instanceof RangeError ||
      (error as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE"
    ) {
      throw new DeliveryTooLargeError(limit);
    }
    throw new ApiRouteError(400, "invalid_request", "Invalid body: not valid gzip");
  }
}

// ---------------------------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------------------------

let reportedUnconfigured = false;

/** Test only: the "not configured" error is logged again at the next refusal. */
export function resetStreamsWarningsForTesting(): void {
  reportedUnconfigured = false;
}

export interface QuicknodeWebhookInput {
  db: Db;
  request: Request;
  settings: StreamsSettings;
  /** The time the delivery is received, for the timestamp tolerance. */
  now: Date;
  /** Default: `serverLogger("quicknode-webhook")`. */
  logger?: Logger;
}

function unauthenticated(log: Logger, reason: string, bytes?: number): ApiRouteError {
  // Never the token, the signature or the payload.
  log.warn(
    { reason, ...(bytes === undefined ? {} : { bytes }) },
    "quicknode delivery refused: signature not verified",
  );
  return new ApiRouteError(401, "unauthenticated", "Invalid webhook signature");
}

function errorSummary(error: unknown): { type: string; message: string } {
  if (error instanceof Error) return { type: error.name, message: error.message.slice(0, 300) };
  return { type: typeof error, message: "" };
}

/**
 * Verifies and stores one Streams delivery. Answers, by throwing an `ApiRouteError`:
 * 503 while the token or the escrow address is not configured (logged once per process);
 * 413 above `MAX_DELIVERY_BYTES`, compressed or inflated; 401 when a header is missing, the
 * timestamp is not a decimal number of seconds, or the signature is not the token's over the
 * uncompressed body (stores nothing); 400 for a body that is not JSON of a documented shape, a
 * quantity out of what the table stores (block number, log index, block time), or a delivery that
 * names no network or another one than configured; 500 when the database fails, so that
 * QuickNode retries. Otherwise `{ received: true }`. A signed delivery is accepted however old
 * its timestamp (see the top of this file).
 *
 * Only the escrow's logs are kept; those the ABI cannot decode are skipped with a warning, as the
 * engine does. A log flagged `removed` is never stored, and logged as an error: Arc has
 * deterministic finality and the engine's readers have no reorg handling (an `eth_getLogs`
 * answer and a receipt never carry a removed log), so it should never happen.
 */
export async function handleQuicknodeWebhook(
  input: QuicknodeWebhookInput,
): Promise<QuicknodeWebhookAck> {
  const { db, request, settings, now } = input;
  const log = input.logger ?? serverLogger("quicknode-webhook");

  const token = settings.token;
  const escrowAddress = settings.escrowAddress;
  if (token === null || escrowAddress === null) {
    if (!reportedUnconfigured) {
      reportedUnconfigured = true;
      log.error(
        { token: token !== null, escrowAddress: escrowAddress !== null },
        "quicknode stream not configured: QUICKNODE_STREAMS_TOKEN or ARC_ESCROW_ADDRESS is missing, deliveries are refused with 503",
      );
    }
    throw new ApiRouteError(503, "internal", "QuickNode Streams is not configured");
  }

  // The headers first: an unsigned request is refused before its body is read.
  const nonce = request.headers.get(QUICKNODE_HEADERS.nonce);
  const timestamp = request.headers.get(QUICKNODE_HEADERS.timestamp);
  const signature = request.headers.get(QUICKNODE_HEADERS.signature);
  if (nonce === null || timestamp === null || signature === null) {
    throw unauthenticated(log, "missing signature headers");
  }
  const sentAtMs = streamsTimestampMs(timestamp);
  if (sentAtMs === null) throw unauthenticated(log, "malformed timestamp");

  let raw: Buffer;
  let payload: Buffer;
  try {
    raw = await readBodyLimited(request, MAX_DELIVERY_BYTES);
    payload = inflate(raw, request.headers.get("content-encoding"), MAX_DELIVERY_BYTES);
  } catch (error: unknown) {
    if (error instanceof DeliveryTooLargeError) {
      log.warn({ limit: MAX_DELIVERY_BYTES }, "quicknode delivery refused: too large");
      throw new ApiRouteError(413, "invalid_request", "Delivery too large");
    }
    throw error;
  }

  // QuickNode signs the uncompressed JSON; the compressed bytes are tried too, in case it ever
  // signs what it sends. Both need the token.
  const verified =
    streamsSignatureMatches(token, nonce, timestamp, payload, signature) ||
    (payload !== raw && streamsSignatureMatches(token, nonce, timestamp, raw, signature));
  if (!verified) throw unauthenticated(log, "signature mismatch", raw.length);

  let body: unknown;
  try {
    body = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new ApiRouteError(400, "invalid_request", "Invalid body: expected a JSON document");
  }
  let delivery: Walked;
  try {
    delivery = readDelivery(body);
  } catch (error: unknown) {
    if (!(error instanceof DeliveryShapeError)) throw error;
    // Signed by QuickNode yet unreadable: a retry cannot fix it, and it is said once, here.
    log.warn(
      { path: error.path, issue: error.issue, bytes: payload.length },
      "quicknode delivery refused: not a documented shape",
    );
    throw new ApiRouteError(400, "invalid_request", "Invalid body: not a Streams delivery");
  }

  const headerNetwork = request.headers.get(QUICKNODE_HEADERS.network);
  const networks = [
    ...delivery.metadata.map((meta) => meta.network).filter((name) => typeof name === "string"),
    ...(headerNetwork === null || headerNetwork.trim() === "" ? [] : [headerNetwork.trim()]),
  ];
  const meta = delivery.metadata[delivery.metadata.length - 1];
  const context = {
    network: networks[0] ?? null,
    dataset: meta?.dataset ?? null,
    streamId: meta?.stream_id ?? null,
    batchStart: meta?.batch_start_range ?? null,
    batchEnd: meta?.batch_end_range ?? null,
  };
  if (networks.length === 0) {
    log.error(context, "quicknode delivery refused: it names no network (metadata turned off?)");
    throw new ApiRouteError(400, "invalid_request", "Delivery names no network");
  }
  const foreign = networks.find((name) => name !== settings.network);
  if (foreign !== undefined) {
    log.error(
      { ...context, expected: settings.network, received: foreign },
      "quicknode delivery refused: the stream is on another network",
    );
    throw new ApiRouteError(400, "invalid_request", "Delivery from another network");
  }

  const logs = delivery.logs;
  const escrow = escrowAddress.toLowerCase();
  const removed = logs.filter((entry) => entry.removed);
  for (const entry of removed.filter((item) => item.address.toLowerCase() === escrow)) {
    log.error(
      { txHash: entry.transactionHash, logIndex: entry.logIndex, blockNumber: entry.blockNumber },
      "escrow log flagged removed (reorg) by QuickNode, not stored",
    );
  }
  const { events, undecodable } = decodeEscrowLogs(
    logs.filter((entry) => !entry.removed),
    escrow,
  );
  for (const entry of undecodable) {
    log.warn(
      {
        txHash: entry.transactionHash,
        logIndex: entry.logIndex,
        blockNumber: entry.blockNumber,
        topic0: entry.topics[0],
      },
      "escrow log that winzEscrowAbi cannot decode, skipped",
    );
  }

  let inserted: number;
  try {
    inserted = events.length === 0 ? 0 : await insertStreamsEvents(db, events);
  } catch (error: unknown) {
    log.error(
      { ...context, error: errorSummary(error), events: events.length },
      "quicknode delivery not stored: database failure, QuickNode will retry",
    );
    throw new ApiRouteError(500, "internal", "Internal error");
  }

  const newest = events.reduce<number | null>(
    (latest, event) =>
      event.blockTime === null
        ? latest
        : Math.max(latest ?? Number.NEGATIVE_INFINITY, event.blockTime.getTime()),
    null,
  );
  log.info(
    {
      ...context,
      logs: logs.length,
      escrowEvents: events.length,
      inserted,
      otherAddresses: logs.filter((entry) => entry.address.toLowerCase() !== escrow).length,
      undecodable: undecodable.length,
      removed: removed.length,
      delayMs: newest === null ? null : now.getTime() - newest,
      // From QuickNode's signature to the reception: a retry or a resumed stream shows here.
      signedAgeMs: now.getTime() - sentAtMs,
    },
    "quicknode delivery stored",
  );
  return { received: true };
}
