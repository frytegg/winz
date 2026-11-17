/**
 * The Hedge desk's maker savings are summed incrementally (a watermark of the last fill read):
 * across refreshes, each fill counts exactly once and the total matches `engine_pnl.maker_savings`.
 */
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hedgeInstrumentSchema, type MicroContracts } from "@winz/shared";

import { createTestDatabase, type TestDatabase } from "../../testing/postgres";
import type { VenueFill } from "../../venues";
import { createMarket, type MarketFixture } from "../allocation/test-support";
import type { PolicyRunnerSnapshot } from "../policy";
import { HedgeDeskWriter } from "./desk";
import { PgPolicySink } from "./sink";

const C = 1_000_000n;
const logger = pino({ level: "silent" });

let database: TestDatabase;
let market: MarketFixture;

beforeEach(async () => {
  database = await createTestDatabase();
  market = await createMarket(database.db);
});
afterEach(async () => {
  await database.drop();
});

function snapshot(held: MicroContracts): PolicyRunnerSnapshot {
  return {
    instrumentSymbol: market.instrument,
    exposure: held,
    held,
    working: 0n,
    unhedgedNotional: 0n,
    bidBps: 4000n,
    askBps: 4600n,
    bookObservedAtMs: Date.now(),
    stale: false,
    breaker: { active: false, reason: null },
    openOrders: [],
    nextOrderSeq: 1,
    reconcilePending: false,
  };
}

async function makerFill(
  sink: PgPolicySink,
  clientOrderId: string,
  fillId: string,
  qty: MicroContracts,
): Promise<void> {
  await sink.record({
    type: "order_intent",
    atMs: Date.now(),
    instrumentSymbol: market.instrument,
    request: {
      clientOrderId,
      instrumentSymbol: market.instrument,
      side: "buy",
      kind: "maker",
      limitPriceBps: 4100n,
      qty,
    },
    reason: "maker",
  });
  const fill: VenueFill = {
    fillId,
    clientOrderId,
    instrumentSymbol: market.instrument,
    side: "buy",
    kind: "maker",
    priceBps: 4100n,
    qty,
    fee: 0n,
    atMs: Date.now(),
    // The ask stood at $0.46 when the maker bought at $0.41: a taker would have paid more.
    bookRef: {
      source: "book",
      instrumentSymbol: market.instrument,
      observedAtMs: Date.now(),
      bookSide: "asks",
      levels: [{ priceBps: 4600n, displayedQty: 1_000n * C, consumedBeforeQty: 0n }],
      limitPriceBps: 4100n,
      orderRemainingQty: qty,
      makerFeeWaived: true,
    },
  };
  await sink.record({
    type: "fill",
    atMs: Date.now(),
    instrumentSymbol: market.instrument,
    fill,
    countedQty: qty,
  });
}

async function pnlSavings(): Promise<bigint> {
  const [row] = await database.db<{ maker_savings: bigint }[]>`
    select maker_savings from engine_pnl where event_ticker = ${market.eventTicker}
  `;
  return row?.maker_savings ?? 0n;
}

describe("HedgeDeskWriter maker savings", () => {
  it("counts each fill once across refreshes, as engine_pnl does", async () => {
    const db = database.db;
    const sink = new PgPolicySink({ db, venue: "paper", logger });
    const desk = new HedgeDeskWriter(db, logger);
    const info = {
      symbol: market.instrument,
      label: "Texas wins",
      eventTitle: "Texas vs Arkansas",
      eventStartsAt: new Date(Date.now() + 86_400_000),
    };

    await makerFill(sink, "wz.d-1", "fill-1", 3n * C);
    const first = await desk.payload(info, snapshot(3n * C));
    expect(BigInt(first.makerSavings)).toBeGreaterThan(0n);
    expect(BigInt(first.makerSavings)).toBe(await pnlSavings());

    // Nothing new: the same total (the last fill is not read again).
    const again = await desk.payload(info, snapshot(3n * C));
    expect(again.makerSavings).toBe(first.makerSavings);

    await makerFill(sink, "wz.d-2", "fill-2", 2n * C);
    await makerFill(sink, "wz.d-3", "fill-3", 5n * C);
    for (let i = 0; i < 3; i += 1) {
      const payload = await desk.payload(info, snapshot(10n * C));
      expect(hedgeInstrumentSchema.safeParse(payload).success).toBe(true);
      expect(BigInt(payload.makerSavings)).toBe(await pnlSavings());
    }
    expect(await pnlSavings()).toBeGreaterThan(BigInt(first.makerSavings));
  });
});
