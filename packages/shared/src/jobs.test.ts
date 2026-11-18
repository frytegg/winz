import { describe, expect, it } from "vitest";

import { JOB_KINDS, JOB_PAYLOAD_SCHEMAS, jobIdempotencyKey } from "./jobs";

describe("job contracts", () => {
  it("has a payload schema for every kind", () => {
    expect(Object.keys(JOB_PAYLOAD_SCHEMAS).sort()).toEqual(Object.values(JOB_KINDS).sort());
  });

  it("builds idempotency keys that cannot collide across kinds", () => {
    const id = "3f0e4a52-7a0b-4e0f-9f43-1d2c3b4a5e6f";
    const keys = [
      jobIdempotencyKey.createCampaign(id),
      jobIdempotencyKey.purchase(id),
      jobIdempotencyKey.setPaused(id),
      jobIdempotencyKey.closeSales(id),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key.endsWith(`:${id}`)).toBe(true);
  });

  it("validates payloads", () => {
    expect(
      JOB_PAYLOAD_SCHEMAS[JOB_KINDS.purchase].safeParse({ paymentIntentId: "pi_1" }).success,
    ).toBe(true);
    expect(JOB_PAYLOAD_SCHEMAS[JOB_KINDS.purchase].safeParse({}).success).toBe(false);
    expect(
      JOB_PAYLOAD_SCHEMAS[JOB_KINDS.createCampaign].safeParse({ campaignId: "not-a-uuid" }).success,
    ).toBe(false);
  });
});

describe("budget top-up job contract (CA-6)", () => {
  const payload = {
    campaignId: "3f0e4a52-7a0b-4e0f-9f43-1d2c3b4a5e6f",
    amount: "500000000",
    paymentIntentId: "pi_top_up_1",
    requestId: "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b",
  };
  const schema = JOB_PAYLOAD_SCHEMAS[JOB_KINDS.topUpBudget];

  it("is its own kind, with a key built from the payment", () => {
    expect(JOB_KINDS.topUpBudget).toBe("campaign.top_up");
    expect(jobIdempotencyKey.topUpBudget("pi_top_up_1")).toBe("campaign.top_up:pi_top_up_1");
    const id = "3f0e4a52-7a0b-4e0f-9f43-1d2c3b4a5e6f";
    const keys = [
      jobIdempotencyKey.createCampaign(id),
      jobIdempotencyKey.purchase(id),
      jobIdempotencyKey.setPaused(id),
      jobIdempotencyKey.closeSales(id),
      jobIdempotencyKey.topUpBudget(id),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("accepts a well-formed payload", () => {
    expect(schema.safeParse(payload).success).toBe(true);
  });

  it.each([
    ["a zero amount", { amount: "0" }],
    ["a negative amount", { amount: "-5" }],
    ["an amount that is not digits", { amount: "5.00" }],
    ["an amount as a number", { amount: 500 }],
    ["a campaign id that is not a uuid", { campaignId: "cmp_1" }],
    ["a request id that is not a uuid", { requestId: "req-1" }],
    ["an empty payment id", { paymentIntentId: "" }],
  ])("refuses %s", (_label, change) => {
    expect(schema.safeParse({ ...payload, ...change }).success).toBe(false);
  });

  it("refuses a payload with a field missing", () => {
    for (const field of Object.keys(payload)) {
      const partial: Record<string, unknown> = { ...payload };
      delete partial[field];
      expect(schema.safeParse(partial).success, field).toBe(false);
    }
  });
});
