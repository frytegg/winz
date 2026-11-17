import { CONTRACT_STEP_MICRO } from "@winz/shared";
import type { Book, BookLevel, MicroContracts } from "@winz/shared";
import { describe, expect, it } from "vitest";

import { floorToContractStep, isWithinLimit, replayFill } from "./replay";
import { harness } from "./test-support";
import type { OrderSide, VenueFill, VenueOrder } from "./types";

/**
 * Conservation properties of the paper venue over random sequences of books, trades, orders and
 * cancels. fast-check is not resolvable from the engine package, so the sequences come from a
 * seeded generator: every run explores the same cases, and a failure names its seed.
 */

const SEEDS = 300;
const STEPS = 60;
const SYMBOLS = ["AAA", "BBB"] as const;

/** mulberry32: small, fast, deterministic. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function int(rand: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  const item = items[int(rand, 0, items.length - 1)];
  if (item === undefined) throw new Error("pick from an empty list");
  return item;
}

/** A quantity, usually on the step, sometimes with an odd remainder the venue must not fill. */
function randomQty(rand: () => number, maxSteps: number): MicroContracts {
  const steps = BigInt(int(rand, 1, maxSteps)) * CONTRACT_STEP_MICRO;
  return rand() < 0.2 ? steps + BigInt(int(rand, 1, 9_999)) : steps;
}

function randomBook(rand: () => number, symbol: string, observedAtMs: number): Book {
  const midTicks = int(rand, 10, 90);
  const bids: BookLevel[] = [];
  const asks: BookLevel[] = [];
  let bidTick = midTicks - int(rand, 0, 2);
  let askTick = midTicks + int(rand, 1, 2);
  for (let i = int(rand, 0, 4); i > 0 && bidTick >= 1; i--) {
    bids.push({ priceBps: BigInt(bidTick * 100), qty: rand() < 0.1 ? 0n : randomQty(rand, 300) });
    bidTick -= int(rand, 1, 3);
  }
  for (let i = int(rand, 0, 4); i > 0 && askTick <= 99; i--) {
    asks.push({ priceBps: BigInt(askTick * 100), qty: rand() < 0.1 ? 0n : randomQty(rand, 300) });
    askTick += int(rand, 1, 3);
  }
  return { instrumentSymbol: symbol, observedAtMs, bids, asks };
}

function sameBook(a: Book, b: Book): boolean {
  const same = (x: readonly BookLevel[], y: readonly BookLevel[]): boolean =>
    x.length === y.length &&
    x.every((l, i) => l.priceBps === y[i]?.priceBps && l.qty === y[i]?.qty);
  return a.observedAtMs === b.observedAtMs && same(a.asks, b.asks) && same(a.bids, b.bids);
}

interface Epoch {
  book: Book;
  /** What the test itself saw taken from each level since this book: side|price → qty. */
  taken: Map<string, MicroContracts>;
}

describe("PaperVenue · conservation over random sequences", () => {
  it(`holds for ${SEEDS.toString()} seeded sequences of ${STEPS.toString()} steps`, async () => {
    let totalFills = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rand = prng(seed);
      const h = harness({ makerFeeWaived: rand() < 0.5 });
      const epochs = new Map<string, Epoch>();
      const placed = new Map<string, VenueOrder>();
      let nextId = 1;

      // A listener that, like the execution policy, sometimes cancels another order when it hears
      // a fill, from inside the venue's own allocation. Events follow the order of state changes,
      // so once an order's `cancelled` update is heard, no fill of that order may follow, and its
      // final filled quantity is the one the update carried.
      const listenerRand = prng(seed + 1_000_003);
      const cancelledAt = new Map<string, MicroContracts>();
      // The venue catches what a listener throws, so violations are collected and asserted after.
      const fillsAfterCancel: string[] = [];
      h.venue.onEvent((event) => {
        if (event.type === "order") {
          if (event.order.status === "cancelled") {
            cancelledAt.set(event.order.clientOrderId, event.order.filledQty);
          }
          return;
        }
        if (cancelledAt.has(event.fill.clientOrderId)) {
          fillsAfterCancel.push(event.fill.fillId);
        }
        if (nextId <= 1 || listenerRand() >= 0.3) return;
        void h.venue.cancelOrder(`o${int(listenerRand, 1, nextId - 1).toString()}`);
      });

      /** Checks the book fills of one call against the test's own copy of the book. */
      const checkBookFills = (fills: readonly VenueFill[]): void => {
        for (const fill of fills) {
          if (fill.bookRef.source !== "book") continue;
          const epoch = epochs.get(fill.instrumentSymbol);
          expect(epoch, `seed ${seed.toString()}: fill without a book`).toBeDefined();
          if (epoch === undefined) return;
          expect(fill.bookRef.observedAtMs).toBe(epoch.book.observedAtMs);
          const side = fill.bookRef.bookSide;
          const displayed = side === "asks" ? epoch.book.asks : epoch.book.bids;
          let left = fill.qty;
          for (const ref of fill.bookRef.levels) {
            const shown = displayed.find((l) => l.priceBps === ref.priceBps);
            expect(shown?.qty, `seed ${seed.toString()}: level not in the book`).toBe(
              ref.displayedQty,
            );
            const key = `${side}|${ref.priceBps.toString()}`;
            const takenBefore = epoch.taken.get(key) ?? 0n;
            expect(ref.consumedBeforeQty, `seed ${seed.toString()}: consumption memory`).toBe(
              takenBefore,
            );
            const available = floorToContractStep(ref.displayedQty - takenBefore);
            const take = left < available ? left : available;
            left -= take;
            const takenAfter = takenBefore + take;
            epoch.taken.set(key, takenAfter);
            // The core property: a level never gives more than it displayed between two books.
            expect(takenAfter <= ref.displayedQty, `seed ${seed.toString()}: level oversold`).toBe(
              true,
            );
          }
          expect(left, `seed ${seed.toString()}: fill larger than its levels`).toBe(0n);
        }
      };

      for (let step = 0; step < STEPS; step++) {
        h.clock.advance(int(rand, 0, 4_000));
        const symbol = pick(rand, SYMBOLS);
        const action = rand();

        if (action < 0.3) {
          // Sometimes an old observation: stale on arrival, or older than the book held.
          const observedAtMs = h.clock.ms - (rand() < 0.15 ? int(rand, 0, 20_000) : 0);
          const book = randomBook(rand, symbol, observedAtMs);
          const held = epochs.get(symbol);
          const fills = h.venue.onBook(book);
          if (
            held === undefined ||
            observedAtMs > held.book.observedAtMs ||
            (observedAtMs === held.book.observedAtMs && !sameBook(held.book, book))
          ) {
            epochs.set(symbol, { book, taken: new Map() });
          } else {
            expect(fills).toEqual([]);
          }
          checkBookFills(fills);
        } else if (action < 0.36) {
          // The owner re-feeds the book it holds (a cache read, a reconnect): not a new book, so
          // nothing is filled and the consumed depth is not forgotten.
          const held = epochs.get(symbol);
          if (held !== undefined) {
            const copy: Book = {
              ...held.book,
              asks: [...held.book.asks],
              bids: [...held.book.bids],
            };
            expect(h.venue.onBook(copy), `seed ${seed.toString()}: re-delivery filled`).toEqual([]);
          }
        } else if (action < 0.5) {
          const qty = randomQty(rand, 200);
          const fills = h.venue.onTrade({
            instrumentSymbol: symbol,
            priceBps: BigInt(int(rand, 1, 99) * 100),
            qty,
            atMs: h.clock.ms - int(rand, 0, 3_000),
          });
          const allocated = fills.reduce((sum, f) => sum + f.qty, 0n);
          expect(allocated <= qty, `seed ${seed.toString()}: print allocated twice`).toBe(true);
          for (const fill of fills) expect(fill.kind).toBe("maker");
        } else if (action < 0.9) {
          const clientOrderId = `o${(nextId++).toString()}`;
          const side: OrderSide = rand() < 0.5 ? "buy" : "sell";
          const result = await h.venue.placeOrder({
            clientOrderId,
            instrumentSymbol: symbol,
            side,
            kind: rand() < 0.5 ? "maker" : "taker",
            limitPriceBps: BigInt(int(rand, 1, 99) * 100),
            qty: BigInt(int(rand, 1, 300)) * CONTRACT_STEP_MICRO,
          });
          if (result.order !== null) placed.set(clientOrderId, result.order);
          if (result.accepted) checkBookFills(result.fills);
        } else if (nextId > 1) {
          await h.venue.cancelOrder(`o${int(rand, 1, nextId - 1).toString()}`);
        }
      }

      expect(fillsAfterCancel, `seed ${seed.toString()}: fills after a cancel`).toEqual([]);
      for (const [clientOrderId, filledQty] of cancelledAt) {
        expect(await h.venue.getOrder(clientOrderId), `seed ${seed.toString()}`).toMatchObject({
          status: "cancelled",
          filledQty,
        });
      }

      // Per-order properties, on the final state and on every fill ever emitted.
      const fillsByOrder = new Map<string, VenueFill[]>();
      for (const fill of h.fills) {
        const list = fillsByOrder.get(fill.clientOrderId) ?? [];
        list.push(fill);
        fillsByOrder.set(fill.clientOrderId, list);
        expect(replayFill(fill), `seed ${seed.toString()}: replay of ${fill.fillId}`).toEqual({
          priceBps: fill.priceBps,
          qty: fill.qty,
          fee: fill.fee,
        });
        expect(fill.qty > 0n).toBe(true);
        expect(fill.qty % CONTRACT_STEP_MICRO).toBe(0n);
      }
      for (const clientOrderId of placed.keys()) {
        const order = await h.venue.getOrder(clientOrderId);
        if (order === null) throw new Error(`seed ${seed.toString()}: order ${clientOrderId} lost`);
        const fills = fillsByOrder.get(clientOrderId) ?? [];
        const filled = fills.reduce((sum, f) => sum + f.qty, 0n);
        const fees = fills.reduce((sum, f) => sum + f.fee, 0n);
        expect(filled).toBe(order.filledQty);
        expect(fees).toBe(order.feePaid);
        expect(order.filledQty <= order.qty, `seed ${seed.toString()}: overfilled`).toBe(true);
        for (const fill of fills) {
          expect(
            isWithinLimit(order.side, fill.priceBps, order.limitPriceBps),
            `seed ${seed.toString()}: fill worse than the limit`,
          ).toBe(true);
          if (order.kind === "maker") expect(fill.priceBps).toBe(order.limitPriceBps);
          expect(fill.side).toBe(order.side);
          expect(fill.kind).toBe(order.kind);
        }
        if (order.kind === "taker") {
          expect(["filled", "cancelled", "rejected"]).toContain(order.status);
        }
        if (order.status === "filled") expect(order.filledQty).toBe(order.qty);
        if (order.status === "rejected") expect(fills).toEqual([]);
      }
      totalFills += h.fills.length;
    }
    // The generator must actually exercise fills, or the properties prove nothing.
    expect(totalFills).toBeGreaterThan(1_000);
  });
});
