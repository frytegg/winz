import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";

import {
  encodeAbiParameters,
  encodeEventTopics,
  numberToHex,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";

import { winzEscrowAbi } from "@winz/shared";

import {
  DEFAULT_STREAMS_NETWORK,
  QUICKNODE_HEADERS,
  signStreamsPayload,
} from "../quicknode-webhook";

/**
 * Test-only builders of QuickNode Streams deliveries in the documented shape (docs/quicknode.md):
 * logs in `eth_getLogs` form, grouped by block, signed like QuickNode signs them. Never a real
 * token: `TEST_STREAMS_TOKEN` is a fixed test value.
 */

export const TEST_STREAMS_TOKEN = "qn-streams-test-token-not-a-secret";

/** A log as a node's JSON-RPC returns it, with the optional `blockTimestamp` of recent nodes. */
export interface RpcLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: Hex;
  logIndex: Hex;
  removed: boolean;
  blockTimestamp?: Hex;
}

/** What viem returns for a log (receipt or `getLogs`). */
export interface ViemLog {
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  blockNumber: bigint | null;
  blockHash: Hex | null;
  transactionHash: Hex | null;
  transactionIndex: number | null;
  logIndex: number | null;
}

/** A viem log in JSON-RPC form, as QuickNode delivers it. `blockTimestamp` in Unix seconds. */
export function rpcLogOf(log: ViemLog, blockTimestamp?: bigint): RpcLog {
  if (
    log.blockNumber === null ||
    log.blockHash === null ||
    log.transactionHash === null ||
    log.transactionIndex === null ||
    log.logIndex === null
  ) {
    throw new Error("a pending log cannot be delivered");
  }
  return {
    address: log.address,
    topics: [...log.topics],
    data: log.data,
    blockNumber: numberToHex(log.blockNumber),
    blockHash: log.blockHash,
    transactionHash: log.transactionHash,
    transactionIndex: numberToHex(log.transactionIndex),
    logIndex: numberToHex(log.logIndex),
    removed: false,
    ...(blockTimestamp === undefined ? {} : { blockTimestamp: numberToHex(blockTimestamp) }),
  };
}

export function randomHash(): Hex {
  return `0x${randomBytes(32).toString("hex")}`;
}

export type EscrowEventName = Extract<(typeof winzEscrowAbi)[number], { type: "event" }>["name"];

function eventOf(name: EscrowEventName): AbiEvent {
  const event = winzEscrowAbi.find((item) => item.type === "event" && item.name === name);
  if (event === undefined || event.type !== "event") throw new Error(`no event ${name}`);
  return event as AbiEvent;
}

/** A log of `name` emitted by `address` with these arguments, encoded with `winzEscrowAbi`. */
export function escrowLog(
  name: EscrowEventName,
  args: Record<string, unknown>,
  at: {
    address: Address;
    txHash: Hex;
    logIndex: number;
    blockNumber: bigint;
    blockTimestamp?: bigint;
  },
): RpcLog {
  const event = eventOf(name);
  const topics = encodeEventTopics({
    abi: [event],
    eventName: event.name,
    args: args as never,
  }) as Hex[];
  const dataInputs = event.inputs.filter((input) => input.indexed !== true);
  const data = encodeAbiParameters(
    dataInputs,
    dataInputs.map((input) => args[input.name ?? ""]),
  );
  return {
    address: at.address,
    topics,
    data,
    blockNumber: numberToHex(at.blockNumber),
    blockHash: randomHash(),
    transactionHash: at.txHash,
    transactionIndex: "0x0",
    logIndex: numberToHex(at.logIndex),
    removed: false,
    ...(at.blockTimestamp === undefined ? {} : { blockTimestamp: numberToHex(at.blockTimestamp) }),
  };
}

export interface DeliveryOptions {
  network?: string;
  /**
   * Where the metadata travels: `body` (`{ data, metadata }`, the default), `header` (bare data,
   * `stream-network` header), `filter` (the filter of docs/quicknode.md: `{ metadata, data }`,
   * wrapped once more by a stream with metadata in the body).
   */
  metadataIn?: "body" | "header" | "filter";
  dataset?: string;
}

export interface Delivery {
  /** The JSON QuickNode signs. */
  json: string;
  /** Metadata headers the stream sends besides the signature. */
  headers: Record<string, string>;
}

/** The delivery of these blocks (one array of logs per block) in the `logs` dataset's shape. */
export function deliveryOf(blocks: readonly unknown[], options: DeliveryOptions = {}): Delivery {
  const network = options.network ?? DEFAULT_STREAMS_NETWORK;
  const numbers = blocks.flatMap((block) =>
    Array.isArray(block)
      ? block
          .filter(
            (log): log is RpcLog => typeof log === "object" && log !== null && "blockNumber" in log,
          )
          .map((log) => Number(BigInt(log.blockNumber)))
      : [],
  );
  const metadata = {
    batch_start_range: numbers.length === 0 ? 0 : Math.min(...numbers),
    batch_end_range: numbers.length === 0 ? 0 : Math.max(...numbers),
    dataset: options.dataset ?? "logs",
    end_range: -1,
    keep_distance_from_tip: 0,
    network,
    start_range: 0,
    stream_id: "00000000-0000-4000-8000-000000000000",
    stream_name: "winz-escrow",
    stream_region: "usa_east",
  };
  switch (options.metadataIn ?? "body") {
    case "header":
      return { json: JSON.stringify(blocks), headers: { [QUICKNODE_HEADERS.network]: network } };
    case "filter":
      return { json: JSON.stringify({ data: { metadata, data: blocks }, metadata }), headers: {} };
    default:
      return { json: JSON.stringify({ data: blocks, metadata }), headers: {} };
  }
}

export interface SignOptions {
  token?: string;
  /** The time QuickNode signs at. */
  at: Date;
  /** Unit of `x-qn-timestamp`. Default seconds. */
  timestampUnit?: "s" | "ms";
  nonce?: string;
  gzip?: boolean;
  /** Replaces the signature header (a forged or broken one). */
  signature?: string;
  /** Headers left out of the request. */
  omit?: string[];
  headers?: Record<string, string>;
}

/** POST /api/webhooks/quicknode as QuickNode sends it: signed over the uncompressed JSON. */
export function signedRequest(delivery: Delivery, options: SignOptions): Request {
  const token = options.token ?? TEST_STREAMS_TOKEN;
  const nonce = options.nonce ?? randomBytes(16).toString("hex");
  const timestamp =
    options.timestampUnit === "ms"
      ? options.at.getTime().toString()
      : Math.floor(options.at.getTime() / 1000).toString();
  const json = Buffer.from(delivery.json, "utf8");
  const signature = options.signature ?? signStreamsPayload(token, nonce, timestamp, json);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...delivery.headers,
    [QUICKNODE_HEADERS.nonce]: nonce,
    [QUICKNODE_HEADERS.timestamp]: timestamp,
    [QUICKNODE_HEADERS.signature]: signature,
    ...(options.gzip === true ? { "content-encoding": "gzip" } : {}),
    ...options.headers,
  };
  for (const name of options.omit ?? []) delete headers[name];
  return new Request("http://localhost/api/webhooks/quicknode", {
    method: "POST",
    headers,
    body: options.gzip === true ? gzipSync(json) : json,
  });
}
