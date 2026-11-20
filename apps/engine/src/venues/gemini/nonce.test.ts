import { describe, expect, it } from "vitest";

import { NonceGuard } from "./nonce";

describe("NonceGuard, incremental (epoch milliseconds)", () => {
  it("uses the clock when it has moved on", () => {
    const guard = new NonceGuard("incremental");
    expect(guard.next(1_000)).toEqual({ nonce: 1_000, waitMs: 0 });
    expect(guard.next(1_500)).toEqual({ nonce: 1_500, waitMs: 0 });
  });

  it("stays strictly increasing when the clock stands still or goes back", () => {
    const guard = new NonceGuard("incremental");
    const nonces = [5_000, 5_000, 5_000, 4_000, 5_001].map((now) => guard.next(now).nonce);
    expect(nonces).toEqual([5_000, 5_001, 5_002, 5_003, 5_004]);
    for (let i = 1; i < nonces.length; i += 1) {
      expect(nonces[i]).toBeGreaterThan(nonces[i - 1] ?? Number.POSITIVE_INFINITY);
    }
  });

  it("a new process starts from its clock, above the previous process's last nonce", () => {
    const before = new NonceGuard("incremental");
    let last = 0;
    for (let i = 0; i < 50; i += 1) last = before.next(1_795_200_000_000).nonce;
    // The previous process ran 49 ms ahead of its clock; a restart takes more than that.
    const after = new NonceGuard("incremental");
    expect(after.next(1_795_200_000_000 + 2_000).nonce).toBeGreaterThan(last);
  });

  it("refuses a clock that is not a number", () => {
    expect(() => new NonceGuard("incremental").next(Number.NaN)).toThrow(RangeError);
  });
});

describe("NonceGuard, time (epoch seconds)", () => {
  it("uses the second of the clock", () => {
    const guard = new NonceGuard("time");
    expect(guard.next(1_795_200_000_400)).toEqual({ nonce: 1_795_200_000, waitMs: 0 });
  });

  it("a second request in the same second takes the next second and waits for it", () => {
    const guard = new NonceGuard("time");
    guard.next(1_795_200_000_400);
    expect(guard.next(1_795_200_000_700)).toEqual({ nonce: 1_795_200_001, waitMs: 300 });
    // The waiting keeps the nonce at most one second ahead of the clock.
    expect(guard.next(1_795_200_001_000)).toEqual({ nonce: 1_795_200_002, waitMs: 1_000 });
  });
});
