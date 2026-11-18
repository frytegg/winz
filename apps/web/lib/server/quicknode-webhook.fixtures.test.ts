import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

import type { Address, Hex } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { decodeEscrowLogs as engineDecode } from "../../../engine/src/chain/events";
import type { ReceiptLog } from "../../../engine/src/chain/types";
import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import type { Db } from "./db";
import {
  DEFAULT_STREAMS_NETWORK,
  handleQuicknodeWebhook,
  signStreamsPayload,
  type StreamsSettings,
} from "./quicknode-webhook";
import {
  TEST_STREAMS_TOKEN,
  deliveryOf,
  escrowLog,
  randomHash,
} from "./testing/quicknode-deliveries";

/**
 * Replays every delivery recorded by `pnpm quicknode:record` (apps/engine/fixtures/quicknode,
 * format in its README) through the webhook's handler, against a real Postgres. The real token is
 * never here: each recorded body is signed again with a test token and a fresh timestamp, and
 * the recorded signature, made with the real token, is shown to be refused under the test one.
 * The escrow is the one of packages/contracts/deployments/5042002.json, the network the default.
 */

const FIXTURES_DIR = fileURLToPath(new URL("../../../engine/fixtures/quicknode/", import.meta.url));
const DEPLOYMENT = fileURLToPath(
  new URL("../../../../packages/contracts/deployments/5042002.json", import.meta.url),
);
const ESCROW = (JSON.parse(readFileSync(DEPLOYMENT, "utf8")) as { escrow: Address }).escrow;

const fixtureSchema = z.object({
  format: z.literal("winz.quicknode-delivery.v1"),
  receivedAt: z.string().datetime(),
  headers: z.record(z.string(), z.string()),
  signatureVerified: z.literal(true),
  signedOver: z.enum(["uncompressed", "compressed"]),
  bodyEncoding: z.literal("base64"),
  body: z.string(),
});
type Fixture = z.output<typeof fixtureSchema>;

const FILES = readdirSync(FIXTURES_DIR)
  .filter((name) => name.endsWith(".json"))
  .sort();

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

const SETTINGS: StreamsSettings = {
  token: TEST_STREAMS_TOKEN,
  escrowAddress: ESCROW,
  network: DEFAULT_STREAMS_NETWORK,
};

/** Every object of the payload shaped like a log, wherever the dataset puts it. */
function logsIn(node: unknown, found: ReceiptLog[] = []): ReceiptLog[] {
  if (Array.isArray(node)) {
    for (const item of node) logsIn(item, found);
  } else if (typeof node === "object" && node !== null) {
    const record = node as Record<string, unknown>;
    if (
      typeof record.address === "string" &&
      Array.isArray(record.topics) &&
      typeof record.data === "string" &&
      record.logIndex !== undefined &&
      typeof record.transactionHash === "string" &&
      record.removed !== true
    ) {
      found.push({
        address: record.address as Address,
        topics: record.topics as Hex[],
        data: record.data as Hex,
        logIndex: Number(BigInt(record.logIndex as string)),
        transactionHash: record.transactionHash as Hex,
        blockNumber: BigInt(record.blockNumber as string),
      });
    } else {
      for (const value of Object.values(record)) logsIn(value, found);
    }
  }
  return found;
}

async function post(fixture: Fixture, signature?: string): Promise<number> {
  const raw = Buffer.from(fixture.body, "base64");
  const gzipped = (fixture.headers["content-encoding"] ?? "").includes("gzip");
  const payload = gzipped ? gunzipSync(raw) : raw;
  const now = new Date();
  const nonce = fixture.headers["x-qn-nonce"] ?? "replay";
  const timestamp =
    signature === undefined
      ? Math.floor(now.getTime() / 1000).toString()
      : (fixture.headers["x-qn-timestamp"] ?? "");
  const signed = fixture.signedOver === "compressed" ? raw : payload;
  const headers: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(fixture.headers).filter(([name]) => !name.startsWith("x-qn-")),
    ),
    "x-qn-nonce": nonce,
    "x-qn-timestamp": timestamp,
    "x-qn-signature": signature ?? signStreamsPayload(TEST_STREAMS_TOKEN, nonce, timestamp, signed),
  };
  const request = new Request("http://localhost/api/webhooks/quicknode", {
    method: "POST",
    headers,
    body: raw,
  });
  // The recorded timestamp is old: the recorded signature is judged at its own time.
  const at = signature === undefined ? now : new Date(Number(timestamp) * 1000);
  try {
    await handleQuicknodeWebhook({ db, request, settings: SETTINGS, now: at });
    return 200;
  } catch (error: unknown) {
    return (error as { status?: number }).status ?? -1;
  }
}

async function replay(fixture: Fixture): Promise<void> {
  const raw = Buffer.from(fixture.body, "base64");
  const gzipped = (fixture.headers["content-encoding"] ?? "").includes("gzip");
  const payload: unknown = JSON.parse((gzipped ? gunzipSync(raw) : raw).toString("utf8"));
  const expected = engineDecode(logsIn(payload), ESCROW).events;

  expect(await post(fixture)).toBe(200);
  const stored = await db<{ tx_hash: string; log_index: number; source: string }[]>`
    select tx_hash, log_index, source from chain_events order by block_number, log_index
  `;
  expect(stored.map((row) => [row.tx_hash, row.log_index])).toEqual(
    expected.map((event) => [event.txHash, event.logIndex]),
  );
  expect(new Set(stored.map((row) => row.source))).toEqual(
    new Set(stored.length === 0 ? [] : ["streams"]),
  );
  // The same delivery again changes nothing.
  expect(await post(fixture)).toBe(200);
  expect(await db`select 1 from chain_events`).toHaveLength(stored.length);
  // The signature recorded with the real token does not verify under the test token.
  const recorded = fixture.headers["x-qn-signature"];
  if (recorded !== undefined) expect(await post(fixture, recorded)).toBe(401);
}

describe("recorded QuickNode deliveries (apps/engine/fixtures/quicknode)", () => {
  if (FILES.length === 0) {
    it("replays every recorded delivery through the route: none recorded yet (0 files)", () => {
      // Nothing to replay until task S-04 records the first real delivery; the directory and its
      // README exist, so the recorder has a place to write to.
      expect(readdirSync(FIXTURES_DIR)).toContain("README.md");
    });
  } else {
    for (const file of FILES) {
      it(`replays ${file} through the route (${FILES.length.toString()} recorded)`, async () => {
        const fixture = fixtureSchema.parse(
          JSON.parse(readFileSync(`${FIXTURES_DIR}${file}`, "utf8")) as unknown,
        );
        await replay(fixture);
      });
    }
  }

  it("replays a fixture of the recorder's format (synthetic, the replay's positive control)", async () => {
    const txHash = randomHash();
    const log = escrowLog(
      "CampaignPaused",
      { id: 3n, paused: true },
      {
        address: ESCROW,
        txHash,
        logIndex: 4,
        blockNumber: 72_800_000n,
        blockTimestamp: 1_763_467_200n,
      },
    );
    const delivery = deliveryOf([[log]]);
    const nonce = "f00d";
    const timestamp = "1763467202";
    const body = gzipSync(Buffer.from(delivery.json));
    const fixture: Fixture = {
      format: "winz.quicknode-delivery.v1",
      receivedAt: "2025-11-18T12:00:02.345Z",
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
        "x-qn-nonce": nonce,
        "x-qn-timestamp": timestamp,
        "x-qn-signature": signStreamsPayload(
          "the-real-token",
          nonce,
          timestamp,
          Buffer.from(delivery.json),
        ),
      },
      signatureVerified: true,
      signedOver: "uncompressed",
      bodyEncoding: "base64",
      body: body.toString("base64"),
    };
    await replay(fixture);
    const [row] = await db<{ name: string }[]>`select name from chain_events`;
    expect(row?.name).toBe("CampaignPaused");
  });
});
