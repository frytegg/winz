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
