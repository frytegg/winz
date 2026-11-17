import { describe, expect, it } from "vitest";

import { PricingInputError } from "./errors";
import {
  MAKER_FEE_RATE_BPS,
  TAKER_FEE_RATE_BPS,
  costPerContractBps,
  makerFeeBps,
  takerFeeBps,
} from "./fees";

describe("takerFeeBps", () => {
  it("is 0.07 × p × (1 − p), in basis points of a dollar", () => {
    expect(TAKER_FEE_RATE_BPS).toBe(700n);
    // Gemini's own example: $0.40 → 0.07 × 0.40 × 0.60 = $0.0168 per contract.
    expect(takerFeeBps(4000n)).toBe(168n);
    // The maximum, at 50 %: 0.07 × 0.25 = $0.0175.
    expect(takerFeeBps(5000n)).toBe(175n);
  });

  it("rounds up, because a fee is a cost", () => {
    // 0.07 × 0.12 × 0.88 = 0.007392 → 73.92 bps.
    expect(takerFeeBps(1200n)).toBe(74n);
    // 0.07 × 0.01 × 0.99 = 0.000693 → 6.93 bps.
    expect(takerFeeBps(100n)).toBe(7n);
    // 0.07 × 0.0001 × 0.9999 → 0.007 bps: still one whole basis point.
    expect(takerFeeBps(1n)).toBe(1n);
  });

  it("is zero at the two ends, where the outcome is certain", () => {
    expect(takerFeeBps(0n)).toBe(0n);
    expect(takerFeeBps(10_000n)).toBe(0n);
  });

  it("is symmetric around 50 % and never above its maximum", () => {
    for (let price = 0n; price <= 10_000n; price += 1n) {
      const fee = takerFeeBps(price);
      expect(fee).toBe(takerFeeBps(10_000n - price));
      expect(fee).toBeLessThanOrEqual(175n);
    }
  });

  it("refuses a price outside 0..10 000 bps", () => {
    expect(() => takerFeeBps(-1n)).toThrow(PricingInputError);
    expect(() => takerFeeBps(10_001n)).toThrow(PricingInputError);
    expect(() => takerFeeBps(10_000n)).not.toThrow();
  });
});

describe("makerFeeBps", () => {
  it("is 0.0175 × p × (1 − p) when the fee applies", () => {
    expect(MAKER_FEE_RATE_BPS).toBe(175n);
    // 0.0175 × 0.40 × 0.60 = $0.0042.
    expect(makerFeeBps(4000n, { waived: false })).toBe(42n);
    // 0.0175 × 0.25 = 0.004375 → 43.75 bps, rounded up.
    expect(makerFeeBps(5000n, { waived: false })).toBe(44n);
  });

  it("is zero while the fee is waived", () => {
    expect(makerFeeBps(4000n, { waived: true })).toBe(0n);
    expect(makerFeeBps(5000n, { waived: true, rateBps: 9_000n })).toBe(0n);
  });

  it("takes another rate when the schedule changes", () => {
    expect(makerFeeBps(4000n, { waived: false, rateBps: 700n })).toBe(takerFeeBps(4000n));
    expect(makerFeeBps(4000n, { waived: false, rateBps: 0n })).toBe(0n);
  });

  it("refuses a price or a rate outside 0..10 000 bps, even when waived", () => {
    expect(() => makerFeeBps(10_001n, { waived: false })).toThrow(PricingInputError);
    expect(() => makerFeeBps(10_001n, { waived: true })).toThrow(PricingInputError);
    expect(() => makerFeeBps(4000n, { waived: false, rateBps: -1n })).toThrow(PricingInputError);
    expect(() => makerFeeBps(4000n, { waived: false, rateBps: 10_001n })).toThrow(
      PricingInputError,
    );
  });
});

describe("costPerContractBps", () => {
  it("is the price plus the taker fee", () => {
    expect(costPerContractBps(1200n)).toBe(1274n);
    expect(costPerContractBps(4000n)).toBe(4168n);
    expect(costPerContractBps(0n)).toBe(0n);
    expect(costPerContractBps(10_000n)).toBe(10_000n);
  });

  it("matches the worked example of SPEC 4.3 around the pause threshold", () => {
    // 0.18 + 0.07 × 0.18 × 0.82 = 0.190332: below 20 %.
    expect(costPerContractBps(1800n)).toBe(1904n);
    // 0.19 + 0.07 × 0.19 × 0.81 = 0.200773: above 20 %.
    expect(costPerContractBps(1900n)).toBe(2008n);
  });

  it("never decreases when the price increases", () => {
    for (let price = 0n; price < 10_000n; price += 1n) {
      expect(costPerContractBps(price + 1n)).toBeGreaterThanOrEqual(costPerContractBps(price));
    }
  });
});
