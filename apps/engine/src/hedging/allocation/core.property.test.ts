/**
 * Properties of the FIFO allocation, as seeded randomised loops (fast-check is not a dependency
 * of the engine). Each seed replays the same sequence of lots arriving, buy fills and sales.
 */
import { describe, expect, it } from "vitest";

import { mulDivUp } from "@winz/shared";

import {
  allocateInventory,
  chargeForLot,
  fillCost,
  inventoryPiece,
  inventoryTotals,
  sellFromInventory,
  type AllocationLot,
  type InventoryPiece,
  type LotAllocation,
} from "./core";
import { SeededRandom } from "./test-support";

const STEP = 10_000n;
const SEEDS = 300;

interface Run {
  lots: AllocationLot[];
  allocations: LotAllocation[];
  inventory: InventoryPiece[];
  fillCosts: Map<string, { qty: bigint; cost: bigint }>;
  boughtCost: bigint;
  soldCostBasis: bigint;
  /** Snapshots of the lots after every step, for the FIFO check. */
  snapshots: AllocationLot[][];
}

function simulate(seed: number): Run {
  const random = new SeededRandom(seed);
  const merchants = ["A", "B", "C"];
  let lots: AllocationLot[] = [];
  let inventory: InventoryPiece[] = [];
  const allocations: LotAllocation[] = [];
  const fillCosts = new Map<string, { qty: bigint; cost: bigint }>();
  const snapshots: AllocationLot[][] = [];
  let boughtCost = 0n;
  let soldCostBasis = 0n;
  let seq = 0n;
  const steps = random.int(1, 40);

  for (let step = 0; step < steps; step += 1) {
    const roll = random.int(1, 10);
    if (roll <= 4) {
      // A sale creates a lot; a few have zero quantity (zero refund or zero guarantee).
      seq += BigInt(random.int(1, 3));
      const qty = random.chance(1, 12) ? 0n : random.between(1n, 300n) * STEP;
      const maxHedgeCost = random.chance(1, 12)
        ? 0n
        : mulDivUp(qty, random.between(100n, 9900n), 10_000n);
      lots.push({
        lotId: `L${seq.toString()}`,
        seq,
        campaignId: merchants[random.int(0, merchants.length - 1)] ?? "A",
        qty,
        filledQty: 0n,
        cost: 0n,
        maxHedgeCost,
      });
      const result = allocateInventory(lots, inventory);
      allocations.push(...result.allocations);
      lots = result.lots;
      inventory = result.inventory;
    } else if (roll <= 9) {
      const fill = {
        fillId: `F${step.toString()}`,
        priceBps: random.between(0n, 10_000n),
        // Not always on the 0.01 step: real venues can report odd quantities.
        qty: random.chance(1, 5) ? random.between(1n, 3_000_000n) : random.between(1n, 400n) * STEP,
        fee: random.chance(1, 3) ? 0n : random.between(0n, 50_000n),
      };
      const piece = inventoryPiece(fill);
      fillCosts.set(fill.fillId, { qty: fill.qty, cost: piece.fillCost });
      boughtCost += piece.fillCost;
      const result = allocateInventory(lots, [...inventory, piece]);
      allocations.push(...result.allocations);
      lots = result.lots;
      inventory = result.inventory;
    } else {
      const held = inventoryTotals(inventory).qty;
      if (held > 0n) {
        const sale = sellFromInventory("X", inventory, {
          fillId: `S${step.toString()}`,
          priceBps: random.between(0n, 10_000n),
          qty: random.between(1n, held),
          fee: random.between(0n, 1_000n),
        });
        soldCostBasis += sale.costBasis;
        inventory = sale.inventory;
      }
    }
    snapshots.push(lots.map((lot) => ({ ...lot })));
  }
  return { lots, allocations, inventory, fillCosts, boughtCost, soldCostBasis, snapshots };
}

describe("FIFO allocation properties", () => {
  it("allocated cost + inventory cost + sold cost basis = the cost of every fill, exactly", () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const run = simulate(seed);
      const allocated = run.allocations.reduce((total, a) => total + a.cost, 0n);
      const lotsCost = run.lots.reduce((total, lot) => total + lot.cost, 0n);
      expect(lotsCost, `seed ${seed.toString()}`).toBe(allocated);
      expect(
        allocated + inventoryTotals(run.inventory).cost + run.soldCostBasis,
        `seed ${seed.toString()}`,
      ).toBe(run.boughtCost);
    }
  });

  it("every lot's charge is at most its guarantee, and charge + guarantee loss = its allocated cost", () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const run = simulate(seed);
      for (const lot of run.lots) {
        const charge = chargeForLot(lot);
        if (charge.status === "open") {
          expect(lot.filledQty, `seed ${seed.toString()}`).toBeLessThan(lot.qty);
          continue;
        }
        expect(charge.amount, `seed ${seed.toString()}`).toBeLessThanOrEqual(lot.maxHedgeCost);
        expect(charge.amount + charge.guaranteeLoss, `seed ${seed.toString()}`).toBe(lot.cost);
        expect(charge.guaranteeLoss, `seed ${seed.toString()}`).toBeGreaterThanOrEqual(0n);
      }
    }
  });

  it("lots are covered strictly in FIFO order: covered lots, at most one partial lot, then untouched lots", () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const run = simulate(seed);
      for (const snapshot of run.snapshots) {
        let phase: "covered" | "after" = "covered";
        for (const lot of snapshot) {
          if (phase === "covered") {
            if (lot.filledQty < lot.qty) phase = "after";
            continue;
          }
          expect(lot.filledQty, `seed ${seed.toString()} lot ${lot.lotId}`).toBe(0n);
        }
      }
      // Inventory is only ever held when every lot is covered.
      if (inventoryTotals(run.inventory).qty > 0n) {
        expect(
          run.lots.every((lot) => lot.filledQty === lot.qty),
          `seed ${seed.toString()}`,
        ).toBe(true);
      }
    }
  });

  it("a lot only carries the cost of the quantity allocated to it, never more than its share of each fill", () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const run = simulate(seed);
      const byLot = new Map<string, { qty: bigint; cost: bigint }>();
      for (const allocation of run.allocations) {
        const fill = run.fillCosts.get(allocation.fillId);
        if (fill === undefined) throw new Error(`unknown fill ${allocation.fillId}`);
        // No lot pays more than its own quantity's share of the fill, rounded up: nothing of the
        // quantity allocated to another lot (another merchant) reaches it.
        expect(allocation.cost, `seed ${seed.toString()}`).toBeLessThanOrEqual(
          mulDivUp(fill.cost, allocation.qty, fill.qty),
        );
        expect(allocation.qty, `seed ${seed.toString()}`).toBeGreaterThan(0n);
        const total = byLot.get(allocation.lotId) ?? { qty: 0n, cost: 0n };
        byLot.set(allocation.lotId, {
          qty: total.qty + allocation.qty,
          cost: total.cost + allocation.cost,
        });
      }
      for (const lot of run.lots) {
        const total = byLot.get(lot.lotId) ?? { qty: 0n, cost: 0n };
        expect(total, `seed ${seed.toString()} lot ${lot.lotId}`).toEqual({
          qty: lot.filledQty,
          cost: lot.cost,
        });
      }
      // Per merchant: what its lots carry is exactly the allocations made to its lots.
      const merchantOf = new Map(run.lots.map((lot) => [lot.lotId, lot.campaignId]));
      for (const merchant of ["A", "B", "C"]) {
        const fromAllocations = run.allocations
          .filter((a) => merchantOf.get(a.lotId) === merchant)
          .reduce((t, a) => t + a.cost, 0n);
        const onLots = run.lots
          .filter((l) => l.campaignId === merchant)
          .reduce((t, l) => t + l.cost, 0n);
        expect(onLots, `seed ${seed.toString()} merchant ${merchant}`).toBe(fromAllocations);
      }
    }
  });

  it("the fill cost of a split fill is conserved however it is split", () => {
    const random = new SeededRandom(7);
    for (let i = 0; i < 500; i += 1) {
      const qty = random.between(1n, 5_000_000n);
      const fill = {
        fillId: "F",
        priceBps: random.between(0n, 10_000n),
        qty,
        fee: random.between(0n, 99_999n),
      };
      const lots: AllocationLot[] = [];
      let left = qty + random.between(0n, 100_000n);
      let seq = 0n;
      while (left > 0n) {
        seq += 1n;
        const size = random.between(1n, left);
        lots.push({
          lotId: `L${seq.toString()}`,
          seq,
          campaignId: "A",
          qty: size,
          filledQty: 0n,
          cost: 0n,
          maxHedgeCost: 0n,
        });
        left -= size;
      }
      const result = allocateInventory(lots, [inventoryPiece(fill)]);
      const total =
        result.allocations.reduce((t, a) => t + a.cost, 0n) +
        inventoryTotals(result.inventory).cost;
      expect(total).toBe(fillCost(fill.priceBps, fill.qty, fill.fee));
    }
  });
});
