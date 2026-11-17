import { describe, expect, it } from "vitest";

import { takerFeeBps } from "@winz/pricing";

import type { BookLevelsRef, TradePrintRef } from "../../venues/types";
import {
  allocateFill,
  allocateInventory,
  bestAskOf,
  chargeForLot,
  fillCost,
  heldInventory,
  rebuildInventory,
  inventoryPiece,
  inventoryTotals,
  makerSaving,
  sellFromInventory,
  takeFromPiece,
  type AllocationLot,
  type BuyFillInput,
} from "./core";
import { AllocationInputError, AllocationStateError, InventoryUnderflowError } from "./errors";

const CONTRACT = 1_000_000n;

function lot(
  id: string,
  seq: bigint,
  qty: bigint,
  maxHedgeCost: bigint,
  campaignId = "A",
): AllocationLot {
  return { lotId: id, seq, campaignId, qty, filledQty: 0n, cost: 0n, maxHedgeCost };
}

function buy(fillId: string, priceBps: bigint, qty: bigint, fee = 0n): BuyFillInput {
  return { fillId, priceBps, qty, fee };
}

function sumCost(allocations: readonly { cost: bigint }[]): bigint {
  return allocations.reduce((total, allocation) => total + allocation.cost, 0n);
}

function asksRef(levels: readonly bigint[]): BookLevelsRef {
  return {
    source: "book",
    instrumentSymbol: "X",
    observedAtMs: 0,
    bookSide: "asks",
    levels: levels.map((priceBps) => ({
      priceBps,
      displayedQty: 10n * CONTRACT,
      consumedBeforeQty: 0n,
    })),
    limitPriceBps: 9900n,
    orderRemainingQty: CONTRACT,
    makerFeeWaived: true,
  };
}

describe("fillCost", () => {
  it("is the notional rounded up plus the fee", () => {
    expect(fillCost(5000n, CONTRACT, 0n)).toBe(500_000n);
    expect(fillCost(3333n, 10_000n, 0n)).toBe(3333n);
    expect(fillCost(3333n, 3n, 0n)).toBe(1n); // 0.9999 rounds up
    expect(fillCost(5000n, CONTRACT, 17_500n)).toBe(517_500n);
  });

  it("refuses a price outside 0..10000 or a negative quantity", () => {
    expect(() => fillCost(10_001n, CONTRACT, 0n)).toThrow(AllocationInputError);
    expect(() => fillCost(5000n, -1n, 0n)).toThrow(AllocationInputError);
    expect(() => fillCost(5000n, 1n, -1n)).toThrow(AllocationInputError);
  });
});

describe("allocateFill", () => {
  it("one fill, one lot: the lot gets the whole fill and is covered", () => {
    const result = allocateFill(
      [lot("L1", 1n, CONTRACT, 600_000n)],
      buy("F1", 5000n, CONTRACT, 1_000n),
    );
    expect(result.allocations).toEqual([
      { lotId: "L1", fillId: "F1", qty: CONTRACT, cost: 501_000n },
    ]);
    expect(result.lots[0]).toMatchObject({ filledQty: CONTRACT, cost: 501_000n });
    expect(result.coveredLotIds).toEqual(["L1"]);
    expect(result.inventory).toEqual([]);
  });

  it("one fill across three lots of two merchants, in seq order, each with its own share", () => {
    const lots = [
      lot("A1", 1n, 300_000n, 200_000n, "A"),
      lot("B1", 2n, 500_000n, 300_000n, "B"),
      lot("A2", 3n, 400_000n, 250_000n, "A"),
    ];
    const result = allocateFill(lots, buy("F1", 5000n, 1_000_000n, 10_000n)); // cost 510 000
    expect(result.allocations).toEqual([
      { lotId: "A1", fillId: "F1", qty: 300_000n, cost: 153_000n },
      { lotId: "B1", fillId: "F1", qty: 500_000n, cost: 255_000n },
      { lotId: "A2", fillId: "F1", qty: 200_000n, cost: 102_000n },
    ]);
    expect(result.coveredLotIds).toEqual(["A1", "B1"]);
    expect(result.lots.map((l) => [l.lotId, l.campaignId, l.filledQty, l.cost])).toEqual([
      ["A1", "A", 300_000n, 153_000n],
      ["B1", "B", 500_000n, 255_000n],
      ["A2", "A", 200_000n, 102_000n],
    ]);
    expect(sumCost(result.allocations)).toBe(510_000n);
  });

  it("three fills at different prices cover one lot, which carries each price for its quantity", () => {
    let lots = [lot("L1", 1n, CONTRACT, 600_000n)];
    const fills = [
      buy("F1", 4000n, 200_000n),
      buy("F2", 5000n, 300_000n, 500n),
      buy("F3", 6000n, 500_000n),
    ];
    const allocations = [];
    for (const fill of fills) {
      const result = allocateFill(lots, fill);
      allocations.push(...result.allocations);
      lots = result.lots;
    }
    expect(allocations.map((a) => [a.fillId, a.qty, a.cost])).toEqual([
      ["F1", 200_000n, 80_000n],
      ["F2", 300_000n, 150_500n],
      ["F3", 500_000n, 300_000n],
    ]);
    expect(lots[0]).toMatchObject({ filledQty: CONTRACT, cost: 530_500n });
    expect(chargeForLot(lots[0] as AllocationLot)).toEqual({
      status: "chargeable",
      amount: 530_500n,
      guaranteeLoss: 0n,
      merchantSaving: 69_500n,
    });
  });

  it("conserves the fill cost exactly: shares round up and the last one takes the remainder", () => {
    // 0.03 contract at 33 %, fee 7: 9 900 + 7 = 9 907 micro-USDC over three lots of 0.01.
    const lots = [
      lot("L1", 1n, 10_000n, 5_000n),
      lot("L2", 2n, 10_000n, 5_000n),
      lot("L3", 3n, 10_000n, 5_000n),
    ];
    const result = allocateFill(lots, buy("F1", 3300n, 30_000n, 7n));
    expect(result.allocations.map((a) => a.cost)).toEqual([3303n, 3303n, 3301n]);
    expect(sumCost(result.allocations)).toBe(fillCost(3300n, 30_000n, 7n));
  });

  it("conserves the cost when a fill is split between a lot and inventory, and when the inventory is used", () => {
    const first = allocateFill([lot("L1", 1n, 10_000n, 5_000n)], buy("F1", 3300n, 30_000n, 7n));
    expect(first.allocations.map((a) => a.cost)).toEqual([3303n]);
    expect(inventoryTotals(first.inventory)).toEqual({ qty: 20_000n, cost: 6604n });
    const second = allocateInventory(
      [lot("L2", 2n, 10_000n, 5_000n), lot("L3", 3n, 10_000n, 5_000n)],
      first.inventory,
    );
    expect(second.allocations.map((a) => a.cost)).toEqual([3303n, 3301n]);
    expect(second.inventory).toEqual([]);
  });

  it("splits the fee in proportion to the quantity", () => {
    const lots = [lot("L1", 1n, 250_000n, 1_000_000n), lot("L2", 2n, 750_000n, 1_000_000n)];
    const result = allocateFill(lots, buy("F1", 0n, CONTRACT, 1_000n)); // a pure fee
    expect(result.allocations.map((a) => a.cost)).toEqual([250n, 750n]);
  });

  it("leaves a lot already covered untouched and skips nothing out of FIFO order", () => {
    const covered = { ...lot("L1", 1n, 10_000n, 5_000n), filledQty: 10_000n, cost: 4_000n };
    const result = allocateFill(
      [covered, lot("L2", 2n, 10_000n, 5_000n)],
      buy("F1", 5000n, 10_000n),
    );
    expect(result.allocations.map((a) => a.lotId)).toEqual(["L2"]);
    expect(result.lots[0]).toEqual(covered);
  });

  it("refuses lots out of seq order, listed twice, or filled beyond their quantity", () => {
    const fill = buy("F1", 5000n, 10_000n);
    expect(() => allocateFill([lot("L2", 2n, 1n, 1n), lot("L1", 1n, 1n, 1n)], fill)).toThrow(
      AllocationInputError,
    );
    expect(() => allocateFill([lot("L1", 1n, 1n, 1n), lot("L1", 2n, 1n, 1n)], fill)).toThrow(
      AllocationInputError,
    );
    expect(() => allocateFill([{ ...lot("L1", 1n, 1n, 1n), filledQty: 2n }], fill)).toThrow(
      AllocationInputError,
    );
  });

  it("refuses a fill of zero contracts, whose fee no lot could carry", () => {
    expect(() => allocateFill([lot("L1", 1n, 1n, 1n)], buy("F1", 5000n, 0n, 10n))).toThrow(
      AllocationInputError,
    );
  });

  it("a fill larger than the open lots leaves inventory, which covers a lot arriving later", () => {
    const first = allocateFill(
      [lot("L1", 1n, 400_000n, 300_000n)],
      buy("F1", 5000n, CONTRACT, 3_000n),
    ); // 503 000
    expect(first.allocations).toEqual([
      { lotId: "L1", fillId: "F1", qty: 400_000n, cost: 201_200n },
    ]);
    expect(first.inventory).toEqual([
      {
        fillId: "F1",
        fillQty: CONTRACT,
        fillCost: 503_000n,
        remainingQty: 600_000n,
        remainingCost: 301_800n,
      },
    ]);
    const later = allocateInventory([lot("L2", 2n, 250_000n, 200_000n)], first.inventory);
    expect(later.allocations).toEqual([
      { lotId: "L2", fillId: "F1", qty: 250_000n, cost: 125_750n },
    ]);
    expect(later.coveredLotIds).toEqual(["L2"]);
    expect(inventoryTotals(later.inventory)).toEqual({ qty: 350_000n, cost: 176_050n });
    expect(201_200n + 125_750n + 176_050n).toBe(503_000n);
  });

  it("with no open lot at all, the whole fill is inventory", () => {
    const result = allocateFill([], buy("F1", 5000n, CONTRACT));
    expect(result.allocations).toEqual([]);
    expect(inventoryTotals(result.inventory)).toEqual({ qty: CONTRACT, cost: 500_000n });
  });
});

describe("chargeForLot", () => {
  it("nothing while the lot is not fully covered", () => {
    expect(chargeForLot({ qty: 10n, filledQty: 4n, cost: 2n, maxHedgeCost: 5n })).toEqual({
      status: "open",
      missingQty: 6n,
    });
  });

  it("a cost above the guarantee charges the guarantee and records the difference as the platform's loss", () => {
    expect(
      chargeForLot({ qty: CONTRACT, filledQty: CONTRACT, cost: 620_000n, maxHedgeCost: 550_000n }),
    ).toEqual({
      status: "chargeable",
      amount: 550_000n,
      guaranteeLoss: 70_000n,
      merchantSaving: 0n,
    });
  });

  it("a cost below the guarantee charges the cost: the saving stays with the merchant", () => {
    expect(
      chargeForLot({ qty: CONTRACT, filledQty: CONTRACT, cost: 480_000n, maxHedgeCost: 550_000n }),
    ).toEqual({
      status: "chargeable",
      amount: 480_000n,
      guaranteeLoss: 0n,
      merchantSaving: 70_000n,
    });
  });

  it("a lot of zero quantity is chargeable at once for 0, which only releases the reservation", () => {
    expect(chargeForLot({ qty: 0n, filledQty: 0n, cost: 0n, maxHedgeCost: 0n })).toEqual({
      status: "chargeable",
      amount: 0n,
      guaranteeLoss: 0n,
      merchantSaving: 0n,
    });
    expect(chargeForLot({ qty: 0n, filledQty: 0n, cost: 0n, maxHedgeCost: 1_000n })).toMatchObject({
      amount: 0n,
    });
    // A zero-quantity lot is never an open lot for a fill.
    const result = allocateFill(
      [lot("Z", 1n, 0n, 0n), lot("L", 2n, 10_000n, 9_000n)],
      buy("F", 5000n, 10_000n),
    );
    expect(result.allocations.map((a) => a.lotId)).toEqual(["L"]);
  });
});

describe("makerSaving", () => {
  it("is the taker cost at the recorded best ask minus what the fill cost", () => {
    const qty = CONTRACT;
    const saving = makerSaving({
      side: "buy",
      kind: "maker",
      priceBps: 4800n,
      qty,
      fee: 0n,
      bookRef: asksRef([5000n, 5100n]),
    });
    const taker = 500_000n + (qty * takerFeeBps(5000n) + 9_999n) / 10_000n;
    expect(saving).toBe(taker - 480_000n);
  });

  it("is floored at zero, and zero for a sell or a fill without a recorded ask", () => {
    expect(
      makerSaving({
        side: "buy",
        kind: "taker",
        priceBps: 5000n,
        qty: CONTRACT,
        fee: 50_000n,
        bookRef: asksRef([5000n]),
      }),
    ).toBe(0n);
    expect(
      makerSaving({
        side: "sell",
        kind: "maker",
        priceBps: 4800n,
        qty: CONTRACT,
        fee: 0n,
        bookRef: asksRef([5000n]),
      }),
    ).toBe(0n);
    const print: TradePrintRef = {
      source: "trade",
      instrumentSymbol: "X",
      printPriceBps: 4800n,
      printedQty: CONTRACT,
      allocatedBeforeQty: 0n,
      printedAtMs: 0,
      limitPriceBps: 4800n,
      orderRemainingQty: CONTRACT,
      makerFeeWaived: true,
    };
    expect(
      makerSaving({
        side: "buy",
        kind: "maker",
        priceBps: 4800n,
        qty: CONTRACT,
        fee: 0n,
        bookRef: print,
      }),
    ).toBe(0n);
    expect(
      makerSaving({
        side: "buy",
        kind: "maker",
        priceBps: 4800n,
        qty: CONTRACT,
        fee: 0n,
        bookRef: null,
      }),
    ).toBe(0n);
  });

  it("bestAskOf reads the lowest ask of a book reference, and nothing from bids", () => {
    expect(bestAskOf(asksRef([5200n, 5000n]))).toBe(5000n);
    expect(bestAskOf({ ...asksRef([5000n]), bookSide: "bids" })).toBeNull();
  });
});

describe("sellFromInventory", () => {
  it("a sell fill takes from the front of the inventory; its proceeds go to the platform, never to a lot", () => {
    const pieces = [
      inventoryPiece(buy("F1", 5000n, 300_000n)),
      inventoryPiece(buy("F2", 6000n, 300_000n)),
    ];
    const sale = sellFromInventory("X", pieces, {
      fillId: "S1",
      priceBps: 5500n,
      qty: 400_000n,
      fee: 100n,
    });
    expect(sale.consumed).toEqual([
      { fillId: "F1", qty: 300_000n, cost: 150_000n },
      { fillId: "F2", qty: 100_000n, cost: 60_000n },
    ]);
    expect(sale.costBasis).toBe(210_000n);
    expect(sale.proceeds).toBe(220_000n - 100n);
    expect(sale.result).toBe(9_900n);
    expect(inventoryTotals(sale.inventory)).toEqual({ qty: 200_000n, cost: 120_000n });
    expect(sale).not.toHaveProperty("allocations");
  });

  it("refuses to sell more than the inventory: those contracts cover lots", () => {
    const pieces = [inventoryPiece(buy("F1", 5000n, 10_000n))];
    expect(() =>
      sellFromInventory("X", pieces, { fillId: "S1", priceBps: 5000n, qty: 20_000n, fee: 0n }),
    ).toThrow(InventoryUnderflowError);
  });

  it("with allowShort, records a real sale beyond the inventory: sells all that is held and returns the excess", () => {
    const pieces = [inventoryPiece(buy("F1", 5000n, 10_000n))]; // 5 000
    const sale = sellFromInventory(
      "X",
      pieces,
      { fillId: "S1", priceBps: 6000n, qty: 30_000n, fee: 10n },
      { allowShort: true },
    );
    expect(sale.consumed).toEqual([{ fillId: "F1", qty: 10_000n, cost: 5_000n }]);
    expect(sale.shortQty).toBe(20_000n);
    expect(sale.costBasis).toBe(5_000n);
    expect(sale.proceeds).toBe(18_000n - 10n);
    expect(sale.result).toBe(18_000n - 10n - 5_000n);
    expect(sale.inventory).toEqual([]);
    const inRange = sellFromInventory(
      "X",
      pieces,
      { fillId: "S2", priceBps: 6000n, qty: 4_000n, fee: 0n },
      { allowShort: true },
    );
    expect(inRange.shortQty).toBe(0n);
  });
});

describe("takeFromPiece", () => {
  it("never takes more than what is left, and the exhausting take gets the remainder", () => {
    const piece = inventoryPiece(buy("F", 1n, 3n, 0n)); // cost 1 for 3 micro-contracts
    const a = takeFromPiece(piece, 1n);
    const b = takeFromPiece(a.piece, 1n);
    const c = takeFromPiece(b.piece, 1n);
    expect([a.cost, b.cost, c.cost]).toEqual([1n, 0n, 0n]);
    expect(() => takeFromPiece(c.piece, 1n)).toThrow(AllocationInputError);
  });
});

describe("rebuildInventory", () => {
  it("returns an over-sale as a short, which the buy fills recorded after it replace first", () => {
    const f1 = {
      fillId: "F1",
      fillQty: CONTRACT,
      fillCost: 500_000n,
      allocatedQty: 300_000n,
      allocatedCost: 150_000n,
    };
    expect(rebuildInventory("X", [f1], CONTRACT)).toEqual({ pieces: [], shortQty: 300_000n });
    expect(rebuildInventory("X", [f1], 700_000n)).toEqual({ pieces: [], shortQty: 0n });
    // F2 (0.5 for 300 000) recorded after the over-sale: its first 0.3 replace the short.
    const f2 = {
      fillId: "F2",
      fillQty: 500_000n,
      fillCost: 300_000n,
      allocatedQty: 0n,
      allocatedCost: 0n,
    };
    const rebuilt = rebuildInventory("X", [f1, f2], CONTRACT);
    expect(rebuilt.shortQty).toBe(0n);
    expect(rebuilt.pieces.map((p) => [p.fillId, p.remainingQty, p.remainingCost])).toEqual([
      ["F2", 200_000n, 120_000n],
    ]);
  });
});

describe("heldInventory", () => {
  it("rebuilds the inventory from recorded fills, lot allocations and sales", () => {
    // F1 (cost 500 000 for 1 contract): 400 000 to a lot, then 300 000 sold, 300 000 left.
    const inventory = heldInventory(
      "X",
      [
        {
          fillId: "F1",
          fillQty: CONTRACT,
          fillCost: 500_000n,
          allocatedQty: 400_000n,
          allocatedCost: 200_000n,
        },
        {
          fillId: "F2",
          fillQty: CONTRACT,
          fillCost: 600_000n,
          allocatedQty: 0n,
          allocatedCost: 0n,
        },
      ],
      300_000n,
    );
    expect(inventory.map((p) => [p.fillId, p.remainingQty, p.remainingCost])).toEqual([
      ["F1", 300_000n, 150_000n],
      ["F2", CONTRACT, 600_000n],
    ]);
  });

  it("refuses a state where more was sold than held, or a fill allocated beyond itself", () => {
    const fill = { fillId: "F1", fillQty: 10n, fillCost: 5n, allocatedQty: 0n, allocatedCost: 0n };
    expect(() => heldInventory("X", [fill], 11n)).toThrow(AllocationStateError);
    expect(() => heldInventory("X", [{ ...fill, allocatedQty: 11n }], 0n)).toThrow(
      AllocationStateError,
    );
    expect(() =>
      heldInventory("X", [{ ...fill, allocatedQty: 10n, allocatedCost: 4n }], 0n),
    ).toThrow(AllocationStateError);
  });
});
