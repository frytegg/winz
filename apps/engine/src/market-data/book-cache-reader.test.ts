import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Book } from "@winz/shared";

import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { BookCacheRowError, parseBookCacheRow, readCachedBook } from "./book-cache-reader";
import { PgBookStore, serializeBookSide, topOfBook } from "./book-store";
import { SPORTS_SYMBOLS, liveInstrumentRow, seedInstruments } from "./book-test-support";

const [NYK, MURR, HOU] = SPORTS_SYMBOLS;

describe("readCachedBook", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
    await seedInstruments(database.db, SPORTS_SYMBOLS);
  });
  afterAll(async () => {
    await database.drop();
  });

  it("reads back exactly what the store wrote", async () => {
    const book: Book = {
      instrumentSymbol: NYK,
      bids: [
        { priceBps: 5600n, qty: 953_000_000n },
        { priceBps: 5500n, qty: 1_000n },
      ],
      asks: [{ priceBps: 5700n, qty: 4_250_000_000n }],
      observedAtMs: 1_794_932_401_835,
    };
    await new PgBookStore(database.db).writeBook(book, "ws");
    expect(await readCachedBook(database.db, NYK)).toEqual(book);
  });

  it("returns null for an instrument with no cached book", async () => {
    expect(await readCachedBook(database.db, MURR)).toBeNull();
  });

  it("never lets an older book overwrite a newer one", async () => {
    const store = new PgBookStore(database.db);
    const newer: Book = {
      instrumentSymbol: MURR,
      bids: [{ priceBps: 8400n, qty: 1n }],
      asks: [],
      observedAtMs: 2_000,
    };
    await store.writeBook(newer, "ws");
    await store.writeBook(
      { ...newer, bids: [{ priceBps: 100n, qty: 1n }], observedAtMs: 1_000 },
      "rest",
    );
    expect(await readCachedBook(database.db, MURR)).toEqual(newer);
    // live_instruments keeps the newer top of book too.
    expect(await liveInstrumentRow(database.db, MURR)).toMatchObject({
      bid_bps: 8400,
      ask_bps: null,
      stale: false,
    });
    expect((await liveInstrumentRow(database.db, MURR))?.observed_at.getTime()).toBe(2_000);
  });

  it("flags stale only a row no newer than the bound it is given", async () => {
    const store = new PgBookStore(database.db);
    const book: Book = {
      instrumentSymbol: HOU,
      bids: [{ priceBps: 9200n, qty: 1n }],
      asks: [{ priceBps: 9700n, qty: 1n }],
      observedAtMs: 5_000,
    };
    await store.writeBook(book, "ws");
    // Another writer's fresher book: an older bound leaves it alone.
    await store.markStale(HOU, { observedAtOrBeforeMs: 4_999 });
    expect((await liveInstrumentRow(database.db, HOU))?.stale).toBe(false);
    await store.markStale(HOU, { observedAtOrBeforeMs: 5_000 });
    expect((await liveInstrumentRow(database.db, HOU))?.stale).toBe(true);
    await store.writeBook({ ...book, observedAtMs: 6_000 }, "ws");
    expect((await liveInstrumentRow(database.db, HOU))?.stale).toBe(false);
    await store.markStale(HOU);
    expect((await liveInstrumentRow(database.db, HOU))?.stale).toBe(true);
  });
});

describe("parseBookCacheRow", () => {
  const row = {
    symbol: NYK,
    bids: [{ priceBps: 5600, qty: "953000000" }],
    asks: [],
    observed_at: "2026-11-17T16:20:01.835+00:00",
    source: "demo",
  };

  it("accepts the ISO string supabase-js returns", () => {
    expect(parseBookCacheRow(row)).toEqual({
      instrumentSymbol: NYK,
      bids: [{ priceBps: 5600n, qty: 953_000_000n }],
      asks: [],
      observedAtMs: Date.parse("2026-11-17T16:20:01.835Z"),
      source: "demo",
    });
  });

  it.each([
    ["a fractional quantity", { ...row, bids: [{ priceBps: 5600, qty: "1.5" }] }],
    ["a price above 10000 bps", { ...row, asks: [{ priceBps: 10_001, qty: "1" }] }],
    ["an unknown source", { ...row, source: "fax" }],
    ["no observed_at", { ...row, observed_at: null }],
  ])("rejects %s", (_label, bad) => {
    expect(() => parseBookCacheRow(bad)).toThrow(BookCacheRowError);
  });
});

describe("book serialization", () => {
  it("stores quantities as digit strings and prices as numbers", () => {
    expect(serializeBookSide([{ priceBps: 100n, qty: 12_345n }])).toEqual([
      { priceBps: 100, qty: "12345" },
    ]);
  });

  it("gives a null mid when a side is empty", () => {
    expect(
      topOfBook({
        instrumentSymbol: "X",
        bids: [],
        asks: [{ priceBps: 300n, qty: 1n }],
        observedAtMs: 0,
      }),
    ).toEqual({ bidBps: null, askBps: 300, midBps: null });
  });
});
