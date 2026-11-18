import { describe, expect, it } from "vitest";

import type { SaleState } from "@winz/shared";

import {
  AUTOMATIC_PAUSES,
  BOOK_CAUSED_BREAKER_REASONS,
  evaluateSaleState,
  evaluateSaleStateWithGrace,
  freshMemory,
  isBookCausedBreaker,
  type SaleStateInput,
} from "./evaluate";
import { bookAt, emptyBook, liveInput } from "./test-support";

const T0 = 1_800_000_000_000;
const ALL_STATES: readonly SaleState[] = ["open", "closed", "paused_manual", ...AUTOMATIC_PAUSES];

/** A live campaign at `T0` with no book yet, stored as `stored`, never evaluated since the start. */
function noBook(stored: SaleState, overrides: Partial<SaleStateInput> = {}): SaleStateInput {
  return liveInput(T0, { book: null, previous: freshMemory(stored), ...overrides });
}

describe("isBookCausedBreaker", () => {
  it("treats only an active stale_book as caused by the missing book", () => {
    expect(BOOK_CAUSED_BREAKER_REASONS).toEqual(["stale_book"]);
    expect(isBookCausedBreaker({ active: true, reason: "stale_book" })).toBe(true);
    expect(isBookCausedBreaker({ active: false, reason: "stale_book" })).toBe(false);
    for (const reason of ["venue_down", "unhedged_limit", "breaker status unavailable", null]) {
      expect(isBookCausedBreaker({ active: true, reason })).toBe(false);
    }
  });
});

describe("evaluateSaleStateWithGrace", () => {
  it("is exactly evaluateSaleState without a grace or with a book", () => {
    const inputs: SaleStateInput[] = [
      liveInput(T0),
      liveInput(T0, { book: null }),
      liveInput(T0, { book: null, previous: freshMemory("paused_price") }),
      liveInput(T0, { book: bookAt(1_900n, T0) }),
      liveInput(T0, { book: emptyBook(T0) }),
      liveInput(T0, { book: bookAt(1_200n, T0 - 10_001) }),
      liveInput(T0, { breaker: { active: true, reason: "stale_book" } }),
      liveInput(T0, { book: null, breaker: { active: true, reason: "stale_book" } }),
    ];
    for (const input of inputs) {
      expect(evaluateSaleStateWithGrace(input, null)).toEqual(evaluateSaleState(input));
      if (input.book !== null) {
        expect(evaluateSaleStateWithGrace(input, { storedState: "open" })).toEqual(
          evaluateSaleState(input),
        );
      }
    }
  });

  it.each(ALL_STATES)(
    "keeps a stored %s with a fresh memory of it while no book has come",
    (stored) => {
      const decision = evaluateSaleStateWithGrace(noBook(stored), { storedState: stored });
      expect(decision).toEqual({
        state: stored,
        reason: "startup_grace",
        detail: "no book since the start, the stored state is kept",
        couldOpen: false,
        effectivePriceBps: null,
        memory: freshMemory(stored),
      });
    },
  );

  it("keeps the one-tick margin of a stored paused_price, and a known price refusal", () => {
    expect(
      evaluateSaleStateWithGrace(noBook("paused_price"), { storedState: "paused_price" }).memory,
    ).toMatchObject({ state: "paused_price", priceRefused: true });
    const known = noBook("paused_stale", { previous: freshMemory("paused_stale", true) });
    expect(evaluateSaleStateWithGrace(known, { storedState: "paused_stale" }).memory).toMatchObject(
      { state: "paused_stale", priceRefused: true },
    );
  });

  it("never decides open for a campaign not stored open", () => {
    for (const stored of ALL_STATES.filter((state) => state !== "open")) {
      for (const previous of ALL_STATES) {
        const decision = evaluateSaleStateWithGrace(
          noBook(stored, { previous: freshMemory(previous) }),
          { storedState: stored },
        );
        expect(decision.state, `${stored} after ${previous}`).not.toBe("open");
      }
    }
  });

  it("still closes at once: settled, sales closed, sales close reached, not on-chain, close requested", () => {
    const grace = { storedState: "open" as const };
    const cases: [Partial<SaleStateInput>, string][] = [
      [{ status: "settled_yes" }, "settled"],
      [{ outcome: "no" }, "settled"],
      [{ status: "sales_closed" }, "sales_closed"],
      [{ salesCloseMs: T0 }, "sales_close_reached"],
      [{ hasOnchainId: false }, "not_on_chain"],
      [{ status: "funding" }, "not_live"],
      [{ closeRequested: true }, "close_requested"],
    ];
    for (const [overrides, reason] of cases) {
      expect(evaluateSaleStateWithGrace(noBook("open", overrides), grace)).toMatchObject({
        state: "closed",
        reason,
      });
    }
  });

  it("still holds a manual pause at once", () => {
    expect(
      evaluateSaleStateWithGrace(noBook("open", { manualPause: true }), { storedState: "open" }),
    ).toMatchObject({ state: "paused_manual", reason: "manual" });
  });

  it.each(["venue_down", "unhedged_limit", "breaker status unavailable", null])(
    "pauses at once on a breaker active for %s",
    (reason) => {
      const decision = evaluateSaleStateWithGrace(
        noBook("open", { breaker: { active: true, reason } }),
        { storedState: "open" },
      );
      expect(decision).toMatchObject({ state: "paused_breaker", reason: "breaker" });
    },
  );

  it("does not pause on a breaker that reports only the missing book", () => {
    const decision = evaluateSaleStateWithGrace(
      noBook("open", { breaker: { active: true, reason: "stale_book" } }),
      { storedState: "open" },
    );
    expect(decision).toMatchObject({ state: "open", reason: "startup_grace" });
  });

  it("ignores the feed's stale flag without a book, as evaluateSaleState does", () => {
    const decision = evaluateSaleStateWithGrace(noBook("open", { bookFlaggedStale: true }), {
      storedState: "open",
    });
    expect(decision).toMatchObject({ state: "open", reason: "startup_grace" });
  });
});
