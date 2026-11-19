import { describe, expect, it } from "vitest";

import {
  campaignTermsSchema,
  isoDateSchema,
  liveCampaignRowSchema,
  liveInstrumentRowSchema,
  microUsdcSchema,
  pgTimestampSchema,
} from "./schemas";

const terms = {
  instrumentSymbol: "GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13",
  unitPrice: "20000000",
  refundBps: 10_000,
  usualMarginBps: 6500,
  minMarginBps: 4500,
  budget: "1000000000",
};

describe("campaign terms", () => {
  it("accepts the terms of the worked example", () => {
    expect(campaignTermsSchema.safeParse(terms).success).toBe(true);
  });

  it("refuses what the contract would refuse: a zero unit price or a zero refund rate", () => {
    expect(campaignTermsSchema.safeParse({ ...terms, unitPrice: "0" }).success).toBe(false);
    expect(campaignTermsSchema.safeParse({ ...terms, unitPrice: "000" }).success).toBe(false);
    expect(campaignTermsSchema.safeParse({ ...terms, refundBps: 0 }).success).toBe(false);
    expect(campaignTermsSchema.safeParse({ ...terms, refundBps: 10_001 }).success).toBe(false);
  });
});

describe("rows pushed by Supabase Realtime (the public live_* tables)", () => {
  // What Postgres writes for a timestamptz in a pushed row, and what the API's answers carry.
  const PUSHED = "2026-11-21T20:00:00.123456+00:00";
  const FROM_THE_API = "2026-11-21T20:00:00.123Z";

  it("accepts a timestamp with an offset and microseconds, which the API's own format refuses", () => {
    expect(pgTimestampSchema.safeParse(PUSHED).success).toBe(true);
    expect(pgTimestampSchema.safeParse("2026-11-21T20:00:00+00:00").success).toBe(true);
    expect(pgTimestampSchema.safeParse(FROM_THE_API).success).toBe(true);
    // The reason the rows have a schema of their own: this is the form that was dropped.
    expect(isoDateSchema.safeParse(PUSHED).success).toBe(false);
    expect(pgTimestampSchema.safeParse("yesterday").success).toBe(false);
  });

  it("reads a pushed live_instruments row", () => {
    const row = {
      symbol: "GEMI-NCAAF-ARK-TEX-M-TEX",
      bid_bps: 6100,
      ask_bps: 6300,
      mid_bps: 6200,
      observed_at: PUSHED,
      stale: false,
    };
    expect(liveInstrumentRowSchema.parse(row)).toEqual(row);
    expect(new Date(liveInstrumentRowSchema.parse(row).observed_at).toISOString()).toBe(
      "2026-11-21T20:00:00.123Z",
    );
  });

  it("reads a pushed live_campaigns row", () => {
    const row = {
      slug: "joes-texas",
      sale_state: "open",
      sales: 12,
      exposure: "24000000",
      hedged_bps: 9500,
      outcome: null,
      updated_at: PUSHED,
    };
    expect(liveCampaignRowSchema.parse(row)).toEqual(row);
  });

  // Rows exactly as Postgres 16 writes them with to_jsonb, which is what realtime.cast sends:
  // `select to_jsonb(c)::text from live_campaigns c` (and live_instruments) on the migrated schema.
  // What a screen gets is this text through JSON.parse (realtime-js leaves numbers as they are).
  const PUSHED_CAMPAIGN =
    '{"slug": "joes-texas", "sales": 12, "outcome": null, "exposure": 24000000, "hedged_bps": 9500, "sale_state": "open", "updated_at": "2026-11-19T12:50:27.005657+00:00"}';
  const PUSHED_SETTLED =
    '{"slug": "joes-texas", "sales": 3, "outcome": "yes", "exposure": 0, "hedged_bps": 0, "sale_state": "closed", "updated_at": "2026-11-21T23:00:00+00:00"}';
  const PUSHED_BEYOND_SAFE =
    '{"slug": "big-one", "sales": 3, "outcome": "yes", "exposure": 9007199254740993, "hedged_bps": 0, "sale_state": "paused_price", "updated_at": "2026-11-19T12:50:27.005657+00:00"}';
  const PUSHED_INSTRUMENT =
    '{"stale": false, "symbol": "GEMI-NCAAF-ARK-TEX-M-TEX", "ask_bps": 6300, "bid_bps": 6100, "mid_bps": 6200, "observed_at": "2026-11-21T20:00:00.123456+00:00"}';
  const PUSHED_NO_QUOTE =
    '{"stale": true, "symbol": "GEMI-X", "ask_bps": null, "bid_bps": null, "mid_bps": null, "observed_at": "2026-11-21T20:00:00+00:00"}';

  it("reads a live_campaigns row in the pushed form, and hands exposure on as the API's string", () => {
    const parsed = liveCampaignRowSchema.parse(JSON.parse(PUSHED_CAMPAIGN));
    expect(parsed).toEqual({
      slug: "joes-texas",
      sale_state: "open",
      sales: 12,
      exposure: "24000000",
      hedged_bps: 9500,
      outcome: null,
      updated_at: "2026-11-19T12:50:27.005657+00:00",
    });
    expect(typeof parsed.exposure).toBe("string");
    // The same type the API's answers carry for money.
    expect(microUsdcSchema.safeParse(parsed.exposure).success).toBe(true);
    expect(liveCampaignRowSchema.parse(JSON.parse(PUSHED_SETTLED))).toMatchObject({
      exposure: "0",
      outcome: "yes",
      sale_state: "closed",
    });
  });

  it("was refused in that form before (the defect): exposure as a string only", () => {
    const stringOnly = liveCampaignRowSchema.extend({ exposure: microUsdcSchema });
    expect(stringOnly.safeParse(JSON.parse(PUSHED_CAMPAIGN)).success).toBe(false);
  });

  it("refuses an exposure that JSON.parse has already rounded, rather than show a wrong amount", () => {
    const pushed = JSON.parse(PUSHED_BEYOND_SAFE) as { exposure: number };
    // What arrives: 9007199254740993 in the JSON text, 9007199254740992 once parsed.
    expect(pushed.exposure).toBe(9007199254740992);
    expect(Number.isSafeInteger(pushed.exposure)).toBe(false);
    expect(liveCampaignRowSchema.safeParse(pushed).success).toBe(false);
    // The largest exact value still passes, as the API's string.
    expect(
      liveCampaignRowSchema.parse({ ...pushed, exposure: Number.MAX_SAFE_INTEGER }).exposure,
    ).toBe("9007199254740991");
  });

  it("refuses an exposure that is not a non-negative integer", () => {
    const pushed = JSON.parse(PUSHED_CAMPAIGN) as Record<string, unknown>;
    for (const exposure of [-1, 1.5, "1.5", "-1", null, true]) {
      expect(
        liveCampaignRowSchema.safeParse({ ...pushed, exposure }).success,
        String(exposure),
      ).toBe(false);
    }
  });

  it("reads live_instruments rows in the pushed form, with and without a quote", () => {
    expect(liveInstrumentRowSchema.parse(JSON.parse(PUSHED_INSTRUMENT))).toEqual({
      symbol: "GEMI-NCAAF-ARK-TEX-M-TEX",
      bid_bps: 6100,
      ask_bps: 6300,
      mid_bps: 6200,
      observed_at: "2026-11-21T20:00:00.123456+00:00",
      stale: false,
    });
    expect(liveInstrumentRowSchema.parse(JSON.parse(PUSHED_NO_QUOTE))).toMatchObject({
      bid_bps: null,
      ask_bps: null,
      mid_bps: null,
      stale: true,
    });
  });
});
