/**
 * Properties of the policy runner over random sequences of exposure increases, books, trades,
 * clock advances and venue failures. fast-check is not a dependency of the engine package, so the
 * sequences come from a small seeded generator: every run is reproducible from its seed.
 */
import { CONTRACT_STEP_MICRO, TICK_BPS } from "@winz/shared";
import type { BookLevel, MicroContracts } from "@winz/shared";
import { describe, expect, it } from "vitest";

import type { PlaceOrderRequest } from "../../venues";
import { HOUR_MS, Scenario, T0, c } from "./test-support";

const MINUTE_MS = 60_000;

/** mulberry32: a tiny deterministic PRNG, uniform in [0, 1). */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

class Random {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = generator(seed);
  }

  /** Integer in [lo, hi]. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

function ceilStep(qty: MicroContracts): MicroContracts {
  if (qty <= 0n) return 0n;
  return ((qty + CONTRACT_STEP_MICRO - 1n) / CONTRACT_STEP_MICRO) * CONTRACT_STEP_MICRO;
}

/** A random book on the tick grid: bid below ask, both between 100 and 9 900 bps. */
function randomLevels(random: Random): { bids: BookLevel[]; asks: BookLevel[] } {
  const bidTicks = random.int(1, 95);
  const askTicks = Math.min(99, bidTicks + random.int(1, 4));
  const bids: BookLevel[] = [];
  const asks: BookLevel[] = [];
  for (let i = 0; i < random.int(1, 3); i += 1) {
    const ticks = bidTicks - i;
    if (ticks < 1) break;
    bids.push({ priceBps: BigInt(ticks) * TICK_BPS, qty: c(random.int(1, 400)) });
  }
  for (let i = 0; i < random.int(1, 3); i += 1) {
    const ticks = askTicks + i;
    if (ticks > 99) break;
    asks.push({ priceBps: BigInt(ticks) * TICK_BPS, qty: c(random.int(1, 400)) });
  }
  return { bids, asks };
}

interface RunReport {
  steps: number;
  placements: number;
  fills: number;
}

async function checkInvariants(s: Scenario, exposure: MicroContracts, seed: number): Promise<void> {
  const where = `seed ${seed.toString()}`;
  const held = s.venueHeld();
  // H as the runner tracks it is H as the venue's fills add up to.
  expect(s.runner.snapshot().held, where).toBe(held);
  // The quantity bought never exceeds the exposure by a step or more.
  expect(held, where).toBeLessThanOrEqual(ceilStep(exposure));
  expect(held - exposure, where).toBeLessThan(CONTRACT_STEP_MICRO);
  // W never exceeds the uncovered quantity (rounded up to the step).
  expect(await s.venueWorking(), where).toBeLessThanOrEqual(ceilStep(exposure - held));
  // No order is placed twice.
  const ids = s.venue.placed.map((request) => request.clientOrderId);
  expect(new Set(ids).size, where).toBe(ids.length);
  // No fill beyond its order's limit: no buy above it, no sell below it.
  const requests = new Map<string, PlaceOrderRequest>(
    s.venue.placed.map((request) => [request.clientOrderId, request]),
  );
  for (const fill of s.fills) {
    const request = requests.get(fill.clientOrderId);
    expect(request, `${where}: fill of an order never placed`).toBeDefined();
    if (request === undefined) continue;
    if (fill.side === "buy")
      expect(fill.priceBps, where).toBeLessThanOrEqual(request.limitPriceBps);
    else expect(fill.priceBps, where).toBeGreaterThanOrEqual(request.limitPriceBps);
    expect(request.limitPriceBps, where).toBeLessThanOrEqual(9_900n);
  }
}

async function runRandomSequence(seed: number, steps: number): Promise<RunReport> {
  const random = new Random(seed);
  const s = new Scenario({
    eventStartMs: T0 + random.int(20, 240) * MINUTE_MS,
  });
  await s.runner.start();
  let levels = randomLevels(random);
  await s.book(levels.bids, levels.asks);
  let exposure = 0n;
  let failingFor = 0;

  for (let step = 0; step < steps; step += 1) {
    if (failingFor > 0) {
      failingFor -= 1;
      if (failingFor === 0) s.venue.mode = "none";
    }
    const roll = random.int(0, 99);
    if (roll < 30) {
      // A sale: anything from 1 micro-contract to 300 contracts, often off the step.
      exposure += random.chance(0.5) ? c(random.int(1, 300)) : BigInt(random.int(1, 300_000_000));
      await s.exposure(exposure);
    } else if (roll < 50) {
      levels = randomLevels(random);
      await s.book(levels.bids, levels.asks);
    } else if (roll < 65) {
      const bid = levels.bids[0]?.priceBps ?? 100n;
      const ask = levels.asks[0]?.priceBps ?? 9_900n;
      const low = Number(bid / TICK_BPS) - 2;
      const high = Number(ask / TICK_BPS) + 2;
      const price = Math.min(99, Math.max(1, random.int(low, high))) * 100;
      await s.trade(price, random.int(1, 150));
    } else if (roll < 90) {
      await s.advance(random.int(1, 20) * 1_000);
    } else if (roll < 95) {
      // The feed goes silent for a while: the book may go stale.
      await s.advance(random.int(1, 15) * 1_000, { refresh: false });
    } else {
      s.venue.mode = random.chance(0.5) ? "before" : "after";
      failingFor = random.int(1, 4);
    }
    await checkInvariants(s, exposure, seed);
  }
  return { steps, placements: s.venue.placed.length, fills: s.fills.length };
}

describe("PolicyRunner · properties (seeded random sequences)", () => {
  it("never buys a step beyond the exposure, never fills beyond a limit, keeps W within U", async () => {
    let placements = 0;
    let fills = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const report = await runRandomSequence(seed, 60);
      placements += report.placements;
      fills += report.fills;
    }
    // The sequences exercise the policy: orders are placed and filled.
    expect(placements).toBeGreaterThan(200);
    expect(fills).toBeGreaterThan(100);
  });

  it("is reproducible from its seed", async () => {
    const first = await runRandomSequence(7, 40);
    const second = await runRandomSequence(7, 40);
    expect(second).toEqual(first);
  });

  it("holds the same properties inside the last hour, everything taker", async () => {
    for (let seed = 101; seed <= 110; seed += 1) {
      const random = new Random(seed);
      const s = new Scenario({ eventStartMs: T0 + HOUR_MS / 2 });
      await s.runner.start();
      const levels = randomLevels(random);
      await s.book(levels.bids, levels.asks);
      let exposure = 0n;
      for (let step = 0; step < 30; step += 1) {
        exposure += BigInt(random.int(1, 50_000_000));
        await s.exposure(exposure);
        await s.advance(random.int(1, 3) * 1_000);
        await checkInvariants(s, exposure, seed);
      }
      expect(s.venue.placed.every((request) => request.kind === "taker")).toBe(true);
    }
  });
});
