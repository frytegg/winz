import type { Book, Bps, MicroContracts } from "@winz/shared";

import type { SaleStateInput, SaleTerms } from "./evaluate";

/**
 * Joe's Pizza (SPEC 4.3): a $20 pizza, usual margin 65 %, minimum margin 45 %, 100 % back.
 * c_max = 20 %, p_max = 18 %. One sale is 20 contracts (20 000 000 micro-contracts).
 */
export const JOE_TERMS: SaleTerms = {
  unitPrice: 20_000_000n,
  refundBps: 10_000n,
  usualMarginBps: 6_500n,
  minMarginBps: 4_500n,
  pauseThresholdBps: 1_800n,
};

/** Exposure of one of Joe's sales, in micro-contracts. */
export const JOE_SALE_EXPOSURE: MicroContracts = 20_000_000n;

/** A book whose asks hold `qty` micro-contracts at `askBps`, observed at `observedAtMs`. */
export function bookAt(
  askBps: Bps,
  observedAtMs: number,
  qty: MicroContracts = 1_000_000_000n,
  symbol = "TEST-YES",
): Book {
  return {
    instrumentSymbol: symbol,
    bids: askBps > 100n ? [{ priceBps: askBps - 100n, qty }] : [],
    asks: [{ priceBps: askBps, qty }],
    observedAtMs,
  };
}

/** An empty book (no asks, no bids), observed at `observedAtMs`. */
export function emptyBook(observedAtMs: number, symbol = "TEST-YES"): Book {
  return { instrumentSymbol: symbol, bids: [], asks: [], observedAtMs };
}

/** A live campaign with Joe's terms, a fresh book at 12 % and plenty of budget, at `nowMs`. */
export function liveInput(nowMs: number, overrides: Partial<SaleStateInput> = {}): SaleStateInput {
  return {
    terms: JOE_TERMS,
    status: "live",
    outcome: null,
    hasOnchainId: true,
    closeRequested: false,
    nowMs,
    salesCloseMs: nowMs + 3_600_000,
    manualPause: false,
    breaker: { active: false, reason: null },
    book: bookAt(1_200n, nowMs),
    bookFlaggedStale: false,
    pending: 0n,
    availableBudget: 1_000_000_000n,
    previous: null,
    ...overrides,
  };
}

/** Deterministic pseudo-random numbers (mulberry32), so a failing sequence can be replayed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
