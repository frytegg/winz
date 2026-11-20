import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../testing/postgres";
import { FillReplayError, replayFill } from "../index";
import type { VenueEvent } from "../types";
import {
  GeminiInsufficientFundsError,
  GeminiNetworkError,
  GeminiOrderUnknownYetError,
} from "./errors";
import { MemoryOrderLinkStore, PgOrderLinkStore, type OrderLinkStore } from "./links";
import type { SimGemini } from "./sim-server";
import { capturedLogger, simClient, simGemini } from "./test-support";
import { GeminiOrderVenue, type GeminiOrderVenueConfig } from "./venue";

const SYMBOL = "GEMI-BTC2611202200-HI91000";

let sim: SimGemini | null = null;
const venues: GeminiOrderVenue[] = [];

afterEach(async () => {
  for (const venue of venues.splice(0)) await venue.close();
  await sim?.stop();
  sim = null;
});

function makeVenue(
  server: SimGemini,
  options: {
    links?: OrderLinkStore;
    config?: Partial<GeminiOrderVenueConfig>;
    now?: () => number;
  } = {},
): { venue: GeminiOrderVenue; events: VenueEvent[] } {
  const { logger } = capturedLogger();
  const now = options.now ?? Date.now;
  const venue = new GeminiOrderVenue({
    client: simClient(server, logger),
    links: options.links ?? new MemoryOrderLinkStore(),
    clock: { now: () => new Date(now()) },
    logger,
    config: { pollIntervalMs: 20, ...options.config },
  });
  venues.push(venue);
  const events: VenueEvent[] = [];
  venue.onEvent((event) => events.push(event));
  return { venue, events };
}

const maker = {
  clientOrderId: "h-1",
  instrumentSymbol: SYMBOL,
  side: "buy" as const,
  kind: "maker" as const,
  limitPriceBps: 3_600n,
  qty: 1_000_000n,
};

async function until(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("GeminiOrderVenue on the simulated Gemini", () => {
  it("a maker order is sent maker-or-cancel, rests, is read back working, and is cancelled", async () => {
    sim = await simGemini();
    const { venue } = makeVenue(sim);
    const placed = await venue.placeOrder(maker);
    expect(placed.accepted).toBe(true);
    if (!placed.accepted) return;
    expect(placed.order).toMatchObject({
      status: "working",
      venueOrderId: "73797746498585286",
      filledQty: 0n,
    });
    expect(sim.privateRequests("/v1/prediction-markets/order")[0]?.payload).toMatchObject({
      price: "0.36",
      quantity: "1.00",
      outcome: "yes",
      timeInForce: "good-til-cancel",
      makerOrCancel: true,
    });
    expect(await venue.getOrder("h-1")).toMatchObject({ status: "working" });
    expect((await venue.listOpenOrders(SYMBOL)).map((order) => order.clientOrderId)).toEqual([
      "h-1",
    ]);

    const cancel = await venue.cancelOrder("h-1");
    expect(cancel).toMatchObject({ cancelled: true, alreadyCancelled: false });
    expect(await venue.getOrder("h-1")).toMatchObject({ status: "cancelled" });
    expect(await venue.cancelOrder("h-1")).toMatchObject({
      cancelled: true,
      alreadyCancelled: true,
    });
    expect(await venue.listOpenOrders(SYMBOL)).toEqual([]);
  });

  it("placing the same clientOrderId again returns the first result and sends nothing", async () => {
    sim = await simGemini();
    const { venue } = makeVenue(sim);
    const first = await venue.placeOrder(maker);
    const second = await venue.placeOrder({ ...maker, limitPriceBps: 3_500n });
    expect(second).toBe(first);
    expect(sim.privateRequests("/v1/prediction-markets/order")).toHaveLength(1);
  });

  it("a maker order at the ask is cancelled by Gemini: a would_cross rejection", async () => {
    sim = await simGemini();
    const { venue } = makeVenue(sim);
    const placed = await venue.placeOrder({ ...maker, limitPriceBps: 5_700n });
    expect(placed).toMatchObject({ accepted: false, reason: "would_cross" });
    expect(placed.order).toMatchObject({
      status: "rejected",
      rejectReason: "would_cross",
      filledQty: 0n,
    });
    expect(sim.orders[0]?.filled).toBe(0);
  });

  it("a taker order fills at once immediate-or-cancel; its fill is priced from Gemini's average", async () => {
    sim = await simGemini();
    const { venue, events } = makeVenue(sim);
    // 4 contracts up to 0.58: 3 at 0.57 and 1 at 0.58, average 0.5725.
    const placed = await venue.placeOrder({
      clientOrderId: "t-1",
      instrumentSymbol: SYMBOL,
      side: "buy",
      kind: "taker",
      limitPriceBps: 5_800n,
      qty: 4_000_000n,
    });
    expect(placed.accepted).toBe(true);
    if (!placed.accepted) return;
    expect(sim.privateRequests("/v1/prediction-markets/order")[0]?.payload).toMatchObject({
      timeInForce: "immediate-or-cancel",
    });
    expect(sim.privateRequests("/v1/prediction-markets/order")[0]?.payload).not.toHaveProperty(
      "makerOrCancel",
    );
    expect(placed.order).toMatchObject({ status: "filled", filledQty: 4_000_000n });
    expect(placed.fills).toHaveLength(1);
    const [fill] = placed.fills;
    expect(fill).toMatchObject({ qty: 4_000_000n, priceBps: 5_725n, kind: "taker" });
    // Taker fee of the published schedule, on 4 contracts at 57.25¢ (packages/pricing).
    expect(fill?.fee).toBeGreaterThan(0n);
    expect(fill?.bookRef).toMatchObject({
      source: "venue",
      venueOrderId: "73797746498585286",
      orderRemainingQty: 4_000_000n,
      reportedFilledQty: 4_000_000n,
      reportedAvgPrice: "0.5725",
      feeFromSchedule: true,
    });
    expect(placed.order.feePaid).toBe(fill?.fee);
    expect(events.map((event) => event.type)).toEqual(["fill", "order"]);
    // A reported fill is not replayable from a book, and says so.
    if (fill !== undefined) expect(() => replayFill(fill)).toThrow(FillReplayError);
  });

  it("a taker the book cannot fill wholly ends cancelled with what it filled", async () => {
    sim = await simGemini();
    const { venue } = makeVenue(sim);
    const placed = await venue.placeOrder({
      clientOrderId: "t-2",
      instrumentSymbol: SYMBOL,
      side: "buy",
      kind: "taker",
      limitPriceBps: 5_700n,
      qty: 5_000_000n,
    });
    expect(placed.accepted && placed.order).toMatchObject({
      status: "cancelled",
      filledQty: 3_000_000n,
    });
  });

  it("a resting maker filled later by the market is seen by the poll, as a fill and an order event", async () => {
    sim = await simGemini();
    const { venue, events } = makeVenue(sim);
    await venue.placeOrder(maker);
    sim.fill(73_797_746_498_585_286n, 0.4);
    await until(() => events.some((event) => event.type === "fill"));
    const fill = events.find((event) => event.type === "fill");
    expect(fill?.type === "fill" && fill.fill).toMatchObject({
      clientOrderId: "h-1",
      qty: 400_000n,
      priceBps: 3_600n,
      kind: "maker",
      fee: 0n, // the maker fee is waived by default, as on the paper venue
    });
    await until(() =>
      events.some((event) => event.type === "order" && event.order.status === "partially_filled"),
    );
    sim.fill(73_797_746_498_585_286n);
    await until(() =>
      events.some((event) => event.type === "order" && event.order.status === "filled"),
    );
    const fills = events.filter((event) => event.type === "fill");
    expect(fills).toHaveLength(2);
    expect(await venue.cancelOrder("h-1")).toMatchObject({
      cancelled: false,
      reason: "already_filled",
    });
  });

  it("cancelling an order filled in the meantime answers already_filled, read back from Gemini", async () => {
    sim = await simGemini();
    const { venue } = makeVenue(sim, { config: { pollIntervalMs: 3_600_000 } });
    await venue.placeOrder(maker);
    sim.fill(73_797_746_498_585_286n);
    const cancel = await venue.cancelOrder("h-1");
    expect(cancel).toMatchObject({ cancelled: false, reason: "already_filled" });
    expect(cancel.order).toMatchObject({ status: "filled", filledQty: 1_000_000n });
  });

  it("an order Gemini refuses (unknown symbol) is a typed rejection, nothing thrown", async () => {
    sim = await simGemini();
    const { venue } = makeVenue(sim);
    const placed = await venue.placeOrder({ ...maker, instrumentSymbol: "GEMI-NOPE" });
    expect(placed).toMatchObject({ accepted: false, reason: "invalid_order" });
    expect(placed.accepted ? "" : placed.message).toContain("InvalidSymbol");
    expect(await venue.getOrder("h-1")).toMatchObject({ status: "rejected" });
  });

  it("an invalid order is refused locally, without a request", async () => {
    sim = await simGemini();
    const { venue } = makeVenue(sim);
    expect(await venue.placeOrder({ ...maker, qty: 15_000n })).toMatchObject({
      accepted: false,
      reason: "invalid_quantity",
    });
    expect(
      await venue.placeOrder({ ...maker, clientOrderId: "h-2", limitPriceBps: 3_650n }),
    ).toMatchObject({
      accepted: false,
      reason: "invalid_price",
    });
    expect(sim.privateRequests()).toHaveLength(0);
  });

  it("insufficient funds is thrown (an account problem), and the order is known as rejected", async () => {
    sim = await simGemini();
    sim.script("/v1/prediction-markets/order", {
      status: 422,
      body: '{"error":"InsufficientFunds","message":"Insufficient funds"}',
    });
    const { venue } = makeVenue(sim);
    await expect(venue.placeOrder(maker)).rejects.toBeInstanceOf(GeminiInsufficientFundsError);
    expect(await venue.getOrder("h-1")).toMatchObject({ status: "rejected" });
  });

  it("a placement whose answer was lost is found at Gemini by its terms", async () => {
    sim = await simGemini();
    sim.script("/v1/prediction-markets/order", { dropAfterProcessing: true });
    const { venue } = makeVenue(sim);
    await expect(venue.placeOrder(maker)).rejects.toBeInstanceOf(GeminiNetworkError);
    const found = await venue.getOrder("h-1");
    expect(found).toMatchObject({ status: "working", venueOrderId: "73797746498585286" });
  });

  it("a placement whose answer was lost and that Gemini never shows: not yet, then never created", async () => {
    sim = await simGemini();
    sim.script("/v1/prediction-markets/order", { dropBeforeProcessing: true });
    let nowMs = Date.now();
    const { venue } = makeVenue(sim, { now: () => nowMs, config: { notVisibleGraceMs: 30_000 } });
    await expect(venue.placeOrder(maker)).rejects.toBeInstanceOf(GeminiNetworkError);
    await expect(venue.getOrder("h-1")).rejects.toBeInstanceOf(GeminiOrderUnknownYetError);
    nowMs += 31_000;
    expect(await venue.getOrder("h-1")).toBeNull();
  });

  it("an order of another client of the account is listed under a foreign id, never adopted", async () => {
    sim = await simGemini();
    const { venue: other } = makeVenue(sim);
    await other.placeOrder({ ...maker, clientOrderId: "elsewhere" });
    const { venue } = makeVenue(sim);
    const open = await venue.listOpenOrders(SYMBOL);
    expect(open.map((order) => order.clientOrderId)).toEqual(["gemini:73797746498585286"]);
  });
});

describe("GeminiOrderVenue across a restart (order links in Postgres)", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  it("a new process finds the order the previous one placed, by its clientOrderId", async () => {
    sim = await simGemini();
    const before = makeVenue(sim, { links: new PgOrderLinkStore(database.db) }).venue;
    await before.placeOrder({ ...maker, clientOrderId: "restart-1" });
    await before.close();

    const after = makeVenue(sim, { links: new PgOrderLinkStore(database.db) }).venue;
    expect(await after.getOrder("restart-1")).toMatchObject({
      status: "working",
      venueOrderId: "73797746498585286",
    });
    expect((await after.listOpenOrders(SYMBOL)).map((order) => order.clientOrderId)).toEqual([
      "restart-1",
    ]);
    expect(await after.cancelOrder("restart-1")).toMatchObject({ cancelled: true });
    const [row] = await database.db<
      { state: string; venue_order_id: string; cancel_requested: boolean }[]
    >`
      select state, venue_order_id, cancel_requested from venue_order_links where client_order_id = 'restart-1'
    `;
    expect(row).toEqual({
      state: "placed",
      venue_order_id: "73797746498585286",
      cancel_requested: true,
    });
  });
});
