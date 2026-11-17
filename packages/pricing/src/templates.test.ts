import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { INSTRUMENT_TYPES } from "@winz/shared";
import type { Book, InstrumentType } from "@winz/shared";

import { isBookStale, isTwoSided } from "./book";
import { PricingInputError } from "./errors";
import { costPerContractBps } from "./fees";
import { FULL_REFUND_BPS, HALF_REFUND_BPS, promoTemplates } from "./templates";
import type { TemplateInstrument } from "./templates";
import { NOW_MS, arbBook, makeBook } from "./testing/books";

interface Line extends TemplateInstrument {
  /** A descriptive field of the caller, carried through. */
  team: string;
}

function line(symbol: string, type: InstrumentType, book: Book | null, team = "TEX"): Line {
  return { symbol, type, book, team };
}

/** A two-sided book with 100 contracts on each side. */
function quoted(bidBps: bigint, askBps: bigint, observedAtMs: number = NOW_MS): Book {
  return makeBook([[askBps, "100"]], [[bidBps, "100"]], observedAtMs);
}

const options = { nowMs: NOW_MS };

/** Arkansas at Texas: two moneylines, two spread lines, one total. */
const texasGame: Line[] = [
  line("TEX-ML", "moneyline", quoted(9000n, 9200n)),
  line("ARK-ML", "moneyline", quoted(800n, 1000n), "ARK"),
  line("TEX-13", "spread", quoted(1100n, 1200n)),
  line("TEX-20", "spread", null),
  line("OVER-55", "total", quoted(4600n, 4700n)),
];

describe("promoTemplates", () => {
  it("proposes the promos of a game, cheapest first, unavailable last", () => {
    const templates = promoTemplates(texasGame, options);
    expect(
      templates.map((t) => [t.id, t.refundBps, t.probabilityBps, t.costBps, t.unavailableReason]),
    ).toEqual([
      // 0.10 + 0.07 × 0.10 × 0.90 = 10.63 % of the price for a full refund.
      ["ARK-ML:10000", 10_000n, 900n, 1063n, null],
      // The condition of SPEC 4.3 at 12 %: 12.74 %.
      ["TEX-13:10000", 10_000n, 1150n, 1274n, null],
      // A full refund would cost 48.75 %: offered as half back, 24.375 % rounded up.
      ["OVER-55:5000", 5_000n, 4650n, 2438n, null],
      // The favourite at 92 %: half back costs 46.26 %.
      ["TEX-ML:5000", 5_000n, 9100n, 4626n, null],
      ["TEX-20:10000", 10_000n, null, null, "no_book"],
    ]);
    expect(templates.map((t) => t.available)).toEqual([true, true, true, true, false]);
    expect(templates.map((t) => t.spreadBps)).toEqual([200n, 100n, 100n, 200n, null]);
  });

  it("carries the instrument and its type through, for the caller to write the labels", () => {
    const templates = promoTemplates(texasGame, options);
    const first = templates[0];
    expect(first?.instrument).toBe(texasGame[1]);
    expect(first?.instrument.team).toBe("ARK");
    expect(first?.instrumentSymbol).toBe("ARK-ML");
    expect(first?.type).toBe("moneyline");
  });

  it("marks a book without two sides as no_book and an old one as stale_book", () => {
    const templates = promoTemplates(
      [
        line("A-FRESH", "moneyline", quoted(2000n, 2100n)),
        line("B-NO-BIDS", "spread", makeBook([[1200n, "100"]])),
        line("C-NO-ASKS", "spread", makeBook([], [[1100n, "100"]])),
        line("D-STALE", "total", quoted(2000n, 2100n, NOW_MS - 10_001)),
        line("E-STALE-ONE-SIDED", "total", makeBook([[1200n, "100"]], [], NOW_MS - 60_000)),
        line("F-EMPTY-LEVELS", "total", makeBook([[1200n, "0"]], [[1100n, "100"]])),
      ],
      { ...options, maxTemplates: 10 },
    );
    expect(templates.map((t) => [t.instrumentSymbol, t.unavailableReason])).toEqual([
      // The only quoted condition, with both refund rates to offer more than one card.
      ["A-FRESH", null],
      ["A-FRESH", null],
      // Stale books first: they may come back.
      ["D-STALE", "stale_book"],
      ["B-NO-BIDS", "no_book"],
      ["C-NO-ASKS", "no_book"],
      ["E-STALE-ONE-SIDED", "no_book"],
      ["F-EMPTY-LEVELS", "no_book"],
    ]);
    for (const template of templates.filter((t) => !t.available)) {
      expect(template.probabilityBps).toBeNull();
      expect(template.costBps).toBeNull();
      expect(template.spreadBps).toBeNull();
      expect(template.refundBps).toBe(FULL_REFUND_BPS);
    }
    // Positive control: exactly at the limit, the book of D is still fresh.
    const atLimit = promoTemplates(
      [line("D-STALE", "total", quoted(2000n, 2100n, NOW_MS - 10_000))],
      options,
    );
    expect(atLimit[0]?.available).toBe(true);
  });

  it("offers a full refund up to 25 % of the price, and half back above", () => {
    const templates = promoTemplates(
      [
        // c(0.23) = 0.23 + 0.0124 = 24.24 %
        line("CHEAP", "spread", quoted(2200n, 2300n)),
        // c(0.24) = 0.24 + 0.0128 = 25.28 %
        line("DEAR", "spread", quoted(2300n, 2400n)),
        line("OTHER", "total", quoted(5000n, 5100n)),
      ],
      options,
    );
    expect(templates.map((t) => [t.instrumentSymbol, t.refundBps, t.costBps])).toEqual([
      ["DEAR", HALF_REFUND_BPS, 1264n],
      ["CHEAP", FULL_REFUND_BPS, 2424n],
      ["OTHER", HALF_REFUND_BPS, 2638n],
    ]);
    // The limit is a parameter.
    const generous = promoTemplates([line("DEAR", "spread", quoted(2300n, 2400n))], {
      ...options,
      fullRefundMaxCostBps: 2528n,
      minTemplates: 1,
    });
    expect(generous.map((t) => t.refundBps)).toEqual([FULL_REFUND_BPS]);
  });

  it("keeps the best condition of each type before filling with the cheapest", () => {
    const spreads = [1n, 2n, 3n, 4n, 5n, 6n].map((n) =>
      line(`SPREAD-${n.toString()}`, "spread", quoted(n * 100n, n * 100n + 100n)),
    );
    const templates = promoTemplates(
      [
        ...spreads,
        line("ML", "moneyline", quoted(6000n, 6100n)),
        line("TOTAL", "total", quoted(5000n, 5100n)),
      ],
      options,
    );
    // Six spread lines are cheaper than the moneyline and the total, which still get a card.
    expect(templates.map((t) => t.instrumentSymbol)).toEqual([
      "SPREAD-1",
      "SPREAD-2",
      "SPREAD-3",
      "TOTAL",
      "ML",
    ]);
    // Positive control: with a single type, the five cheapest are kept.
    expect(promoTemplates(spreads, options).map((t) => t.instrumentSymbol)).toEqual([
      "SPREAD-1",
      "SPREAD-2",
      "SPREAD-3",
      "SPREAD-4",
      "SPREAD-5",
    ]);
  });

  it("prefers well-quoted conditions to cheaper ones with a wide spread", () => {
    const lines = [
      // Cheapest ask, but 6 ticks between bid and ask.
      line("WIDE", "spread", quoted(100n, 700n)),
      line("TIGHT-1", "spread", quoted(900n, 1000n)),
      line("TIGHT-2", "spread", quoted(1000n, 1100n)),
      line("TIGHT-3", "spread", quoted(1100n, 1200n)),
    ];
    const three = promoTemplates(lines, { ...options, maxTemplates: 3 });
    expect(three.map((t) => t.instrumentSymbol)).toEqual(["TIGHT-1", "TIGHT-2", "TIGHT-3"]);
    // With room for it the wide one is proposed too, and sorted by its cost.
    const four = promoTemplates(lines, { ...options, maxTemplates: 4 });
    expect(four.map((t) => t.instrumentSymbol)).toEqual(["WIDE", "TIGHT-1", "TIGHT-2", "TIGHT-3"]);
    // The spread that counts as well quoted is a parameter.
    const lenient = promoTemplates(lines, {
      ...options,
      maxTemplates: 3,
      wellQuotedSpreadBps: 600n,
    });
    expect(lenient.map((t) => t.instrumentSymbol)).toEqual(["WIDE", "TIGHT-1", "TIGHT-2"]);
  });

  it("can rank long shots after the others", () => {
    const lines = [
      line("LONGSHOT", "spread", quoted(100n, 200n)),
      line("A", "spread", quoted(900n, 1000n)),
      line("B", "spread", quoted(1000n, 1100n)),
      line("C", "spread", quoted(1100n, 1200n)),
    ];
    // By default the cheapest wins, however unlikely.
    const byCost = promoTemplates(lines, { ...options, maxTemplates: 3 });
    expect(byCost.map((t) => t.instrumentSymbol)).toEqual(["LONGSHOT", "A", "B"]);
    const floored = promoTemplates(lines, {
      ...options,
      maxTemplates: 3,
      minProbabilityBps: 500n,
    });
    expect(floored.map((t) => t.instrumentSymbol)).toEqual(["A", "B", "C"]);
  });

  it("adds the other refund rate when fewer than three conditions are quoted", () => {
    const one = promoTemplates([line("ML", "moneyline", quoted(4600n, 4700n))], options);
    // One condition has two refund rates: two cards, not three.
    expect(one.map((t) => [t.id, t.costBps])).toEqual([
      ["ML:5000", 2438n],
      ["ML:10000", 4875n],
    ]);

    const two = promoTemplates(
      [
        line("ML", "moneyline", quoted(4600n, 4700n)),
        line("TEX-13", "spread", quoted(1100n, 1200n)),
      ],
      options,
    );
    // The best condition (the cheapest) gets its second rate; the other does not need to.
    expect(two.map((t) => [t.id, t.costBps])).toEqual([
      ["TEX-13:5000", 637n],
      ["TEX-13:10000", 1274n],
      ["ML:5000", 2438n],
    ]);
  });

  it("orders two cards of equal cost on the same condition: the full refund first", () => {
    // A contract offered for nothing costs nothing at both refund rates.
    const free = promoTemplates([line("FREE", "total", quoted(0n, 0n))], options);
    expect(free.map((t) => [t.id, t.costBps])).toEqual([
      ["FREE:10000", 0n],
      ["FREE:5000", 0n],
    ]);
  });

  it("returns nothing for an event without instrument, and respects maxTemplates", () => {
    expect(promoTemplates([], options)).toEqual([]);
    expect(promoTemplates(texasGame, { ...options, maxTemplates: 0 })).toEqual([]);
    expect(promoTemplates(texasGame, { ...options, maxTemplates: 2 }).map((t) => t.id)).toEqual([
      "ARK-ML:10000",
      "TEX-13:10000",
    ]);
    // minTemplates never asks for more than maxTemplates.
    expect(
      promoTemplates([line("ML", "moneyline", quoted(4600n, 4700n))], {
        ...options,
        maxTemplates: 1,
        minTemplates: 3,
      }),
    ).toHaveLength(1);
  });

  it("refuses an instrument listed twice and options that can never be valid", () => {
    const twice = [texasGame[0], texasGame[0]].filter((item) => item !== undefined);
    expect(() => promoTemplates(twice, options)).toThrow(PricingInputError);
    expect(() => promoTemplates(texasGame, { ...options, maxTemplates: -1 })).toThrow(
      PricingInputError,
    );
    expect(() => promoTemplates(texasGame, { ...options, minTemplates: 1.5 })).toThrow(
      PricingInputError,
    );
    expect(() => promoTemplates(texasGame, { ...options, fullRefundMaxCostBps: -1n })).toThrow(
      PricingInputError,
    );
    expect(() => promoTemplates(texasGame, { ...options, wellQuotedSpreadBps: 10_001n })).toThrow(
      PricingInputError,
    );
    expect(() => promoTemplates(texasGame, { ...options, minProbabilityBps: 10_001n })).toThrow(
      PricingInputError,
    );
    expect(() => promoTemplates(texasGame, options)).not.toThrow();
  });
});

describe("promoTemplates, properties", () => {
  const arbInstruments: fc.Arbitrary<TemplateInstrument[]> = fc
    .array(
      fc.record({
        type: fc.constantFrom(...INSTRUMENT_TYPES),
        book: fc.option(arbBook, { nil: null }),
        ageMs: fc.constantFrom(0, 0, 0, 20_000),
      }),
      { maxLength: 12 },
    )
    .map((items) =>
      items.map(({ type, book, ageMs }, index) => ({
        symbol: `SYM-${index.toString().padStart(2, "0")}`,
        type,
        book: book === null ? null : { ...book, observedAtMs: NOW_MS - ageMs },
      })),
    );

  it("returns at most five cards, available first and cheapest first, each one priced on its book", () => {
    let available = 0;
    let unavailable = 0;
    fc.assert(
      fc.property(arbInstruments, (instruments) => {
        const templates = promoTemplates(instruments, options);
        expect(templates.length).toBeLessThanOrEqual(5);
        expect(new Set(templates.map((t) => t.id)).size).toBe(templates.length);

        const flags = templates.map((t) => t.available);
        expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));

        const costs = templates.flatMap((t) => (t.available ? [t.costBps] : []));
        expect(costs).toEqual([...costs].sort((a, b) => Number(a - b)));

        for (const template of templates) {
          const book = template.instrument.book;
          expect(instruments).toContain(template.instrument);
          expect([FULL_REFUND_BPS, HALF_REFUND_BPS]).toContain(template.refundBps);
          if (template.available) {
            available += 1;
            expect(book).not.toBeNull();
            if (book === null) continue;
            expect(isTwoSided(book)).toBe(true);
            expect(isBookStale(book, NOW_MS)).toBe(false);
            const ask = book.asks.find((level) => level.qty > 0n)?.priceBps ?? -1n;
            const bid = book.bids.find((level) => level.qty > 0n)?.priceBps ?? -1n;
            expect(template.probabilityBps).toBe((bid + ask) / 2n);
            // refundBps × c(bestAsk) / 10 000, rounded up.
            const exact = template.refundBps * costPerContractBps(ask);
            expect(template.costBps * 10_000n).toBeGreaterThanOrEqual(exact);
            expect(template.costBps * 10_000n).toBeLessThan(exact + 10_000n);
          } else {
            unavailable += 1;
            const twoSided = book !== null && isTwoSided(book);
            expect(template.unavailableReason).toBe(twoSided ? "stale_book" : "no_book");
            if (book !== null && twoSided) expect(isBookStale(book, NOW_MS)).toBe(true);
          }
        }

        // A quoted condition is never left out while a place is free or held by a disabled card.
        const quotedCount = instruments.filter(
          (i) => i.book !== null && isTwoSided(i.book) && !isBookStale(i.book, NOW_MS),
        ).length;
        const offeredSymbols = new Set(
          templates.filter((t) => t.available).map((t) => t.instrumentSymbol),
        );
        expect(offeredSymbols.size).toBe(Math.min(quotedCount, 5));
        if (quotedCount >= 2) expect(costs.length).toBeGreaterThanOrEqual(3);
      }),
      { numRuns: 500 },
    );
    expect(available).toBeGreaterThan(0);
    expect(unavailable).toBeGreaterThan(0);
  });

  it("does not depend on the order of the instruments", () => {
    fc.assert(
      fc.property(
        arbInstruments.chain((instruments) =>
          fc.tuple(
            fc.constant(instruments),
            fc.shuffledSubarray(instruments, { minLength: instruments.length }),
          ),
        ),
        ([instruments, shuffled]) => {
          const ids = promoTemplates(instruments, options).map((t) => t.id);
          expect(promoTemplates(shuffled, options).map((t) => t.id)).toEqual(ids);
        },
      ),
      { numRuns: 300 },
    );
  });
});
