/**
 * The log poller against a node that enforces the limits measured on Arc's public RPC (see
 * fake-rpc-node.ts), through the clients of `createArcClients` over real HTTP: the incident of
 * the first rehearsal (57 000 blocks to catch up, one 429, then a flood of halved ranges) and
 * what the limiter and the poller now do instead.
 */
import pino, { type Logger } from "pino";
import { getAddress, parseAbi, type Address } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../db";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { createArcClients, type ArcClientOptions, type ArcClients } from "./clients";
import { ARC_LOGS_PER_WINDOW, FakeRpcNode } from "./fake-rpc-node";
import { capturingLogger } from "./ingest-test-support";
import { DEFAULT_MAX_BLOCK_RANGE, LogPoller, readCursor, type LogClient } from "./log-poller";
import type { RpcRefusal } from "./rpc-errors";

const ESCROW: Address = getAddress("0x00000000000000000000000000000000000e5c21");
const KEYS = {
  relayer: `0x${"11".repeat(32)}`,
  oracle: `0x${"22".repeat(32)}`,
} as const;
const DEPLOY_BLOCK = 1_000_000n;
/** The rehearsal started 57 000 blocks behind; 60 000 makes exactly 30 ranges of 2 000. */
const BEHIND = 60_000n;

/** The poller's reading of an error before this change: any -32005 halved the range. */
function legacyClassification(error: unknown): RpcRefusal {
  let current: unknown = error;
  for (let depth = 0; depth < 10 && typeof current === "object" && current !== null; depth += 1) {
    const record = current as Record<string, unknown>;
    if (record.code === -32005 || record.code === -32012) return "too-large";
    current = record.cause;
  }
  return "other";
}

function silent(): Logger {
  return pino({ level: "silent" });
}

describe("LogPoller against a rate-limiting node", () => {
  let database: TestDatabase;
  let db: Db;
  let cursorCount = 0;

  beforeAll(async () => {
    database = await createTestDatabase();
    db = database.db;
  });
  afterAll(async () => {
    await database?.drop();
  });

  async function withNode(
    options: { head?: bigint; logsPerWindow?: number; refusedSpan?: bigint },
    clientOptions: ArcClientOptions,
    run: (node: FakeRpcNode, arc: ArcClients) => Promise<void>,
  ): Promise<void> {
    const node = new FakeRpcNode({
      head: options.head ?? DEPLOY_BLOCK + BEHIND - 1n,
      ...(options.logsPerWindow !== undefined ? { logsPerWindow: options.logsPerWindow } : {}),
      ...(options.refusedSpan !== undefined ? { refusedSpan: options.refusedSpan } : {}),
    });
    const url = await node.listen();
    const arc = createArcClients(
      {
        ARC_CHAIN_ID: node.chainId,
        ARC_RPC_URL: url,
        ARC_RPC_FALLBACK_URL: url,
        ARC_RELAYER_PRIVATE_KEY: KEYS.relayer,
        ARC_ORACLE_PRIVATE_KEY: KEYS.oracle,
      },
      clientOptions,
    );
    try {
      await run(node, arc);
    } finally {
      arc.limiter?.close();
      await node.close();
    }
  }

  function poller(
    client: LogClient,
    config: Partial<ConstructorParameters<typeof LogPoller>[2]> = {},
    logger: Logger = silent(),
  ): LogPoller {
    cursorCount += 1;
    return new LogPoller(
      db,
      client,
      {
        escrowAddress: ESCROW,
        fromBlock: DEPLOY_BLOCK,
        cursorName: `rate-limit-test-${cursorCount.toString()}`,
        ...config,
      },
      logger,
    );
  }

  it("catches up 60 000 blocks in about thirty requests and a few seconds, while other reads still answer", async () => {
    await withNode({}, {}, async (node, arc) => {
      const logPoller = poller(arc.publicClient);
      const sideLatencies: number[] = [];
      const sideErrors: unknown[] = [];
      let polling = true;
      const sideLoad = (async (): Promise<void> => {
        const abi = parseAbi(["function counter() view returns (uint256)"]);
        while (polling) {
          for (const read of [
            () => arc.publicClient.getBlockNumber({ cacheTime: 0 }),
            () => arc.publicClient.readContract({ address: ESCROW, abi, functionName: "counter" }),
            () =>
              arc.publicClient.estimateGas({
                account: arc.accounts.relayer.address,
                to: ESCROW,
                data: "0x",
              }),
          ]) {
            const started = Date.now();
            try {
              await read();
            } catch (error: unknown) {
              sideErrors.push(error);
            }
            sideLatencies.push(Date.now() - started);
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      })();

      const started = Date.now();
      const result = await logPoller.pollOnce();
      const elapsed = Date.now() - started;
      polling = false;
      await sideLoad;

      // Complete, at the full range, in the minimum number of requests, never refused.
      expect(result.toBlock).toBe(DEPLOY_BLOCK + BEHIND - 1n);
      expect(await readCursor(db, logPoller.cursorName)).toBe(DEPLOY_BLOCK + BEHIND - 1n);
      expect(result.requests).toBe(30);
      expect(node.callsOf("eth_getLogs")).toHaveLength(30);
      expect(node.calls.filter((call) => call.outcome !== "ok")).toEqual([]);
      expect(result.rateLimited).toBe(0);
      expect(logPoller.currentRange).toBe(DEFAULT_MAX_BLOCK_RANGE);
      expect(node.callsOf("eth_getLogs").every((call) => call.span === 2_000n)).toBe(true);
      // Four a second: 29 gaps of 250 ms, well under the 12 in 1.4 s the node accepts.
      expect(elapsed).toBeGreaterThanOrEqual(29 * 250 - 50);
      expect(elapsed).toBeLessThan(12_000);

      // Meanwhile a block number, a contract read and a gas estimate kept answering.
      expect(sideErrors).toEqual([]);
      expect(sideLatencies.length).toBeGreaterThanOrEqual(30);
      expect(Math.max(...sideLatencies)).toBeLessThan(1_500);
      expect(node.callsOf("eth_call").length).toBeGreaterThanOrEqual(10);
      expect(node.callsOf("eth_estimateGas").length).toBeGreaterThanOrEqual(10);
    });
  }, 30_000);

  it("floods the node the old way: no limiter, no gap, any -32005 read as a range refusal", async () => {
    await withNode({}, { rateLimit: false }, async (node, arc) => {
      const logPoller = poller(arc.publicClient, {
        minRequestGapMs: 0,
        classifyError: legacyClassification,
      });
      const outcome = await logPoller.pollOnce().then(
        () => "completed",
        () => "failed",
      );
      const logs = node.callsOf("eth_getLogs");
      const refused = logs.filter((call) => call.outcome === "rate-limited");
      // The incident: the 13th request is refused, and the range halves at each refusal, down
      // to single blocks, until even one block is refused.
      expect(logs[ARC_LOGS_PER_WINDOW]?.outcome).toBe("rate-limited");
      expect(refused.length).toBeGreaterThanOrEqual(10);
      expect(logPoller.currentRange).toBeLessThanOrEqual(4n);
      expect(Math.min(...logs.map((call) => Number(call.span)))).toBeLessThanOrEqual(4);
      expect(outcome).toBe("failed");
    });
  }, 30_000);

  it("without the limiter, the poller alone waits out the rate limit at the same range", async () => {
    await withNode({}, { rateLimit: false }, async (node, arc) => {
      const logPoller = poller(arc.publicClient, {
        minRequestGapMs: 0,
        rateLimitBaseDelayMs: 500,
      });
      const result = await logPoller.pollOnce();
      expect(result.toBlock).toBe(DEPLOY_BLOCK + BEHIND - 1n);
      expect(result.requests).toBe(30);
      expect(result.rateLimited).toBeGreaterThanOrEqual(1);
      // Refused, but never halved: every request asked for 2 000 blocks.
      expect(node.callsOf("eth_getLogs").every((call) => call.span === 2_000n)).toBe(true);
      expect(logPoller.currentRange).toBe(DEFAULT_MAX_BLOCK_RANGE);
    });
  }, 30_000);

  it("with the limiter, the old reading of -32005 is never put to the test: no refusal at all", async () => {
    await withNode({}, {}, async (node, arc) => {
      const logPoller = poller(arc.publicClient, {
        minRequestGapMs: 0,
        classifyError: legacyClassification,
      });
      const result = await logPoller.pollOnce();
      expect(result.requests).toBe(30);
      expect(node.calls.filter((call) => call.outcome !== "ok")).toEqual([]);
      expect(logPoller.currentRange).toBe(DEFAULT_MAX_BLOCK_RANGE);
    });
  }, 30_000);

  it("halves on a node whose range limit is lower than its own, completes, and grows back", async () => {
    // A generous rate, so that only the range limit is in play.
    await withNode(
      { head: DEPLOY_BLOCK + 40_000n - 1n, logsPerWindow: 10_000, refusedSpan: 1_500n },
      { rateLimit: { maxRequestsPerSecond: 1_000, maxHeavyRequestsPerSecond: 1_000 } },
      async (node, arc) => {
        const { logger, entries } = capturingLogger();
        const logPoller = poller(arc.publicClient, { minRequestGapMs: 0 }, logger);
        const result = await logPoller.pollOnce();
        expect(result.toBlock).toBe(DEPLOY_BLOCK + 40_000n - 1n);
        const spans = node
          .callsOf("eth_getLogs")
          .map((call) => `${String(call.span)}:${call.outcome}`);
        // 2 000 refused, 16 ranges of 1 000, then 2 000 again (grown back) and refused again.
        expect(spans.slice(0, 18)).toEqual([
          "2000:too-large",
          ...Array.from({ length: 16 }, () => "1000:ok"),
          "2000:too-large",
        ]);
        expect(
          spans.filter((span) => span.endsWith("ok")).every((span) => span === "1000:ok"),
        ).toBe(true);
        expect(
          entries.filter((entry) => entry.msg === "node refused the eth_getLogs range, halving it")
            .length,
        ).toBe(spans.filter((span) => span.endsWith("too-large")).length);
        // The size refusal is not a rate limit: no cool-down started.
        expect(arc.limiter?.stats.coolDowns).toBe(0);
      },
    );
  }, 30_000);

  it("waits longer at each rate-limit answer in a row, at the same range, then completes", async () => {
    const refusal = Object.assign(new Error("rate limit exceeded"), { code: -32005, status: 429 });
    const spans: bigint[] = [];
    let refusals = 5;
    const client: LogClient = {
      getBlockNumber: async (): Promise<bigint> => Promise.resolve(DEPLOY_BLOCK + 99n),
      getLogs: async (request) => {
        spans.push(request.toBlock - request.fromBlock + 1n);
        if (refusals > 0) {
          refusals -= 1;
          return Promise.reject(refusal);
        }
        return Promise.resolve([]);
      },
      getBlock: async (): Promise<{ timestamp: bigint }> => Promise.resolve({ timestamp: 0n }),
    };
    const { logger, entries } = capturingLogger();
    const logPoller = poller(
      client,
      {
        minRequestGapMs: 0,
        rateLimitBaseDelayMs: 4,
        rateLimitMaxDelayMs: 1_000,
        // No jitter: the wait is exactly half of the doubled base.
        random: () => 0,
      },
      logger,
    );
    const result = await logPoller.pollOnce();
    expect(result).toMatchObject({ toBlock: DEPLOY_BLOCK + 99n, requests: 1, rateLimited: 5 });
    const waits = entries
      .filter((entry) => String(entry.msg).startsWith("node rate-limited eth_getLogs"))
      .map((entry) => ({ waitMs: entry.waitMs, inARow: entry.inARow }));
    expect(waits).toEqual([
      { waitMs: 2, inARow: 1 },
      { waitMs: 4, inARow: 2 },
      { waitMs: 8, inARow: 3 },
      { waitMs: 16, inARow: 4 },
      { waitMs: 32, inARow: 5 },
    ]);
    // Asked again for the same range every time.
    expect(new Set(spans)).toEqual(new Set([100n]));
    expect(spans).toHaveLength(6);
  });

  it("stops at once when aborted during a rate-limit wait, and leaves no timer", async () => {
    const refusal = Object.assign(new Error("rate limit exceeded"), { code: -32005, status: 429 });
    let getLogsCalls = 0;
    const client: LogClient = {
      getBlockNumber: async (): Promise<bigint> => Promise.resolve(DEPLOY_BLOCK + 10n),
      getLogs: async () => {
        getLogsCalls += 1;
        return Promise.reject(refusal);
      },
      getBlock: async (): Promise<{ timestamp: bigint }> => Promise.resolve({ timestamp: 0n }),
    };
    const { logger, entries } = capturingLogger();
    const logPoller = poller(
      client,
      { rateLimitBaseDelayMs: 60_000, rateLimitMaxDelayMs: 60_000 },
      logger,
    );
    const timers = (): number =>
      process.getActiveResourcesInfo().filter((kind) => kind === "Timeout").length;
    const controller = new AbortController();
    const polled = logPoller.pollOnce(controller.signal);
    const deadline = Date.now() + 5_000;
    while (
      !entries.some((entry) => String(entry.msg).startsWith("node rate-limited eth_getLogs"))
    ) {
      if (Date.now() > deadline) throw new Error("the poller never waited");
      await new Promise((resolve) => setImmediate(resolve));
    }
    const waiting = timers();
    const abortedAt = Date.now();
    controller.abort();
    const result = await polled;
    expect(Date.now() - abortedAt).toBeLessThan(200);
    expect(result).toMatchObject({ toBlock: null, requests: 0, rateLimited: 1 });
    expect(getLogsCalls).toBe(1);
    expect(timers()).toBe(waiting - 1);
    expect(await readCursor(db, logPoller.cursorName)).toBeNull();
  });
});
