/**
 * The ingestion never logs an RPC URL beyond its origin: a provider such as QuickNode carries
 * its API token in the URL's path, and viem's errors repeat the full URL in their message,
 * stack and `url` property.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, getAddress, http, HttpRequestError } from "viem";

import type { Db } from "../db";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { redactUrls, summarizeError } from "./error-summary";
import { startChainIngest } from "./ingest";
import { capturingLogger, waitFor } from "./ingest-test-support";
import { LogPoller, type LogClient } from "./log-poller";

const TOKEN = "PATHTOKEN_s3cr3t";
const ESCROW = getAddress("0x00000000000000000000000000000000000e5c20");

describe("summarizeError", () => {
  it("reduces every URL to its origin", () => {
    expect(redactUrls(`URL: https://name.quiknode.pro/${TOKEN}/ failed`)).toBe(
      "URL: https://name.quiknode.pro failed",
    );
    expect(redactUrls(`wss://user:pass@node.example:8546/ws/${TOKEN}?key=${TOKEN}`)).toBe(
      "wss://node.example:8546",
    );
    expect(redactUrls("no url here")).toBe("no url here");
  });

  it("keeps the type, short message and code of an error and its causes, without the URL", () => {
    const error = new HttpRequestError({
      url: `http://127.0.0.1:1/${TOKEN}/`,
      body: { method: "eth_blockNumber" },
      cause: Object.assign(new Error(`connect ECONNREFUSED http://127.0.0.1:1/${TOKEN}/`), {
        code: "ECONNREFUSED",
      }),
    });
    const summary = summarizeError(error);
    expect(JSON.stringify(summary)).not.toContain(TOKEN);
    expect(summary.type).toBe("HttpRequestError");
    expect(summary.message).toBe("HTTP request failed.");
    expect(summary.cause?.code).toBe("ECONNREFUSED");
    expect(summary.cause?.message).toContain("http://127.0.0.1:1");
    expect(summarizeError("plain")).toEqual({ type: "string", message: "plain" });
  });
});

describe("logs of the ingestion", () => {
  let database: TestDatabase;
  let db: Db;

  beforeAll(async () => {
    database = await createTestDatabase();
    db = database.db;
  });

  afterAll(async () => {
    await database?.drop();
  });

  it("never contain the token in the path of an unreachable RPC URL", async () => {
    const publicClient = createPublicClient({
      transport: http(`http://127.0.0.1:1/${TOKEN}/`, { retryCount: 0 }),
    });
    const { logger, entries } = capturingLogger();
    const controller = new AbortController();
    const ingest = startChainIngest({
      db,
      publicClient,
      escrowAddress: ESCROW,
      fromBlock: 0n,
      logger,
      signal: controller.signal,
      pollIntervalMs: 20,
      projectIntervalMs: 1_000,
      retryBaseMs: 10,
      retryMaxMs: 20,
    });
    try {
      await waitFor(
        async () =>
          Promise.resolve(
            entries.filter((entry) => entry.msg === "chain ingest step failed, retrying").length >=
              2,
          ),
        "two failures",
      );
    } finally {
      controller.abort();
      await ingest.stopped;
    }
    const failure = entries.find((entry) => entry.msg === "chain ingest step failed, retrying");
    expect(failure?.error).toMatchObject({ type: "HttpRequestError" });
    const logged = JSON.stringify(entries);
    expect(logged).not.toContain(TOKEN);
    expect(logged).toContain("127.0.0.1:1");
  });

  it("never contain the token when the node refuses a range", async () => {
    const url = `https://name.quiknode.pro/${TOKEN}/`;
    let refusals = 0;
    const client: LogClient = {
      getBlockNumber: async (): Promise<bigint> => Promise.resolve(3n),
      getLogs: async () => {
        refusals += 1;
        if (refusals === 1) {
          throw Object.assign(new Error(`query exceeds max block range\n\nURL: ${url}`), {
            code: -32005,
            url,
          });
        }
        return Promise.resolve([]);
      },
      getBlock: async (): Promise<{ timestamp: bigint }> => Promise.resolve({ timestamp: 0n }),
    };
    const { logger, entries } = capturingLogger();
    const poller = new LogPoller(
      db,
      client,
      { escrowAddress: ESCROW, fromBlock: 0n, maxBlockRange: 4n, cursorName: "redaction-test" },
      logger,
    );
    await poller.pollOnce();
    const warning = entries.find(
      (entry) => entry.msg === "node refused the eth_getLogs range, halving it",
    );
    expect(warning).toBeDefined();
    expect(JSON.stringify(entries)).not.toContain(TOKEN);
    expect(JSON.stringify(warning)).toContain("https://name.quiknode.pro");
  });
});
