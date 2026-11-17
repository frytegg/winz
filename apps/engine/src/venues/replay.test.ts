import { describe, expect, it } from "vitest";

import { FillReplayError } from "./errors";
import { fillFee, floorToContractStep, isWithinLimit, replayFill } from "./replay";
import { c } from "./test-support";
import type { VenueFill } from "./types";

const takerFill: VenueFill = {
  fillId: "f1",
  clientOrderId: "o1",
  instrumentSymbol: "SYM",
  side: "buy",
  kind: "taker",
  priceBps: 5100n,
  qty: c(1),
  fee: 17_500n,
  atMs: 10,
  bookRef: {
    source: "book",
    instrumentSymbol: "SYM",
    observedAtMs: 5,
    bookSide: "asks",
    levels: [{ priceBps: 5100n, displayedQty: c(2), consumedBeforeQty: c(1) }],
    limitPriceBps: 5200n,
    orderRemainingQty: c(3),
    makerFeeWaived: true,
  },
};

describe("replay helpers", () => {
  it("floors to the 0.01 contract step and never goes negative", () => {
    expect(floorToContractStep(1_239_999n)).toBe(1_230_000n);
    expect(floorToContractStep(9_999n)).toBe(0n);
    expect(floorToContractStep(-5n)).toBe(0n);
  });

  it("compares prices to the limit by side", () => {
    expect(isWithinLimit("buy", 5000n, 5000n)).toBe(true);
    expect(isWithinLimit("buy", 5100n, 5000n)).toBe(false);
    expect(isWithinLimit("sell", 5000n, 5000n)).toBe(true);
    expect(isWithinLimit("sell", 4900n, 5000n)).toBe(false);
  });

  it("computes taker and maker fees in micro-USDC", () => {
    expect(fillFee("taker", 5000n, c(1), true)).toBe(17_500n);
    expect(fillFee("maker", 5000n, c(1), true)).toBe(0n);
    // 0.0175 × 0.25 = 43.75 bps → 44 bps per contract.
    expect(fillFee("maker", 5000n, c(1), false)).toBe(4_400n);
  });
});

describe("replayFill", () => {
  it("reproduces a consistent fill", () => {
    expect(replayFill(takerFill)).toEqual({ priceBps: 5100n, qty: c(1), fee: 17_500n });
  });

  it("exposes a tampered quantity as a difference", () => {
    const tampered: VenueFill = { ...takerFill, qty: c(2) };
    expect(replayFill(tampered).qty).not.toBe(tampered.qty);
  });

  it.each([
    [
      "a level beyond the limit",
      { ...takerFill, bookRef: { ...takerFill.bookRef, limitPriceBps: 5000n } },
    ],
    [
      "another instrument",
      { ...takerFill, bookRef: { ...takerFill.bookRef, instrumentSymbol: "OTHER" } },
    ],
    ["the wrong side of the book", { ...takerFill, side: "sell" as const }],
    [
      "a level consumed beyond its display",
      {
        ...takerFill,
        bookRef: {
          ...takerFill.bookRef,
          levels: [{ priceBps: 5100n, displayedQty: c(1), consumedBeforeQty: c(2) }],
        },
      },
    ],
    [
      "a taker fill on a trade print",
      {
        ...takerFill,
        bookRef: {
          source: "trade" as const,
          instrumentSymbol: "SYM",
          printPriceBps: 5100n,
          printedQty: c(1),
          allocatedBeforeQty: 0n,
          printedAtMs: 1,
          limitPriceBps: 5200n,
          orderRemainingQty: c(1),
          makerFeeWaived: true,
        },
      },
    ],
  ])("throws on %s", (_label, fill) => {
    expect(() => replayFill(fill as VenueFill)).toThrow(FillReplayError);
  });
});
