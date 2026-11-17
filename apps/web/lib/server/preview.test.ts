import { limits } from "@winz/pricing";
import { campaignPreviewResponseSchema, type CampaignPreviewRequest } from "@winz/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import { parsePreviewTerms, previewCampaign } from "./preview";
import { ApiRouteError } from "./route";
import {
  insertBook,
  insertEvent,
  insertInstrument,
  insertPosition,
  minutesFrom,
} from "./testing/fixtures";

const now = new Date("2026-11-20T18:00:00.000Z");
const SYMBOL = "GEMI-NCAAF-ARK-TEX-S-TEX13";

/** Joe's terms (SPEC 4.3): a $20 pizza, usual margin 65 %, minimum 45 %, R = 100 %, $1,000. */
const joe: CampaignPreviewRequest = {
  instrumentSymbol: SYMBOL,
  unitPrice: "20000000",
  refundBps: 10_000,
  usualMarginBps: 6500,
  minMarginBps: 4500,
  budget: "1000000000",
};

/** A book deep enough that neither the depth nor the price limits Joe: 10 000 contracts a level. */
const DEEP = 10_000_000_000n;

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
  await insertEvent(database.db, { ticker: "EV", startsAt: minutesFrom(now, 600) });
  await insertInstrument(database.db, {
    symbol: SYMBOL,
    eventTicker: "EV",
    label: "Texas wins by 14+",
  });
  await insertInstrument(database.db, {
    symbol: "DELISTED",
    eventTicker: "EV",
    label: "Texas wins by 30+",
    active: false,
  });
});
afterAll(async () => {
  await database.drop();
});
beforeEach(async () => {
  await database.db`truncate book_cache, tracked_instruments, positions`;
});

async function rejection(promise: Promise<unknown>): Promise<ApiRouteError> {
  const error = await promise.then(
    () => new Error("expected a refusal"),
    (caught: unknown) => caught,
  );
  if (error instanceof ApiRouteError) return error;
  throw error;
}

describe("POST /api/campaigns/preview", () => {
  it("gives Joe's figures of SPEC 4.3 at an ask of 12 % on a deep book", async () => {
    const observedAt = new Date(now.getTime() - 2_000);
    await insertBook(database.db, {
      symbol: SYMBOL,
      bids: [{ priceBps: 1100, qty: DEEP }],
      asks: [
        { priceBps: 1200, qty: DEEP },
        { priceBps: 1300, qty: DEEP },
      ],
      observedAt,
    });
    const preview = await previewCampaign(database.db, joe, now);
    expect(campaignPreviewResponseSchema.parse(preview)).toEqual(preview);
    expect(preview).toMatchObject({
      maxCostBps: 2000,
      pauseThresholdBps: 1800,
      currentProbabilityBps: 1150,
      costPerSale: "2548000",
      marginKeptPerSale: "10452000",
      marginKeptBps: 5226,
      saleState: "open",
      bookAsOf: observedAt.toISOString(),
    });
    // $1,000 at a guaranteed $2.748 (cost plus one tick of tolerance) per sale.
    expect(preview.capacity).toEqual({ sales: 363, limitedBy: "budget" });
  });

  it("returns exactly what the pricing library computes, behind the unhedged exposure", async () => {
    const observedAt = new Date(now.getTime() - 1_000);
    const asks = [
      { priceBps: 1200, qty: 30_000_000n },
      { priceBps: 1500, qty: 50_000_000n },
    ];
    await insertBook(database.db, {
      symbol: SYMBOL,
      bids: [{ priceBps: 1100, qty: 10_000_000n }],
      asks,
      observedAt,
    });
    // 25 contracts sold and 5 held: 20 are promised to earlier sales.
    await insertPosition(database.db, {
      instrument: SYMBOL,
      exposure: 25_000_000n,
      held: 5_000_000n,
    });
    const preview = await previewCampaign(database.db, joe, now);
    const expected = limits({
      book: {
        instrumentSymbol: SYMBOL,
        bids: [{ priceBps: 1100n, qty: 10_000_000n }],
        asks: asks.map((level) => ({ priceBps: BigInt(level.priceBps), qty: level.qty })),
        observedAtMs: observedAt.getTime(),
      },
      pending: 20_000_000n,
      nowMs: now.getTime(),
      unitPrice: 20_000_000n,
      refundBps: 10_000n,
      usualMarginBps: 6500n,
      minMarginBps: 4500n,
      availableBudget: 1_000_000_000n,
    });
    expect(preview.costPerSale).toBe(expected.costPerSale?.toString());
    expect(preview.capacity).toEqual(expected.capacity);
    expect(preview.saleState).toBe(expected.saleState);
    // The 10 contracts left at 12 % cover the next sale's first half only: priced higher.
    expect(preview.costPerSale).not.toBe("2548000");
  });

  it("answers null figures and paused_depth when the engine has no book yet, never an error", async () => {
    const preview = await previewCampaign(database.db, joe, now);
    expect(campaignPreviewResponseSchema.parse(preview)).toEqual(preview);
    expect(preview).toEqual({
      maxCostBps: 2000,
      pauseThresholdBps: 1800,
      currentProbabilityBps: null,
      costPerSale: null,
      marginKeptPerSale: null,
      marginKeptBps: null,
      capacity: { sales: 0, limitedBy: "depth" },
      saleState: "paused_depth",
      bookAsOf: null,
    });
  });

  it("does not price a stale book", async () => {
    const observedAt = new Date(now.getTime() - 60_000);
    await insertBook(database.db, {
      symbol: SYMBOL,
      bids: [{ priceBps: 1100, qty: DEEP }],
      asks: [{ priceBps: 1200, qty: DEEP }],
      observedAt,
    });
    const preview = await previewCampaign(database.db, joe, now);
    expect(preview).toMatchObject({
      costPerSale: null,
      saleState: "paused_stale",
      bookAsOf: observedAt.toISOString(),
    });
  });

  it("registers a tracking request, and refreshes its expiry on a second call", async () => {
    await previewCampaign(database.db, joe, now);
    const [first] = await database.db<{ expires_at: Date; requested_at: Date; ttl: number }[]>`
      select expires_at, requested_at,
        extract(epoch from expires_at - requested_at)::int as ttl
      from tracked_instruments where symbol = ${SYMBOL}
    `;
    expect(first?.ttl).toBe(600);

    // Pretend the request is old and about to expire.
    await database.db`
      update tracked_instruments
      set requested_at = now() - interval '9 minutes', expires_at = now() + interval '1 minute'
    `;
    await previewCampaign(database.db, joe, now);
    const rows = await database.db<{ remaining: number }[]>`
      select extract(epoch from expires_at - now())::int as remaining from tracked_instruments
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.remaining).toBeGreaterThanOrEqual(590);
  });

  it("answers closed with no capacity once the game's sales have closed, and tracks nothing", async () => {
    // The event starts in 600 minutes, so its sales close in 595.
    const later = minutesFrom(now, 596);
    await insertBook(database.db, {
      symbol: SYMBOL,
      bids: [{ priceBps: 1100, qty: DEEP }],
      asks: [{ priceBps: 1200, qty: DEEP }],
      observedAt: new Date(later.getTime() - 1_000),
    });
    const response = await previewCampaign(database.db, joe, later);
    expect(campaignPreviewResponseSchema.parse(response)).toEqual(response);
    expect(response.saleState).toBe("closed");
    expect(response.capacity.sales).toBe(0);
    // The market figures stay, for information.
    expect(response.costPerSale).toBe("2548000");
    expect(await database.db`select symbol from tracked_instruments`).toEqual([]);
  });

  it("answers 404 for an unknown or delisted condition", async () => {
    for (const instrumentSymbol of ["NOPE", "DELISTED"]) {
      const error = await rejection(
        previewCampaign(database.db, { ...joe, instrumentSymbol }, now),
      );
      expect(error.status).toBe(404);
    }
    const rows = await database.db`select symbol from tracked_instruments`;
    expect(rows).toEqual([]);
  });
});

describe("parsePreviewTerms", () => {
  it("refuses a zero price and a minimum margin above the usual one", () => {
    expect(() => parsePreviewTerms({ ...joe, unitPrice: "0" })).toThrow(ApiRouteError);
    expect(() => parsePreviewTerms({ ...joe, minMarginBps: 7000 })).toThrow(/minMarginBps/);
    expect(parsePreviewTerms(joe)).toEqual({
      instrumentSymbol: SYMBOL,
      unitPrice: 20_000_000n,
      refundBps: 10_000n,
      usualMarginBps: 6500n,
      minMarginBps: 4500n,
      budget: 1_000_000_000n,
    });
  });
});
