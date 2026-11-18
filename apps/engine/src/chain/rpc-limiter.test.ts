/**
 * The request limiter on its own, under fake timers: ceilings, order, cool-downs, and what it
 * leaves behind when it stops.
 */
import pino from "pino";
import { LimitExceededRpcError, RpcRequestError } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_RPC_LIMITS,
  isRpcLimiterClosedError,
  resolveRpcLimits,
  RpcLimiter,
  RpcLimiterClosedError,
  RpcLimiterConfigError,
  RpcRequestAbortedError,
  type RpcLimits,
} from "./rpc-limiter";

const T0 = Date.parse("2026-11-18T12:00:00Z");

function rateLimit(headers?: Headers): Error {
  return new LimitExceededRpcError(
    new RpcRequestError({
      body: { method: "eth_getLogs" },
      error: { code: -32005, message: "rate limit exceeded" },
      url: "https://name.quiknode.pro/PATHTOKEN_s3cr3t/",
      status: 429,
      headers: headers ?? new Headers(),
    }),
  );
}

function capture(): { lines: Record<string, unknown>[]; logger: pino.Logger } {
  const lines: Record<string, unknown>[] = [];
  const logger = pino(
    { level: "debug", base: undefined },
    { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) },
  );
  return { lines, logger };
}

/** Starts of each request, as offsets from T0, filled as their turn comes. */
function track(
  limiter: RpcLimiter,
  requests: readonly { name: string; method: string; seq?: number; signal?: AbortSignal }[],
): { started: Map<string, number>; failed: Map<string, unknown>; order: string[] } {
  const started = new Map<string, number>();
  const failed = new Map<string, unknown>();
  const order: string[] = [];
  for (const request of requests) {
    limiter
      .acquire(request.method, request.seq ?? limiter.ticket(), request.signal)
      .then((at) => {
        started.set(request.name, at - T0);
        order.push(request.name);
      })
      .catch((error: unknown) => failed.set(request.name, error));
  }
  return { started, failed, order };
}

function limiterWith(limits: Partial<RpcLimits>, logger?: pino.Logger): RpcLimiter {
  return new RpcLimiter({ limits, ...(logger ? { logger } : {}) });
}

describe("RpcLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("has defaults under the limits measured on Arc's public RPC", () => {
    expect(DEFAULT_RPC_LIMITS).toMatchObject({
      maxRequestsPerSecond: 10,
      maxHeavyRequestsPerSecond: 4,
      heavyMethods: ["eth_getLogs"],
    });
    // 12 eth_getLogs within 1.4 s were accepted: 4 a second leaves at most 8 in any 1.4 s.
    expect(DEFAULT_RPC_LIMITS.maxHeavyRequestsPerSecond * 2).toBeLessThan(12);
  });

  it("refuses limits that cannot work", () => {
    expect(() => resolveRpcLimits({ maxRequestsPerSecond: 0 })).toThrow(RpcLimiterConfigError);
    expect(() => resolveRpcLimits({ maxHeavyRequestsPerSecond: Number.NaN })).toThrow(
      RpcLimiterConfigError,
    );
    expect(() => resolveRpcLimits({ coolDownMs: 2_000, maxCoolDownMs: 1_000 })).toThrow(
      RpcLimiterConfigError,
    );
    expect(() => resolveRpcLimits({ rateLimitRetries: 1.5 })).toThrow(RpcLimiterConfigError);
  });

  it("starts at most the overall ceiling in any second, in arrival order", async () => {
    const limiter = limiterWith({ maxRequestsPerSecond: 3 });
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    const { started, order } = track(
      limiter,
      names.map((name) => ({ name, method: "eth_blockNumber" })),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect([...started.values()]).toEqual([0, 0, 0]);
    await vi.advanceTimersByTimeAsync(999);
    expect(started.size).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(started.size).toBe(6);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(order).toEqual(names);
    expect(started.get("d")).toBe(1_000);
    expect(started.get("g")).toBe(2_000);
    expect(limiter.waiting).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("holds the heavy methods to their own ceiling, and later requests wait behind them", async () => {
    const limiter = limiterWith({ maxRequestsPerSecond: 100, maxHeavyRequestsPerSecond: 2 });
    const { started, order } = track(limiter, [
      { name: "logs1", method: "eth_getLogs" },
      { name: "block1", method: "eth_blockNumber" },
      { name: "logs2", method: "eth_getLogs" },
      { name: "logs3", method: "eth_getLogs" },
      { name: "block2", method: "eth_blockNumber" },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["logs1", "block1", "logs2"]);
    // Strictly in order: the read behind the third eth_getLogs waits with it.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(order).toEqual(["logs1", "block1", "logs2", "logs3", "block2"]);
    expect(started.get("logs3")).toBe(1_000);
    expect(started.get("block2")).toBe(1_000);
  });

  it("holds every request during a cool-down, logs it once, and doubles it when refusals go on", async () => {
    const { lines, logger } = capture();
    const limiter = limiterWith({ coolDownMs: 1_000, maxCoolDownMs: 3_000 }, logger);
    limiter.reportRateLimit("eth_getLogs", rateLimit());
    // Answers of requests sent before the cool-down began change nothing.
    limiter.reportRateLimit("eth_getLogs", rateLimit());
    limiter.reportRateLimit("eth_estimateGas", rateLimit());
    expect(limiter.coolingDown).toBe(true);
    const first = track(limiter, [
      { name: "a", method: "eth_blockNumber" },
      { name: "b", method: "eth_estimateGas" },
    ]);
    await vi.advanceTimersByTimeAsync(999);
    expect(first.started.size).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect([...first.started.values()]).toEqual([1_000, 1_000]);

    const warnings = lines.filter(
      (line) => line.msg === "node is rate limiting this client, every request waits",
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ method: "eth_getLogs", coolDownMs: 1_000, inARow: 1 });
    expect(JSON.stringify(lines)).not.toContain("PATHTOKEN");
    expect(limiter.stats).toMatchObject({ rateLimited: 3, coolDowns: 1, started: 2 });

    // Refused again after the cool-down: twice as long, then capped.
    limiter.reportRateLimit("eth_getLogs", rateLimit());
    const second = track(limiter, [{ name: "c", method: "eth_blockNumber" }]);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(second.started.size).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(second.started.get("c")).toBe(3_000);
    limiter.reportRateLimit("eth_getLogs", rateLimit());
    expect(lines.at(-1)).toMatchObject({ coolDownMs: 3_000, inARow: 3 });

    // A success of a request started after the cool-down: the next one is short again.
    await vi.advanceTimersByTimeAsync(3_000);
    limiter.reportSuccess(Date.now());
    limiter.reportRateLimit("eth_getLogs", rateLimit());
    expect(lines.at(-1)).toMatchObject({ coolDownMs: 1_000, inARow: 1 });
    expect(lines.filter((line) => line.level === 40)).toHaveLength(4);
  });

  it("waits at least the node's Retry-After, within the longest cool-down", async () => {
    const limiter = limiterWith({ coolDownMs: 1_000, maxCoolDownMs: 4_000 });
    limiter.reportRateLimit("eth_call", rateLimit(new Headers({ "Retry-After": "2" })));
    const { started } = track(limiter, [{ name: "a", method: "eth_call" }]);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(started.size).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(started.get("a")).toBe(2_000);
  });

  it("lets a retried request go before every request that arrived after it", async () => {
    const limiter = limiterWith({ coolDownMs: 500 });
    const firstSeq = limiter.ticket();
    const early = track(limiter, [
      { name: "first", method: "eth_sendRawTransaction", seq: firstSeq },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(early.order).toEqual(["first"]);
    // The first is refused; two requests arrive during the cool-down, then the retry.
    limiter.reportRateLimit("eth_sendRawTransaction", rateLimit());
    const later = track(limiter, [
      { name: "second", method: "eth_sendRawTransaction" },
      { name: "third", method: "eth_blockNumber" },
    ]);
    const retry = track(limiter, [
      { name: "first-again", method: "eth_sendRawTransaction", seq: firstSeq },
    ]);
    await vi.advanceTimersByTimeAsync(500);
    expect(retry.started.get("first-again")).toBe(500);
    expect(later.started.get("second")).toBe(500);
    // Same instant: the order of the resolutions is the queue's.
    const all: string[] = [];
    const limiter2 = limiterWith({ coolDownMs: 500 });
    const seq = limiter2.ticket();
    limiter2.reportRateLimit("eth_sendRawTransaction", rateLimit());
    for (const [name, s] of [
      ["second", limiter2.ticket()],
      ["third", limiter2.ticket()],
      ["first-again", seq],
    ] as const) {
      void limiter2.acquire("eth_blockNumber", s).then(() => all.push(name));
    }
    await vi.advanceTimersByTimeAsync(500);
    expect(all).toEqual(["first-again", "second", "third"]);
  });

  it("releases a request whose signal aborts at once, and leaves no timer", async () => {
    const limiter = limiterWith({ coolDownMs: 60_000, maxCoolDownMs: 60_000 });
    limiter.reportRateLimit("eth_getLogs", rateLimit());
    const controller = new AbortController();
    const { failed } = track(limiter, [
      { name: "a", method: "eth_getLogs", signal: controller.signal },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(failed.get("a")).toBeInstanceOf(RpcRequestAbortedError);
    expect(limiter.waiting).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await expect(
      limiter.acquire("eth_getLogs", limiter.ticket(), controller.signal),
    ).rejects.toBeInstanceOf(RpcRequestAbortedError);
  });

  it("on close, releases every waiting request and every retry delay, and leaves no timer", async () => {
    const limiter = limiterWith({ coolDownMs: 60_000, maxCoolDownMs: 60_000 });
    limiter.reportRateLimit("eth_getLogs", rateLimit());
    const { failed } = track(limiter, [
      { name: "a", method: "eth_getLogs" },
      { name: "b", method: "eth_blockNumber" },
    ]);
    const delayed = limiter.delay(30_000, "eth_call").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(2);
    limiter.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(failed.get("a")).toBeInstanceOf(RpcLimiterClosedError);
    expect(failed.get("b")).toBeInstanceOf(RpcLimiterClosedError);
    expect(await delayed).toBeInstanceOf(RpcLimiterClosedError);
    expect(vi.getTimerCount()).toBe(0);
    await expect(limiter.acquire("eth_chainId", limiter.ticket())).rejects.toBeInstanceOf(
      RpcLimiterClosedError,
    );
  });

  it("closeAfter releases the requests held by a long cool-down at the given time, not before", async () => {
    // A shutdown: viem does not pass the engine's signal to the transport, so only the limiter
    // can release a request that waits out a 60 s cool-down.
    const limiter = limiterWith({ coolDownMs: 60_000, maxCoolDownMs: 60_000 });
    limiter.reportRateLimit("eth_getLogs", rateLimit());
    const { failed } = track(limiter, [{ name: "a", method: "eth_getLogs" }]);
    limiter.closeAfter(9_000);
    await vi.advanceTimersByTimeAsync(8_999);
    expect(failed.size).toBe(0);
    expect(limiter.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(failed.get("a")).toBeInstanceOf(RpcLimiterClosedError);
    expect(isRpcLimiterClosedError(new Error("wrapped", { cause: failed.get("a") }))).toBe(true);
    expect(isRpcLimiterClosedError(rateLimit())).toBe(false);
    expect(limiter.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closeAfter leaves no timer once the limiter is closed earlier", async () => {
    const limiter = limiterWith({});
    limiter.closeAfter(9_000);
    expect(vi.getTimerCount()).toBe(1);
    limiter.close();
    expect(vi.getTimerCount()).toBe(0);
    limiter.closeAfter(1_000);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
  });
});
