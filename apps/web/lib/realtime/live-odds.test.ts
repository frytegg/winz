import { BOOK_STALE_AFTER_MS } from "@winz/shared";
import { describe, expect, it } from "vitest";

import { FEED_SILENT_AFTER_MS, isFeedLive, oddsFromRow, wobble } from "./live-odds";

const NOW = Date.parse("2026-11-21T20:00:00.000Z");

function row(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    symbol: "GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13",
    bid_bps: 1150,
    ask_bps: 1250,
    mid_bps: 1200,
    observed_at: new Date(NOW - 1000).toISOString(),
    stale: false,
    ...patch,
  };
}

describe("oddsFromRow", () => {
  it("reads the mid of a fresh quote", () => {
    expect(oddsFromRow(row(), NOW)).toBe(1200);
  });

  it("shows nothing for a stale quote, as the API does", () => {
    expect(oddsFromRow(row({ stale: true }), NOW)).toBeNull();
  });

  it("shows nothing for a quote older than the book allows", () => {
    const old = new Date(NOW - BOOK_STALE_AFTER_MS - 1).toISOString();
    expect(oddsFromRow(row({ observed_at: old }), NOW)).toBeNull();
    const edge = new Date(NOW - BOOK_STALE_AFTER_MS).toISOString();
    expect(oddsFromRow(row({ observed_at: edge }), NOW)).toBe(1200);
  });

  it("reads a row the way Supabase Realtime sends it, with a +00:00 offset instead of Z", () => {
    const pushed = row({ observed_at: new Date(NOW - 1000).toISOString().replace("Z", "+00:00") });
    expect(oddsFromRow(pushed, NOW)).toBe(1200);
    const old = new Date(NOW - BOOK_STALE_AFTER_MS - 1).toISOString().replace("Z", "+00:00");
    expect(oddsFromRow(row({ observed_at: old }), NOW)).toBeNull();
  });

  it("shows nothing when the row has no mid", () => {
    expect(oddsFromRow(row({ mid_bps: null }), NOW)).toBeNull();
  });

  it("shows nothing for something that is not a row (a delete pushes an empty record)", () => {
    expect(oddsFromRow({}, NOW)).toBeNull();
    expect(oddsFromRow(null, NOW)).toBeNull();
    expect(oddsFromRow(row({ mid_bps: "12" }), NOW)).toBeNull();
  });
});

describe("wobble", () => {
  it("stays close to the figure and inside 1% to 99%", () => {
    for (let step = 1; step < 200; step += 1) {
      expect(Math.abs(wobble(1200, step) - 1200)).toBeLessThanOrEqual(150);
      expect(wobble(50, step)).toBeGreaterThanOrEqual(100);
      expect(wobble(9990, step)).toBeLessThanOrEqual(9900);
    }
  });

  it("moves", () => {
    const values = new Set(Array.from({ length: 20 }, (_, index) => wobble(1200, index + 1)));
    expect(values.size).toBeGreaterThan(5);
  });
});

describe("isFeedLive", () => {
  it("is not live before any row arrived, even when subscribed", () => {
    expect(isFeedLive(true, null, NOW)).toBe(false);
  });

  it("is live right after a row, and until the feed has been silent too long", () => {
    expect(isFeedLive(true, NOW - 1000, NOW)).toBe(true);
    expect(isFeedLive(true, NOW - FEED_SILENT_AFTER_MS + 1, NOW)).toBe(true);
    expect(isFeedLive(true, NOW - FEED_SILENT_AFTER_MS, NOW)).toBe(false);
  });

  it("is never live when not subscribed", () => {
    expect(isFeedLive(false, NOW - 1000, NOW)).toBe(false);
  });
});
