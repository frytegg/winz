import {
  ADMIN_KEY_HEADER,
  JOB_KINDS,
  apiErrorSchema,
  demoResponseSchema,
  hedgeDeskResponseSchema,
  jobIdempotencyKey,
  type CampaignStatus,
  type SaleState,
} from "@winz/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { POST as postBook } from "@/app/api/admin/demo/book/route";
import { POST as postReset } from "@/app/api/admin/demo/reset/route";
import { POST as postResult } from "@/app/api/admin/demo/result/route";
import { POST as postSale } from "@/app/api/admin/demo/sale/route";
import { GET as getHedgeDesk } from "@/app/api/hedge-desk/route";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import { getCampaignDetail } from "./campaigns";
import type { Db } from "./db";
import { setServerDepsForTesting } from "./deps";
import { DEMO_PAYMENT_PREFIX, demoBookOf } from "./demo";
import { ApiRouteError } from "./route";
import {
  ADMIN_KEY,
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
import { publicCampaign, ticketByToken } from "./tickets";

/**
 * The admin demo routes end to end through their Next.js handlers, on a real Postgres. The engine
 * is not running: a test helper plays its part when a sale must end with a ticket.
 */

const now = new Date("2026-11-20T18:00:00.000Z");
const SYMBOL = "GEMI-NCAAF-ARK-TEX-S-TEX13";
const OTHER = "GEMI-NCAAF-ARK-TEX-S-ARK7";
const ADMIN = { [ADMIN_KEY_HEADER]: ADMIN_KEY };
const WRONG = { [ADMIN_KEY_HEADER]: "not-the-admin-key-0000" };
const noParams = { params: Promise.resolve({}) };
const SHORT_WAIT = { timeoutMs: 150, pollIntervalMs: 20 };
const LONG_WAIT = { timeoutMs: 5_000, pollIntervalMs: 20 };
const BOOK = { instrumentSymbol: SYMBOL, bidBps: 1100, askBps: 1300, depth: "500000000" };

let database: TestDatabase;
let db: Db;
let joe: string;
let slugCounter = 0;
const identity = new FakeIdentity();

function post(path: string, body: unknown, headers: Record<string, string> = ADMIN): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function useWait(wait: { timeoutMs: number; pollIntervalMs: number }): void {
  setServerDepsForTesting({ ...serverDepsFor(db, identity, now), demoSaleWait: wait });
}

async function errorCode(response: Response): Promise<string> {
  return apiErrorSchema.parse(await response.json()).error.code;
}

async function campaign(
  overrides: {
    instrument?: string;
    status?: CampaignStatus;
    saleState?: SaleState;
    salesClose?: Date;
    unitPrice?: bigint;
  } = {},
): Promise<{ id: string; slug: string }> {
  slugCounter += 1;
  const slug = `joes-demo-${slugCounter}`;
  const id = await insertCampaign(db, {
    merchantId: joe,
    instrument: overrides.instrument ?? SYMBOL,
    eventTicker: "EV",
    salesClose: overrides.salesClose ?? minutesFrom(now, 595),
    slug,
    status: overrides.status,
    saleState: overrides.saleState,
    unitPrice: overrides.unitPrice,
  });
  return { id, slug };
}

async function isDemo(campaignId: string): Promise<boolean> {
  const [row] = await db<{ demo: boolean }[]>`select demo from campaigns where id = ${campaignId}`;
  return row?.demo === true;
}

/** Everything a demo route may write, to prove a refused call changed nothing. */
async function snapshot(): Promise<unknown> {
  const [overrides, tracked, paymentsRows, jobs, campaigns] = await Promise.all([
    db`select instrument, book, forced_result from demo_overrides order by instrument`,
    db`select symbol, requested_at, expires_at from tracked_instruments order by symbol`,
    db`select stripe_pi, status, email, amount from payments order by stripe_pi`,
    db`select kind, idempotency_key from jobs order by idempotency_key`,
    db`select id, demo from campaigns order by id`,
  ]);
  return { overrides, tracked, paymentsRows, jobs, campaigns };
}

/** Plays the engine: waits for the demo payment of the campaign, then tickets it. */
async function ticketWhenPaymentAppears(campaignId: string): Promise<string> {
  const deadline = Date.now() + 4_000;
  for (;;) {
    const [payment] = await db<{ stripe_pi: string; qty: number; amount: bigint }[]>`
      select stripe_pi, qty, amount from payments where campaign_id = ${campaignId}
    `;
    if (payment) {
      const ticket = await insertTicket(db, {
        campaignId,
        buyer: randomWallet(),
        qty: payment.qty,
        paid: payment.amount,
        refundable: payment.amount,
      });
      await db`update tickets set payment_pi = ${payment.stripe_pi} where id = ${ticket.id}`;
      await db`
        update payments set status = 'ticketed', ticket_id = ${ticket.id}
        where stripe_pi = ${payment.stripe_pi}
      `;
      return ticket.token;
    }
    if (Date.now() > deadline) throw new Error("the demo payment never appeared");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  await insertEvent(db, { ticker: "EV", startsAt: minutesFrom(now, 600) });
  await insertInstrument(db, { symbol: SYMBOL, eventTicker: "EV", label: "Texas wins by 14+" });
  await insertInstrument(db, { symbol: OTHER, eventTicker: "EV", label: "Arkansas +7" });
  joe = (await insertMerchant(db, { email: "joe@example.com" })).merchantId;
  setServerDepsForTesting(serverDepsFor(db, identity, now));
});

afterEach(() => {
  setServerDepsForTesting(serverDepsFor(db, identity, now));
});

afterAll(async () => {
  setServerDepsForTesting(undefined);
  await database.drop();
});

describe("the admin key", () => {
  const calls: [
    string,
    (request: Request, context: typeof noParams) => Promise<Response>,
    unknown,
  ][] = [
    ["/api/admin/demo/book", postBook, BOOK],
    ["/api/admin/demo/result", postResult, { instrumentSymbol: SYMBOL, outcome: "yes" }],
    ["/api/admin/demo/sale", postSale, { slug: "joes-demo-x", qty: 1, email: "a@b.co" }],
    ["/api/admin/demo/reset", postReset, {}],
  ];

  it.each(calls)(
    "%s answers 401 without the key or with a wrong one, and changes nothing",
    async (path, handler, body) => {
      await campaign();
      await db`insert into demo_overrides (instrument, forced_result) values (${OTHER}, 'no')
             on conflict (instrument) do nothing`;
      const before = await snapshot();
      for (const headers of [{}, WRONG, { [ADMIN_KEY_HEADER]: "" }]) {
        const response = await handler(post(path, body, headers), noParams);
        expect(response.status).toBe(401);
        expect(await errorCode(response)).toBe("unauthenticated");
      }
      expect(await snapshot()).toEqual(before);
      await db`delete from demo_overrides`;
    },
  );
});

describe("POST /api/admin/demo/book", () => {
  it("stores a one-level book, follows the instrument for 60 minutes and marks its campaigns demo", async () => {
    const onIt = await campaign();
    const elsewhere = await campaign({ instrument: OTHER });
    await db`insert into demo_overrides (instrument, forced_result) values (${SYMBOL}, 'yes')`;

    const response = await postBook(post("/api/admin/demo/book", BOOK), noParams);
    expect(response.status).toBe(200);
    expect(demoResponseSchema.parse(await response.json())).toEqual({
      ok: true,
      demo: true,
      ticketToken: null,
    });

    const [override] = await db`
      select book, forced_result from demo_overrides where instrument = ${SYMBOL}
    `;
    expect(override).toEqual({
      book: {
        bids: [{ priceBps: 1100, qty: "500000000" }],
        asks: [{ priceBps: 1300, qty: "500000000" }],
      },
      // The forced result is kept.
      forced_result: "yes",
    });
    const [tracked] = await db<{ requested_at: Date; expires_at: Date }[]>`
      select requested_at, expires_at from tracked_instruments where symbol = ${SYMBOL}
    `;
    expect(tracked?.requested_at).toEqual(now);
    expect(tracked?.expires_at).toEqual(minutesFrom(now, 60));
    expect(await isDemo(onIt.id)).toBe(true);
    expect(await isDemo(elsewhere.id)).toBe(false);

    // A second book replaces the first; the tracking never shortens.
    await db`update tracked_instruments set expires_at = ${minutesFrom(now, 90)} where symbol = ${SYMBOL}`;
    const again = await postBook(
      post("/api/admin/demo/book", { ...BOOK, bidBps: 2000, askBps: 2200 }),
      noParams,
    );
    expect(again.status).toBe(200);
    const [replaced] = await db`select book from demo_overrides where instrument = ${SYMBOL}`;
    expect(replaced?.book).toEqual({
      bids: [{ priceBps: 2000, qty: "500000000" }],
      asks: [{ priceBps: 2200, qty: "500000000" }],
    });
    const [kept] = await db`select expires_at from tracked_instruments where symbol = ${SYMBOL}`;
    expect(kept?.expires_at).toEqual(minutesFrom(now, 90));
    await db`delete from demo_overrides`;
  });

  it.each([
    ["a crossed book", { bidBps: 1300, askBps: 1300 }],
    ["a bid above the ask", { bidBps: 1500, askBps: 1300 }],
    ["an off-tick bid", { bidBps: 1150, askBps: 1300 }],
    ["an off-tick ask", { bidBps: 1100, askBps: 1310 }],
    ["a zero bid", { bidBps: 0, askBps: 1300 }],
    ["an ask of 100 %", { bidBps: 9800, askBps: 10_000 }],
    ["a zero depth", { depth: "0" }],
    ["a depth off the 0.01 contract step", { depth: "5000" }],
  ])("refuses %s with 400 and writes nothing", async (_name, change) => {
    const before = await snapshot();
    const response = await postBook(post("/api/admin/demo/book", { ...BOOK, ...change }), noParams);
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_request");
    expect(await snapshot()).toEqual(before);
  });

  it("answers 404 for an unknown instrument", async () => {
    const before = await snapshot();
    const response = await postBook(
      post("/api/admin/demo/book", { ...BOOK, instrumentSymbol: "GEMI-NOPE" }),
      noParams,
    );
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("not_found");
    expect(await snapshot()).toEqual(before);
  });

  it("builds the book of the edges of the range", () => {
    expect(
      demoBookOf({ instrumentSymbol: SYMBOL, bidBps: 100, askBps: 9900, depth: "10000" }),
    ).toEqual({
      bids: [{ priceBps: 100, qty: "10000" }],
      asks: [{ priceBps: 9900, qty: "10000" }],
    });
    expect(() => demoBookOf({ ...BOOK, bidBps: 1200, askBps: 1100 })).toThrow(ApiRouteError);
  });
});

describe("POST /api/admin/demo/result", () => {
  it("forces the result, keeps the demo book and marks the instrument's campaigns demo", async () => {
    const onIt = await campaign({ instrument: OTHER });
    await postBook(post("/api/admin/demo/book", { ...BOOK, instrumentSymbol: OTHER }), noParams);
    const response = await postResult(
      post("/api/admin/demo/result", { instrumentSymbol: OTHER, outcome: "no" }),
      noParams,
    );
    expect(response.status).toBe(200);
    expect(demoResponseSchema.parse(await response.json()).ticketToken).toBeNull();
    const [row] = await db<{ forced_result: string; has_book: boolean }[]>`
      select forced_result, book is not null as has_book from demo_overrides
      where instrument = ${OTHER}
    `;
    expect(row).toEqual({ forced_result: "no", has_book: true });
    expect(await isDemo(onIt.id)).toBe(true);

    // Forcing again replaces the result.
    await postResult(
      post("/api/admin/demo/result", { instrumentSymbol: OTHER, outcome: "yes" }),
      noParams,
    );
    const [again] = await db`select forced_result from demo_overrides where instrument = ${OTHER}`;
    expect(again?.forced_result).toBe("yes");
    await db`delete from demo_overrides`;
  });

  it("answers 404 for an unknown instrument and 400 for an unknown outcome", async () => {
    const before = await snapshot();
    const unknown = await postResult(
      post("/api/admin/demo/result", { instrumentSymbol: "GEMI-NOPE", outcome: "yes" }),
      noParams,
    );
    expect(unknown.status).toBe(404);
    const invalid = await postResult(
      post("/api/admin/demo/result", { instrumentSymbol: SYMBOL, outcome: "maybe" }),
      noParams,
    );
    expect(invalid.status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });
});

describe("POST /api/admin/demo/sale", () => {
  async function paymentsOf(campaignId: string): Promise<Record<string, unknown>[]> {
    return db<Record<string, unknown>[]>`
      select stripe_pi, qty, amount, email, status from payments where campaign_id = ${campaignId}
    `;
  }

  it("records one processing payment and one purchase job, and answers null on timeout", async () => {
    useWait(SHORT_WAIT);
    const promo = await campaign({ unitPrice: 15_000_000n });
    const started = Date.now();
    const response = await postSale(
      post("/api/admin/demo/sale", { slug: promo.slug, qty: 3, email: "Fan@Example.COM" }),
      noParams,
    );
    expect(response.status).toBe(200);
    expect(demoResponseSchema.parse(await response.json())).toEqual({
      ok: true,
      demo: true,
      ticketToken: null,
    });
    expect(Date.now() - started).toBeLessThan(2_000);

    const rows = await paymentsOf(promo.id);
    expect(rows).toHaveLength(1);
    const [payment] = rows;
    expect(payment).toMatchObject({
      qty: 3,
      amount: 45_000_000n,
      email: "fan@example.com",
      status: "processing",
    });
    const id = String(payment?.stripe_pi);
    expect(id).toMatch(new RegExp(`^${DEMO_PAYMENT_PREFIX}[0-9a-f]{24}$`));
    const jobs = await db<{ kind: string; payload: unknown; status: string }[]>`
      select kind, payload, status from jobs where idempotency_key = ${jobIdempotencyKey.purchase(id)}
    `;
    expect(jobs).toEqual([
      { kind: JOB_KINDS.purchase, payload: { paymentIntentId: id }, status: "queued" },
    ]);
    const [all] = await db<{ n: bigint }[]>`
      select count(*)::bigint as n from jobs where kind = ${JOB_KINDS.purchase}
        and payload ->> 'paymentIntentId' = ${id}
    `;
    expect(all?.n).toBe(1n);
    expect(await isDemo(promo.id)).toBe(true);
  });

  it("answers the ticket token when the engine tickets the payment during the wait", async () => {
    useWait(LONG_WAIT);
    const promo = await campaign();
    const [response, token] = await Promise.all([
      postSale(
        post("/api/admin/demo/sale", { slug: promo.slug, qty: 1, email: "fan@example.com" }),
        noParams,
      ),
      ticketWhenPaymentAppears(promo.id),
    ]);
    expect(response.status).toBe(200);
    expect(demoResponseSchema.parse(await response.json())).toEqual({
      ok: true,
      demo: true,
      ticketToken: token,
    });
    expect(await paymentsOf(promo.id)).toHaveLength(1);
  });

  it.each([
    [
      "a paused campaign",
      { status: "paused" as const, saleState: "paused_manual" as const },
      409,
      "sales_paused",
    ],
    ["a price pause", { saleState: "paused_price" as const }, 409, "sales_paused"],
    ["a campaign whose sales closed", { salesClose: minutesFrom(now, -1) }, 409, "sales_closed"],
    [
      "a closed campaign",
      { status: "sales_closed" as const, saleState: "closed" as const },
      409,
      "sales_closed",
    ],
    ["an unpublished campaign", { status: "funding" as const }, 404, "not_found"],
  ])(
    "refuses %s like a real checkout and writes nothing",
    async (_name, overrides, status, code) => {
      useWait(SHORT_WAIT);
      const promo = await campaign(overrides);
      const before = await snapshot();
      const response = await postSale(
        post("/api/admin/demo/sale", { slug: promo.slug, qty: 1, email: "fan@example.com" }),
        noParams,
      );
      expect(response.status).toBe(status);
      expect(await errorCode(response)).toBe(code);
      expect(await snapshot()).toEqual(before);
      expect(await isDemo(promo.id)).toBe(false);
    },
  );

  it("answers 404 for an unknown slug", async () => {
    const before = await snapshot();
    const response = await postSale(
      post("/api/admin/demo/sale", { slug: "nobody-knows-me", qty: 1, email: "fan@example.com" }),
      noParams,
    );
    expect(response.status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });
});

describe("POST /api/admin/demo/reset", () => {
  it("removes every override; the campaigns stay demo", async () => {
    const a = await campaign();
    const b = await campaign({ instrument: OTHER });
    await postBook(post("/api/admin/demo/book", BOOK), noParams);
    await postResult(
      post("/api/admin/demo/result", { instrumentSymbol: OTHER, outcome: "yes" }),
      noParams,
    );
    const desk = hedgeDeskResponseSchema.parse(
      await (await getHedgeDesk(new Request("http://localhost/api/hedge-desk"), noParams)).json(),
    );
    expect(desk.demo).toBe(true);

    const response = await postReset(post("/api/admin/demo/reset", {}), noParams);
    expect(response.status).toBe(200);
    expect(demoResponseSchema.parse(await response.json()).ticketToken).toBeNull();
    const [count] = await db<{ n: bigint }[]>`select count(*)::bigint as n from demo_overrides`;
    expect(count?.n).toBe(0n);
    expect(await isDemo(a.id)).toBe(true);
    expect(await isDemo(b.id)).toBe(true);
    const after = hedgeDeskResponseSchema.parse(
      await (await getHedgeDesk(new Request("http://localhost/api/hedge-desk"), noParams)).json(),
    );
    expect(after.demo).toBe(false);

    // A reset with an empty body (no JSON at all) is accepted too.
    const empty = await postReset(
      new Request("http://localhost/api/admin/demo/reset", { method: "POST", headers: ADMIN }),
      noParams,
    );
    expect(empty.status).toBe(200);
  });
});

describe("the demo flag reaches every answer that carries one", () => {
  it("shows on the public page, the ticket and the merchant detail once a demo action touched the campaign", async () => {
    const promo = await campaign();
    const ticket = await insertTicket(db, { campaignId: promo.id, buyer: randomWallet() });
    expect((await publicCampaign(db, promo.slug, now)).demo).toBe(false);
    expect((await ticketByToken(db, ticket.token, now)).demo).toBe(false);
    expect((await getCampaignDetail(db, joe, promo.id, TEST_CONFIG, now)).demo).toBe(false);

    await postResult(
      post("/api/admin/demo/result", { instrumentSymbol: SYMBOL, outcome: "yes" }),
      noParams,
    );
    await postReset(post("/api/admin/demo/reset", {}), noParams);

    expect((await publicCampaign(db, promo.slug, now)).demo).toBe(true);
    expect((await ticketByToken(db, ticket.token, now)).demo).toBe(true);
    expect((await getCampaignDetail(db, joe, promo.id, TEST_CONFIG, now)).demo).toBe(true);
  });
});
