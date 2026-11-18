import { campaignDetailSchema, campaignsResponseSchema } from "@winz/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import {
  campaignReport,
  getCampaignDetail,
  listCampaigns,
  onchainBlock,
  type CampaignRow,
} from "./campaigns";
import { ApiRouteError } from "./route";
import {
  TEST_CONFIG,
  insertBook,
  insertCampaign,
  insertEvent,
  insertInstrument,
  insertLive,
  insertLot,
  insertMerchant,
  insertTicket,
  minutesFrom,
  randomWallet,
} from "./testing/fixtures";

const now = new Date("2026-11-20T18:00:00.000Z");
const SYMBOL = "GEMI-NCAAF-ARK-TEX-S-TEX13";
const startsAt = minutesFrom(now, 600);
const salesClose = minutesFrom(now, 595);

let database: TestDatabase;
let joe: string;
let other: string;
let live: string;
let settled: string;
let othersCampaign: string;
const buyerA = randomWallet();
const buyerB = randomWallet();

beforeAll(async () => {
  database = await createTestDatabase();
  const db = database.db;
  await insertEvent(db, { ticker: "EV", title: "Arkansas vs Texas", startsAt });
  await insertInstrument(db, { symbol: SYMBOL, eventTicker: "EV", label: "Texas wins by 14+" });
  joe = (await insertMerchant(db, { email: "joe@example.com" })).merchantId;
  other = (await insertMerchant(db, { email: "ann@example.com", name: "Ann's Bar" })).merchantId;

  settled = await insertCampaign(db, {
    merchantId: joe,
    instrument: SYMBOL,
    eventTicker: "EV",
    salesClose,
    slug: "joes-old",
    onchainId: 3n,
    status: "settled_yes",
    saleState: "closed",
    outcome: "yes",
    createdAt: new Date(now.getTime() - 86_400_000),
  });
  live = await insertCampaign(db, {
    merchantId: joe,
    instrument: SYMBOL,
    eventTicker: "EV",
    salesClose,
    slug: "joes-texas",
    onchainId: 7n,
    createdAt: new Date(now.getTime() - 3_600_000),
    liveAt: new Date(now.getTime() - 3_500_000),
  });
  othersCampaign = await insertCampaign(db, {
    merchantId: other,
    instrument: SYMBOL,
    eventTicker: "EV",
    salesClose,
    slug: "anns-texas",
  });

  // Settled campaign: buyer A bought first here, $20 at R = 100 %, refunded on YES.
  const old = await insertTicket(db, {
    campaignId: settled,
    buyer: buyerA,
    status: "refunded",
    purchasedAt: new Date(now.getTime() - 86_000_000),
    refundedAt: new Date(now.getTime() - 80_000_000),
  });
  await insertLot(db, {
    ticketId: old.id,
    campaignId: settled,
    instrument: SYMBOL,
    qty: 20_000_000n,
    filledQty: 20_000_000n,
    maxHedgeCost: 2_748_000n,
    chargedAmount: 2_500_000n,
  });

  // Live campaign: buyer A again (not new), buyer B twice (new).
  const t1 = await insertTicket(db, {
    campaignId: live,
    buyer: buyerA,
    purchasedAt: new Date(now.getTime() - 600_000),
  });
  const t2 = await insertTicket(db, {
    campaignId: live,
    buyer: buyerB,
    qty: 2,
    paid: 40_000_000n,
    refundable: 40_000_000n,
    purchasedAt: new Date(now.getTime() - 300_000),
  });
  await insertLot(db, {
    ticketId: t1.id,
    campaignId: live,
    instrument: SYMBOL,
    qty: 20_000_000n,
    filledQty: 20_000_000n,
    maxHedgeCost: 2_748_000n,
    chargedAmount: 2_600_000n,
  });
  await insertLot(db, {
    ticketId: t2.id,
    campaignId: live,
    instrument: SYMBOL,
    qty: 40_000_000n,
    filledQty: 10_000_000n,
    maxHedgeCost: 5_496_000n,
    chargedAmount: null,
  });
  await insertLive(db, {
    symbol: SYMBOL,
    bidBps: 1100,
    askBps: 1300,
    observedAt: new Date(now.getTime() - 1_000),
  });
  await insertBook(db, {
    symbol: SYMBOL,
    bids: [{ priceBps: 1100, qty: 10_000_000_000n }],
    asks: [{ priceBps: 1200, qty: 100_000_000n }],
    observedAt: new Date(now.getTime() - 1_000),
  });
});
afterAll(async () => {
  await database.drop();
});

async function rejection(promise: Promise<unknown>): Promise<ApiRouteError> {
  const error = await promise.then(
    () => new Error("expected a refusal"),
    (caught: unknown) => caught,
  );
  if (error instanceof ApiRouteError) return error;
  throw error;
}

describe("GET /api/campaigns", () => {
  it("lists only the merchant's own campaigns, newest first", async () => {
    const response = await listCampaigns(database.db, joe, now);
    expect(campaignsResponseSchema.parse(response)).toEqual(response);
    expect(response.campaigns.map((campaign) => campaign.id)).toEqual([live, settled]);
    expect(response.campaigns[0]).toEqual({
      id: live,
      slug: "joes-texas",
      product: "Large pizza",
      promise: "100% back if Texas wins by 14+",
      status: "live",
      saleState: "open",
      eventTitle: "Arkansas vs Texas",
      event: {
        sport: "football",
        league: "NCAAF",
        home: { name: "Texas Longhorns", abbreviation: "TEX", logoUrl: null },
        away: { name: "Arkansas Razorbacks", abbreviation: "ARK", logoUrl: null },
      },
      startsAt: startsAt.toISOString(),
      salesCloseAt: salesClose.toISOString(),
      sales: 3,
      revenue: "60000000",
      createdAt: new Date(now.getTime() - 3_600_000).toISOString(),
      liveAt: new Date(now.getTime() - 3_500_000).toISOString(),
    });
    const others = await listCampaigns(database.db, other, now);
    expect(others.campaigns.map((campaign) => campaign.id)).toEqual([othersCampaign]);
  });

  it("shows sales as closed once the sales close has passed", async () => {
    const later = minutesFrom(salesClose, 1);
    const response = await listCampaigns(database.db, joe, later);
    expect(response.campaigns[0]?.saleState).toBe("closed");
  });
});

describe("GET /api/campaigns/:id", () => {
  it("maps a live campaign with its lots, live odds, capacity and on-chain block", async () => {
    const detail = await getCampaignDetail(database.db, joe, live, TEST_CONFIG, now);
    expect(campaignDetailSchema.parse(detail)).toEqual(detail);
    expect(detail).toMatchObject({
      id: live,
      conditionLabel: "Texas wins by 14+",
      subjectName: "Texas",
      resultLabel: null,
      instrumentSymbol: SYMBOL,
      unitPrice: "20000000",
      refundBps: 10_000,
      usualMarginBps: 6500,
      minMarginBps: 4500,
      pauseThresholdBps: 1800,
      probabilityBps: 1200,
      budget: "1000000000",
      hedgeSpent: "2600000",
      hedgeReserved: "5496000",
      budgetAvailable: String(1_000_000_000 - 2_600_000 - 5_496_000),
      exposure: "60000000",
      // 30 of 60 contracts filled.
      hedgedBps: 5000,
      // The asks hold 100 contracts at 12 %: five sales of 20.
      capacitySales: 5,
      received: "0",
      pending: "60000000",
      outcome: null,
      url: "https://winz.test/c/joes-texas",
      onchain: {
        campaignId: "7",
        escrowAddress: TEST_CONFIG.escrowAddress,
        explorerUrl: `https://explorer.testnet.arc.io/address/${TEST_CONFIG.escrowAddress}`,
      },
      report: null,
      demo: false,
    });
  });

  it("reports a settled campaign and stops showing odds and capacity", async () => {
    const detail = await getCampaignDetail(database.db, joe, settled, TEST_CONFIG, now);
    expect(campaignDetailSchema.parse(detail)).toEqual(detail);
    expect(detail).toMatchObject({
      probabilityBps: null,
      capacitySales: 0,
      received: "20000000",
      pending: "0",
      outcome: "yes",
      resultLabel: "Texas won by 14+",
      hedgedBps: 10_000,
      report: {
        sales: 1,
        newCustomers: 1,
        hedgeCost: "2500000",
        hedgeCostBps: 1250,
        equivalentDiscountBps: 1250,
        refundsPaid: "20000000",
        paidToMerchant: "20000000",
      },
    });
  });

  it("has no capacity once its sales close has passed, even with a fresh book", async () => {
    // Status still live (the engine has not closed it yet), book fresh relative to `now`.
    await database.db`
      update campaigns set sales_close = ${minutesFrom(now, -1)} where id = ${live}
    `;
    try {
      const detail = await getCampaignDetail(database.db, joe, live, TEST_CONFIG, now);
      expect(detail.status).toBe("live");
      expect(detail.saleState).toBe("closed");
      expect(detail.capacitySales).toBe(0);
    } finally {
      await database.db`update campaigns set sales_close = ${salesClose} where id = ${live}`;
    }
  });

  it("has no capacity once an outcome is known, even before its status follows", async () => {
    await database.db`update campaigns set outcome = 'yes' where id = ${live}`;
    try {
      const detail = await getCampaignDetail(database.db, joe, live, TEST_CONFIG, now);
      expect(detail.status).toBe("live");
      expect(detail.capacitySales).toBe(0);
    } finally {
      await database.db`update campaigns set outcome = null where id = ${live}`;
    }
  });

  it("counts as new only the customers whose first ticket at this merchant is here", async () => {
    await database.db`
      update campaigns set status = 'settled_no', outcome = 'no', sale_state = 'closed'
      where id = ${live}
    `;
    try {
      const detail = await getCampaignDetail(database.db, joe, live, TEST_CONFIG, now);
      expect(detail.report?.newCustomers).toBe(1);
      expect(detail.report?.refundsPaid).toBe("0");
    } finally {
      await database.db`
        update campaigns set status = 'live', outcome = null, sale_state = 'open' where id = ${live}
      `;
    }
  });

  it("answers 404, not 403, for another merchant's campaign", async () => {
    const error = await rejection(
      getCampaignDetail(database.db, joe, othersCampaign, TEST_CONFIG, now),
    );
    expect(error.status).toBe(404);
    expect(error.code).toBe("not_found");
  });

  it("answers 404 for an unknown or malformed id", async () => {
    for (const id of ["00000000-0000-0000-0000-000000000000", "not-a-uuid"]) {
      const error = await rejection(getCampaignDetail(database.db, joe, id, TEST_CONFIG, now));
      expect(error.status).toBe(404);
    }
  });

  it("has no on-chain block before the escrow is configured or the campaign is on-chain", async () => {
    const detail = await getCampaignDetail(
      database.db,
      joe,
      live,
      { ...TEST_CONFIG, escrowAddress: null },
      now,
    );
    expect(detail.onchain).toBeNull();
    expect(onchainBlock(null, TEST_CONFIG.escrowAddress)).toBeNull();
  });
});

describe("campaignReport", () => {
  const row: CampaignRow = {
    id: "00000000-0000-0000-0000-000000000001",
    slug: "joes-texas",
    product: "Large pizza",
    promise: "100% back if Texas wins by 14+",
    status: "settled_no",
    sale_state: "closed",
    sales_close: salesClose,
    condition_label: "Texas wins by 14+",
    instrument: SYMBOL,
    instrument_type: "spread",
    unit_price: 20_000_000n,
    refund_bps: 10_000,
    usual_margin_bps: 6500,
    min_margin_bps: 4500,
    pause_threshold_bps: 1800,
    budget: 1_000_000_000n,
    outcome: "no",
    onchain_id: 7n,
    demo: false,
    event_title: "Arkansas vs Texas",
    starts_at: startsAt,
    created_at: now,
    live_at: now,
    event_sport: "football",
    event_league: "NCAAF",
    home_name: "Texas Longhorns",
    home_abbreviation: "TEX",
    home_logo_url: null,
    away_name: "Arkansas Razorbacks",
    away_abbreviation: "ARK",
    away_logo_url: null,
    units: 3n,
    revenue: 60_000_000n,
    exposure: 60_000_000n,
    refunds_paid: 0n,
  };
  const lots = { spent: 7_500_001n, reserved: 0n, qty: 60_000_000n, filled: 60_000_000n };

  it("rounds the cost ratios up, never understating the cost", () => {
    // 7 500 001 / 60 000 000 = 1250.0001 bps: shown as 1251.
    expect(campaignReport(row, lots, 2)).toMatchObject({
      hedgeCost: "7500001",
      hedgeCostBps: 1251,
      equivalentDiscountBps: 1251,
    });
  });

  it("charges nothing on a void game and has no report before the outcome", () => {
    expect(campaignReport({ ...row, outcome: "void" }, lots, 2)).toMatchObject({
      hedgeCost: "0",
      hedgeCostBps: 0,
    });
    expect(campaignReport({ ...row, outcome: null }, lots, 2)).toBeNull();
  });
});
