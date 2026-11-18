/**
 * The limiter in front of a viem client: through viem's own request code, against the fake node,
 * in-process (to see the exact order requests leave the client) and over HTTP (to see viem's
 * HTTP errors for a 429).
 */
import pino from "pino";
import {
  BaseError,
  createPublicClient,
  custom,
  fallback,
  LimitExceededRpcError,
  RpcRequestError,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { afterEach, describe, expect, it } from "vitest";

import { createArcClients } from "./clients";
import { FakeNodeError, FakeRpcNode } from "./fake-rpc-node";
import { rateLimitedTransport, RpcLimiter, type RpcLimits } from "./rpc-limiter";

const COOL_DOWN_MS = 300;
const KEYS = {
  relayer: `0x${"11".repeat(32)}`,
  oracle: `0x${"22".repeat(32)}`,
} as const;

function capture(): { lines: Record<string, unknown>[]; logger: pino.Logger } {
  const lines: Record<string, unknown>[] = [];
  const logger = pino(
    { level: "debug", base: undefined },
    { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) },
  );
  return { lines, logger };
}

function address(index: number): Address {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

async function until(predicate: () => boolean, what: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A client on the in-process fake node, behind a limiter. */
function inProcess(
  node: FakeRpcNode,
  limits: Partial<RpcLimits> = {},
  logger?: pino.Logger,
): { client: PublicClient; limiter: RpcLimiter } {
  const limiter = new RpcLimiter({
    limits: { coolDownMs: COOL_DOWN_MS, maxCoolDownMs: 4 * COOL_DOWN_MS, ...limits },
    ...(logger ? { logger } : {}),
  });
  cleanups.push(() => limiter.close());
  const client = createPublicClient({
    transport: rateLimitedTransport(fallback([node.transport()], { retryCount: 0 }), { limiter }),
  });
  return { client, limiter };
}

describe("rateLimitedTransport", () => {
  it("cools down every request after a rate limit, keeps their order, and warns once", async () => {
    const node = new FakeRpcNode({ head: 100n });
    const { lines, logger } = capture();
    const { client } = inProcess(node, {}, logger);

    // Two requests in flight together are both refused: one cool-down, one warning.
    node.forcedRateLimits = 2;
    const first = [1, 2].map((index) => client.getBalance({ address: address(index) }));
    await until(() => node.calls.length === 2, "the two refusals");
    // The cool-down starts when the limiter receives the first refusal, which is at or after the
    // node recorded it: measured from the node's own record, the bound does not depend on how
    // late this test's polling notices the refusals.
    const refusedAt = node.calls[0]?.at ?? Number.POSITIVE_INFINITY;
    // Three more arrive during the cool-down.
    const later = [3, 4, 5].map((index) => client.getBalance({ address: address(index) }));
    await Promise.all([...first, ...later]);

    const order = node.calls.map((call) => `${String(call.params[0]).slice(-1)}:${call.outcome}`);
    expect(order).toEqual([
      "1:rate-limited",
      "2:rate-limited",
      "1:ok",
      "2:ok",
      "3:ok",
      "4:ok",
      "5:ok",
    ]);
    // Nothing reached the node during the cool-down.
    const afterRefusal = node.calls.slice(2);
    for (const call of afterRefusal) {
      expect(call.at - refusedAt).toBeGreaterThanOrEqual(COOL_DOWN_MS - 20);
    }
    const warnings = lines.filter(
      (line) => line.msg === "node is rate limiting this client, every request waits",
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ method: "eth_getBalance", coolDownMs: COOL_DOWN_MS });
    expect(lines.filter((line) => line.level === 40)).toHaveLength(1);
  });

  it("sends a refused eth_sendRawTransaction again with the same bytes, before the signer's next one", async () => {
    const node = new FakeRpcNode({ head: 100n });
    const { client } = inProcess(node);
    node.forcedRateLimits = 1;
    const nonce0: Hex = "0x02f86c0180";
    const nonce1: Hex = "0x02f86c0101";
    const sent0 = client.sendRawTransaction({ serializedTransaction: nonce0 });
    await until(() => node.calls.length === 1, "the refusal");
    const sent1 = client.sendRawTransaction({ serializedTransaction: nonce1 });
    await Promise.all([sent0, sent1]);
    expect(node.calls.map((call) => [call.params[0], call.outcome])).toEqual([
      [nonce0, "rate-limited"],
      [nonce0, "ok"],
      [nonce1, "ok"],
    ]);
  });

  it("a retry keeps its place in the queue: the signer's next transaction does not overtake it", async () => {
    const node = new FakeRpcNode({ head: 100n });
    // The first try of nonce 0 is held in flight until released, so that nonce 1 is already
    // waiting in the queue (one request a second) when nonce 0 is refused and tried again.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    const gated = custom({
      request: async ({ method, params }: { method: string; params?: unknown }) => {
        if (first) {
          first = false;
          await held;
        }
        const answer = node.handle(method, Array.isArray(params) ? (params as unknown[]) : []);
        if (answer.error) throw new FakeNodeError(answer.error.code, answer.error.message);
        return answer.result;
      },
    } as unknown as Parameters<typeof custom>[0]);
    const limiter = new RpcLimiter({
      limits: { maxRequestsPerSecond: 1, coolDownMs: 100, maxCoolDownMs: 100 },
    });
    cleanups.push(() => limiter.close());
    const client = createPublicClient({
      transport: rateLimitedTransport(fallback([gated], { retryCount: 0 }), { limiter }),
    });
    const nonce0: Hex = "0x02f86c0180";
    const nonce1: Hex = "0x02f86c0101";
    node.forcedRateLimits = 1;
    const sent0 = client.sendRawTransaction({ serializedTransaction: nonce0 });
    await until(() => limiter.stats.started === 1, "the first try of nonce 0 in flight");
    const sent1 = client.sendRawTransaction({ serializedTransaction: nonce1 });
    await until(() => limiter.waiting === 1, "nonce 1 waiting for its turn");
    release();
    await Promise.all([sent0, sent1]);
    expect(node.calls.map((call) => [call.params[0], call.outcome])).toEqual([
      [nonce0, "rate-limited"],
      [nonce0, "ok"],
      [nonce1, "ok"],
    ]);
  });

  it("does not read a revert as a rate limit, even when its reason sounds like one", async () => {
    const node = new FakeRpcNode({ head: 100n });
    let estimates = 0;
    const reverting = custom({
      request: async ({ method, params }: { method: string; params?: unknown }) => {
        await Promise.resolve();
        if (method === "eth_estimateGas") {
          estimates += 1;
          // As viem's http transport throws it for a node's JSON-RPC error.
          throw new RpcRequestError({
            body: { method },
            error: {
              code: 3,
              message: "execution reverted: capacity exceeded",
              data: "0x08c379a0",
            },
            url: "http://127.0.0.1:8545",
          });
        }
        const answer = node.handle(method, Array.isArray(params) ? (params as unknown[]) : []);
        if (answer.error) throw new FakeNodeError(answer.error.code, answer.error.message);
        return answer.result;
      },
    } as unknown as Parameters<typeof custom>[0]);
    const { lines, logger } = capture();
    const limiter = new RpcLimiter({ limits: { coolDownMs: COOL_DOWN_MS }, logger });
    cleanups.push(() => limiter.close());
    const client = createPublicClient({
      transport: rateLimitedTransport(fallback([reverting], { retryCount: 0 }), { limiter }),
    });
    await expect(
      client.estimateGas({ account: address(1), to: address(2), data: "0x" }),
    ).rejects.toThrow(/capacity exceeded/);
    // Given to the caller at once: one try, no cool-down, no warning, other requests unhindered.
    expect(estimates).toBe(1);
    expect(limiter.stats).toMatchObject({ rateLimited: 0, coolDowns: 0 });
    expect(limiter.coolingDown).toBe(false);
    expect(lines.filter((line) => line.level === 40)).toEqual([]);
  });

  it("gives the node's error to the caller after a bounded number of tries", async () => {
    const node = new FakeRpcNode({ head: 100n });
    const { client, limiter } = inProcess(node, {
      rateLimitRetries: 2,
      coolDownMs: 20,
      maxCoolDownMs: 40,
    });
    node.forcedRateLimits = 100;
    await expect(client.getBlockNumber({ cacheTime: 0 })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof BaseError &&
        error.walk((e) => e instanceof LimitExceededRpcError) !== null,
    );
    expect(node.calls).toHaveLength(3);
    expect(limiter.stats).toMatchObject({ rateLimited: 3, coolDowns: 3 });
  });

  it("retries other failures as viem would, each try waiting for its turn", async () => {
    const node = new FakeRpcNode({ head: 100n });
    const limiter = new RpcLimiter({ limits: { maxRequestsPerSecond: 2 } });
    cleanups.push(() => limiter.close());
    const client = createPublicClient({
      transport: rateLimitedTransport(fallback([node.transport()], { retryCount: 0 }), {
        limiter,
        retryCount: 2,
        retryDelayMs: 10,
      }),
    });
    node.failingMethods.add("eth_blockNumber");
    const started = Date.now();
    await expect(client.getBlockNumber({ cacheTime: 0 })).rejects.toThrow();
    // Three tries; the third waited for the one-second window of two requests.
    expect(node.callsOf("eth_blockNumber")).toHaveLength(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(950);
    node.failingMethods.clear();
    expect(await client.getBlockNumber({ cacheTime: 0 })).toBe(100n);
  });

  it("reads an HTTP 429 answer from a real HTTP node, and the limiter of createArcClients waits it out", async () => {
    const node = new FakeRpcNode({ head: 7n });
    const url = await node.listen();
    cleanups.push(() => node.close());
    const { lines, logger } = capture();
    const arc = createArcClients(
      {
        ARC_CHAIN_ID: node.chainId,
        ARC_RPC_URL: url,
        ARC_RPC_FALLBACK_URL: url,
        ARC_RELAYER_PRIVATE_KEY: KEYS.relayer,
        ARC_ORACLE_PRIVATE_KEY: KEYS.oracle,
        ARC_RPC_MAX_REQUESTS_PER_SECOND: 50,
      },
      { logger, rateLimit: { coolDownMs: COOL_DOWN_MS } },
    );
    cleanups.push(() => arc.limiter?.close());
    expect(arc.limiter?.limits.maxRequestsPerSecond).toBe(50);
    node.forcedRateLimits = 1;
    expect(await arc.publicClient.getBlockNumber({ cacheTime: 0 })).toBe(7n);
    const [refused, accepted] = node.calls;
    expect(refused?.outcome).toBe("rate-limited");
    expect(accepted?.outcome).toBe("ok");
    expect((accepted?.at ?? 0) - (refused?.at ?? 0)).toBeGreaterThanOrEqual(COOL_DOWN_MS - 20);
    const warning = lines.find(
      (line) => line.msg === "node is rate limiting this client, every request waits",
    );
    expect(warning).toMatchObject({ method: "eth_blockNumber" });
    // The URL is reduced to its origin in the log.
    expect(JSON.stringify(warning)).toContain("127.0.0.1");
  });

  it("is turned off by rateLimit: false, as the transport was before", async () => {
    const node = new FakeRpcNode({ head: 7n });
    const url = await node.listen();
    cleanups.push(() => node.close());
    const arc = createArcClients(
      {
        ARC_CHAIN_ID: node.chainId,
        ARC_RPC_URL: url,
        ARC_RPC_FALLBACK_URL: url,
        ARC_RELAYER_PRIVATE_KEY: KEYS.relayer,
        ARC_ORACLE_PRIVATE_KEY: KEYS.oracle,
      },
      { rateLimit: false },
    );
    expect(arc.limiter).toBeNull();
    node.forcedRateLimits = 1;
    expect(await arc.publicClient.getBlockNumber({ cacheTime: 0 })).toBe(7n);
    // viem's own retry: 150 ms later, no cool-down of its own.
    const [refused, accepted] = node.calls;
    expect((accepted?.at ?? 0) - (refused?.at ?? 0)).toBeLessThan(COOL_DOWN_MS);
  });

  it("takes its limits from the environment's optional variables, over the defaults", () => {
    const limiter = createArcClients({
      ARC_CHAIN_ID: 1,
      ARC_RPC_URL: "http://127.0.0.1:1",
      ARC_RPC_FALLBACK_URL: "http://127.0.0.1:1",
      ARC_RELAYER_PRIVATE_KEY: KEYS.relayer,
      ARC_ORACLE_PRIVATE_KEY: KEYS.oracle,
      ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND: 2,
      ARC_RPC_HEAVY_METHODS: ["eth_getLogs", "eth_estimateGas"],
    }).limiter;
    cleanups.push(() => limiter?.close());
    expect(limiter?.limits).toMatchObject({
      maxRequestsPerSecond: 10,
      maxHeavyRequestsPerSecond: 2,
      heavyMethods: ["eth_getLogs", "eth_estimateGas"],
    });
    expect(limiter?.isHeavy("eth_estimateGas")).toBe(true);
  });
});
