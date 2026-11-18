import { Writable } from "node:stream";
import { gzipSync } from "node:zlib";

import pino, { type Logger } from "pino";
import { getAddress, type Address, type Hex } from "viem";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { apiErrorSchema, webhookAckSchema } from "@winz/shared";

import { POST } from "@/app/api/webhooks/quicknode/route";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import type { Db } from "./db";
import { setServerDepsForTesting, type ServerConfig } from "./deps";
import {
  MAX_BLOCK_NUMBER,
  MAX_BLOCK_TIMESTAMP,
  MAX_DELIVERY_BYTES,
  MAX_LOG_INDEX,
  handleQuicknodeWebhook,
  resetStreamsWarningsForTesting,
  signStreamsPayload,
  streamsSettingsOf,
  type StreamsSettings,
} from "./quicknode-webhook";
import { FakeIdentity, TEST_CONFIG, serverDepsFor } from "./testing/fixtures";
import {
  TEST_STREAMS_TOKEN,
  deliveryOf,
  escrowLog,
  randomHash,
  signedRequest,
  type Delivery,
  type RpcLog,
} from "./testing/quicknode-deliveries";

/**
 * POST /api/webhooks/quicknode against a real Postgres (every migration applied): each refusal
 * with its status and nothing stored, and every accepted delivery stored once, in the engine's
 * form, with source `streams`.
 */

const now = new Date("2026-11-18T12:00:00.000Z");
const ESCROW = TEST_CONFIG.escrowAddress as Address;
const OTHER = "0x3600000000000000000000000000000000000000" as Address;
/** Checksummed (mixed case): stored lowercase. */
const BUYER = getAddress("0xabcdef0123456789abcdef0123456789abcdef01");
const BLOCK_TIME = BigInt(Math.floor(now.getTime() / 1000) - 3);

let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
});
afterAll(async () => {
  setServerDepsForTesting(undefined);
  await database.drop();
});
beforeEach(async () => {
  await db`delete from chain_events`;
  delete process.env.APP_API_MOCK;
  resetStreamsWarningsForTesting();
  configure({});
});
afterEach(() => {
  delete process.env.APP_API_MOCK;
});

/** The route's dependencies, with this configuration over `TEST_CONFIG` (token, network, escrow). */
function configure(overrides: Partial<ServerConfig>): void {
  setServerDepsForTesting({
    ...serverDepsFor(db, new FakeIdentity(), now),
    config: () => ({ ...TEST_CONFIG, ...overrides }),
  });
}

function purchase(
  txHash: Hex,
  logIndex: number,
  blockNumber: bigint,
  campaignId = 1n,
  ticketId = 7n,
): RpcLog {
  return escrowLog(
    "TicketPurchased",
    {
      ticketId,
      id: campaignId,
      buyer: BUYER,
      qty: 2,
      paid: 40_000_000n,
      refundable: 40_000_000n,
      maxHedgeCost: 5_500_000n,
    },
    { address: ESCROW, txHash, logIndex, blockNumber, blockTimestamp: BLOCK_TIME },
  );
}

/** A USDC `Transfer` in the same transaction: another address, never stored. */
function transfer(txHash: Hex, logIndex: number, blockNumber: bigint): RpcLog {
  return {
    ...purchase(txHash, logIndex, blockNumber),
    address: OTHER,
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      `0x${"0".repeat(24)}${BUYER.slice(2).toLowerCase()}`,
      `0x${"0".repeat(24)}${ESCROW.slice(2).toLowerCase()}`,
    ],
    data: `0x${40_000_000n.toString(16).padStart(64, "0")}`,
  };
}

async function post(request: Request): Promise<{ status: number; body: unknown }> {
  const response = await POST(request, { params: Promise.resolve({}) });
  return { status: response.status, body: await response.json() };
}

async function expectRefused(request: Request, status: number, code: string): Promise<void> {
  const answer = await post(request);
  expect(answer.status).toBe(status);
  expect(apiErrorSchema.parse(answer.body).error.code).toBe(code);
}

interface StoredRow {
  tx_hash: string;
  log_index: number;
  block_number: bigint;
  block_time: Date | null;
  name: string;
  args: string;
  source: string;
  processed_at: Date | null;
}

async function rows(): Promise<StoredRow[]> {
  return db<StoredRow[]>`
    select tx_hash, log_index, block_number, block_time, name, args::text as args, source,
      processed_at
    from chain_events order by block_number, log_index
  `;
}

/** A logger whose lines are kept, to read what was logged. */
function capturingLogger(): { logger: Logger; lines: () => string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      lines.push(
        ...chunk
          .toString("utf8")
          .split("\n")
          .filter((line) => line !== ""),
      );
      callback();
    },
  });
  return { logger: pino({ level: "debug" }, stream), lines: () => lines };
}

function settings(overrides: Partial<StreamsSettings> = {}): StreamsSettings {
  return { ...streamsSettingsOf(TEST_CONFIG), ...overrides };
}

/** Calls the handler with a captured logger; the status of the refusal, or 200. */
async function handle(
  request: Request,
  logger: Logger,
  overrides: Partial<StreamsSettings> = {},
): Promise<number> {
  try {
    await handleQuicknodeWebhook({ db, request, settings: settings(overrides), now, logger });
    return 200;
  } catch (error: unknown) {
    return (error as { status?: number }).status ?? -1;
  }
}

function oneBlock(): { delivery: Delivery; txHash: Hex } {
  const txHash = randomHash();
  return {
    txHash,
    delivery: deliveryOf([
      [transfer(txHash, 0, 100n), transfer(txHash, 1, 100n), purchase(txHash, 2, 100n)],
    ]),
  };
}

describe("an accepted delivery", () => {
  it("stores the escrow's logs only, in the engine's form, with source streams", async () => {
    const { delivery, txHash } = oneBlock();
    const answer = await post(signedRequest(delivery, { at: now }));
    expect(answer.status).toBe(200);
    expect(webhookAckSchema.parse(answer.body)).toEqual({ received: true });

    const stored = await rows();
    expect(stored).toHaveLength(1);
    const [row] = stored;
    expect({ ...row, args: JSON.parse(row?.args ?? "null") as unknown }).toEqual({
      tx_hash: txHash,
      log_index: 2,
      block_number: 100n,
      block_time: new Date(Number(BLOCK_TIME) * 1000),
      name: "TicketPurchased",
      // Integers as decimal strings, addresses lowercase, small ints as numbers (toJsonValue).
      args: {
        id: "1",
        qty: 2,
        paid: "40000000",
        buyer: BUYER.toLowerCase(),
        ticketId: "7",
        refundable: "40000000",
        maxHedgeCost: "5500000",
      },
      source: "streams",
      processed_at: null,
    });
  });

  it("ignores an event of winzEscrowAbi emitted by any other address (another deployment, a copy)", async () => {
    const txHash = randomHash();
    const copy: RpcLog = { ...purchase(txHash, 0, 100n), address: OTHER };
    const delivery = deliveryOf([[copy, purchase(txHash, 1, 100n)]]);
    expect((await post(signedRequest(delivery, { at: now }))).status).toBe(200);
    expect((await rows()).map((row) => row.log_index)).toEqual([1]);
  });

  it("is idempotent: the same delivery twice, or an event another source stored, changes nothing", async () => {
    const { delivery, txHash } = oneBlock();
    expect((await post(signedRequest(delivery, { at: now }))).status).toBe(200);
    const first = await rows();
    // QuickNode retries with a new nonce and timestamp.
    expect(
      (await post(signedRequest(delivery, { at: new Date(now.getTime() + 1000) }))).status,
    ).toBe(200);
    expect(await rows()).toEqual(first);

    // The receipt path stored a row first: the webhook leaves it as it is.
    await db`delete from chain_events`;
    await db`
      insert into chain_events (tx_hash, log_index, block_number, block_time, name, args, source, processed_at)
      values (${txHash}, 2, 100, null, 'TicketPurchased', '{"from":"receipt"}', 'receipt', now())
    `;
    expect((await post(signedRequest(delivery, { at: now }))).status).toBe(200);
    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ source: "receipt", args: '{"from": "receipt"}' });
  });

  it("stores a batch of two blocks and two campaigns in one delivery", async () => {
    const first = randomHash();
    const second = randomHash();
    const delivery = deliveryOf([
      [transfer(first, 0, 100n), purchase(first, 1, 100n, 1n, 7n)],
      [purchase(second, 0, 101n, 2n, 8n), transfer(second, 1, 101n)],
    ]);
    expect((await post(signedRequest(delivery, { at: now }))).status).toBe(200);
    const stored = await rows();
    expect(stored.map((row) => [row.tx_hash, row.log_index, row.block_number])).toEqual([
      [first, 1, 100n],
      [second, 0, 101n],
    ]);
    expect(stored.map((row) => (JSON.parse(row.args) as { id: string }).id)).toEqual(["1", "2"]);
  });

  it("accepts a gzip-compressed delivery signed over its uncompressed JSON", async () => {
    const { delivery } = oneBlock();
    expect((await post(signedRequest(delivery, { at: now, gzip: true }))).status).toBe(200);
    expect(await rows()).toHaveLength(1);
  });

  it("reads the timestamp in Unix seconds, as documented, and logs the delivery's age", async () => {
    const { logger, lines } = capturingLogger();
    const { delivery } = oneBlock();
    const signedAt = new Date(now.getTime() - 42_000);
    expect(await handle(signedRequest(delivery, { at: signedAt }), logger)).toBe(200);
    const stored = lines().find((line) => line.includes("quicknode delivery stored")) ?? "";
    expect(JSON.parse(stored)).toMatchObject({ signedAgeMs: 42_000 });
    // A value only milliseconds can be is read as such rather than refused: it gates nothing.
    await db`delete from chain_events`;
    expect((await post(signedRequest(delivery, { at: now, timestampUnit: "ms" }))).status).toBe(
      200,
    );
    expect(await rows()).toHaveLength(1);
  });

  it("reads the metadata from the body, the headers, or the filter's wrapped answer", async () => {
    for (const metadataIn of ["header", "filter"] as const) {
      await db`delete from chain_events`;
      const txHash = randomHash();
      const delivery = deliveryOf([[purchase(txHash, 0, 100n)]], { metadataIn });
      expect((await post(signedRequest(delivery, { at: now }))).status).toBe(200);
      expect((await rows()).map((row) => row.tx_hash)).toEqual([txHash]);
    }
  });

  it("reads the logs dataset nested three deep, as QuickNode's sample shows it", async () => {
    const txHash = randomHash();
    const delivery = deliveryOf([[[transfer(txHash, 0, 100n), purchase(txHash, 1, 100n)]], [[]]]);
    expect((await post(signedRequest(delivery, { at: now }))).status).toBe(200);
    expect((await rows()).map((row) => [row.tx_hash, row.log_index])).toEqual([[txHash, 1]]);
  });

  it("reads the answer of docs/quicknode.md's filter, bare or wrapped once more in an array", async () => {
    for (const wrapped of [false, true]) {
      await db`delete from chain_events`;
      const txHash = randomHash();
      const kept = [purchase(txHash, 0, 100n), purchase(txHash, 1, 100n)];
      const delivery = deliveryOf(wrapped ? [kept] : kept);
      expect((await post(signedRequest(delivery, { at: now }))).status).toBe(200);
      expect((await rows()).map((row) => row.log_index)).toEqual([0, 1]);
    }
  });

  it("reads the receipts and block_with_receipts datasets, the block's time from the block", async () => {
    const txHash = randomHash();
    const log = { ...purchase(txHash, 3, 100n), blockTimestamp: undefined };
    const receipts = deliveryOf([[{ transactionHash: txHash, status: "0x1", logs: [log] }]], {
      dataset: "receipts",
    });
    expect((await post(signedRequest(receipts, { at: now }))).status).toBe(200);
    expect((await rows())[0]).toMatchObject({ log_index: 3, block_time: null });

    await db`delete from chain_events`;
    const withBlock = deliveryOf(
      [
        {
          block: { number: "0x64", timestamp: `0x${BLOCK_TIME.toString(16)}`, hash: randomHash() },
          receipts: [{ transactionHash: txHash, logs: [log] }],
        },
      ],
      { dataset: "block_with_receipts" },
    );
    expect((await post(signedRequest(withBlock, { at: now }))).status).toBe(200);
    expect((await rows())[0]).toMatchObject({
      log_index: 3,
      block_time: new Date(Number(BLOCK_TIME) * 1000),
    });
  });

  it("acknowledges a delivery without any escrow log, storing nothing", async () => {
    const txHash = randomHash();
    const delivery = deliveryOf([[transfer(txHash, 0, 100n)], []]);
    expect((await post(signedRequest(delivery, { at: now }))).status).toBe(200);
    expect(await rows()).toEqual([]);
  });

  it("skips an escrow log the ABI cannot decode, with a warning, and stores the others", async () => {
    const { logger, lines } = capturingLogger();
    const txHash = randomHash();
    const unknown: RpcLog = { ...purchase(txHash, 0, 100n), topics: [randomHash()] };
    const delivery = deliveryOf([[unknown, purchase(txHash, 1, 100n)]]);
    expect(await handle(signedRequest(delivery, { at: now }), logger)).toBe(200);
    expect((await rows()).map((row) => row.log_index)).toEqual([1]);
    expect(lines().some((line) => line.includes("cannot decode, skipped"))).toBe(true);
  });

  it("never stores a log flagged removed, and logs it as an error", async () => {
    const { logger, lines } = capturingLogger();
    const txHash = randomHash();
    const delivery = deliveryOf([
      [{ ...purchase(txHash, 0, 100n), removed: true }, purchase(txHash, 1, 100n)],
    ]);
    expect(await handle(signedRequest(delivery, { at: now }), logger)).toBe(200);
    expect((await rows()).map((row) => row.log_index)).toEqual([1]);
    expect(lines().some((line) => line.includes("flagged removed"))).toBe(true);
  });
});

describe("a refused delivery stores nothing", () => {
  it("answers 401 without a signature header, whichever is missing", async () => {
    for (const header of ["x-qn-nonce", "x-qn-timestamp", "x-qn-signature"]) {
      await expectRefused(
        signedRequest(oneBlock().delivery, { at: now, omit: [header] }),
        401,
        "unauthenticated",
      );
    }
    expect(await rows()).toEqual([]);
  });

  it("answers 401 for a wrong signature: another token, a tampered body, a malformed value", async () => {
    const { delivery } = oneBlock();
    await expectRefused(
      signedRequest(delivery, { at: now, token: "another-token" }),
      401,
      "unauthenticated",
    );
    await expectRefused(
      signedRequest(delivery, { at: now, signature: "00".repeat(32) }),
      401,
      "unauthenticated",
    );
    await expectRefused(
      signedRequest(delivery, { at: now, signature: "not-hex" }),
      401,
      "unauthenticated",
    );
    // Signed for one body, sent with another: the signature is checked on the bytes received.
    const signed = signedRequest(delivery, { at: now });
    const tampered = new Request(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: delivery.json.replace("0x64", "0x65"),
    });
    await expectRefused(tampered, 401, "unauthenticated");
    // The same JSON re-serialized (spaces): the raw bytes differ, so does the signature.
    const reformatted = new Request(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: JSON.stringify(JSON.parse(delivery.json), null, 1),
    });
    await expectRefused(reformatted, 401, "unauthenticated");
    expect(await rows()).toEqual([]);
  });

  it("answers 401 for a timestamp that is not a number, and stores a signed one however old", async () => {
    const { delivery } = oneBlock();
    await expectRefused(
      signedRequest(delivery, { at: now, headers: { "x-qn-timestamp": "yesterday" } }),
      401,
      "unauthenticated",
    );
    await expectRefused(
      signedRequest(delivery, { at: now, headers: { "x-qn-timestamp": "-1735613672" } }),
      401,
      "unauthenticated",
    );
    expect(await rows()).toEqual([]);
    // No freshness window: a retry, or a stream resumed a day after its pause, is stored, and the
    // same delivery replayed changes nothing.
    const dayOld = signedRequest(delivery, { at: new Date(now.getTime() - 86_400_000) });
    expect((await post(dayOld)).status).toBe(200);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    const replay = signedRequest(delivery, { at: new Date(now.getTime() - 86_400_000) });
    expect((await post(replay)).status).toBe(200);
    expect(await rows()).toEqual(stored);
  });

  it("answers 503 while the token or the escrow address is not configured, and says it once", async () => {
    const { logger, lines } = capturingLogger();
    const request = (): Request => signedRequest(oneBlock().delivery, { at: now });
    expect(await handle(request(), logger, { token: null })).toBe(503);
    expect(await handle(request(), logger, { token: null })).toBe(503);
    expect(await handle(request(), logger, { escrowAddress: null })).toBe(503);
    expect(lines().filter((line) => line.includes("not configured"))).toHaveLength(1);

    // Through the route: the server's configuration without a token.
    configure({ streamsToken: null });
    await expectRefused(request(), 503, "internal");
    expect(await rows()).toEqual([]);
  });

  it("answers 413 above the size limit, declared, streamed, or once inflated", async () => {
    const big = Buffer.alloc(MAX_DELIVERY_BYTES + 1, 0x20);
    const at = Math.floor(now.getTime() / 1000).toString();
    const headers = {
      "x-qn-nonce": "n",
      "x-qn-timestamp": at,
      "x-qn-signature": signStreamsPayload(TEST_STREAMS_TOKEN, "n", at, big),
    };
    await expectRefused(
      new Request("http://localhost/api/webhooks/quicknode", {
        method: "POST",
        headers,
        body: big,
      }),
      413,
      "invalid_request",
    );
    // A small gzip body that inflates past the limit.
    const bomb = gzipSync(big);
    expect(bomb.length).toBeLessThan(MAX_DELIVERY_BYTES);
    await expectRefused(
      new Request("http://localhost/api/webhooks/quicknode", {
        method: "POST",
        headers: { ...headers, "content-encoding": "gzip" },
        body: bomb,
      }),
      413,
      "invalid_request",
    );
    expect(await rows()).toEqual([]);
  });

  it("answers 400 for a signed body that is not JSON, or not of a documented shape", async () => {
    for (const json of [
      "not json",
      JSON.stringify({ hello: "world" }),
      JSON.stringify({ data: [[{ address: ESCROW }]], metadata: { network: "arc-testnet" } }),
      JSON.stringify({ data: "blocks", metadata: { network: "arc-testnet" } }),
    ]) {
      await expectRefused(
        signedRequest({ json, headers: {} }, { at: now }),
        400,
        "invalid_request",
      );
    }
    expect(await rows()).toEqual([]);
  });

  it("answers 400 and logs an error for a delivery of another network, or of none", async () => {
    const { logger, lines } = capturingLogger();
    const txHash = randomHash();
    const other = deliveryOf([[purchase(txHash, 0, 100n)]], { network: "ethereum-mainnet" });
    expect(await handle(signedRequest(other, { at: now }), logger)).toBe(400);
    const header = deliveryOf([[purchase(txHash, 0, 100n)]], {
      network: "base-sepolia",
      metadataIn: "header",
    });
    expect(await handle(signedRequest(header, { at: now }), logger)).toBe(400);
    const none = { json: JSON.stringify([[purchase(txHash, 0, 100n)]]), headers: {} };
    expect(await handle(signedRequest(none, { at: now }), logger)).toBe(400);
    const errors = lines().filter((line) => line.includes('"level":50'));
    expect(errors.filter((line) => line.includes("another network"))).toHaveLength(2);
    expect(errors.filter((line) => line.includes("names no network"))).toHaveLength(1);
    expect(await rows()).toEqual([]);

    // Positive control: the configured network is accepted, here a custom one.
    configure({ streamsNetwork: "ethereum-mainnet" });
    expect((await post(signedRequest(other, { at: now }))).status).toBe(200);
  });

  it("answers 400, logged, for a quantity out of what the table stores: never a 500 retried", async () => {
    const { logger, lines } = capturingLogger();
    const txHash = randomHash();
    const valid = purchase(txHash, 0, 100n);
    const hex = (value: bigint): string => `0x${value.toString(16)}`;
    const cases: { log: unknown; issue: string }[] = [
      { log: { ...valid, blockNumber: hex(MAX_BLOCK_NUMBER + 1n) }, issue: "block number" },
      { log: { ...valid, blockNumber: hex(2n ** 255n) }, issue: "block number" },
      { log: { ...valid, logIndex: hex(MAX_LOG_INDEX + 1n) }, issue: "log index" },
      {
        log: { ...valid, blockTimestamp: hex(MAX_BLOCK_TIMESTAMP + 1n) },
        issue: "block timestamp",
      },
      { log: { ...valid, blockNumber: 2 ** 64 }, issue: "block number" },
    ];
    for (const { log, issue } of cases) {
      const delivery = deliveryOf([[log]]);
      expect(await handle(signedRequest(delivery, { at: now }), logger)).toBe(400);
      await expectRefused(signedRequest(delivery, { at: now }), 400, "invalid_request");
      const refusal = lines().filter((line) => line.includes("not a documented shape"));
      expect(refusal.at(-1)).toContain(`${issue} out of range`);
    }
    // The block of block_with_receipts is bounded too.
    const withBlock = deliveryOf(
      [
        {
          block: { number: "0x64", timestamp: hex(MAX_BLOCK_TIMESTAMP + 1n) },
          receipts: [{ logs: [valid] }],
        },
      ],
      { dataset: "block_with_receipts" },
    );
    await expectRefused(signedRequest(withBlock, { at: now }), 400, "invalid_request");
    expect(await rows()).toEqual([]);

    // Positive control: the largest values the table holds are stored.
    const largest = {
      ...valid,
      blockNumber: hex(MAX_BLOCK_NUMBER),
      logIndex: hex(MAX_LOG_INDEX),
      blockTimestamp: hex(MAX_BLOCK_TIMESTAMP),
    };
    expect((await post(signedRequest(deliveryOf([[largest]]), { at: now }))).status).toBe(200);
    expect(await rows()).toMatchObject([
      {
        block_number: MAX_BLOCK_NUMBER,
        log_index: Number(MAX_LOG_INDEX),
        block_time: new Date(Number(MAX_BLOCK_TIMESTAMP) * 1000),
      },
    ]);
  });

  it("answers 500 when the database fails, with nothing half-written, and stores on the retry", async () => {
    const txHash = randomHash();
    await db.unsafe(`
      create function test_fail_streams() returns trigger language plpgsql as $$
      begin
        if new.log_index = 7 then raise exception 'injected failure'; end if;
        return new;
      end $$;
      create trigger test_fail_streams before insert on chain_events
        for each row execute function test_fail_streams();
    `);
    try {
      const delivery = deliveryOf([[purchase(txHash, 1, 100n), purchase(txHash, 7, 100n)]]);
      await expectRefused(signedRequest(delivery, { at: now }), 500, "internal");
      expect(await rows()).toEqual([]);
      await db.unsafe(`drop trigger test_fail_streams on chain_events`);
      expect((await post(signedRequest(delivery, { at: now }))).status).toBe(200);
      expect((await rows()).map((row) => row.log_index)).toEqual([1, 7]);
    } finally {
      await db.unsafe(`
        drop trigger if exists test_fail_streams on chain_events;
        drop function if exists test_fail_streams();
      `);
    }
  });

  it("never logs the token, a signature or a nonce, whatever the outcome", async () => {
    const { logger, lines } = capturingLogger();
    const { delivery } = oneBlock();
    const nonce = "nonce-that-must-not-be-logged";
    const accepted = signedRequest(delivery, { at: now, nonce });
    const signature = accepted.headers.get("x-qn-signature") ?? "";
    expect(await handle(accepted, logger)).toBe(200);
    expect(await handle(signedRequest(delivery, { at: now, token: "wrong", nonce }), logger)).toBe(
      401,
    );
    expect(
      await handle(
        signedRequest(deliveryOf([[]], { network: "other" }), { at: now, nonce }),
        logger,
      ),
    ).toBe(400);
    const text = lines().join("\n");
    expect(text).toContain("quicknode delivery stored");
    for (const secret of [TEST_STREAMS_TOKEN, signature, nonce]) expect(text).not.toContain(secret);
  });
});

describe("mock mode", () => {
  it("still answers the example under APP_API_MOCK=true, with no signature and no token", async () => {
    process.env.APP_API_MOCK = "true";
    configure({ streamsToken: null });
    const answer = await post(
      new Request("http://localhost/api/webhooks/quicknode", { method: "POST", body: "{}" }),
    );
    expect(answer).toEqual({ status: 200, body: { received: true } });
    expect(await rows()).toEqual([]);
  });
});
