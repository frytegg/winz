import { randomBytes } from "node:crypto";

import {
  JOB_KINDS,
  jobIdempotencyKey,
  type DemoBookRequest,
  type DemoResponse,
  type DemoResultRequest,
  type DemoSaleRequest,
} from "@winz/shared";

import { normalizeEmail } from "./auth";
import { checkoutStatus, findSellableCampaign } from "./checkout";
import type { Db } from "./db";
import { enqueueJob, type JobSql } from "./jobs";
import { serverLogger } from "./logger";
import { ApiRouteError } from "./route";

/**
 * Demo mode (A-07, SPEC MDB-4), behind the admin key: drive the book of one instrument, force its
 * result, replay a sale without a card, drop every override. The web app only writes rows; the
 * engine reads `demo_overrides` in place of the Gemini feed and of Gemini's result, and settles a
 * `pi_demo_` payment without calling Stripe.
 *
 * Every campaign a demo action touches is marked `demo` for good (reset does not un-mark it), so
 * the "DEMO MODE" banner shows on its pages, its tickets and the merchant's detail.
 */

/** Prefix of the payment id of a replayed sale: the engine settles these without Stripe. */
export const DEMO_PAYMENT_PREFIX = "pi_demo_";

/** How long the demo follows an instrument it drives (`tracked_instruments.expires_at`). */
export const DEMO_TRACKING_MINUTES = 60;

/** Contract quantities move by steps of 0.01 contract (10 000 micro-contracts). */
export const QTY_STEP_MICRO = 10_000n;

const TICK_BPS = 100;
const MIN_PRICE_BPS = 100;
const MAX_PRICE_BPS = 9_900;

const OK: DemoResponse = { ok: true, demo: true, ticketToken: null, paymentIntentId: null };

// ---------------------------------------------------------------------------------------------
// Shared steps
// ---------------------------------------------------------------------------------------------

function invalid(field: string, message: string): ApiRouteError {
  return new ApiRouteError(400, "invalid_request", `Invalid body.${field}: ${message}`);
}

/** 404 unless `symbol` is a row of `instruments`. */
async function requireInstrument(sql: JobSql, symbol: string): Promise<void> {
  const [row] = await sql<{ symbol: string }[]>`
    select symbol from instruments where symbol = ${symbol}
  `;
  if (!row) throw new ApiRouteError(404, "not_found", "Instrument not found");
}

/** Marks every campaign on the instrument as a demo campaign. */
async function markInstrumentCampaignsDemo(sql: JobSql, symbol: string): Promise<void> {
  await sql`update campaigns set demo = true where instrument = ${symbol} and not demo`;
}

// ---------------------------------------------------------------------------------------------
// POST /api/admin/demo/book
// ---------------------------------------------------------------------------------------------

/** One level of a book in the JSON shape of `book_cache` (see `books.ts`). */
export interface StoredLevel {
  priceBps: number;
  qty: string;
}

export interface StoredBook {
  bids: StoredLevel[];
  asks: StoredLevel[];
}

function checkPrice(field: "bidBps" | "askBps", bps: number): void {
  if (bps % TICK_BPS !== 0 || bps < MIN_PRICE_BPS || bps > MAX_PRICE_BPS) {
    throw invalid(field, "must be a multiple of 100 between 100 and 9900");
  }
}

/**
 * The demo book of a request, one level each side, or a 400: prices on the 100 bps tick between
 * 100 and 9 900, bid strictly below ask, and a depth that is a positive whole number of 0.01
 * contract steps.
 */
export function demoBookOf(request: DemoBookRequest): StoredBook {
  checkPrice("bidBps", request.bidBps);
  checkPrice("askBps", request.askBps);
  if (request.bidBps >= request.askBps) throw invalid("bidBps", "must be below askBps");
  const depth = BigInt(request.depth);
  if (depth <= 0n || depth % QTY_STEP_MICRO !== 0n) {
    throw invalid("depth", "must be a positive multiple of 10000 micro-contracts (0.01 contract)");
  }
  const qty = depth.toString();
  return {
    bids: [{ priceBps: request.bidBps, qty }],
    asks: [{ priceBps: request.askBps, qty }],
  };
}

/**
 * POST /api/admin/demo/book: sets the demo book of the instrument (`demo_overrides.book`, its
 * forced result kept), has the engine follow the instrument for the next 60 minutes, and marks its
 * campaigns demo. 400 for a crossed or off-tick book, 404 for an unknown instrument.
 */
export async function setDemoBook(
  db: Db,
  request: DemoBookRequest,
  now: Date,
): Promise<DemoResponse> {
  const book = demoBookOf(request);
  const symbol = request.instrumentSymbol;
  const expiresAt = new Date(now.getTime() + DEMO_TRACKING_MINUTES * 60_000);
  // Sent as text and cast in SQL, as for jobs: a jsonb parameter would be encoded twice.
  const json = JSON.stringify(book);
  await db.begin(async (tx) => {
    await requireInstrument(tx, symbol);
    await tx`
      insert into demo_overrides (instrument, book)
      values (${symbol}, ${json}::text::jsonb)
      on conflict (instrument) do update set book = excluded.book
    `;
    await tx`
      insert into tracked_instruments (symbol, requested_at, expires_at)
      values (${symbol}, ${now}, ${expiresAt})
      on conflict (symbol) do update set
        requested_at = excluded.requested_at,
        expires_at = greatest(tracked_instruments.expires_at, excluded.expires_at)
    `;
    await markInstrumentCampaignsDemo(tx, symbol);
  });
  serverLogger("demo").info(
    { instrument: symbol, bidBps: request.bidBps, askBps: request.askBps, depth: request.depth },
    "demo book set",
  );
  return OK;
}

// ---------------------------------------------------------------------------------------------
// POST /api/admin/demo/result
// ---------------------------------------------------------------------------------------------

/**
 * POST /api/admin/demo/result: forces the result of the instrument (`demo_overrides.forced_result`,
 * its demo book kept), which the engine's settlement watcher reads in place of Gemini's, and marks
 * its campaigns demo. 404 for an unknown instrument.
 */
export async function forceDemoResult(db: Db, request: DemoResultRequest): Promise<DemoResponse> {
  const symbol = request.instrumentSymbol;
  await db.begin(async (tx) => {
    await requireInstrument(tx, symbol);
    await tx`
      insert into demo_overrides (instrument, forced_result)
      values (${symbol}, ${request.outcome})
      on conflict (instrument) do update set forced_result = excluded.forced_result
    `;
    await markInstrumentCampaignsDemo(tx, symbol);
  });
  serverLogger("demo").info({ instrument: symbol, outcome: request.outcome }, "demo result forced");
  return OK;
}

// ---------------------------------------------------------------------------------------------
// POST /api/admin/demo/sale
// ---------------------------------------------------------------------------------------------

export interface DemoSaleWait {
  /** Longest wait for the ticket, in milliseconds. */
  timeoutMs: number;
  /** Pause between two reads of the payment, in milliseconds. */
  pollIntervalMs: number;
}

/** The wait of the running server: up to 8 seconds, a look every 250 ms. */
export const DEMO_SALE_WAIT: DemoSaleWait = { timeoutMs: 8_000, pollIntervalMs: 250 };

/** A new payment id of a replayed sale: `pi_demo_` and 24 random hex digits. */
export function demoPaymentId(): string {
  return `${DEMO_PAYMENT_PREFIX}${randomBytes(12).toString("hex")}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reads the payment until the engine has ticketed it (its ticket token), it ended without a ticket
 * (null), or `wait.timeoutMs` elapsed (null: the front then polls GET /api/checkout/:pi).
 */
export async function waitForTicket(
  db: Db,
  paymentId: string,
  wait: DemoSaleWait,
): Promise<string | null> {
  const deadline = Date.now() + wait.timeoutMs;
  for (;;) {
    const status = await checkoutStatus(db, paymentId);
    if (status.status === "ticketed") return status.ticketToken;
    if (status.status === "failed" || status.status === "cancelled_paused") {
      serverLogger("demo").warn(
        { paymentId, status: status.status },
        "demo sale ended without a ticket",
      );
      return null;
    }
    const left = deadline - Date.now();
    if (left <= 0) return null;
    await sleep(Math.min(wait.pollIntervalMs, left));
  }
}

/**
 * POST /api/admin/demo/sale: replays a customer's purchase without a card. The campaign must sell
 * exactly as for POST /api/checkout (404 unknown, 409 `sales_paused` or `sales_closed`). In one
 * transaction: a `processing` payment `pi_demo_…` for qty × unit price with the normalised e-mail,
 * its purchase job (`jobIdempotencyKey.purchase(id)`), and the campaign marked demo. Then waits for
 * the engine to issue the ticket and answers its token, or null when it is not there in time.
 */
export async function replayDemoSale(
  db: Db,
  request: DemoSaleRequest,
  now: Date,
  wait: DemoSaleWait = DEMO_SALE_WAIT,
): Promise<DemoResponse> {
  const paymentId = demoPaymentId();
  const email = normalizeEmail(request.email);
  const campaignId = await db.begin(async (tx) => {
    const campaign = await findSellableCampaign(tx, request.slug, request.qty, now, {
      lock: true,
    });
    await tx`
      insert into payments (stripe_pi, campaign_id, qty, amount, email, status)
      values (${paymentId}, ${campaign.id}, ${request.qty}, ${campaign.amount}, ${email}, 'processing')
    `;
    await enqueueJob(
      tx,
      JOB_KINDS.purchase,
      { paymentIntentId: paymentId },
      jobIdempotencyKey.purchase(paymentId),
    );
    await tx`update campaigns set demo = true where id = ${campaign.id} and not demo`;
    return campaign.id;
  });
  serverLogger("demo").info({ paymentId, campaignId, qty: request.qty }, "demo sale enqueued");
  const ticketToken = await waitForTicket(db, paymentId, wait);
  return { ok: true, demo: true, ticketToken, paymentIntentId: paymentId };
}

// ---------------------------------------------------------------------------------------------
// POST /api/admin/demo/reset
// ---------------------------------------------------------------------------------------------

/**
 * POST /api/admin/demo/reset: deletes every demo override (demo books and forced results). The
 * campaigns a demo action touched stay demo campaigns.
 */
export async function resetDemo(db: Db): Promise<DemoResponse> {
  const deleted = await db`delete from demo_overrides`;
  serverLogger("demo").info({ overrides: deleted.count }, "demo overrides reset");
  return OK;
}
