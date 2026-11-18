import { randomBytes, randomInt } from "node:crypto";

import { getAddress, hexToBigInt, type AbiParameter } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { winzEscrowAbi } from "@winz/shared";

import {
  decodeEscrowLogs as engineDecode,
  insertChainEvents,
} from "../../../engine/src/chain/events";
import { insertLogEvents } from "../../../engine/src/chain/log-poller";
import type { ReceiptLog } from "../../../engine/src/chain/types";
import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import type { Db } from "./db";
import {
  DEFAULT_STREAMS_NETWORK,
  decodeEscrowLogs,
  handleQuicknodeWebhook,
  insertStreamsEvents,
  streamsSettingsOf,
  type StreamsLog,
} from "./quicknode-webhook";
import {
  TEST_STREAMS_TOKEN,
  deliveryOf,
  escrowLog,
  randomHash,
  signedRequest,
  type EscrowEventName,
  type RpcLog,
} from "./testing/quicknode-deliveries";

/**
 * The contract between the webhook's copy of the engine's encoding and the engine's own
 * (apps/engine/src/chain/events.ts): the same logs, through the engine's ingest (the receipt
 * path and the `eth_getLogs` poller) and through the webhook, give byte-identical rows of
 * `chain_events`, every column but `source`, `processed_at` and `created_at`. Every event of
 * `winzEscrowAbi`, with random arguments over each type's whole range, and a log of another
 * address and one the ABI cannot decode.
 */

const ESCROW = getAddress(`0x${randomBytes(20).toString("hex")}`);
const NOW = new Date();
const BLOCK_SECONDS = BigInt(Math.floor(NOW.getTime() / 1000) - 2);

let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
});
afterAll(async () => {
  await database.drop();
});
beforeEach(async () => {
  await db`delete from chain_events`;
});

function randomValue(parameter: AbiParameter): unknown {
  const type = parameter.type;
  if (type === "address") return getAddress(`0x${randomBytes(20).toString("hex")}`);
  if (type === "bool") return randomInt(2) === 1;
  if (type === "bytes32") return randomHash();
  const uint = /^uint(\d+)$/.exec(type);
  if (uint) {
    const bits = Number(uint[1]);
    // The extremes of the type as well as random values within it.
    const pick = randomInt(4);
    if (pick === 0) return 0n;
    if (pick === 1) return (1n << BigInt(bits)) - 1n;
    return hexToBigInt(`0x${randomBytes(bits / 8).toString("hex")}`);
  }
  throw new Error(`no generator for ${type}`);
}

const EVENTS = winzEscrowAbi.filter((item) => item.type === "event");

function randomLogs(): RpcLog[] {
  const txHash = randomHash();
  const logs: RpcLog[] = [];
  let logIndex = randomInt(0, 50);
  for (const event of EVENTS) {
    const args = Object.fromEntries(event.inputs.map((input) => [input.name, randomValue(input)]));
    logs.push(
      escrowLog(event.name as EscrowEventName, args, {
        address: ESCROW,
        txHash,
        logIndex,
        blockNumber: 72_727_350n,
        blockTimestamp: BLOCK_SECONDS,
      }),
    );
    logIndex += 1;
  }
  return logs;
}

/** The same log as the engine's readers see it (viem's form). */
function asReceiptLog(log: RpcLog): ReceiptLog {
  return {
    address: log.address,
    topics: log.topics,
    data: log.data,
    logIndex: Number(BigInt(log.logIndex)),
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber),
  };
}

function asStreamsLog(log: RpcLog): StreamsLog {
  return {
    ...asReceiptLog(log),
    logIndex: Number(BigInt(log.logIndex)),
    transactionHash: log.transactionHash,
    blockNumber: BigInt(log.blockNumber),
    blockTime: new Date(Number(BLOCK_SECONDS) * 1000),
    removed: false,
  };
}

/** Every column the three sources must agree on, as Postgres prints them. */
async function storedRows(): Promise<string[]> {
  const rows = await db<{ row: string }[]>`
    select concat_ws(' | ', tx_hash, log_index::text, block_number::text, block_time::text, name,
      args::text) as row
    from chain_events order by tx_hash, log_index
  `;
  return rows.map((row) => row.row);
}

describe("the webhook's rows and the engine's rows", () => {
  it("are byte-identical for every event of winzEscrowAbi, through the receipt, the poller and the webhook", async () => {
    const logs = Array.from({ length: 8 }, randomLogs).flat();
    const [first] = logs;
    if (first === undefined) throw new Error("no log generated");
    const foreign: RpcLog = {
      ...first,
      address: getAddress(`0x${"36".repeat(20)}`),
      logIndex: "0x3e8",
    };
    const unknown: RpcLog = { ...first, topics: [randomHash()], logIndex: "0x3e9" };
    const all = [...logs, foreign, unknown];
    const blockTime = new Date(Number(BLOCK_SECONDS) * 1000);

    // The engine's decoding: same events, same undecodable logs, same order within a receipt.
    const engine = engineDecode(all.map(asReceiptLog), ESCROW);
    const mine = decodeEscrowLogs(all.map(asStreamsLog), ESCROW);
    expect(mine.events.map(({ blockTime: _time, ...event }) => event)).toEqual(engine.events);
    expect(mine.undecodable.map((log) => log.logIndex)).toEqual(
      engine.undecodable.map((log) => log.logIndex),
    );
    expect(engine.events).toHaveLength(logs.length);

    // The receipt path (`insertChainEvents`).
    await insertChainEvents(db, engine.events, blockTime);
    const fromReceipt = await storedRows();
    await db`delete from chain_events`;
    // The log poller (`insertLogEvents`).
    await insertLogEvents(
      db,
      engine.events.map((event) => ({ event, blockTime })),
    );
    const fromPoller = await storedRows();
    await db`delete from chain_events`;
    // The webhook, through its handler, from a signed delivery.
    await handleQuicknodeWebhook({
      db,
      request: signedRequest(deliveryOf([all]), { at: NOW }),
      settings: streamsSettingsOf({
        streamsToken: TEST_STREAMS_TOKEN,
        streamsNetwork: DEFAULT_STREAMS_NETWORK,
        escrowAddress: ESCROW,
      }),
      now: NOW,
    });
    const fromWebhook = await storedRows();

    expect(fromReceipt).toHaveLength(logs.length);
    expect(fromPoller).toEqual(fromReceipt);
    expect(fromWebhook).toEqual(fromReceipt);
    const sources = await db<{ source: string }[]>`select distinct source from chain_events`;
    expect(sources).toEqual([{ source: "streams" }]);
  });

  it("is checked by this test: a row written differently is seen (positive control)", async () => {
    const purchase = randomLogs().find(
      (log) => decodeEscrowLogs([asStreamsLog(log)], ESCROW).events[0]?.name === "TicketPurchased",
    );
    if (purchase === undefined) throw new Error("no TicketPurchased generated");
    const engine = engineDecode([asReceiptLog(purchase)], ESCROW);
    await insertChainEvents(db, engine.events, new Date(Number(BLOCK_SECONDS) * 1000));
    const fromReceipt = await storedRows();
    const [event] = decodeEscrowLogs([asStreamsLog(purchase)], ESCROW).events;
    if (event === undefined) throw new Error("not decoded");
    const variants = [
      // The block's time read as ms instead of s.
      { ...event, blockTime: new Date(Number(BLOCK_SECONDS)) },
      // The buyer left checksummed instead of lowercase.
      { ...event, args: { ...event.args, buyer: getAddress(String(event.args.buyer)) } },
      // An amount as a JSON number instead of a decimal string.
      { ...event, args: { ...event.args, paid: Number(event.args.paid) } },
    ];
    for (const variant of variants) {
      await db`delete from chain_events`;
      await insertStreamsEvents(db, [variant]);
      expect(await storedRows()).not.toEqual(fromReceipt);
    }
    await db`delete from chain_events`;
    await insertStreamsEvents(db, [event]);
    expect(await storedRows()).toEqual(fromReceipt);
  });
});
