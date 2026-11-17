import { describe, expect, it } from "vitest";

import { exponentialBackoff } from "./backoff";
import { JobConfigError } from "./errors";

describe("exponentialBackoff", () => {
  it("doubles from the base and stops at the cap", () => {
    const backoff = exponentialBackoff({ baseMs: 100, maxMs: 1_000, jitter: 0 });
    expect([1, 2, 3, 4, 5, 6, 50, 5_000].map(backoff)).toEqual([
      100, 200, 400, 800, 1_000, 1_000, 1_000, 1_000,
    ]);
  });

  it("shortens the delay by a random share and never exceeds the cap", () => {
    const longest = exponentialBackoff({ baseMs: 100, maxMs: 1_000, jitter: 0.5, random: () => 0 });
    const shortest = exponentialBackoff({
      baseMs: 100,
      maxMs: 1_000,
      jitter: 0.5,
      random: () => 0.999_999,
    });
    expect(longest(3)).toBe(400);
    expect(shortest(3)).toBe(200);
    expect(longest(20)).toBe(1_000);

    const random = exponentialBackoff({ baseMs: 100, maxMs: 1_000 });
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const delayMs = random(attempt);
      expect(delayMs).toBeGreaterThanOrEqual(50);
      expect(delayMs).toBeLessThanOrEqual(1_000);
    }
  });

  it("refuses options that make no sense", () => {
    expect(() => exponentialBackoff({ baseMs: -1, maxMs: 10 })).toThrow(JobConfigError);
    expect(() => exponentialBackoff({ baseMs: 100, maxMs: 10 })).toThrow(JobConfigError);
    expect(() => exponentialBackoff({ baseMs: 1, maxMs: 10, factor: 0.5 })).toThrow(JobConfigError);
    expect(() => exponentialBackoff({ baseMs: 1, maxMs: 10, jitter: 2 })).toThrow(JobConfigError);
  });
});
