import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  STRIPE_PAYMENT_KINDS,
  apiErrorSchema,
  topUpCampaignResponseSchema,
  type TopUpCampaignResponse,
} from "@winz/shared";

import { POST as postTopUp } from "@/app/api/campaigns/[id]/top-up/route";

import { startAnvil, type AnvilInstance } from "../../engine/src/testing/anvil";
import { api, apiRefusal } from "./support/api";
import {
  DEFAULT_TERMS,
  buy,
  customerEmail,
  launchCampaign,
  signUpMerchant,
  waitSaleState,
  waitTicketed,
  type LiveCampaign,
} from "./support/flows";
import { hedgeCharges, soldTickets } from "./support/ledger";
import {
  QUIET_BOOK,
  closeSales,
  expectYesLedger,
  fillRestingMaker,
  sum,
  waitOpen,
  waitSettled,
} from "./support/steps";
import {
  createWorld,
  escrowEvents,
  onchainCampaign,
  tokenBalance,
  type World,
} from "./support/world";

/**
 * SPEC CA-6 end to end on a local chain: the web app's route handlers, the engine as one process
 * and the real WinzEscrow, with Gemini and Stripe simulated. A promo sells until its hedge budget
 * is used up and pauses; the merchant tops the budget up through POST /api/campaigns/:id/top-up,
 * pays on Stripe's sheet, Stripe's webhook arrives (twice); the engine adds it to the escrow and
 * the promo sells again without any other action. Settled YES, the unspent budget, top-up
 * included, comes back to the merchant through the settlement.
 */

process.env.APP_LOG_LEVEL ??= "warn";

const SCENARIO_TIMEOUT_MS = 150_000;

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

/** POST /api/campaigns/:id/top-up as Next.js calls it, validated with the shared schemas. */
async function topUp(
  campaign: LiveCampaign,
  amount: bigint,
  requestId: string,
): Promise<TopUpCampaignResponse> {
  const response = await postTopUp(
    new Request(`http://localhost/api/campaigns/${campaign.id}/top-up`, {
      method: "POST",
      headers: { ...campaign.merchant.headers, "content-type": "application/json" },
      body: JSON.stringify({ amount: amount.toString(), requestId }),
    }),
    { params: Promise.resolve({ id: campaign.id }) },
  );
  const payload: unknown = await response.json();
  if (response.status !== 200) {
    throw new Error(
      `top-up answered ${response.status.toString()}: ${JSON.stringify(apiErrorSchema.parse(payload))}`,
    );
  }
  return topUpCampaignResponseSchema.parse(payload);
}

describe("a budget top-up, end to end (CA-6)", () => {
  it(
    "a promo whose budget is used up is topped up by card, sells again, and settles YES with the top-up back",
    { timeout: SCENARIO_TIMEOUT_MS },
    async () => {
      const w = await createWorld(anvil);
      world = w;
      // The world's routes pay through its simulated Stripe account (`stripe.web`), top-ups
      // included: the payer's sheet, the webhooks and the engine's refund all see the same intent.
      const symbol = w.game.away.symbol;
      w.gemini.setBook(symbol, QUIET_BOOK);
      const treasury = w.escrow.accounts.treasury.address;
      const treasuryBefore = await tokenBalance(w, treasury);

      // $20 a unit, all of it back on YES, a cost cap of 20 %: one sale reserves about $2.75 of
      // guarantee at a 12 % ask, so a $3 budget holds exactly one sale.
      const budget = 3_000_000n;
      const merchant = await signUpMerchant(w, "Joe's Pizza", "pizza");
      const campaign = await launchCampaign(w, merchant, symbol, {
        terms: { ...DEFAULT_TERMS, budget },
      });

      // The first sale uses the budget up: the promo pauses, a new customer is refused.
      const first = await buy(w, campaign.slug, 1, customerEmail("ann"));
      await waitTicketed(w, first.pi);
      await waitSaleState(w, campaign.slug, "paused_budget");
      const refused = await apiRefusal(() => api.checkout(campaign.slug, 1));
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe("sales_paused");

      // The merchant tops the budget up by $50 and pays on Stripe's sheet; the front retries
      // its request once (same requestId: the same payment).
      const topUpAmount = 50_000_000n;
      const requestId = randomUUID();
      const answer = await topUp(campaign, topUpAmount, requestId);
      expect(answer).toMatchObject({
        campaignId: campaign.id,
        requestId,
        amount: topUpAmount.toString(),
        budgetPayment: { amount: topUpAmount.toString() },
        status: "requires_payment",
      });
      expect(await topUp(campaign, topUpAmount, requestId)).toEqual(answer);
      const topUpPi = answer.budgetPayment.paymentIntentId;
      // Made in the world's one Stripe account by its shared web gateway, like the first budget.
      expect(w.stripe.intent(topUpPi)).toMatchObject({
        captureMethod: "automatic",
        clientSecret: answer.budgetPayment.clientSecret,
        metadata: {
          kind: STRIPE_PAYMENT_KINDS.campaignBudgetTopUp,
          campaignId: campaign.id,
          requestId,
        },
      });
      w.stripe.confirmCard(topUpPi, merchant.email);
      const delivery = w.stripe.webhookDelivery("payment_intent.succeeded", topUpPi);
      await api.stripeWebhook(delivery);
      await api.stripeWebhook(delivery);

      // The engine adds it to the escrow; the merchant's detail and list show the new budget.
      const total = budget + topUpAmount;
      await w.waitFor("the top-up on the escrow and the merchant's detail", async () => {
        const onchain = await onchainCampaign(w, campaign.onchainId);
        const detail = await api.campaign(merchant.headers, campaign.id);
        return {
          ok: onchain.hedgeBudget === total && detail.budget === total.toString(),
          seen: { hedgeBudget: onchain.hedgeBudget, budget: detail.budget },
        };
      });
      const detail = await api.campaign(merchant.headers, campaign.id);
      expect(BigInt(detail.budgetAvailable)).toBe(
        total - BigInt(detail.hedgeSpent) - BigInt(detail.hedgeReserved),
      );
      // Nothing else of the promo changed.
      expect(detail).toMatchObject({
        unitPrice: campaign.terms.unitPrice.toString(),
        refundBps: campaign.terms.refundBps,
        usualMarginBps: campaign.terms.usualMarginBps,
        minMarginBps: campaign.terms.minMarginBps,
      });
      const [row] = await w.db<{ status: string; tx_hash: string | null }[]>`
        select status, tx_hash from budget_top_ups where request_id = ${requestId}
      `;
      expect(row?.status).toBe("credited");
      expect(row?.tx_hash).toMatch(/^0x[0-9a-f]{64}$/);
      // The front asking again is told it is done.
      expect(await topUp(campaign, topUpAmount, requestId)).toEqual({
        ...answer,
        status: "credited",
      });
      expect(w.stripe.intent(topUpPi)).toMatchObject({
        status: "succeeded",
        captures: 1,
        refunds: 0,
        amount: topUpAmount,
      });

      // It sells again without any other action.
      await waitOpen(w, campaign.slug);
      const second = await buy(w, campaign.slug, 1, customerEmail("bob"));
      await waitTicketed(w, second.pi);
      await fillRestingMaker(w, campaign, 2);

      // Sales close, the game ends YES.
      await closeSales(w, campaign);
      await w.waitFor("the hedge reservation back to zero", async () => {
        const onchain = await onchainCampaign(w, campaign.onchainId);
        return { ok: onchain.hedgeReserved === 0n, seen: onchain };
      });
      w.gemini.settle({ home: "no", away: "yes" });
      await waitSettled(w, campaign, "yes");

      const tickets = await soldTickets(w, campaign.onchainId);
      expect(tickets).toHaveLength(2);
      const charges = await hedgeCharges(w, campaign.onchainId);
      const spent = sum(charges.map((charge) => charge.amount));
      // The whole YES ledger, with the top-up counted in the budget: the treasury paid the
      // budget and the top-up, the merchant got back everything not spent on the hedge.
      await expectYesLedger(
        w,
        { ...campaign, terms: { ...campaign.terms, budget: total } },
        tickets,
        charges,
        treasury,
        treasuryBefore,
      );
      const released = (await escrowEvents(w, "CampaignReleased")).filter(
        (event) => event.id === campaign.onchainId,
      );
      expect(released.map((event) => event.amount)).toEqual([total - spent]);
      expect((await onchainCampaign(w, campaign.onchainId)).hedgeBudget).toBe(total);
      // Stripe holds the budget, the top-up and the two purchases, nothing else; no refund.
      expect([...w.stripe.intents.keys()].sort()).toEqual(
        [campaign.budgetPi, topUpPi, first.pi, second.pi].sort(),
      );
      expect(w.stripe.intent(topUpPi).refunds).toBe(0);
    },
  );
});
