import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { startAnvil, type AnvilInstance } from "../../engine/src/testing/anvil";
import { api } from "./support/api";
import {
  buy,
  customerEmail,
  launchCampaign,
  signUpMerchant,
  waitSaleState,
  waitTicketed,
  type LiveCampaign,
} from "./support/flows";
import { expectGuaranteesCapped, waitOpen } from "./support/steps";
import { MICRO } from "./support/gemini";
import { countFor, expectRefunded, hedgeCharges, soldTickets } from "./support/ledger";
import { createWorld, onchainCampaign, tokenBalance, type World } from "./support/world";

/**
 * The demo mode (SPEC MDB-4), end to end: on an instrument whose real book is empty, the admin
 * drives the book, replays a sale without a card, forces the result; sales close and the campaign
 * settles YES with the refund on-chain. The replayed payment never reaches Stripe. Every answer
 * about that campaign says `demo` from the first demo action on, for good; the Hedge desk says it
 * only while overrides exist; a campaign no demo action touched never says it.
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

/** Every answer that carries `demo` for this campaign, from the merchant's and the public side. */
async function demoFlags(campaign: LiveCampaign, tokens: readonly string[]): Promise<boolean[]> {
  const flags = [
    (await api.campaign(campaign.merchant.headers, campaign.id)).demo,
    (await api.publicCampaign(campaign.slug)).demo,
  ];
  for (const token of tokens) flags.push((await api.ticket(token)).demo);
  return flags;
}

describe("demo mode", () => {
  it(
    "D: the admin drives the book, replays a sale, forces the result; the campaign settles YES",
    { timeout: SCENARIO_TIMEOUT_MS },
    async () => {
      const w = await createWorld(anvil);
      world = w;
      const demoSymbol = w.game.home.symbol;
      const realSymbol = w.game.away.symbol;
      // Gemini has a book for the underdog only: the favourite's real book is empty.
      w.gemini.setBook(realSymbol, { bidBps: 1000, askBps: 1200 });

      // A real promo, never touched by a demo action, with a real checkout.
      const ann = await signUpMerchant(w, "Ann's Bar", "bar");
      const real = await launchCampaign(w, ann, realSymbol);
      const realPurchase = await buy(w, real.slug, 1, customerEmail("ray"));
      const realToken = await waitTicketed(w, realPurchase.pi);
      expect(await demoFlags(real, [realToken])).toEqual([false, false, false]);

      // The demo promo: live on-chain, but it cannot sell without a book.
      const joe = await signUpMerchant(w, "Joe's Pizza", "pizza");
      const demo = await launchCampaign(w, joe, demoSymbol, { expectOpen: false });
      await waitSaleState(w, demo.slug, "paused_depth");
      expect(await demoFlags(demo, [])).toEqual([false, false]);
      expect((await api.hedgeDesk()).demo).toBe(false);

      // First demo action: the book.
      const bookAnswer = await api.demoBook({
        instrumentSymbol: demoSymbol,
        bidBps: 1000,
        askBps: 1200,
        depth: (500n * MICRO).toString(),
      });
      expect(bookAnswer).toEqual({
        ok: true,
        demo: true,
        ticketToken: null,
        paymentIntentId: null,
      });
      expect(await demoFlags(demo, [])).toEqual([true, true]);
      expect((await api.hedgeDesk()).demo).toBe(true);
      expect(await demoFlags(real, [realToken])).toEqual([false, false, false]);
      await waitOpen(w, demo.slug);
      expect((await api.publicCampaign(demo.slug)).probabilityBps).toBe(1100);

      // A sale replayed without a card: the ticket token comes back in the answer.
      const stripeCallsBefore = w.stripe.calls.length;
      const email = customerEmail("demo-fan");
      const sale = await api.demoSale({ slug: demo.slug, qty: 2, email });
      expect(sale.demo).toBe(true);
      expect(sale.paymentIntentId).toMatch(/^pi_demo_/);
      expect(sale.ticketToken).not.toBeNull();
      const demoToken = sale.ticketToken ?? "";
      const demoPi = sale.paymentIntentId ?? "";
      expect(await api.checkoutStatus(demoPi)).toEqual({
        status: "ticketed",
        ticketToken: demoToken,
        message: null,
      });
      expect(await api.ticket(demoToken)).toMatchObject({ qty: 2, paid: "40000000", demo: true });
      expect(await demoFlags(demo, [demoToken])).toEqual([true, true, true]);

      // The forced result.
      const resultAnswer = await api.demoResult({ instrumentSymbol: demoSymbol, outcome: "yes" });
      expect(resultAnswer.demo).toBe(true);
      expect(await demoFlags(demo, [demoToken])).toEqual([true, true, true]);
      expect(await demoFlags(real, [realToken])).toEqual([false, false, false]);

      // Sales close; the demo campaign settles YES with the refund on-chain.
      await w.advance(Math.ceil((w.game.salesCloseAt.getTime() - w.clock.now()) / 1000) + 30);
      await w.waitFor(
        "the demo campaign settled YES and finished",
        async () => {
          const onchain = await onchainCampaign(w, demo.onchainId);
          const detail = await api.campaign(joe.headers, demo.id);
          return {
            ok:
              detail.status === "settled_yes" &&
              onchain.released &&
              onchain.merchantDue === 0n &&
              onchain.lockedRefunds === 0n,
            seen: { status: detail.status, onchain },
          };
        },
        60_000,
      );
      const tickets = await soldTickets(w, demo.onchainId);
      expect(tickets).toHaveLength(1);
      expect(tickets[0]?.refundable).toBe(40_000_000n);
      await expectRefunded(w, tickets);
      expect(await countFor(w, "CampaignSettled", demo.onchainId)).toBe(1);
      expect(await countFor(w, "TicketRefunded", demo.onchainId)).toBe(1);
      const charges = await hedgeCharges(w, demo.onchainId);
      expect(charges).toHaveLength(1);
      expect(charges[0]?.amount ?? -1n).toBeLessThanOrEqual(tickets[0]?.maxHedgeCost ?? 0n);
      expectGuaranteesCapped(demo, tickets);
      const spent = charges[0]?.amount ?? 0n;
      expect(await tokenBalance(w, joe.wallet)).toBe(40_000_000n + demo.terms.budget - spent);
      expect((await api.ticket(demoToken)).phase).toBe("refunded");
      const detail = await api.campaign(joe.headers, demo.id);
      expect(detail.outcome).toBe("yes");
      expect(detail.report?.refundsPaid).toBe("40000000");

      // Nothing of the demo sale ever reached Stripe.
      expect(w.stripe.calls.length).toBe(stripeCallsBefore);
      expect(w.stripe.calls.some((call) => call.id.startsWith("pi_demo_"))).toBe(false);
      expect(w.stripe.intents.has(demoPi)).toBe(false);

      // The desk is demo while overrides exist; the campaign stays demo after the reset.
      expect((await api.hedgeDesk()).demo).toBe(true);
      expect(await api.demoReset()).toEqual({
        ok: true,
        demo: true,
        ticketToken: null,
        paymentIntentId: null,
      });
      expect((await api.hedgeDesk()).demo).toBe(false);
      expect(await demoFlags(demo, [demoToken])).toEqual([true, true, true]);

      // The real promo never turned demo, and its sale went through Stripe once.
      expect(await demoFlags(real, [realToken])).toEqual([false, false, false]);
      expect(w.stripe.intent(realPurchase.pi)).toMatchObject({ status: "succeeded", captures: 1 });
    },
  );
});
