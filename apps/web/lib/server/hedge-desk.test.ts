import {
  DEFAULT_RISK_PARAMS,
  apiExamples,
  hedgeDeskResponseSchema,
  type HedgeDeskResponse,
  type HedgeInstrument,
} from "@winz/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getHedgeDesk } from "@/app/api/hedge-desk/route";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import type { Db } from "./db";
import { setServerDepsForTesting } from "./deps";
import { containsPersonalData, riskParamsOf, venueDescription } from "./hedge-desk";
import {
  FakeIdentity,
  TEST_CONFIG,
  insertCampaign,
  insertEvent,
  insertInstrument,
  insertMerchant,
  insertTicket,
  minutesFrom,
  randomWallet,
  serverDepsFor,
} from "./testing/fixtures";

/**
 * GET /api/hedge-desk through its Next.js handler, on a real Postgres holding what the engine
 * writes. The route is public: no header at all.
 */

const now = new Date("2026-11-20T18:00:00.000Z");
const EARLY = "GEMI-NBA-EARLY-LAL";
const LATE_A = "GEMI-NCAAF-LATE-A";
const LATE_B = "GEMI-NCAAF-LATE-B";
const noParams = { params: Promise.resolve({}) };
const EMAIL_PATTERN = /[^\s@"]+@[^\s@"]+\.[^\s@"]+/;
const ADDRESS_PATTERN = /0x[0-9a-fA-F]{40}/;

let database: TestDatabase;
let db: Db;
const identity = new FakeIdentity();

function instrumentPayload(symbol: string, startsAt: Date): HedgeInstrument {
  const example = apiExamples.hedgeDeskExample.instruments[0];
  if (!example) throw new Error("the Hedge desk example has no instrument");
  return { ...example, symbol, startsAt: startsAt.toISOString() };
}

async function insertDeskRow(db: Db, instrument: string, payload: unknown): Promise<void> {
  await db`
    insert into live_hedge_desk (instrument, payload)
    values (${instrument}, ${JSON.stringify(payload)}::text::jsonb)
  `;
}

async function fetchDesk(): Promise<{ status: number; body: unknown; text: string }> {
  const response = await getHedgeDesk(new Request("http://localhost/api/hedge-desk"), noParams);
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) as unknown, text };
}

async function desk(): Promise<HedgeDeskResponse> {
  const { status, body } = await fetchDesk();
  expect(status).toBe(200);
  return hedgeDeskResponseSchema.parse(body);
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  await insertEvent(db, { ticker: "EV-EARLY", startsAt: minutesFrom(now, 120) });
  await insertEvent(db, { ticker: "EV-LATE", startsAt: minutesFrom(now, 600) });
  await insertInstrument(db, { symbol: EARLY, eventTicker: "EV-EARLY", label: "Lakers win" });
  await insertInstrument(db, { symbol: LATE_A, eventTicker: "EV-LATE", label: "A" });
  await insertInstrument(db, { symbol: LATE_B, eventTicker: "EV-LATE", label: "B" });
  setServerDepsForTesting(serverDepsFor(db, identity, now));
});

afterAll(async () => {
  setServerDepsForTesting(undefined);
  await database.drop();
});

beforeEach(async () => {
  await db`delete from live_hedge_desk`;
  await db`delete from engine_params`;
  await db`delete from engine_pnl`;
  await db`delete from venue_checks`;
  await db`delete from demo_overrides`;
});

describe("GET /api/hedge-desk", () => {
  it("answers the defaults on an empty database", async () => {
    const answer = await desk();
    expect(answer).toEqual({
      venue: "paper",
      venueLabel: "PAPER · live Gemini book",
      venueNote: apiExamples.hedgeDeskExample.venueNote,
      params: {
        uMax: DEFAULT_RISK_PARAMS.uMaxMicroUsdc.toString(),
        makerTtlSeconds: DEFAULT_RISK_PARAMS.makerTtlSeconds,
        askMoveTicks: DEFAULT_RISK_PARAMS.askMoveTicks,
        toleranceTicks: DEFAULT_RISK_PARAMS.toleranceTicks,
        forceTakerMinutes: DEFAULT_RISK_PARAMS.forceTakerMinutes,
      },
      instruments: [],
      totals: { makerSavings: "0", guaranteeLosses: "0", crossingGains: "0" },
      venueCheck: null,
      demo: false,
    });
  });

  it("serves every instrument row, ordered by event start then symbol", async () => {
    await insertDeskRow(db, LATE_B, instrumentPayload(LATE_B, minutesFrom(now, 600)));
    await insertDeskRow(db, EARLY, instrumentPayload(EARLY, minutesFrom(now, 120)));
    await insertDeskRow(db, LATE_A, instrumentPayload(LATE_A, minutesFrom(now, 600)));
    const answer = await desk();
    expect(answer.instruments.map((instrument) => instrument.symbol)).toEqual([
      EARLY,
      LATE_A,
      LATE_B,
    ]);
    expect(answer.instruments[0]).toEqual(instrumentPayload(EARLY, minutesFrom(now, 120)));
  });

  it("skips a payload that does not validate, without failing the answer", async () => {
    await insertDeskRow(db, EARLY, instrumentPayload(EARLY, minutesFrom(now, 120)));
    await insertDeskRow(db, LATE_A, { symbol: LATE_A, exposure: -1 });
    await insertDeskRow(db, LATE_B, { ...instrumentPayload(LATE_B, now), held: "12.5" });
    // A payload filed under another instrument's key is not served either.
    await insertDeskRow(db, "GEMI-ORPHAN", instrumentPayload(LATE_A, now));
    const answer = await desk();
    expect(answer.instruments.map((instrument) => instrument.symbol)).toEqual([EARLY]);
  });

  it("applies the engine_params overrides, uMax as a micro-USDC string", async () => {
    await db`
      insert into engine_params (key, value) values
        ('uMaxMicroUsdc', ${JSON.stringify("150000000")}::text::jsonb),
        ('makerTtlSeconds', '45'::jsonb),
        ('toleranceTicks', '0'::jsonb),
        ('forceTakerMinutes', '"30"'::jsonb),
        ('askMoveTicks', '"two"'::jsonb),
        ('somethingElse', '7'::jsonb)
    `;
    const answer = await desk();
    expect(answer.params).toEqual({
      uMax: "150000000",
      makerTtlSeconds: 45,
      // Invalid: the default is shown.
      askMoveTicks: DEFAULT_RISK_PARAMS.askMoveTicks,
      toleranceTicks: 0,
      forceTakerMinutes: 30,
    });
  });

  it("refuses a zero where the answer needs a positive number, keeping the default", () => {
    expect(riskParamsOf([{ key: "makerTtlSeconds", value: 0 }]).makerTtlSeconds).toBe(
      DEFAULT_RISK_PARAMS.makerTtlSeconds,
    );
    expect(riskParamsOf([{ key: "uMaxMicroUsdc", value: 300_000_001 }]).uMax).toBe("300000001");
  });

  it("sums engine_pnl over every event", async () => {
    await db`
      insert into engine_pnl (event_ticker, maker_savings, guarantee_losses, crossing_gains)
      values ('EV-EARLY', 1800000, 0, 250000), ('EV-LATE', 200000, 90000, 0)
    `;
    const answer = await desk();
    expect(answer.totals).toEqual({
      makerSavings: "2000000",
      guaranteeLosses: "90000",
      crossingGains: "250000",
    });
  });

  it("shows the latest venue check run only", async () => {
    const old = new Date("2026-11-17T10:00:00.000Z");
    const ranAt = new Date("2026-11-18T16:00:00.000Z");
    await db`
      insert into venue_checks (venue_order_id, instrument, action, at) values
        ('000', 'GEMI-BTC-OLD', 'placed_maker', ${old}),
        ('222', 'GEMI-BTC2611190000-HI100000', 'filled', ${ranAt}),
        ('111', 'GEMI-BTC2611190000-HI100000', 'cancelled', ${ranAt}),
        ('111', 'GEMI-BTC2611190000-HI100000', 'placed_maker', ${ranAt})
    `;
    const answer = await desk();
    expect(answer.venueCheck).toEqual({
      ranAt: ranAt.toISOString(),
      orders: [
        {
          venueOrderId: "111",
          instrumentSymbol: "GEMI-BTC2611190000-HI100000",
          action: "placed_maker",
          at: ranAt.toISOString(),
        },
        {
          venueOrderId: "111",
          instrumentSymbol: "GEMI-BTC2611190000-HI100000",
          action: "cancelled",
          at: ranAt.toISOString(),
        },
        {
          venueOrderId: "222",
          instrumentSymbol: "GEMI-BTC2611190000-HI100000",
          action: "filled",
          at: ranAt.toISOString(),
        },
      ],
    });
  });

  it("says demo as soon as one demo override exists", async () => {
    await db`insert into demo_overrides (instrument, forced_result) values (${EARLY}, 'yes')`;
    expect((await desk()).demo).toBe(true);
    await db`delete from demo_overrides`;
    expect((await desk()).demo).toBe(false);
  });

  it("names each venue in clear", async () => {
    expect(venueDescription("gemini-sandbox").label).toContain("SANDBOX");
    expect(venueDescription("gemini").label).toContain("GEMINI");
    setServerDepsForTesting({
      ...serverDepsFor(db, identity, now),
      config: () => ({ ...TEST_CONFIG, executionVenue: "gemini-sandbox" }),
    });
    try {
      const answer = await desk();
      expect(answer.venue).toBe("gemini-sandbox");
      expect(answer.venueLabel).toBe(venueDescription("gemini-sandbox").label);
    } finally {
      setServerDepsForTesting(serverDepsFor(db, identity, now));
    }
  });

  it("never contains an e-mail or a 0x address, even with buyers in the database", async () => {
    const { merchantId } = await insertMerchant(db, {
      email: "joe@example.com",
      wallet: randomWallet(),
    });
    const campaignId = await insertCampaign(db, {
      merchantId,
      instrument: EARLY,
      eventTicker: "EV-EARLY",
      salesClose: minutesFrom(now, 115),
      slug: "joes-lakers",
    });
    await insertTicket(db, { campaignId, buyer: randomWallet() });
    await db`
      insert into payments (stripe_pi, campaign_id, qty, amount, email, buyer, status)
      values ('pi_pd', ${campaignId}, 1, 20000000, 'fan@example.com', ${randomWallet()}, 'ticketed')
    `;
    await insertDeskRow(db, EARLY, instrumentPayload(EARLY, minutesFrom(now, 120)));
    // An engine row that would leak an address is dropped rather than served.
    await insertDeskRow(db, LATE_A, {
      ...instrumentPayload(LATE_A, minutesFrom(now, 600)),
      label: `Bought by ${randomWallet()}`,
    });
    await insertDeskRow(db, LATE_B, {
      ...instrumentPayload(LATE_B, minutesFrom(now, 600)),
      eventTitle: "fan@example.com",
    });
    await db`
      insert into venue_checks (venue_order_id, instrument, action, at)
      values ('333', 'GEMI-BTC2611190000-HI100000', 'placed_maker', ${now})
    `;
    await db`
      insert into engine_pnl (event_ticker, maker_savings) values ('EV-EARLY', 1)
    `;
    await db`insert into demo_overrides (instrument, forced_result) values (${EARLY}, 'no')`;

    const { status, body, text } = await fetchDesk();
    expect(status).toBe(200);
    const answer = hedgeDeskResponseSchema.parse(body);
    expect(answer.instruments.map((instrument) => instrument.symbol)).toEqual([EARLY]);
    expect(answer.venueCheck?.orders).toHaveLength(1);
    expect(text).not.toMatch(EMAIL_PATTERN);
    expect(text).not.toMatch(ADDRESS_PATTERN);
    expect(containsPersonalData(answer)).toBe(false);
  });
});
