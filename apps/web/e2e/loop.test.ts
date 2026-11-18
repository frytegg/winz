import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { startAnvil, type AnvilInstance } from "../../engine/src/testing/anvil";
import { api, apiRefusal } from "./support/api";
import {
  buy,
  customerEmail,
  launchCampaign,
  signUpMerchant,
  waitTicketed,
  type Purchase,
} from "./support/flows";
import { MICRO } from "./support/gemini";
import {
  countFor,
  deskInstrument,
  enginePnl,
  expectEachCapturedOnce,
  expectRefunded,
  fillsCost,
  hedgeCharges,
  hedgeFills,
  makerSavingsOf,
  soldTickets,
} from "./support/ledger";
import {
  QUIET_BOOK,
  closeSales,
  expectReport,
  expectGuaranteesCapped,
  expectYesLedger,
  fillRestingMaker,
  sum,
  waitSettled,
} from "./support/steps";
import { createWorld, onchainCampaign, tokenBalance, type World } from "./support/world";

/**
 * The whole loop on a local chain (SPEC section 15, success criteria of section 14): the web app's
 * route handlers, the engine as one process and the real WinzEscrow, with Gemini and Stripe
 * simulated. Scenarios A (outcome YES, with the latency measure G), B (outcome NO) and F (two
 * merchants on one game).
 */

process.env.APP_LOG_LEVEL ??= "warn";

const SCENARIO_TIMEOUT_MS = 120_000;

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

/** When `condition` first held (wall clock, ms), polling every 20 ms for at most 10 s. */
async function firstSeen(what: string, condition: () => Promise<boolean>): Promise<number> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    if (await condition()) return Date.now();
    if (Date.now() >= deadline) throw new Error(`${what}: not seen within 10 s`);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

async function open(): Promise<World> {
  world = await createWorld(anvil);
  return world;
}

describe("the nominal loop", () => {
  it(
    "A + G: a promo sells, is hedged, closes and settles YES; every unit of money adds up",
    { timeout: SCENARIO_TIMEOUT_MS },
    async () => {
      const w = await open();
      const symbol = w.game.away.symbol;
      w.gemini.setBook(symbol, QUIET_BOOK);
      const treasury = w.escrow.accounts.treasury.address;
      const treasuryBefore = await tokenBalance(w, treasury);

      // The merchant signs in, previews and creates the promo, pays its budget.
      const merchant = await signUpMerchant(w, "Joe's Pizza", "pizza");
      const campaign = await launchCampaign(w, merchant, symbol);
      const budget = campaign.terms.budget;
      const page = await api.publicCampaign(campaign.slug);
      expect(page).toMatchObject({ saleState: "open", demo: false, outcome: null });
      expect(page.probabilityBps).toBe(1100);
      const created = await onchainCampaign(w, campaign.onchainId);
      expect(created).toMatchObject({
        merchant: merchant.wallet,
        hedgeBudget: budget,
        unitPrice: campaign.terms.unitPrice,
        refundBps: campaign.terms.refundBps,
        status: 0,
      });
      expect(await tokenBalance(w, w.escrow.escrow)).toBe(budget);
      const budgetIntent = w.stripe.intent(campaign.budgetPi);
      expect(budgetIntent).toMatchObject({ status: "succeeded", captures: 1, amount: budget });

      // First customer. G: from the confirmation to what the customer and the merchant see.
      const first = await buy(w, campaign.slug, 1, customerEmail("ann"));
      // Two pollers, every 20 ms, as the checkout page and the dashboard would.
      const [ticketedAtMs, dashboardAtMs] = await Promise.all([
        firstSeen("the checkout to answer ticketed", async () => {
          return (await api.checkoutStatus(first.pi)).status === "ticketed";
        }),
        firstSeen("the sale on the merchant's detail", async () => {
          return (await api.campaign(merchant.headers, campaign.id)).sales === 1;
        }),
      ]);
      const ticketedMs = ticketedAtMs - first.confirmedAtMs;
      const dashboardMs = dashboardAtMs - first.confirmedAtMs;
      process.stdout.write(
        `[e2e latency] confirmation → checkout ticketed: ${ticketedMs.toString()} ms; ` +
          `confirmation → sale on the merchant's detail: ${dashboardMs.toString()} ms\n`,
      );
      expect(ticketedMs).toBeLessThan(10_000);
      expect(dashboardMs).toBeLessThan(10_000);

      const firstToken = await waitTicketed(w, first.pi);
      const firstTicket = await api.ticket(firstToken);
      expect(firstTicket).toMatchObject({
        campaignSlug: campaign.slug,
        qty: 1,
        paid: "20000000",
        refundable: "20000000",
        phase: "pre_game",
        demo: false,
      });
      expect(w.stripe.intent(first.pi).captures).toBe(1);

      // The exposure on the desk, a maker resting on the paper venue, a book that fills it.
      await w.waitFor("the exposure of the sale on the Hedge desk", async () => {
        const row = await deskInstrument(symbol);
        return { ok: row?.exposure === (20n * MICRO).toString(), seen: row };
      });
      await fillRestingMaker(w, campaign, 1);
      const [ticket1] = await soldTickets(w, campaign.onchainId);
      const [charge1] = await hedgeCharges(w, campaign.onchainId);
      if (ticket1 === undefined || charge1 === undefined) throw new Error("first sale missing");
      expect(charge1.ticketId).toBe(ticket1.ticketId);
      expect(charge1.amount).toBeGreaterThan(0n);
      expect(charge1.amount).toBeLessThanOrEqual(ticket1.maxHedgeCost);
      await w.waitFor("the hedge cost on the merchant's detail", async () => {
        const detail = await api.campaign(merchant.headers, campaign.id);
        return {
          ok: detail.sales === 1 && detail.hedgeSpent === charge1.amount.toString(),
          seen: detail,
        };
      });

      // Two more customers, one of them buying three units.
      const second = await buy(w, campaign.slug, 1, customerEmail("bob"));
      const third = await buy(w, campaign.slug, 3, customerEmail("cyd"));
      const purchases: Purchase[] = [first, second, third];
      await waitTicketed(w, second.pi);
      const thirdToken = await waitTicketed(w, third.pi);
      expect((await api.ticket(thirdToken)).qty).toBe(3);
      await fillRestingMaker(w, campaign, 3);

      // Sales close: the position is reconciled and nothing stays reserved on-chain.
      await closeSales(w, campaign);
      await w.waitFor("the hedge reservation back to zero", async () => {
        const onchain = await onchainCampaign(w, campaign.onchainId);
        return { ok: onchain.hedgeReserved === 0n, seen: onchain };
      });

      // The game ends YES.
      w.gemini.settle({ home: "no", away: "yes" });
      await waitSettled(w, campaign, "yes");

      const tickets = await soldTickets(w, campaign.onchainId);
      expect(tickets.map((ticket) => ticket.qty).sort()).toEqual([1, 1, 3]);
      const charges = await hedgeCharges(w, campaign.onchainId);
      await expectYesLedger(w, campaign, tickets, charges, treasury, treasuryBefore);

      for (const purchase of purchases) {
        const token = await waitTicketed(w, purchase.pi);
        const shown = await api.ticket(token);
        expect(shown.phase).toBe("refunded");
        expect(shown.refundedAt).not.toBeNull();
      }
      const detail = await api.campaign(merchant.headers, campaign.id);
      expectReport(detail, tickets, charges, "yes");
      expectEachCapturedOnce(w, purchases);
      // Stripe holds the budget payment and these three purchases, nothing else.
      expect([...w.stripe.intents.keys()].sort()).toEqual(
        [campaign.budgetPi, ...purchases.map((purchase) => purchase.pi)].sort(),
      );

      // The platform's result: what was charged plus what the platform paid above the
      // guarantees is exactly what the fills cost; the maker savings are recomputed from them.
      const fills = await hedgeFills(w, symbol);
      expect(fills.length).toBeGreaterThan(0);
      const pnl = await enginePnl(w);
      const charged = sum(charges.map((charge) => charge.amount));
      expect(charged + pnl.guaranteeLosses).toBe(fillsCost(fills));
      expect(pnl.makerSavings).toBe(makerSavingsOf(fills));
      expect(pnl.makerSavings).toBeGreaterThan(0n);
      const desk = await api.hedgeDesk();
      expect(desk.totals.makerSavings).toBe(pnl.makerSavings.toString());
      expect(desk.totals.guaranteeLosses).toBe(pnl.guaranteeLosses.toString());
      expect(desk.demo).toBe(false);
    },
  );

  it(
    "B: the same loop with outcome NO: no refund, the merchant keeps everything left",
    { timeout: SCENARIO_TIMEOUT_MS },
    async () => {
      const w = await open();
      const symbol = w.game.away.symbol;
      w.gemini.setBook(symbol, QUIET_BOOK);
      const treasury = w.escrow.accounts.treasury.address;
      const treasuryBefore = await tokenBalance(w, treasury);
      const merchant = await signUpMerchant(w, "Ann's Bar");
      const campaign = await launchCampaign(w, merchant, symbol);
      const purchases = [
        await buy(w, campaign.slug, 1, customerEmail("dan")),
        await buy(w, campaign.slug, 2, customerEmail("eve")),
      ];
      for (const purchase of purchases) await waitTicketed(w, purchase.pi);
      await fillRestingMaker(w, campaign, 2);
      await closeSales(w, campaign);

      w.gemini.settle({ home: "yes", away: "no" });
      await waitSettled(w, campaign, "no");

      const tickets = await soldTickets(w, campaign.onchainId);
      const charges = await hedgeCharges(w, campaign.onchainId);
      const spent = sum(charges.map((charge) => charge.amount));
      const paid = sum(tickets.map((ticket) => ticket.paid));
      expectGuaranteesCapped(campaign, tickets);
      // No refund: the buyers' wallets hold nothing, every ticket shows lost.
      expect(await countFor(w, "TicketRefunded", campaign.onchainId)).toBe(0);
      for (const ticket of tickets) expect(await tokenBalance(w, ticket.buyer)).toBe(0n);
      for (const purchase of purchases) {
        const shown = await api.ticket(await waitTicketed(w, purchase.pi));
        expect(shown.phase).toBe("not_this_time");
        expect(shown.refundedAt).toBeNull();
      }
      // The escrowed amounts and the unspent budget went to the merchant.
      const budget = campaign.terms.budget;
      expect(await tokenBalance(w, merchant.wallet)).toBe(paid + budget - spent);
      expect(await tokenBalance(w, w.escrow.escrow)).toBe(0n);
      expect(treasuryBefore - (await tokenBalance(w, treasury))).toBe(budget + paid - spent);
      const settled = await onchainCampaign(w, campaign.onchainId);
      expect(settled).toMatchObject({ status: 3, merchantDue: 0n, released: true });
      expect(await countFor(w, "MerchantPaid", campaign.onchainId)).toBe(0);
      expectReport(await api.campaign(merchant.headers, campaign.id), tickets, charges, "no");
      expectEachCapturedOnce(w, purchases);
    },
  );
});

describe("two merchants on the same game", () => {
  it(
    "F: each budget pays only for its own tickets, each campaign settles on its own",
    { timeout: SCENARIO_TIMEOUT_MS },
    async () => {
      const w = await open();
      const symbol = w.game.away.symbol;
      w.gemini.setBook(symbol, QUIET_BOOK);
      const joe = await signUpMerchant(w, "Joe's Pizza", "pizza");
      const ann = await signUpMerchant(w, "Ann's Bar", "bar");
      const joes = await launchCampaign(w, joe, symbol);
      const anns = await launchCampaign(w, ann, symbol, {
        terms: { ...joes.terms, unitPrice: 10_000_000n, budget: 100_000_000n },
        product: "Two beers",
      });

      const forJoe = await buy(w, joes.slug, 2, customerEmail("fay"));
      await waitTicketed(w, forJoe.pi);
      await fillRestingMaker(w, joes, 1);
      const forAnn = await buy(w, anns.slug, 1, customerEmail("gus"));
      await waitTicketed(w, forAnn.pi);
      await fillRestingMaker(w, anns, 1);

      await closeSales(w, joes);
      w.gemini.settle({ home: "no", away: "yes" });
      await waitSettled(w, joes, "yes");
      await waitSettled(w, anns, "yes");

      for (const campaign of [joes, anns]) {
        const tickets = await soldTickets(w, campaign.onchainId);
        const charges = await hedgeCharges(w, campaign.onchainId);
        expect(tickets).toHaveLength(1);
        expectGuaranteesCapped(campaign, tickets);
        expect(charges.map((charge) => charge.ticketId)).toEqual(
          tickets.map((ticket) => ticket.ticketId),
        );
        const onchain = await onchainCampaign(w, campaign.onchainId);
        // Each budget was charged for its own ticket only.
        expect(onchain.hedgeSpent).toBe(sum(charges.map((charge) => charge.amount)));
        expect(await countFor(w, "CampaignSettled", campaign.onchainId)).toBe(1);
        const detail = await api.campaign(campaign.merchant.headers, campaign.id);
        expect(detail.hedgeSpent).toBe(onchain.hedgeSpent.toString());
        expect(detail.sales).toBe(tickets[0]?.qty);
        // The merchant got its refunds' worth and its unspent budget, nothing of the other's.
        const refundable = sum(tickets.map((ticket) => ticket.refundable));
        expect(await tokenBalance(w, campaign.merchant.wallet)).toBe(
          refundable + campaign.terms.budget - onchain.hedgeSpent,
        );
        await expectRefunded(w, tickets);
      }
      expect(await tokenBalance(w, w.escrow.escrow)).toBe(0n);
      // Neither merchant sees the other's campaign.
      const refusal = await apiRefusal(() => api.campaign(ann.headers, joes.id));
      expect(refusal.status).toBe(404);
      expectEachCapturedOnce(w, [forJoe, forAnn]);
    },
  );
});
