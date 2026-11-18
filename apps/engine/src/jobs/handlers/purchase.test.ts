/**
 * J-03 on the real contract: the purchase job against a local chain with the real escrow, a real
 * Postgres, the real transaction sender and projector, a fake payment gateway, a fake identity
 * directory and a hand-fed book. After every scenario, the invariant of the sale path is checked
 * on-chain: per payment, 0 or 1 ticket, at most 1 capture, and a capture only with a ticket.
 */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { computeQuote, maxCostBps } from "@winz/pricing";
import type { BookLevel, PurchaseJob } from "@winz/shared";

import type { TxSender } from "../../chain";
import { permanentGatewayError, transientGatewayError } from "../../payments";
import { JobAbortedError, PermanentJobError, RetryLaterError } from "../errors";
import type { JobHandler } from "../worker";
import { createCloseSalesHandler, createSetPausedHandler } from "./campaign-actions";
import type { JobHandlerOptions } from "./deps";
import { PURCHASE_MESSAGES, createPurchaseHandler } from "./purchase";
import {
  CONTRACT,
  USDC,
  allLogText,
  checksum,
  createJobsHarness,
  createLiveCampaign,
  getCampaign,
  logsAt,
  onchainTickets,
  runHandler,
  seedPayment,
  txRows,
  thresholdOf,
  type JobsHarness,
  type LiveCampaign,
} from "./test-support";

let harness: JobsHarness;
/** The campaign most scenarios sell on: $5 a unit, 100 % refunded, $100 budget. */
let campaign: LiveCampaign;

/** Payments created by the current test, checked by the invariant after it. */
let scenario: { pi: string; campaignOnchainId: bigint }[] = [];
/** Every e-mail used, which no log line may contain. */
const emails = new Set<string>();

const FRESH_ASKS: BookLevel[] = [
  { priceBps: 3_000n, qty: 200n * CONTRACT },
  { priceBps: 3_100n, qty: 300n * CONTRACT },
];
const BIDS: BookLevel[] = [{ priceBps: 2_900n, qty: 100n * CONTRACT }];

let counter = 0;
function newEmail(): string {
  counter += 1;
  const email = `fan-${counter.toString()}-${Date.now().toString(36)}@example.com`;
  emails.add(email);
  return email;
}

beforeAll(async () => {
  harness = await createJobsHarness();
  campaign = await createLiveCampaign(harness, "main");
});

afterAll(async () => {
  await harness?.close();
});

afterEach(async () => {
  const tickets = await onchainTickets(harness);
  for (const { pi, campaignOnchainId } of scenario) {
    const [row] = await harness.db<{ buyer: string | null }[]>`
      select buyer from payments where stripe_pi = ${pi}
    `;
    const onchain =
      row?.buyer === null || row?.buyer === undefined
        ? []
        : tickets.filter(
            (ticket) =>
              ticket.campaignId === campaignOnchainId && ticket.buyer === checksum(row.buyer ?? ""),
          );
    const captures = harness.gateway.effectsOf(pi).captures;
    expect(onchain.length, `tickets of ${pi}`).toBeLessThanOrEqual(1);
    expect(captures, `captures of ${pi}`).toBeLessThanOrEqual(1);
    if (captures === 1) expect(onchain.length, `ticket of captured ${pi}`).toBe(1);
    if (row?.buyer === null) {
      // No wallet was ever resolved: no buyFor of this payment may have been mined.
      expect(
        (await txRows(harness, `buyFor:${pi}:`)).filter((tx) => tx.status === "mined"),
      ).toEqual([]);
    }
  }
  scenario = [];
  harness.gateway.clearFailures();
  harness.outage.active = false;
  harness.clock.skewMs = 0;
});

function purchase(
  options: JobHandlerOptions = {},
  sender?: Pick<TxSender, "enqueue" | "waitFor">,
): JobHandler<PurchaseJob> {
  return createPurchaseHandler(
    harness.deps(sender === undefined ? {} : { txSender: sender }, options),
  );
}

async function buy(
  on: LiveCampaign,
  input: {
    qty?: number;
    email?: string | null;
    payerEmail?: string | null;
    intent?: { amount?: bigint; qty?: string; campaignId?: string };
  } = {},
): Promise<string> {
  const email = input.email === undefined ? newEmail() : input.email;
  const pi = await seedPayment(harness, {
    campaignId: on.campaignId,
    qty: input.qty ?? 1,
    unitPrice: on.terms.unitPrice,
    email,
    ...(input.payerEmail === undefined ? {} : { payerEmail: input.payerEmail }),
    ...(input.intent === undefined ? {} : { intent: input.intent }),
  });
  scenario.push({ pi, campaignOnchainId: on.onchainId });
  return pi;
}

interface PaymentRow {
  status: string;
  message: string | null;
  buyer: string | null;
  ticket_id: string | null;
}

async function paymentRow(pi: string): Promise<PaymentRow> {
  const [row] = await harness.db<PaymentRow[]>`
    select status, message, buyer, ticket_id from payments where stripe_pi = ${pi}
  `;
  if (row === undefined) throw new Error(`no payment ${pi}`);
  return row;
}

interface TicketRow {
  id: string;
  onchain_id: bigint;
  buyer: string;
  paid: bigint;
  refundable: bigint;
  max_hedge_cost: bigint;
  access_token: string;
  quote_nonce: string | null;
  payment_pi: string | null;
}

async function ticketsOf(pi: string): Promise<TicketRow[]> {
  return harness.db<TicketRow[]>`
    select id, onchain_id, buyer, paid, refundable, max_hedge_cost, access_token,
           quote_nonce::text as quote_nonce, payment_pi
    from tickets where payment_pi = ${pi}
  `;
}

/** The scenario's refusal: authorization released once, nothing sent, the customer's message. */
async function expectCancelledPaused(pi: string): Promise<void> {
  const row = await paymentRow(pi);
  expect(row.status).toBe("cancelled_paused");
  expect(row.message).toBe("Promo just paused, you were not charged");
  expect(row.ticket_id).toBeNull();
  expect(harness.gateway.effectsOf(pi)).toEqual({ captures: 0, cancels: 1, refunds: 0 });
  expect(harness.gateway.callsOf(pi, "cancel")).toHaveLength(1);
  expect(harness.gateway.intent(pi)?.status).toBe("canceled");
}

describe("purchase job: a sale", () => {
  it("buys one ticket for the buyer's wallet, captures once and links everything", async () => {
    harness.books.set(campaign.symbol, { asks: FRESH_ASKS, bids: BIDS });
    const pi = await buy(campaign, { qty: 2 });
    const qty = 2n;
    const [position] = await harness.db<{ exposure: bigint; held: bigint }[]>`
      select exposure, held from positions where instrument = ${campaign.symbol}
    `;
    const pending = position === undefined ? 0n : position.exposure - position.held;
    const before = await getCampaign(harness, campaign.onchainId);
    const available = before.hedgeBudget - before.hedgeSpent - before.hedgeReserved;
    const expected = computeQuote({
      book: harness.books.getBook(campaign.symbol),
      pending: pending > 0n ? pending : 0n,
      nowMs: harness.clock.chainNow(),
      qty,
      unitPrice: campaign.terms.unitPrice,
      refundBps: BigInt(campaign.terms.refundBps),
      pauseThresholdBps: thresholdOf(campaign.terms),
      maxCostBps: maxCostBps(
        BigInt(campaign.terms.usualMarginBps),
        BigInt(campaign.terms.minMarginBps),
      ),
      availableBudget: available,
    });
    if (!expected.ok) throw new Error(`the test book does not quote: ${expected.reason}`);

    await runHandler(harness, purchase(), { paymentIntentId: pi });

    const payment = await paymentRow(pi);
    expect(payment.status).toBe("ticketed");
    expect(payment.message).toBeNull();
    expect(payment.buyer).toMatch(/^0x[0-9a-f]{40}$/);
    expect(harness.gateway.effectsOf(pi)).toEqual({ captures: 1, cancels: 0, refunds: 0 });

    const tickets = await ticketsOf(pi);
    expect(tickets).toHaveLength(1);
    const [ticket] = tickets;
    if (ticket === undefined) throw new Error("no ticket");
    expect(payment.ticket_id).toBe(ticket.id);
    expect(ticket.buyer).toBe(payment.buyer);
    expect(ticket.access_token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const [buyTx] = await harness.db<{ payload: { quoteNonce: string } }[]>`
      select payload from chain_txs where idempotency_key = ${`buyFor:${pi}:1`} and status = 'mined'
    `;
    expect(ticket.quote_nonce).toBe(buyTx?.payload.quoteNonce);

    const onchain = (await onchainTickets(harness)).find((t) => t.id === ticket.onchain_id);
    const paid = qty * campaign.terms.unitPrice;
    expect(onchain?.buyer).toBe(checksum(payment.buyer ?? ""));
    expect(onchain?.campaignId).toBe(campaign.onchainId);
    expect(onchain?.paid).toBe(paid);
    expect(onchain?.refundable).toBe((paid * BigInt(campaign.terms.refundBps)) / 10_000n);
    // The guarantee signed is computeQuote's, and the contract reserved exactly it.
    expect(onchain?.maxHedgeCost).toBe(expected.maxHedgeCost);
    const after = await getCampaign(harness, campaign.onchainId);
    expect(after.hedgeReserved - before.hedgeReserved).toBe(expected.maxHedgeCost);
    expect(after.hedgeReserved + after.hedgeSpent).toBeLessThanOrEqual(after.hedgeBudget);
    expect(ticket.max_hedge_cost).toBe(expected.maxHedgeCost);
    expect(ticket.paid).toBe(paid);

    const [lot] = await harness.db<{ qty: bigint; max_hedge_cost: bigint }[]>`
      select qty, max_hedge_cost from lots where ticket_id = ${ticket.id}
    `;
    expect(lot?.qty).toBe(onchain?.refundable);
    expect(lot?.max_hedge_cost).toBe(expected.maxHedgeCost);
  });

  it("produces one ticket and one capture when the job is delivered twice", async () => {
    harness.books.set(campaign.symbol, { asks: FRESH_ASKS, bids: BIDS });
    const pi = await buy(campaign);
    await runHandler(harness, purchase(), { paymentIntentId: pi });
    await runHandler(harness, purchase(), { paymentIntentId: pi });

    expect((await paymentRow(pi)).status).toBe("ticketed");
    expect(await ticketsOf(pi)).toHaveLength(1);
    expect(harness.gateway.effectsOf(pi)).toEqual({ captures: 1, cancels: 0, refunds: 0 });
    expect(harness.gateway.callsOf(pi, "capture")).toHaveLength(1);
    expect(await txRows(harness, `buyFor:${pi}:`)).toHaveLength(1);
  });

  it("produces one ticket and one capture when two workers race on the payment", async () => {
    harness.books.set(campaign.symbol, { asks: FRESH_ASKS, bids: BIDS });
    const pi = await buy(campaign);
    const results = await Promise.allSettled([
      runHandler(harness, purchase(), { paymentIntentId: pi }),
      runHandler(harness, purchase(), { paymentIntentId: pi }),
    ]);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toBeInstanceOf(RetryLaterError);
    }
    // The run that was turned away comes back later, as the worker would make it.
    await runHandler(harness, purchase(), { paymentIntentId: pi });

    expect((await paymentRow(pi)).status).toBe("ticketed");
    expect(await ticketsOf(pi)).toHaveLength(1);
    expect(harness.gateway.effectsOf(pi)).toEqual({ captures: 1, cancels: 0, refunds: 0 });
    expect(await txRows(harness, `buyFor:${pi}:`)).toHaveLength(1);
  });
});

/** computeQuote with the campaign's terms, the given book and pending, and its on-chain budget. */
async function quoteFor(
  on: LiveCampaign,
  qty: bigint,
  pending: bigint,
): Promise<ReturnType<typeof computeQuote>> {
  const onchain = await getCampaign(harness, on.onchainId);
  return computeQuote({
    book: harness.books.getBook(on.symbol),
    pending,
    nowMs: harness.clock.chainNow(),
    qty,
    unitPrice: on.terms.unitPrice,
    refundBps: BigInt(on.terms.refundBps),
    pauseThresholdBps: thresholdOf(on.terms),
    maxCostBps: maxCostBps(BigInt(on.terms.usualMarginBps), BigInt(on.terms.minMarginBps)),
    availableBudget: onchain.hedgeBudget - onchain.hedgeSpent - onchain.hedgeReserved,
  });
}

/** The guarantee the escrow holds for the one ticket of a payment. */
async function signedGuarantee(pi: string): Promise<bigint> {
  const [ticket] = await ticketsOf(pi);
  if (ticket === undefined) throw new Error(`no ticket for ${pi}`);
  const onchain = (await onchainTickets(harness)).find((t) => t.id === ticket.onchain_id);
  if (onchain === undefined) throw new Error(`ticket ${ticket.onchain_id.toString()} not on-chain`);
  return onchain.maxHedgeCost;
}

describe("purchase job: what the guarantee is priced on", () => {
  it("caps the guarantee at the merchant's maximum cost (usual margin minus minimum margin)", async () => {
    const capped = await createLiveCampaign(harness, "capped");
    // The asks sit at the pause threshold: the taker cost fits under the cap, the cost plus the
    // one-tick tolerance does not, so the cap is what gets signed.
    harness.books.set(capped.symbol, {
      asks: [{ priceBps: thresholdOf(capped.terms), qty: 500n * CONTRACT }],
      bids: BIDS,
    });
    const qty = 2n;
    const paid = qty * capped.terms.unitPrice;
    const cap = (paid * BigInt(capped.terms.usualMarginBps - capped.terms.minMarginBps)) / 10_000n;
    const expected = await quoteFor(capped, qty, 0n);
    if (!expected.ok) throw new Error(`the test book does not quote: ${expected.reason}`);
    expect(expected.maxHedgeCost).toBe(cap);
    expect(expected.hedgeCost).toBeLessThan(cap);

    const pi = await buy(capped, { qty: Number(qty) });
    await runHandler(harness, purchase(), { paymentIntentId: pi });

    expect((await paymentRow(pi)).status).toBe("ticketed");
    expect(await signedGuarantee(pi)).toBe(cap);
  });

  it("prices a sale behind the exposure sold and not hedged yet (exposure minus held)", async () => {
    const shared = await createLiveCampaign(harness, "pending");
    harness.books.set(shared.symbol, { asks: FRESH_ASKS, bids: BIDS });
    const first = await buy(shared);
    await runHandler(harness, purchase(), { paymentIntentId: first });
    expect((await paymentRow(first)).status).toBe("ticketed");

    // Two of the five contracts sold are hedged: three are still owed to the first sale.
    await harness.db`
      update positions set held = ${(2n * CONTRACT).toString()}::bigint
      where instrument = ${shared.symbol}
    `;
    const [position] = await harness.db<{ exposure: bigint; held: bigint }[]>`
      select exposure, held from positions where instrument = ${shared.symbol}
    `;
    expect(position).toEqual({ exposure: 5n * CONTRACT, held: 2n * CONTRACT });
    const pending = 3n * CONTRACT;
    // A thin first level: where the next sale's slice starts decides what it costs.
    harness.books.set(shared.symbol, {
      asks: [
        { priceBps: 3_000n, qty: 4n * CONTRACT },
        { priceBps: 3_500n, qty: 500n * CONTRACT },
      ],
      bids: BIDS,
    });
    const expected = await quoteFor(shared, 1n, pending);
    const ignoringPending = await quoteFor(shared, 1n, 0n);
    const ignoringHeld = await quoteFor(shared, 1n, 5n * CONTRACT);
    if (!expected.ok || !ignoringPending.ok || !ignoringHeld.ok) {
      throw new Error("the test book does not quote");
    }
    expect(expected.maxHedgeCost).not.toBe(ignoringPending.maxHedgeCost);
    expect(expected.maxHedgeCost).not.toBe(ignoringHeld.maxHedgeCost);

    const second = await buy(shared);
    await runHandler(harness, purchase(), { paymentIntentId: second });

    expect((await paymentRow(second)).status).toBe("ticketed");
    expect(await signedGuarantee(second)).toBe(expected.maxHedgeCost);
  });
});

describe("purchase job: the sale cannot go on-chain now", () => {
  it("refuses on a stale book", async () => {
    harness.books.set(campaign.symbol, { asks: FRESH_ASKS, bids: BIDS, ageMs: 11_000 });
    const pi = await buy(campaign);
    await runHandler(harness, purchase(), { paymentIntentId: pi });
    await expectCancelledPaused(pi);
    expect(await txRows(harness, `buyFor:${pi}:`)).toHaveLength(0);
  });

  it("refuses on an empty book", async () => {
    harness.books.set(campaign.symbol, { asks: [], bids: [] });
    const pi = await buy(campaign);
    await runHandler(harness, purchase(), { paymentIntentId: pi });
    await expectCancelledPaused(pi);
    expect(await txRows(harness, `buyFor:${pi}:`)).toHaveLength(0);
  });

  it("refuses when the price is above the pause threshold", async () => {
    harness.books.set(campaign.symbol, {
      asks: [{ priceBps: 6_000n, qty: 500n * CONTRACT }],
      bids: BIDS,
    });
    const pi = await buy(campaign);
    await runHandler(harness, purchase(), { paymentIntentId: pi });
    await expectCancelledPaused(pi);
    expect(await txRows(harness, `buyFor:${pi}:`)).toHaveLength(0);
  });

  it("refuses when the budget left on-chain cannot hold the guarantee", async () => {
    const poor = await createLiveCampaign(harness, "poor", { budget: USDC / 100n });
    harness.books.set(poor.symbol, { asks: FRESH_ASKS, bids: BIDS });
    const pi = await buy(poor);
    await runHandler(harness, purchase(), { paymentIntentId: pi });
    await expectCancelledPaused(pi);
    expect(await txRows(harness, `buyFor:${pi}:`)).toHaveLength(0);
  });

  it("refuses while the merchant has paused the promo", async () => {
    const paused = await createLiveCampaign(harness, "paused");
    harness.books.set(paused.symbol, { asks: FRESH_ASKS, bids: BIDS });
    await harness.db`update campaigns set sale_state = 'paused_manual' where id = ${paused.campaignId}`;
    await runHandler(harness, createSetPausedHandler(harness.deps()), {
      campaignId: paused.campaignId,
      paused: true,
      requestId: randomUUID(),
    });
    expect((await getCampaign(harness, paused.onchainId)).status).toBe(1);
    const pi = await buy(paused);
    await runHandler(harness, purchase(), { paymentIntentId: pi });
    await expectCancelledPaused(pi);
    expect(await txRows(harness, `buyFor:${pi}:`)).toHaveLength(0);
  });

  it.each(["paused_price", "paused_budget", "paused_depth", "paused_stale", "paused_breaker"])(
    "signs no quote while the sale state is %s, even on a book that would sell",
    async (saleState) => {
      // The automatic pause is still in force (its ten-second return has not elapsed) although
      // the book of this instant would pass every pricing rule.
      const held = await createLiveCampaign(harness, `held-${saleState}`);
      harness.books.set(held.symbol, { asks: FRESH_ASKS, bids: BIDS });
      const pi = await buy(held);
      await harness.db`
        update campaigns set sale_state = ${saleState} where id = ${held.campaignId}
      `;
      await runHandler(harness, purchase(), { paymentIntentId: pi });
      await expectCancelledPaused(pi);
      expect(await txRows(harness, `buyFor:${pi}:`)).toHaveLength(0);
    },
  );

  it("refuses once sales are closed", async () => {
    const closed = await createLiveCampaign(harness, "closed");
    harness.books.set(closed.symbol, { asks: FRESH_ASKS, bids: BIDS });
    await runHandler(harness, createCloseSalesHandler(harness.deps()), {
      campaignId: closed.campaignId,
    });
    const pi = await buy(closed);
    await runHandler(harness, purchase(), { paymentIntentId: pi });
    await expectCancelledPaused(pi);
    expect(await txRows(harness, `buyFor:${pi}:`)).toHaveLength(0);
  });

  it("cancels when the escrow refuses because the campaign was paused meanwhile", async () => {
    const raced = await createLiveCampaign(harness, "raced");
    harness.books.set(raced.symbol, { asks: FRESH_ASKS, bids: BIDS });
    // Paused on-chain (through the engine's own sender, the only user of the relayer key), then
    // the database is put back as it was before it heard of the pause.
    await runHandler(harness, createSetPausedHandler(harness.deps()), {
      campaignId: raced.campaignId,
      paused: true,
      requestId: randomUUID(),
    });
    expect((await getCampaign(harness, raced.onchainId)).status).toBe(1);
    await harness.db`
      update campaigns set status = 'live', sale_state = 'open' where id = ${raced.campaignId}
    `;
    const pi = await buy(raced);
    await runHandler(harness, purchase(), { paymentIntentId: pi });
    await expectCancelledPaused(pi);
    const rows = await txRows(harness, `buyFor:${pi}:`);
    expect(rows.map((tx) => [tx.status, tx.last_error])).toEqual([["failed", "SalesArePaused"]]);
  });
});

describe("purchase job: retries and failures", () => {
  it("quotes again after a quote expired before buyFor ran, and succeeds", async () => {
    harness.books.set(campaign.symbol, { asks: FRESH_ASKS, bids: BIDS });
    const pi = await buy(campaign);
    // The handler's clock is two minutes behind the chain until the first buyFor is queued: that
    // quote is already expired when the escrow checks it.
    harness.clock.skewMs = -120_000;
    const sender: Pick<TxSender, "enqueue" | "waitFor"> = {
      enqueue: async (request) => {
        const result = await harness.sender.enqueue(request);
        harness.clock.skewMs = 0;
        return result;
      },
      waitFor: (id, options) => harness.sender.waitFor(id, options),
    };
    await runHandler(harness, purchase({}, sender), { paymentIntentId: pi });

    const rows = await txRows(harness, `buyFor:${pi}:`);
    expect(rows.map((tx) => [tx.idempotency_key, tx.status, tx.last_error])).toEqual([
      [`buyFor:${pi}:1`, "failed", "QuoteExpired"],
      [`buyFor:${pi}:2`, "mined", null],
    ]);
    expect((await paymentRow(pi)).status).toBe("ticketed");
    expect(harness.gateway.effectsOf(pi)).toEqual({ captures: 1, cancels: 0, refunds: 0 });
  });

  it("gives up with a cancellation after three expired quotes", async () => {
    harness.books.set(campaign.symbol, { asks: FRESH_ASKS, bids: BIDS });
    const pi = await buy(campaign);
    harness.clock.skewMs = -120_000;
    await runHandler(harness, purchase(), { paymentIntentId: pi });

    const rows = await txRows(harness, `buyFor:${pi}:`);
    expect(rows.map((tx) => [tx.idempotency_key, tx.last_error])).toEqual([
      [`buyFor:${pi}:1`, "QuoteExpired"],
      [`buyFor:${pi}:2`, "QuoteExpired"],
      [`buyFor:${pi}:3`, "QuoteExpired"],
    ]);
    await expectCancelledPaused(pi);
    // A later delivery changes nothing.
    harness.clock.skewMs = 0;
    await runHandler(harness, purchase(), { paymentIntentId: pi });
    expect(await txRows(harness, `buyFor:${pi}:`)).toHaveLength(3);
    expect(harness.gateway.effectsOf(pi).cancels).toBe(1);
  });

  it("waits out a node outage and ends with one ticket and one capture, never a cancellation", async () => {
    harness.books.set(campaign.symbol, { asks: FRESH_ASKS, bids: BIDS });
    const pi = await buy(campaign);
    harness.outage.active = true;
    await expect(
      runHandler(harness, purchase({ waitTimeoutMs: 1_500 }), { paymentIntentId: pi }),
    ).rejects.toBeInstanceOf(RetryLaterError);
    expect((await paymentRow(pi)).status).toBe("processing");
    expect(harness.gateway.callsOf(pi, "cancel")).toHaveLength(0);
    expect((await txRows(harness, `buyFor:${pi}:`)).map((tx) => tx.status)).toEqual(["sent"]);

    // Still down: the retry waits again, and still does not cancel.
    await expect(
      runHandler(harness, purchase({ waitTimeoutMs: 500 }), { paymentIntentId: pi }),
    ).rejects.toBeInstanceOf(RetryLaterError);
    expect(harness.gateway.callsOf(pi, "cancel")).toHaveLength(0);

    harness.outage.active = false;
    await runHandler(harness, purchase(), { paymentIntentId: pi });
    expect((await paymentRow(pi)).status).toBe("ticketed");
    expect(await ticketsOf(pi)).toHaveLength(1);
    expect(await txRows(harness, `buyFor:${pi}:`)).toHaveLength(1);
    expect(harness.gateway.effectsOf(pi)).toEqual({ captures: 1, cancels: 0, refunds: 0 });
  });

  it("gives the job back when it is interrupted while waiting, and stops polling", async () => {
    harness.books.set(campaign.symbol, { asks: FRESH_ASKS, bids: BIDS });
    const pi = await buy(campaign);
    const waits: { timeoutMs: number; startedAt: number }[] = [];
    const sender: Pick<TxSender, "enqueue" | "waitFor"> = {
      enqueue: (request) => harness.sender.enqueue(request),
      waitFor: (id, options) => {
        waits.push({ timeoutMs: options.timeoutMs, startedAt: Date.now() });
        return harness.sender.waitFor(id, options);
      },
    };
    harness.outage.active = true;
    const controller = new AbortController();
    await harness.clock.sync(harness.escrow);
    const running = purchase({ waitTimeoutMs: 20_000, waitSliceMs: 200 }, sender)(
      { paymentIntentId: pi },
      { jobId: randomUUID(), attempt: 1, signal: controller.signal },
    );
    const outcome = running.then(
      () => "resolved",
      (error: unknown) => error,
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(waits.length).toBeGreaterThan(0);
    const abortedAt = Date.now();
    controller.abort(new JobAbortedError("worker-stopping", "the worker is stopping"));

    expect(await outcome).toBeInstanceOf(JobAbortedError);
    // Every wait was a short slice, and none started after the abort.
    for (const wait of waits) expect(wait.timeoutMs).toBeLessThanOrEqual(200);
    const count = waits.length;
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(waits.length).toBe(count);
    expect(waits.every((wait) => wait.startedAt <= abortedAt)).toBe(true);
    // Nothing was decided on the unknown outcome.
    expect((await paymentRow(pi)).status).toBe("processing");
    expect(harness.gateway.callsOf(pi, "cancel")).toHaveLength(0);

    // The job comes back once the node is reachable and finishes the same transaction.
    harness.outage.active = false;
    await runHandler(harness, purchase(), { paymentIntentId: pi });
    expect((await paymentRow(pi)).status).toBe("ticketed");
    expect(await txRows(harness, `buyFor:${pi}:`)).toHaveLength(1);
    expect(harness.gateway.effectsOf(pi)).toEqual({ captures: 1, cancels: 0, refunds: 0 });
  });

  it("captures once when the capture fails for now and then succeeds", async () => {
    harness.books.set(campaign.symbol, { asks: FRESH_ASKS, bids: BIDS });
    const pi = await buy(campaign);
    harness.gateway.failNext("capture", transientGatewayError());
    await expect(runHandler(harness, purchase(), { paymentIntentId: pi })).rejects.toBeInstanceOf(
      RetryLaterError,
    );
    const pending = await paymentRow(pi);
    expect(pending.status).toBe("processing");
    expect(pending.ticket_id).not.toBeNull();
    const [first] = await ticketsOf(pi);

    await runHandler(harness, purchase(), { paymentIntentId: pi });
    expect((await paymentRow(pi)).status).toBe("ticketed");
    const [second] = await ticketsOf(pi);
    // The access token set by the first run is kept.
    expect(second?.access_token).toBe(first?.access_token);
    expect(harness.gateway.callsOf(pi, "capture")).toHaveLength(2);
    expect(harness.gateway.effectsOf(pi)).toEqual({ captures: 1, cancels: 0, refunds: 0 });
    expect(await txRows(harness, `buyFor:${pi}:`)).toHaveLength(1);
  });

  it("keeps the ticket, fails the payment and logs an error when the capture can never succeed", async () => {
    harness.books.set(campaign.symbol, { asks: FRESH_ASKS, bids: BIDS });
    const pi = await buy(campaign);
    harness.gateway.failNext("capture", permanentGatewayError());
    await runHandler(harness, purchase(), { paymentIntentId: pi });

    const payment = await paymentRow(pi);
    expect(payment.status).toBe("failed");
    expect(payment.message).toBe(PURCHASE_MESSAGES.captureFailed);
    expect(payment.ticket_id).not.toBeNull();
    expect(await ticketsOf(pi)).toHaveLength(1);
    expect(harness.gateway.effectsOf(pi)).toEqual({ captures: 0, cancels: 0, refunds: 0 });
    const errors = logsAt(harness, 50, "capture failed for good").filter(
      (entry) => entry.paymentIntentId === pi,
    );
    expect(errors).toHaveLength(1);
  });

  it.each([
    ["amount", { amount: 6n * USDC }],
    ["quantity", { qty: "2" }],
    ["campaign", { campaignId: "00000000-0000-4000-8000-000000000000" }],
  ])("refuses and cancels a PaymentIntent whose %s does not match", async (_what, intent) => {
    harness.books.set(campaign.symbol, { asks: FRESH_ASKS, bids: BIDS });
    const pi = await buy(campaign, { intent });
    await expect(runHandler(harness, purchase(), { paymentIntentId: pi })).rejects.toBeInstanceOf(
      PermanentJobError,
    );
    const payment = await paymentRow(pi);
    expect(payment.status).toBe("failed");
    expect(payment.message).toBe(PURCHASE_MESSAGES.failed);
    expect(harness.gateway.effectsOf(pi)).toEqual({ captures: 0, cancels: 1, refunds: 0 });
    expect(await txRows(harness, `buyFor:${pi}:`)).toHaveLength(0);
  });
});

describe("purchase job: the buyer", () => {
  it("resolves '  Maya@Example.com ' and 'maya@example.com' to one wallet and one user", async () => {
    const other = await createLiveCampaign(harness, "maya");
    harness.books.set(campaign.symbol, { asks: FRESH_ASKS, bids: BIDS });
    harness.books.set(other.symbol, { asks: FRESH_ASKS, bids: BIDS });
    emails.add("maya@example.com");
    emails.add("  Maya@Example.com ");
    const first = await buy(campaign, { email: null, payerEmail: "  Maya@Example.com " });
    const second = await buy(other, { email: "maya@example.com" });

    await runHandler(harness, purchase(), { paymentIntentId: first });
    await runHandler(harness, purchase(), { paymentIntentId: second });

    const a = await paymentRow(first);
    const b = await paymentRow(second);
    expect(a.status).toBe("ticketed");
    expect(b.status).toBe("ticketed");
    expect(a.buyer).not.toBeNull();
    expect(a.buyer).toBe(b.buyer);
    const users = await harness.db<{ email: string; wallet: string | null; roles: string[] }[]>`
      select email, wallet, roles from users where lower(email) like '%maya%'
    `;
    expect(users).toEqual([{ email: "maya@example.com", wallet: a.buyer, roles: ["fan"] }]);
    const [stored] = await harness.db<{ email: string | null }[]>`
      select email from payments where stripe_pi = ${first}
    `;
    expect(stored?.email).toBe("maya@example.com");
    expect(harness.identity.lookups.filter((email) => email.includes("aya"))).toEqual([
      "maya@example.com",
    ]);
    const onchain = (await onchainTickets(harness)).filter(
      (ticket) => ticket.buyer === checksum(a.buyer ?? ""),
    );
    expect(onchain.map((ticket) => ticket.campaignId).sort()).toEqual(
      [campaign.onchainId, other.onchainId].sort(),
    );
  });

  it("never logs an e-mail", () => {
    const text = allLogText(harness).toLowerCase();
    expect(harness.logs.length).toBeGreaterThan(0);
    for (const email of emails) expect(text).not.toContain(email.trim().toLowerCase());
  });
});
