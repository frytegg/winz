import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Outcome } from "@winz/shared";

import { startAnvil, type AnvilInstance } from "../../engine/src/testing/anvil";
import { api } from "./support/api";
import {
  customerEmail,
  launchCampaign,
  signUpMerchant,
  waitSaleState,
  waitTicketPhase,
  type LiveCampaign,
  type MerchantSession,
} from "./support/flows";
import { MICRO } from "./support/gemini";
import {
  countFor,
  deskInstrument,
  expectRefunded,
  hedgeCharges,
  soldTickets,
  type SoldTicket,
} from "./support/ledger";
import { closeSales, expectGuaranteesCapped, sum, waitOpen, waitSettled } from "./support/steps";
import { createWorld, onchainCampaign, tokenBalance, type World } from "./support/world";

/**
 * The demo replayed twice on the same game and the same contract, on one engine, as an operator
 * does before a jury (SPEC MDB-4, HE-1 to HE-6): campaign A is driven, sold, hedged, closed by its
 * merchant, forced YES and settled with its refund, and the demo is reset; then campaign B, by the
 * same merchant on the same instrument, is sold, hedged for its own exposure (the contracts that
 * hedged A were paid out and are no longer held), closed at the game's sales close, forced NO and
 * settled. Then the same with the engine restarted between A and B.
 */

process.env.APP_LOG_LEVEL ??= "warn";

const SCENARIO_TIMEOUT_MS = 180_000;
/** The driven book: the favourite's real book is empty, the admin drives it at 10–12 %. */
const DEMO_BOOK = { bidBps: 1000, askBps: 1200 };
const DEPTH = (500n * MICRO).toString();

let anvil: AnvilInstance;
let world: World | undefined;

beforeAll(async () => {
  anvil = await startAnvil();
});
afterAll(async () => {
  await anvil?.stop();
});
afterEach(async () => {
  await world?.close();
  world = undefined;
});

async function driveBook(symbol: string, book: { bidBps: number; askBps: number }): Promise<void> {
  const answer = await api.demoBook({ instrumentSymbol: symbol, ...book, depth: DEPTH });
  expect(answer.demo).toBe(true);
}

/**
 * Hedges the campaign's sales on the driven book: each maker the engine rests (read from the
 * Hedge desk) is filled by bringing the demo ask down to its price, then the book goes back to
 * quiet; until `charges` tickets of the campaign are charged on-chain. The demo book stands in for
 * the market here, as the Gemini book does in `fillRestingMaker`.
 */
async function fillDemoMaker(w: World, campaign: LiveCampaign, charges: number): Promise<void> {
  for (let round = 0; ; round += 1) {
    let maker: { id: string; priceBps: number } | null = null;
    let charged = 0;
    await w.waitFor(
      `a resting maker order, or ${charges.toString()} tickets charged on-chain`,
      async () => {
        charged = (await hedgeCharges(w, campaign.onchainId)).length;
        const row = await deskInstrument(campaign.symbol);
        const working = row?.orders.find(
          (order) => order.kind === "maker" && order.side === "buy" && order.status === "working",
        );
        maker = working === undefined ? null : { id: working.id, priceBps: working.priceBps };
        return { ok: charged >= charges || maker !== null, seen: { charged, desk: row } };
      },
    );
    if (charged >= charges) break;
    const resting = maker as { id: string; priceBps: number } | null;
    if (resting === null || round >= 5) {
      throw new Error(`no maker left to fill and only ${charged.toString()} tickets charged`);
    }
    await driveBook(campaign.symbol, {
      bidBps: Math.min(DEMO_BOOK.bidBps, resting.priceBps - 100),
      askBps: resting.priceBps,
    });
    await w.waitFor(`the maker ${resting.id} filled`, async () => {
      const row = await deskInstrument(campaign.symbol);
      const order = row?.orders.find((item) => item.id === resting.id);
      return { ok: order?.status === "filled", seen: order };
    });
    await driveBook(campaign.symbol, DEMO_BOOK);
  }
  await w.waitFor(`exactly ${charges.toString()} tickets charged on-chain`, async () => {
    const charged = await hedgeCharges(w, campaign.onchainId);
    return { ok: charged.length === charges, seen: charged };
  });
}

/**
 * A sale replayed without a card, then the Hedge desk shows the engine hedging this campaign's
 * exposure: E is what the campaign sold (nothing else is owed on the instrument), H starts at zero
 * (nothing held from an earlier campaign), and a maker rests for the whole of it.
 */
async function replaySaleAndSeeItHedged(
  w: World,
  campaign: LiveCampaign,
  qty: number,
  name: string,
): Promise<{ token: string; exposure: bigint }> {
  const sale = await api.demoSale({ slug: campaign.slug, qty, email: customerEmail(name) });
  expect(sale.demo).toBe(true);
  expect(sale.paymentIntentId).toMatch(/^pi_demo_/);
  expect(
    sale.ticketToken,
    `the replayed sale's ticket (checkout ${JSON.stringify(
      await api.checkoutStatus(sale.paymentIntentId ?? ""),
    )}; engine: ${JSON.stringify(w.engineLogs.slice(-5).map((entry) => entry.msg))})`,
  ).not.toBeNull();
  const token = sale.ticketToken ?? "";
  // 100 % refundable: the exposure is the price of what was sold, one micro-contract a micro-USDC.
  const exposure = BigInt(qty) * campaign.terms.unitPrice;
  await w.waitFor(`the Hedge desk hedging ${name}'s exposure`, async () => {
    const row = await deskInstrument(campaign.symbol);
    const maker = row?.orders.find(
      (order) => order.kind === "maker" && order.side === "buy" && order.status === "working",
    );
    return {
      ok:
        row?.exposure === exposure.toString() &&
        row.held === "0" &&
        maker !== undefined &&
        maker.qty === exposure.toString(),
      seen: row,
    };
  });
  return { token, exposure };
}

/** The merchant's detail and the chain agree on a finished campaign. */
async function expectFinished(
  w: World,
  campaign: LiveCampaign,
  outcome: Outcome,
  tickets: readonly SoldTicket[],
  charges: readonly { ticketId: bigint; amount: bigint }[],
): Promise<void> {
  const spent = sum(charges.map((charge) => charge.amount));
  // One charge per ticket, never above its guarantee, the guarantee within the promo's cap.
  expect(charges.map((charge) => charge.ticketId).sort()).toEqual(
    tickets.map((ticket) => ticket.ticketId).sort(),
  );
  for (const ticket of tickets) {
    const charge = charges.find((item) => item.ticketId === ticket.ticketId);
    expect(charge?.amount ?? -1n).toBeLessThanOrEqual(ticket.maxHedgeCost);
  }
  expectGuaranteesCapped(campaign, tickets);
  expect(await countFor(w, "CampaignSettled", campaign.onchainId)).toBe(1);
  expect(await countFor(w, "TicketRefunded", campaign.onchainId)).toBe(
    outcome === "yes" ? tickets.length : 0,
  );
  expect(await countFor(w, "MerchantPaid", campaign.onchainId)).toBe(outcome === "yes" ? 1 : 0);
  expect(await countFor(w, "CampaignReleased", campaign.onchainId)).toBe(1);
  expect(await onchainCampaign(w, campaign.onchainId)).toMatchObject({
    status: outcome === "yes" ? 2 : 3,
    hedgeReserved: 0n,
    hedgeSpent: spent,
    lockedRefunds: 0n,
    merchantDue: 0n,
    released: true,
  });
  const detail = await api.campaign(campaign.merchant.headers, campaign.id);
  const refunds = sum(tickets.map((ticket) => ticket.refundable));
  expect(detail).toMatchObject({
    status: outcome === "yes" ? "settled_yes" : "settled_no",
    outcome,
    demo: true,
    hedgeSpent: spent.toString(),
    hedgeReserved: "0",
  });
  expect(detail.report).toMatchObject({
    hedgeCost: spent.toString(),
    refundsPaid: (outcome === "yes" ? refunds : 0n).toString(),
  });
}

interface Played {
  campaign: LiveCampaign;
  tickets: SoldTicket[];
  charges: { ticketId: bigint; amount: bigint }[];
}

/** Campaign A: driven book, replayed sale, maker filled, charged, closed by its merchant, YES. */
async function playA(w: World, merchant: MerchantSession, symbol: string): Promise<Played> {
  const campaign = await launchCampaign(w, merchant, symbol, { expectOpen: false });
  // Live on-chain, but the favourite's real book is empty: the engine pauses it until driven.
  await waitSaleState(w, campaign.slug, "paused_depth");
  await driveBook(symbol, DEMO_BOOK);
  await waitOpen(w, campaign.slug);
  const { token, exposure } = await replaySaleAndSeeItHedged(w, campaign, 2, "fan-a");
  expect(exposure).toBe(40n * MICRO);
  await fillDemoMaker(w, campaign, 1);
  const hedged = await deskInstrument(symbol);
  expect(hedged).toMatchObject({ exposure: exposure.toString(), held: exposure.toString() });

  // The merchant closes the promo early; the admin forces YES; it settles with its refund.
  const closed = await api.close(merchant.headers, campaign.id);
  expect(closed).toMatchObject({ saleState: "closed" });
  await w.waitFor("campaign A's sales closed on-chain", async () => {
    const detail = await api.campaign(merchant.headers, campaign.id);
    return { ok: detail.status === "sales_closed", seen: detail.status };
  });
  expect((await api.demoResult({ instrumentSymbol: symbol, outcome: "yes" })).demo).toBe(true);
  await waitSettled(w, campaign, "yes");
  const tickets = await soldTickets(w, campaign.onchainId);
  expect(tickets).toHaveLength(1);
  await expectRefunded(w, tickets);
  await waitTicketPhase(w, token, "refunded");
  const charges = await hedgeCharges(w, campaign.onchainId);
  await expectFinished(w, campaign, "yes", tickets, charges);

  // A's contracts were paid out: the engine no longer hedges the instrument nor holds anything.
  await w.waitFor("the instrument off the Hedge desk with nothing held", async () => {
    const [position] = await w.db<{ exposure: bigint; held: bigint }[]>`
      select exposure, held from positions where instrument = ${symbol}
    `;
    const row = await deskInstrument(symbol);
    return {
      ok: row === null && position?.exposure === 0n && position.held === 0n,
      seen: { position, desk: row },
    };
  });

  // The demo is reset for the next run.
  expect((await api.demoReset()).demo).toBe(true);
  expect((await api.hedgeDesk()).demo).toBe(false);
  return { campaign, tickets, charges };
}

/** Campaign B on the same instrument: replayed sale, hedged for its own exposure, sales close, NO. */
async function playB(w: World, merchant: MerchantSession, symbol: string): Promise<Played> {
  await driveBook(symbol, DEMO_BOOK);
  const campaign = await launchCampaign(w, merchant, symbol);
  await waitOpen(w, campaign.slug);
  const { exposure } = await replaySaleAndSeeItHedged(w, campaign, 1, "fan-b");
  expect(exposure).toBe(20n * MICRO);
  await fillDemoMaker(w, campaign, 1);
  const hedged = await deskInstrument(symbol);
  expect(hedged).toMatchObject({ exposure: exposure.toString(), held: exposure.toString() });

  await closeSales(w, campaign);
  expect((await api.demoResult({ instrumentSymbol: symbol, outcome: "no" })).demo).toBe(true);
  await waitSettled(w, campaign, "no");
  const tickets = await soldTickets(w, campaign.onchainId);
  expect(tickets).toHaveLength(1);
  for (const ticket of tickets) expect(await tokenBalance(w, ticket.buyer)).toBe(0n);
  const charges = await hedgeCharges(w, campaign.onchainId);
  await expectFinished(w, campaign, "no", tickets, charges);
  await w.waitFor("the instrument off the Hedge desk with nothing held", async () => {
    const [position] = await w.db<{ exposure: bigint; held: bigint }[]>`
      select exposure, held from positions where instrument = ${symbol}
    `;
    const row = await deskInstrument(symbol);
    return {
      ok: row === null && position?.exposure === 0n && position.held === 0n,
      seen: { position, desk: row },
    };
  });
  return { campaign, tickets, charges };
}

async function replayTwice(restartBetween: boolean): Promise<void> {
  const w = await createWorld(anvil);
  world = w;
  const symbol = w.game.home.symbol;
  const treasury = w.escrow.accounts.treasury.address;
  const treasuryBefore = await tokenBalance(w, treasury);
  const joe = await signUpMerchant(w, "Joe's Pizza", "pizza");

  const a = await playA(w, joe, symbol);
  if (restartBetween) await w.restartEngine();
  const b = await playB(w, joe, symbol);

  // The same game, the same contract on-chain, the same merchant.
  expect(b.campaign.symbol).toBe(a.campaign.symbol);
  const [onchainA, onchainB] = [
    await onchainCampaign(w, a.campaign.onchainId),
    await onchainCampaign(w, b.campaign.onchainId),
  ];
  expect(onchainB.instrument).toBe(onchainA.instrument);
  expect(onchainB.merchant).toBe(onchainA.merchant);
  expect(b.campaign.onchainId).not.toBe(a.campaign.onchainId);

  // Every fill went to its own campaign's lot, each paid once, never anything sold.
  const [hedge] = await w.db<{ sells: bigint; fills: bigint; lots: bigint; covered: bigint }[]>`
    select
      (select count(*) from orders where instrument = ${symbol} and side = 'sell')::bigint as sells,
      (select count(*) from fills f join orders o on o.id = f.order_id
        where o.instrument = ${symbol})::bigint as fills,
      (select count(*) from lots where instrument = ${symbol})::bigint as lots,
      (select count(*) from lots where instrument = ${symbol} and filled_qty = qty and charged)::bigint
        as covered
  `;
  expect(hedge).toEqual({ sells: 0n, fills: 2n, lots: 2n, covered: 2n });

  // The money: the escrow holds nothing for either campaign; nothing was created or lost.
  expect(await tokenBalance(w, w.escrow.escrow)).toBe(0n);
  const played = [a, b];
  const paid = sum(played.flatMap((run) => run.tickets.map((ticket) => ticket.paid)));
  const budgets = sum(played.map((run) => run.campaign.terms.budget));
  const spent = sum(played.flatMap((run) => run.charges.map((charge) => charge.amount)));
  const dueOnYes = sum(a.tickets.map((ticket) => ticket.refundable));
  // The merchant: every sale, its budgets back but for the hedge spent (YES or NO alike).
  expect(await tokenBalance(w, joe.wallet)).toBe(paid + budgets - spent);
  // The treasury fronted both budgets, every sale and A's due on YES; the hedge came back.
  const treasuryAfter = await tokenBalance(w, treasury);
  expect(treasuryBefore - treasuryAfter).toBe(budgets + paid + dueOnYes - spent);
  const buyers = sum(a.tickets.map((ticket) => ticket.refundable));
  expect(treasuryBefore - treasuryAfter).toBe(buyers + (await tokenBalance(w, joe.wallet)));
}

describe("the demo replayed on the same game", () => {
  it(
    "R: A settles YES and the demo is reset, then B on the same contract is hedged, charged and settles NO",
    { timeout: SCENARIO_TIMEOUT_MS },
    async () => {
      await replayTwice(false);
    },
  );

  it(
    "R': the same with the engine restarted between A and B",
    { timeout: SCENARIO_TIMEOUT_MS },
    async () => {
      await replayTwice(true);
    },
  );
});
