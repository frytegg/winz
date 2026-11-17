import { describe, expect, it } from "vitest";

import { GEMINI_BUCKET_DEFAULTS, TokenBucket } from "./rate-limiter";
import { fakeTime } from "./test-support";

describe("TokenBucket", () => {
  it("lets the burst through at once, then spaces requests at the refill rate", async () => {
    const time = fakeTime(0);
    const bucket = new TokenBucket({
      capacity: 2,
      refillPerMinute: 60,
      now: time.now,
      sleep: time.sleep,
    });

    const sentAt: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      await bucket.acquire();
      sentAt.push(time.now());
    }

    // Two tokens in the bucket, then one new token per second.
    expect(sentAt).toEqual([0, 0, 1_000, 2_000, 3_000]);
    expect(time.sleeps).toEqual([1_000, 1_000, 1_000]);
  });

  it("refills while idle, never above capacity", async () => {
    const time = fakeTime(0);
    const bucket = new TokenBucket({
      capacity: 3,
      refillPerMinute: 60,
      now: time.now,
      sleep: time.sleep,
    });
    for (let i = 0; i < 3; i += 1) await bucket.acquire();

    time.advance(10 * 60_000);
    const sentAt: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      await bucket.acquire();
      sentAt.push(time.now() - 10 * 60_000);
    }
    expect(sentAt).toEqual([0, 0, 0, 1_000]);
  });

  it("serves concurrent callers in arrival order", async () => {
    const time = fakeTime(0);
    const bucket = new TokenBucket({
      capacity: 1,
      refillPerMinute: 120,
      now: time.now,
      sleep: time.sleep,
    });
    const order: string[] = [];
    await Promise.all(
      ["a", "b", "c", "d"].map((name) =>
        bucket.acquire().then(() => order.push(`${name}@${time.now().toString()}`)),
      ),
    );
    expect(order).toEqual(["a@0", "b@500", "c@1000", "d@1500"]);
  });

  it("keeps the default bucket at or under 100 requests in any 60-second window", async () => {
    const time = fakeTime(0);
    const bucket = new TokenBucket({
      ...GEMINI_BUCKET_DEFAULTS,
      now: time.now,
      sleep: time.sleep,
    });

    const sentAt: number[] = [];
    for (let i = 0; i < 400; i += 1) {
      await bucket.acquire();
      sentAt.push(time.now());
    }

    let busiestWindow = 0;
    for (let start = 0; start < sentAt.length; start += 1) {
      const windowStart = sentAt[start] ?? 0;
      const inWindow = sentAt.filter((at) => at >= windowStart && at < windowStart + 60_000).length;
      busiestWindow = Math.max(busiestWindow, inWindow);
    }
    expect(busiestWindow).toBeLessThanOrEqual(100);
    // The burst is really used: the first 20 leave together.
    expect(sentAt.slice(0, 20).every((at) => at === 0)).toBe(true);
    expect(sentAt[20]).toBe(750);
  });

  it("rejects a configuration that could never send", () => {
    expect(() => new TokenBucket({ capacity: 0, refillPerMinute: 60 })).toThrow(RangeError);
    expect(() => new TokenBucket({ capacity: 1, refillPerMinute: 0 })).toThrow(RangeError);
  });
});
