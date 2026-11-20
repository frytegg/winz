import { describe, expect, it } from "vitest";

import { bestAskOf } from "../allocation/core";
import { parseBookRef } from "./desk";

describe("a fill reported by the real Gemini venue, as stored in fills.book_ref", () => {
  const stored = {
    source: "venue",
    instrumentSymbol: "GEMI-BTC2611202200-HI91000",
    venueOrderId: "73797746498585287",
    limitPriceBps: "5800",
    orderRemainingQty: "4000000",
    reportedFilledQty: "4000000",
    reportedAvgPrice: "0.5725",
    observedAtMs: 1_795_200_000_000,
    feeFromSchedule: true,
    makerFeeWaived: true,
  };

  it("is read back, the order id kept as text", () => {
    expect(parseBookRef(stored)).toEqual({
      ...stored,
      limitPriceBps: 5_800n,
      orderRemainingQty: 4_000_000n,
      reportedFilledQty: 4_000_000n,
    });
  });

  it("names no book, so no best ask is derived from it", () => {
    const ref = parseBookRef(stored);
    expect(ref).not.toBeNull();
    expect(bestAskOf(ref)).toBeNull();
  });

  it("a stored reference of an unknown source is still refused", () => {
    expect(parseBookRef({ ...stored, source: "guess" })).toBeNull();
  });
});
