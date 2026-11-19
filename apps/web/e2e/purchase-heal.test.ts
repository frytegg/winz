import { JOB_KINDS, jobIdempotencyKey } from "@winz/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { PaymentGatewayError, type PaymentIntentView } from "@/lib/server/payments-gateway";

import { startAnvil, type AnvilInstance } from "../../engine/src/testing/anvil";
import { api, apiRefusal } from "./support/api";
import { customerEmail, launchCampaign, signUpMerchant, waitTicketed } from "./support/flows";
import { soldTickets } from "./support/ledger";
import { QUIET_BOOK } from "./support/steps";
import { createWorld, ticketCount, type World } from "./support/world";

/**
 * A fan's purchase completes with neither the webhook nor a second confirmation (SPEC CO-2,
 * CO-3): the card is authorized, the front's one confirmation fails (Stripe could not be read: a
 * 502), the webhook never comes (a wrong webhook secret on the day of the deployment), and the
 * front only keeps polling GET /api/checkout/:pi. The polls alone lead to the ticket, on a local
 * chain with the real WinzEscrow and the engine, with one purchase job, one on-chain purchase and
 * one capture; the webhook that finally arrives afterwards changes nothing.
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

async function purchaseJobs(w: World, pi: string): Promise<number> {
  const [row] = await w.db<{ n: bigint }[]>`
    select count(*)::bigint as n from jobs
    where kind = ${JOB_KINDS.purchase} and payload ->> 'paymentIntentId' = ${pi}
  `;
  return Number(row?.n ?? 0n);
}

describe("the purchase heals without the webhook", () => {
  it(
    "the confirmation fails once, the webhook never comes: the polls alone lead to the ticket",
    { timeout: SCENARIO_TIMEOUT_MS },
    async () => {
      const w = await createWorld(anvil);
      world = w;
      const symbol = w.game.away.symbol;
      w.gemini.setBook(symbol, QUIET_BOOK);
      const merchant = await signUpMerchant(w, "Joe's Pizza", "pizza");
      const campaign = await launchCampaign(w, merchant, symbol);
      const ticketsBefore = await ticketCount(w);

      // The fan checks out and authorizes the card on Stripe's sheet.
      const checkout = await api.checkout(campaign.slug, 1);
      const pi = checkout.paymentIntentId;
      w.stripe.confirmCard(pi, customerEmail("ann"));
      // The webhook Stripe would send now; it is delivered only at the very end.
      const lateWebhook = w.stripe.webhookDelivery("payment_intent.amount_capturable_updated", pi);

      // The front's one confirmation fails: the web app's read of Stripe fails once.
      const web = w.stripe.web;
      const read = web.retrievePaymentIntent;
      let failedReads = 0;
      web.retrievePaymentIntent = (id: string): Promise<PaymentIntentView | null> => {
        web.retrievePaymentIntent = read;
        failedReads += 1;
        return Promise.reject(new PaymentGatewayError(`simulated Stripe outage reading ${id}`));
      };
      const refusal = await apiRefusal(() => api.confirm(pi));
      expect(refusal.status).toBe(502);
      expect(failedReads).toBe(1);
      expect(await purchaseJobs(w, pi)).toBe(0);

      // No webhook, no second confirmation: only the polls of the front.
      const token = await waitTicketed(w, pi);
      const ticket = await api.ticket(token);
      expect(ticket).toMatchObject({ campaignSlug: campaign.slug, qty: 1, paid: checkout.amount });

      // One purchase job, one purchase on-chain, one capture.
      expect(await purchaseJobs(w, pi)).toBe(1);
      const [job] = await w.db<{ status: string }[]>`
        select status from jobs where idempotency_key = ${jobIdempotencyKey.purchase(pi)}
      `;
      expect(job?.status).toBe("done");
      expect(await ticketCount(w)).toBe(ticketsBefore + 1n);
      expect(await soldTickets(w, campaign.onchainId)).toHaveLength(1);
      const intent = w.stripe.intent(pi);
      expect(intent).toMatchObject({ status: "succeeded", captures: 1, cancels: 0 });
      expect(intent.capturedAmount).toBe(BigInt(checkout.amount));
      expect(
        new Set(w.stripe.callsOf("engine", "capture", pi).map((c) => c.idempotencyKey)).size,
      ).toBe(1);
      // The web app read the intent once more than the failed confirmation: the heal's one read.
      expect(w.stripe.callsOf("web", "retrieve", pi)).toHaveLength(1);

      // The webhook finally arrives (twice, as Stripe may deliver it): nothing happens twice.
      await api.stripeWebhook(lateWebhook);
      await api.stripeWebhook(lateWebhook);
      expect((await api.checkoutStatus(pi)).status).toBe("ticketed");
      expect(await purchaseJobs(w, pi)).toBe(1);
      expect(await ticketCount(w)).toBe(ticketsBefore + 1n);
      expect(w.stripe.intent(pi).captures).toBe(1);
      const [payment] = await w.db<{ status: string; email: string | null }[]>`
        select status, email from payments where stripe_pi = ${pi}
      `;
      expect(payment?.status).toBe("ticketed");
    },
  );
});
