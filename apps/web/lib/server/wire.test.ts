import { describe, expect, it } from "vitest";

import { BookCacheRowError, parseBookCacheRow } from "./books";
import {
  digits,
  effectiveSaleState,
  liveProbabilityBps,
  percentLabel,
  ratioBps,
  ratioBpsUp,
  safeUrl,
} from "./wire";

const now = new Date("2026-11-20T18:00:00.000Z");

describe("wire conversions", () => {
  it("formats percentages without trailing zeros", () => {
    expect(percentLabel(10_000n)).toBe("100");
    expect(percentLabel(1250)).toBe("12.5");
    expect(percentLabel(1205n)).toBe("12.05");
    expect(percentLabel(0)).toBe("0");
  });

  it("keeps only absolute http(s) URLs", () => {
    expect(safeUrl("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("logo.png")).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });

  it("computes ratios in basis points, rounded down and clamped", () => {
    expect(ratioBps(1n, 3n)).toBe(3333);
    expect(ratioBps(5n, 0n)).toBe(0);
    expect(ratioBps(7n, 5n)).toBe(10_000);
  });

  it("computes cost ratios in basis points, rounded up and clamped", () => {
    expect(ratioBpsUp(1n, 3n)).toBe(3334);
    expect(ratioBpsUp(1250n, 10_000n)).toBe(1250);
    expect(ratioBpsUp(5n, 0n)).toBe(0);
    expect(ratioBpsUp(0n, 5n)).toBe(0);
    expect(ratioBpsUp(7n, 5n)).toBe(10_000);
  });

  it("never sends a negative amount", () => {
    expect(digits(12n)).toBe("12");
    expect(() => digits(-1n)).toThrow(RangeError);
  });

  it("shows the live mid only while fresh and unsettled", () => {
    const fresh = { mid_bps: 1200, stale: false, observed_at: new Date(now.getTime() - 5_000) };
    expect(liveProbabilityBps(fresh, false, now)).toBe(1200);
    expect(liveProbabilityBps(fresh, true, now)).toBeNull();
    expect(liveProbabilityBps({ ...fresh, stale: true }, false, now)).toBeNull();
    expect(liveProbabilityBps({ ...fresh, mid_bps: null }, false, now)).toBeNull();
    expect(
      liveProbabilityBps({ ...fresh, observed_at: new Date(now.getTime() - 11_000) }, false, now),
    ).toBeNull();
    expect(liveProbabilityBps(null, false, now)).toBeNull();
  });

  it("closes sales at the sales close whatever the stored state", () => {
    expect(effectiveSaleState("open", new Date(now.getTime() + 1), now)).toBe("open");
    expect(effectiveSaleState("paused_price", now, now)).toBe("closed");
  });
});

describe("parseBookCacheRow", () => {
  it("reads levels into bigints, best first as stored", () => {
    const observedAt = new Date(now.getTime() - 1_000);
    expect(
      parseBookCacheRow("SYM", {
        symbol: "SYM",
        bids: [{ priceBps: 1100, qty: "5000000" }],
        asks: [
          { priceBps: 1200, qty: "1000000" },
          { priceBps: 1300, qty: "2000000" },
        ],
        observed_at: observedAt,
      }),
    ).toEqual({
      instrumentSymbol: "SYM",
      bids: [{ priceBps: 1100n, qty: 5_000_000n }],
      asks: [
        { priceBps: 1200n, qty: 1_000_000n },
        { priceBps: 1300n, qty: 2_000_000n },
      ],
      observedAtMs: observedAt.getTime(),
    });
  });

  it("refuses a malformed row", () => {
    expect(() =>
      parseBookCacheRow("SYM", {
        symbol: "SYM",
        bids: [{ priceBps: 1100, qty: 5 }],
        asks: [],
        observed_at: now,
      }),
    ).toThrow(BookCacheRowError);
  });
});
