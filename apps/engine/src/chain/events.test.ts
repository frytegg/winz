import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { winzEscrowAbi } from "@winz/shared";

import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { UnserializableValueError } from "./errors";
import {
  decodeEscrowLogs,
  insertChainEvents,
  readChainEvents,
  serializeEventArgs,
  toJsonValue,
} from "./events";
import type { ReceiptLog } from "./types";

const ESCROW: Address = getAddress("0x00000000000000000000000000000000000e5c20");
const USDC: Address = "0x3600000000000000000000000000000000000000";
// Checksummed, as viem returns addresses: mixed case that the database must not keep.
const BUYER: Address = getAddress("0xabcdef0123456789abcdef0123456789abcdef01");
const TX_HASH: Hex = `0x${"ab".repeat(32)}`;
const BLOCK = 1_234n;

function ticketPurchasedLog(logIndex: number, overrides: Partial<ReceiptLog> = {}): ReceiptLog {
  return {
    address: ESCROW,
    topics: encodeEventTopics({
      abi: winzEscrowAbi,
      eventName: "TicketPurchased",
      args: { ticketId: 2n ** 200n + 7n, id: 3n, buyer: BUYER },
    }) as Hex[],
    data: encodeAbiParameters(
      [{ type: "uint32" }, { type: "uint128" }, { type: "uint128" }, { type: "uint128" }],
      [2, 20_000_000n, 2_400_000n, 255_000n],
    ),
    logIndex,
    transactionHash: TX_HASH,
    blockNumber: BLOCK,
    ...overrides,
  };
}

/** An ERC-20 Transfer, as USDC emits twice per transfer on Arc. */
function transferLog(logIndex: number, address: Address): ReceiptLog {
  return {
    address,
    topics: [
      keccak256(toHex("Transfer(address,address,uint256)")),
      `0x${"00".repeat(12)}${BUYER.slice(2).toLowerCase()}`,
      `0x${"00".repeat(12)}${ESCROW.slice(2).toLowerCase()}`,
    ],
    data: encodeAbiParameters([{ type: "uint256" }], [20_000_000n]),
    logIndex,
    transactionHash: TX_HASH,
    blockNumber: BLOCK,
  };
}

describe("toJsonValue", () => {
  it("turns bigints into decimal strings, at any depth", () => {
    expect(toJsonValue(2n ** 255n)).toBe((2n ** 255n).toString());
    expect(toJsonValue({ a: 1n, b: [2n, { c: 3n }] })).toEqual({ a: "1", b: ["2", { c: "3" }] });
    expect(JSON.stringify(toJsonValue({ big: 9_007_199_254_740_993n }))).toBe(
      '{"big":"9007199254740993"}',
    );
  });

  it("lowercases addresses and leaves other strings alone", () => {
    expect(BUYER).not.toBe(BUYER.toLowerCase());
    expect(toJsonValue(BUYER)).toBe(BUYER.toLowerCase());
    expect(toJsonValue("Texas Wins")).toBe("Texas Wins");
    expect(toJsonValue(`0x${"AB".repeat(32)}`)).toBe(`0x${"AB".repeat(32)}`);
  });

  it("keeps numbers, booleans and null, drops undefined properties, dates become ISO strings", () => {
    expect(toJsonValue({ n: 2, ok: true, none: null, skip: undefined })).toEqual({
      n: 2,
      ok: true,
      none: null,
    });
    expect(toJsonValue(new Date("2026-11-17T10:00:00.000Z"))).toBe("2026-11-17T10:00:00.000Z");
  });

  it("refuses what JSON cannot hold and says where", () => {
    expect(() => toJsonValue({ a: [1, Number.POSITIVE_INFINITY] })).toThrow(
      UnserializableValueError,
    );
    expect(() => toJsonValue({ a: { fn: () => 1 } })).toThrow("'$.a.fn'");
    expect(() => toJsonValue(undefined)).toThrow(UnserializableValueError);
  });
});

describe("serializeEventArgs", () => {
  it("keys named arguments by name and unnamed ones by position", () => {
    expect(serializeEventArgs({ id: 3n, paused: true })).toEqual({ id: "3", paused: true });
    expect(serializeEventArgs([5n, "x"])).toEqual({ "0": "5", "1": "x" });
    expect(serializeEventArgs(undefined)).toEqual({});
  });
});

describe("decodeEscrowLogs", () => {
  it("decodes a TicketPurchased log with every argument", () => {
    const { events, undecodable } = decodeEscrowLogs([ticketPurchasedLog(4)], ESCROW);
    expect(undecodable).toEqual([]);
    expect(events).toEqual([
      {
        name: "TicketPurchased",
        args: {
          ticketId: (2n ** 200n + 7n).toString(),
          id: "3",
          buyer: BUYER.toLowerCase(),
          qty: 2,
          paid: "20000000",
          refundable: "2400000",
          maxHedgeCost: "255000",
        },
        txHash: TX_HASH,
        logIndex: 4,
        blockNumber: BLOCK,
      },
    ]);
  });

  it("ignores logs of any other address, even with an escrow event's signature", () => {
    const logs = [
      transferLog(0, USDC),
      transferLog(1, USDC),
      ticketPurchasedLog(2),
      ticketPurchasedLog(3, { address: USDC }),
    ];
    const { events, undecodable } = decodeEscrowLogs(logs, ESCROW);
    expect(events.map((event) => event.logIndex)).toEqual([2]);
    expect(undecodable).toEqual([]);
    // Positive control: seen from the other address, its two kinds of logs are considered.
    const fromUsdc = decodeEscrowLogs(logs, USDC);
    expect(fromUsdc.events.map((event) => event.logIndex)).toEqual([3]);
    expect(fromUsdc.undecodable).toHaveLength(2);
  });

  it("matches the escrow address whatever its case", () => {
    const lower = ESCROW.toLowerCase() as Address;
    expect(
      decodeEscrowLogs([ticketPurchasedLog(0, { address: lower })], ESCROW).events,
    ).toHaveLength(1);
    expect(decodeEscrowLogs([ticketPurchasedLog(0)], lower).events).toHaveLength(1);
  });

  it("reports escrow logs it cannot decode instead of dropping them silently", () => {
    const unknown = transferLog(0, ESCROW);
    const truncated = ticketPurchasedLog(1, { data: "0x" });
    const noPosition = ticketPurchasedLog(2, { logIndex: null });
    const { events, undecodable } = decodeEscrowLogs(
      [unknown, truncated, noPosition, ticketPurchasedLog(3)],
      ESCROW,
    );
    expect(events.map((event) => event.logIndex)).toEqual([3]);
    expect(undecodable).toEqual([unknown, truncated, noPosition]);
  });

  it("returns events in log order", () => {
    const { events } = decodeEscrowLogs(
      [ticketPurchasedLog(9), ticketPurchasedLog(2), ticketPurchasedLog(5)],
      ESCROW,
    );
    expect(events.map((event) => event.logIndex)).toEqual([2, 5, 9]);
  });
});

describe("insertChainEvents", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.drop();
  });

  it("writes a hand-built receipt once, and replaying it changes nothing", async () => {
    const { events } = decodeEscrowLogs(
      [transferLog(0, USDC), transferLog(1, USDC), ticketPurchasedLog(2), ticketPurchasedLog(3)],
      ESCROW,
    );
    const blockTime = new Date("2026-11-17T10:00:00.000Z");

    expect(await insertChainEvents(database.db, events, blockTime)).toBe(2);
    expect(await insertChainEvents(database.db, events, blockTime)).toBe(0);

    const rows = await database.db<
      {
        log_index: number;
        block_number: bigint;
        block_time: Date;
        name: string;
        source: string;
        args: unknown;
      }[]
    >`select * from chain_events where tx_hash = ${TX_HASH} order by log_index`;
    expect(rows.map((row) => [row.log_index, row.name, row.source, row.block_number])).toEqual([
      [2, "TicketPurchased", "receipt", BLOCK],
      [3, "TicketPurchased", "receipt", BLOCK],
    ]);
    expect(rows[0]?.block_time.toISOString()).toBe(blockTime.toISOString());
    expect(rows[0]?.args).toEqual(events[0]?.args);

    expect(await readChainEvents(database.db, TX_HASH)).toEqual(events);
  });

  it("does not overwrite an event another source already stored", async () => {
    const other: Hex = `0x${"cd".repeat(32)}`;
    await database.db`
      insert into chain_events (tx_hash, log_index, block_number, name, args, source)
      values (${other}, 0, 10, 'TicketPurchased', '{"from":"streams"}'::jsonb, 'streams')
    `;
    const { events } = decodeEscrowLogs(
      [ticketPurchasedLog(0, { transactionHash: other })],
      ESCROW,
    );
    expect(await insertChainEvents(database.db, events, null)).toBe(0);
    const rows = await database.db<{ source: string; args: unknown }[]>`
      select source, args from chain_events where tx_hash = ${other}
    `;
    expect(rows).toEqual([{ source: "streams", args: { from: "streams" } }]);
  });

  it("rolls back with the surrounding transaction", async () => {
    const third: Hex = `0x${"ef".repeat(32)}`;
    const { events } = decodeEscrowLogs(
      [ticketPurchasedLog(0, { transactionHash: third })],
      ESCROW,
    );
    await expect(
      database.db.begin(async (tx) => {
        expect(await insertChainEvents(tx, events, null)).toBe(1);
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await readChainEvents(database.db, third)).toEqual([]);
  });
});
