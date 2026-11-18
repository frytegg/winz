/**
 * The store's allocation, played purely (no database): every operation starts from the inventory
 * `rebuildInventory` finds in what the tables would record (each buy fill with its lot
 * allocations, and the total quantity sold), exactly as `recordFill` and `allocateHeldInventory`
 * do. Seeded randomised sequences of lots, buy fills, resales and over-sales (fast-check is not a
 * dependency of the engine).
 *
 * After every step: the inventory rebuilt from the records is the one the operation left, piece by
 * piece; and what the buy fills cost is exactly what the lots were allocated, plus the cost bases
 * the resales returned, plus the cost of the buys that replaced an over-sale, plus the inventory's
 * cost.
 */
import { describe, expect, it } from "vitest";

import { mulDivUp } from "@winz/shared";

import {
  allocateInventory,
  fillCost,
  inventoryTotals,
  rebuildInventory,
  sellFromInventory,
  type AllocationLot,
  type HeldFill,
  type InventoryPiece,
  type LotAllocation,
} from "./core";
import { SeededRandom } from "./test-support";

const STEP = 10_000n;
const SEEDS = 600;

interface Totals {
  resales: number;
  multiResaleFills: number;
  overSales: number;
  replacements: number;
}

function view(pieces: readonly InventoryPiece[]): [string, bigint, bigint, bigint][] {
  return pieces.map((piece) => [
    piece.fillId,
    piece.remainingQty,
    piece.remainingCost,
    piece.soldQty ?? 0n,
  ]);
}

function simulate(seed: number, totals: Totals): void {
  const random = new SeededRandom(seed);
  const fills: HeldFill[] = [];
  let lots: AllocationLot[] = [];
  let soldQty = 0n;
  let seq = 0n;
  let paid = 0n;
  let soldCostBasis = 0n;
  let replacedCost = 0n;
  const salesByFill = new Map<string, number>();

  const record = (allocations: readonly LotAllocation[]): void => {
    for (const allocation of allocations) {
      const fill = fills.find((item) => item.fillId === allocation.fillId);
      if (fill === undefined) throw new Error(`unknown fill ${allocation.fillId}`);
      fill.allocatedQty += allocation.qty;
      fill.allocatedCost += allocation.cost;
    }
  };
  /** Open lots as `lockOpenLots` reads them, covered by `pieces`; returns what is left. */
  const cover = (pieces: readonly InventoryPiece[]): InventoryPiece[] => {
    const open = lots.filter((lot) => lot.filledQty < lot.qty);
    const result = allocateInventory(open, pieces);
    record(result.allocations);
    const byId = new Map(result.lots.map((lot) => [lot.lotId, lot]));
    lots = lots.map((lot) => byId.get(lot.lotId) ?? lot);
    return result.inventory;
  };

  const steps = random.int(1, 40);
  for (let step = 0; step < steps; step += 1) {
    const where = `seed ${seed.toString()} step ${step.toString()}`;
    const roll = random.int(1, 10);
    let left: InventoryPiece[];
    if (roll <= 3) {
      seq += 1n;
      lots.push({
        lotId: `L${seq.toString()}`,
        seq,
        campaignId: "A",
        qty: random.chance(1, 12) ? 0n : random.between(1n, 300n) * STEP,
        filledQty: 0n,
        cost: 0n,
        maxHedgeCost: 0n,
      });
      left = cover(rebuildInventory("X", fills, soldQty).pieces);
    } else if (roll <= 7) {
      const qty = random.chance(1, 4)
        ? random.between(1n, 3_000_000n)
        : random.between(1n, 400n) * STEP;
      const priceBps = random.between(0n, 10_000n);
      const fee = random.chance(1, 3) ? 0n : random.between(0n, 9_999n);
      const cost = fillCost(priceBps, qty, fee);
      const fillId = `F${step.toString()}`;
      fills.push({ fillId, fillQty: qty, fillCost: cost, allocatedQty: 0n, allocatedCost: 0n });
      paid += cost;
      const rebuilt = rebuildInventory("X", fills, soldQty);
      // What `recordFill` returns as `replacedShort`: the part of this fill a short consumed.
      const piece = rebuilt.pieces.find((item) => item.fillId === fillId);
      if ((piece?.remainingQty ?? 0n) < qty) {
        replacedCost += cost - (piece?.remainingCost ?? 0n);
        totals.replacements += 1;
      }
      left = cover(rebuilt.pieces);
    } else {
      const rebuilt = rebuildInventory("X", fills, soldQty);
      const held = inventoryTotals(rebuilt.pieces).qty;
      const over = random.chance(1, 6);
      if (held === 0n && !over) continue;
      const qty = over ? held + random.between(1n, 50n) * STEP : random.between(1n, held);
      const sale = sellFromInventory(
        "X",
        rebuilt.pieces,
        {
          fillId: `S${step.toString()}`,
          priceBps: random.between(0n, 10_000n),
          qty,
          fee: random.between(0n, 999n),
        },
        { allowShort: true },
      );
      soldQty += qty;
      soldCostBasis += sale.costBasis;
      totals.resales += 1;
      if (sale.shortQty > 0n) totals.overSales += 1;
      for (const taken of sale.consumed) {
        salesByFill.set(taken.fillId, (salesByFill.get(taken.fillId) ?? 0) + 1);
      }
      // Nothing a resale returns is above its quantity's share of each fill, rounded up.
      for (const taken of sale.consumed) {
        const fill = fills.find((item) => item.fillId === taken.fillId);
        if (fill === undefined) throw new Error(`unknown fill ${taken.fillId}`);
        expect(taken.cost, where).toBeLessThanOrEqual(
          mulDivUp(fill.fillCost, taken.qty, fill.fillQty),
        );
      }
      left = cover(sale.inventory);
    }

    const rebuilt = rebuildInventory("X", fills, soldQty);
    // The tables give back exactly what the operation left.
    expect(view(rebuilt.pieces), where).toEqual(view(left));
    if (rebuilt.shortQty > 0n) expect(rebuilt.pieces, where).toEqual([]);
    const lotCost = lots.reduce((total, lot) => total + lot.cost, 0n);
    const allocatedCost = fills.reduce((total, fill) => total + fill.allocatedCost, 0n);
    expect(lotCost, where).toBe(allocatedCost);
    expect(
      lotCost + soldCostBasis + replacedCost + inventoryTotals(rebuilt.pieces).cost,
      where,
    ).toBe(paid);
  }
  if ([...salesByFill.values()].some((count) => count > 1)) totals.multiResaleFills += 1;
}

describe("the allocation as the store plays it, from what the tables record", () => {
  it("conserves every fill's cost to the micro-USDC across lots, resales, over-sales and their replacement", () => {
    const totals: Totals = { resales: 0, multiResaleFills: 0, overSales: 0, replacements: 0 };
    for (let seed = 1; seed <= SEEDS; seed += 1) simulate(seed, totals);
    // The sequences really resold one fill several times, over-sold, and replaced the short.
    expect(totals.resales).toBeGreaterThan(500);
    expect(totals.multiResaleFills).toBeGreaterThan(50);
    expect(totals.overSales).toBeGreaterThan(50);
    expect(totals.replacements).toBeGreaterThan(50);
  });
});
