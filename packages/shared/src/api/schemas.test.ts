import { describe, expect, it } from "vitest";

import { campaignTermsSchema } from "./schemas";

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
