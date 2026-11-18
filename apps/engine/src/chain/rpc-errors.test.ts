import {
  HttpRequestError,
  InternalRpcError,
  LimitExceededRpcError,
  MethodNotFoundRpcError,
  RpcRequestError,
  TimeoutError,
} from "viem";
import { describe, expect, it } from "vitest";

import { isRangeRefusal, rateLimitDelayMs } from "./log-poller";
import {
  classifyRpcRefusal,
  isRateLimitedError,
  isRetryableRpcError,
  retryAfterMs,
} from "./rpc-errors";

const URL = "https://name.quiknode.pro/TOKEN/";
const BODY = { method: "eth_getLogs", params: [{ fromBlock: "0x1", toBlock: "0x7d0" }] };

/** What viem throws for a JSON-RPC error answered with `status` (as its http transport does). */
function viemRpcError(code: number, message: string, status?: number): Error {
  const raw = new RpcRequestError({
    body: BODY,
    error: { code, message },
    url: URL,
    ...(status !== undefined ? { status, headers: new Headers() } : {}),
  });
  if (code === -32005) return new LimitExceededRpcError(raw);
  if (code === -32603) return new InternalRpcError(raw);
  return raw;
}

describe("classifyRpcRefusal", () => {
  it("reads the measured rate limit of Arc's public RPC (HTTP 429, -32005) as a rate limit", () => {
    expect(classifyRpcRefusal(viemRpcError(-32005, "rate limit exceeded", 429))).toBe(
      "rate-limited",
    );
  });

  it("reads the measured range refusal of Arc's public RPC (HTTP 200, -32012) as too large", () => {
    expect(classifyRpcRefusal(viemRpcError(-32012, "requested range too large"))).toBe("too-large");
    // The code alone is enough, whatever the wording.
    expect(classifyRpcRefusal(viemRpcError(-32012, "nope"))).toBe("too-large");
  });

  it("reads any HTTP 429 as a rate limit, whatever the body says", () => {
    const plain = new HttpRequestError({
      body: BODY,
      details: "Too Many Requests",
      status: 429,
      url: URL,
    });
    expect(classifyRpcRefusal(plain)).toBe("rate-limited");
    expect(
      classifyRpcRefusal(viemRpcError(-32005, "query returned more than 10000 results", 429)),
    ).toBe("rate-limited");
    expect(classifyRpcRefusal(viemRpcError(-32000, "block range too large", 429))).toBe(
      "rate-limited",
    );
  });

  it("reads code 429 and QuickNode's -32007 as a rate limit", () => {
    expect(classifyRpcRefusal(Object.assign(new Error("slow down"), { code: 429 }))).toBe(
      "rate-limited",
    );
    expect(
      classifyRpcRefusal(
        viemRpcError(
          -32007,
          "15/second request limit reached - reduce calls per second or upgrade your account at quicknode.com",
        ),
      ),
    ).toBe("rate-limited");
  });

  it.each([
    "rate limit exceeded",
    "Rate-limited, try again later",
    "ratelimit hit",
    "Too Many Requests",
    "daily request limit reached",
    "You have exceeded your quota",
    "exceeded the capacity of this endpoint",
    "request throttled",
    "Throttling: slow down",
  ])("reads '%s' as a rate limit, with any code", (message) => {
    expect(classifyRpcRefusal(new Error(message))).toBe("rate-limited");
    expect(classifyRpcRefusal(viemRpcError(-32000, message))).toBe("rate-limited");
    expect(classifyRpcRefusal(viemRpcError(-32005, message))).toBe("rate-limited");
  });

  it.each([
    "requested range too large",
    "query exceeds max block range 2000",
    "eth_getLogs block range is too large",
    "Log response size exceeded. You can make eth_getLogs requests with up to a 2K block range",
    "query returned more than 10000 results",
    "too many logs in response",
    "too many blocks requested",
    "more than 5000 results",
    "response size should not greater than 10000000 bytes",
    "exceed maximum block range: 5000",
  ])("reads '%s' as too large, with -32005 or any other code", (message) => {
    expect(classifyRpcRefusal(new Error(message))).toBe("too-large");
    expect(classifyRpcRefusal(viemRpcError(-32005, message))).toBe("too-large");
    expect(classifyRpcRefusal(viemRpcError(-32000, message))).toBe("too-large");
  });

  it("reads a bare -32005 with an unknown message as a rate limit (the cautious reading)", () => {
    expect(classifyRpcRefusal(viemRpcError(-32005, "limit exceeded"))).toBe("rate-limited");
    const inner = Object.assign(new Error("limit"), { code: -32005 });
    expect(classifyRpcRefusal(new Error("RPC request failed", { cause: inner }))).toBe(
      "rate-limited",
    );
  });

  it("reads a revert as other, even when its reason sounds like a rate limit", () => {
    // The revert string is the contract's, not the node's: no cool-down for it.
    expect(classifyRpcRefusal(viemRpcError(3, "execution reverted: capacity exceeded"))).toBe(
      "other",
    );
    expect(classifyRpcRefusal(viemRpcError(-32000, "execution reverted: quota reached"))).toBe(
      "other",
    );
    expect(
      classifyRpcRefusal(Object.assign(new Error("throttled by the contract"), { code: 3 })),
    ).toBe("other");
    expect(isRateLimitedError(viemRpcError(-32005, "execution reverted: rate limit"))).toBe(false);
    // An HTTP 429 stays a rate limit, whatever the body says.
    expect(classifyRpcRefusal(viemRpcError(3, "execution reverted", 429))).toBe("rate-limited");
  });

  it("reads failures that are neither as other", () => {
    expect(classifyRpcRefusal(new TimeoutError({ body: BODY, url: URL }))).toBe("other");
    expect(
      classifyRpcRefusal(
        new HttpRequestError({ body: BODY, url: URL, cause: new Error("fetch failed") }),
      ),
    ).toBe("other");
    expect(classifyRpcRefusal(viemRpcError(-32603, "internal error"))).toBe("other");
    expect(classifyRpcRefusal(viemRpcError(3, "execution reverted"))).toBe("other");
    expect(classifyRpcRefusal(undefined)).toBe("other");
    expect(classifyRpcRefusal("plain string")).toBe("other");
  });

  it("does not read the URL or the request body viem puts in its message", () => {
    // The body names a block range and the URL a quota: neither is the node's answer.
    const error = new HttpRequestError({
      body: { method: "eth_getLogs", params: ["block range"] },
      url: "https://quota.example/rate-limit/",
      cause: new Error("fetch failed"),
    });
    expect(error.message).toContain("block range");
    expect(classifyRpcRefusal(error)).toBe("other");
  });

  it("keeps isRangeRefusal and isRateLimitedError consistent with it", () => {
    expect(isRangeRefusal(viemRpcError(-32012, "requested range too large"))).toBe(true);
    expect(isRangeRefusal(viemRpcError(-32005, "rate limit exceeded", 429))).toBe(false);
    expect(isRateLimitedError(viemRpcError(-32005, "rate limit exceeded", 429))).toBe(true);
    expect(isRateLimitedError(viemRpcError(-32012, "requested range too large"))).toBe(false);
  });
});

describe("isRetryableRpcError", () => {
  it("retries what viem retries, rate limits and size refusals excepted", () => {
    expect(
      isRetryableRpcError(new HttpRequestError({ body: BODY, url: URL, cause: new Error("x") })),
    ).toBe(true);
    expect(isRetryableRpcError(new TimeoutError({ body: BODY, url: URL }))).toBe(true);
    expect(isRetryableRpcError(viemRpcError(-32603, "internal error"))).toBe(true);
    for (const status of [403, 408, 413, 500, 502, 503, 504]) {
      expect(
        isRetryableRpcError(new HttpRequestError({ body: BODY, url: URL, status, details: "x" })),
      ).toBe(true);
    }
    expect(
      isRetryableRpcError(
        new HttpRequestError({ body: BODY, url: URL, status: 400, details: "x" }),
      ),
    ).toBe(false);
    expect(isRetryableRpcError(viemRpcError(-32012, "requested range too large"))).toBe(false);
    expect(
      isRetryableRpcError(viemRpcError(-32005, "query returned more than 10000 results")),
    ).toBe(false);
    expect(
      isRetryableRpcError(new MethodNotFoundRpcError(new Error("no"), { method: "eth_x" })),
    ).toBe(false);
    expect(isRetryableRpcError(viemRpcError(3, "execution reverted"))).toBe(false);
    expect(isRetryableRpcError(Object.assign(new Error("stop"), { name: "AbortError" }))).toBe(
      false,
    );
  });
});

describe("retryAfterMs", () => {
  it("reads a Retry-After in seconds or as a date, anywhere in the cause chain", () => {
    const seconds = new RpcRequestError({
      body: BODY,
      error: { code: -32005, message: "rate limit exceeded" },
      url: URL,
      status: 429,
      headers: new Headers({ "Retry-After": "3" }),
    });
    expect(retryAfterMs(new LimitExceededRpcError(seconds), 0)).toBe(3_000);
    const now = Date.parse("2026-11-18T12:00:00Z");
    const date = new RpcRequestError({
      body: BODY,
      error: { code: -32005, message: "rate limit exceeded" },
      url: URL,
      status: 429,
      headers: new Headers({ "Retry-After": "Wed, 18 Nov 2026 12:00:05 GMT" }),
    });
    expect(retryAfterMs(date, now)).toBe(5_000);
    expect(retryAfterMs(viemRpcError(-32005, "rate limit exceeded", 429), now)).toBeUndefined();
  });
});

describe("rateLimitDelayMs", () => {
  it("doubles from the base, stays within [half, full] of it, and never exceeds the maximum", () => {
    expect(rateLimitDelayMs(1, 1_000, 30_000, 0)).toBe(500);
    expect(rateLimitDelayMs(1, 1_000, 30_000, 1)).toBe(1_000);
    expect(rateLimitDelayMs(2, 1_000, 30_000, 1)).toBe(2_000);
    expect(rateLimitDelayMs(3, 1_000, 30_000, 0.5)).toBe(3_000);
    expect(rateLimitDelayMs(10, 1_000, 30_000, 1)).toBe(30_000);
    expect(rateLimitDelayMs(1_000, 1_000, 30_000, 0)).toBe(15_000);
    // A refusal that never ends is asked less and less often: the smallest wait of a later
    // refusal is never below the smallest wait of an earlier one.
    let previousFloor = 0;
    for (let inARow = 1; inARow <= 40; inARow += 1) {
      const floor = rateLimitDelayMs(inARow, 1_000, 30_000, 0);
      expect(floor).toBeGreaterThanOrEqual(previousFloor);
      expect(rateLimitDelayMs(inARow, 1_000, 30_000, 0.999)).toBeLessThanOrEqual(30_000);
      previousFloor = floor;
    }
  });
});
