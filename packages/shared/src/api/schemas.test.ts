import { describe, expect, it } from "vitest";

import {
  campaignTermsSchema,
  isoDateSchema,
  liveCampaignRowSchema,
  liveInstrumentRowSchema,
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
});
