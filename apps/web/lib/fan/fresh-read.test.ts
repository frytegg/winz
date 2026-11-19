import { BOOK_STALE_AFTER_MS } from "@winz/shared";
import { describe, expect, it, vi } from "vitest";

import { isReadFresh, shownOdds, stampingReads } from "./fresh-read";

const NOW = 1_800_000_000_000;

describe("the freshness of a fan's screen (review 2.4)", () => {
  it("uses the API's own bound for a quote: 10 s, the same rule as liveProbabilityBps", () => {
    expect(BOOK_STALE_AFTER_MS).toBe(10_000);
    expect(isReadFresh(NOW - BOOK_STALE_AFTER_MS, NOW)).toBe(true);
    expect(isReadFresh(NOW - BOOK_STALE_AFTER_MS - 1, NOW)).toBe(false);
  });

  it("trusts the answer the page was served with until the first re-read, and the server's render", () => {
    expect(isReadFresh(null, NOW)).toBe(true);
    expect(isReadFresh(NOW - 60_000, 0)).toBe(true);
  });

  it("shows the chance as unknown when a re-read failed, even with an answer in hand", () => {
    expect(shownOdds(1200, { failing: false, lastReadAtMs: NOW - 1000, nowMs: NOW })).toBe(1200);
    expect(shownOdds(1200, { failing: true, lastReadAtMs: NOW - 1000, nowMs: NOW })).toBeNull();
  });

  it("shows the chance as unknown when the last successful read is too old", () => {
    expect(shownOdds(1200, { failing: false, lastReadAtMs: NOW - 11_000, nowMs: NOW })).toBeNull();
    expect(shownOdds(null, { failing: false, lastReadAtMs: NOW, nowMs: NOW })).toBeNull();
  });
});

describe("stampingReads: when the page last read the API", () => {
  it("stamps every successful read, even one that hands back the very same object", async () => {
    // A read layer that reuses its last object (a cache, structural sharing) must not freeze the
    // clock: the purchase would lock 10 s after the first read although every read succeeds.
    const answer = { probabilityBps: 1200 };
    const stamps: number[] = [];
    let clock = NOW;
    const read = stampingReads(
      () => Promise.resolve(answer),
      (at) => stamps.push(at),
      () => clock,
    );
    const signal = new AbortController().signal;
    expect(await read(signal)).toBe(answer);
    clock += 5000;
    expect(await read(signal)).toBe(answer);
    expect(stamps).toEqual([NOW, NOW + 5000]);
  });

  it("stamps nothing for a read that fails, or one whose page moved on", async () => {
    const onRead = vi.fn();
    const failing = stampingReads(() => Promise.reject(new Error("offline")), onRead);
    await expect(failing(new AbortController().signal)).rejects.toThrow("offline");
    const aborted = new AbortController();
    const late = stampingReads(() => {
      aborted.abort();
      return Promise.resolve(1);
    }, onRead);
    await late(aborted.signal);
    expect(onRead).not.toHaveBeenCalled();
  });
});
