import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { SaleState } from "@winz/shared";

import { startAnvil, type AnvilInstance } from "../../engine/src/testing/anvil";
import { api } from "./support/api";
import {
  buy,
  customerEmail,
  launchCampaign,
  signUpMerchant,
  waitCheckout,
  waitSaleState,
  waitTicketed,
  type LiveCampaign,
  type Purchase,
} from "./support/flows";
import { waitOpen } from "./support/steps";
import { within } from "./support/wait";
import {
  escrowEvents,
  onchainCampaign,
  ticketCount,
  type World,
  createWorld,
} from "./support/world";

/**
 * "Pause, then the authorization is cancelled" (SPEC CO-4, CA-5). A customer's card is authorized
 * while the promo sells; before the engine can sell the ticket, the promo stops selling: the
 * merchant pauses it (1), the price moves above its pause threshold (2), the book goes stale (3).
 * The customer is told the promo just paused and is not charged, nothing reaches the chain, and
 * once the condition clears a new checkout succeeds.
 *
 * The order of events is controlled from the outside only: the simulated Stripe holds the engine's
 * first read of the new PaymentIntent (as a slow Stripe would) until the pause is visible on the
 * campaign page, then lets it through.
 */

process.env.APP_LOG_LEVEL ??= "warn";

const SCENARIO_TIMEOUT_MS = 90_000;
const QUIET_BOOK = { bidBps: 1000, askBps: 1200 };
const PAUSED_MESSAGE = "Promo just paused, you were not charged";

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

async function liveCampaign(): Promise<{ w: World; campaign: LiveCampaign }> {
  const w = await createWorld(anvil);
  world = w;
  w.gemini.setBook(w.game.away.symbol, QUIET_BOOK);
  const merchant = await signUpMerchant(w, "Joe's Pizza", "pizza");
  const campaign = await launchCampaign(w, merchant, w.game.away.symbol);
  return { w, campaign };
}

interface HeldPurchase {
  purchase: Purchase;
  /** Lets the engine's read of the PaymentIntent through. */
  release: () => void;
}

/**
 * A customer pays while the promo sells; the engine's purchase job starts and is held at its first
 * read of the PaymentIntent. Resolves once the engine is holding.
 */
async function heldPurchase(w: World, campaign: LiveCampaign): Promise<HeldPurchase> {
  let target: string | null = null;
  let arrive: () => void = () => undefined;
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  w.stripe.setInterceptor("retrieve", async (call) => {
    if (call.id !== target) return;
    arrive();
    await released;
  });
  expect((await api.publicCampaign(campaign.slug)).saleState).toBe("open");
  const purchase = await buy(w, campaign.slug, 1, customerEmail("ann"), {
    beforeConfirm: (pi) => {
      target = pi;
    },
  });
  await within(arrived, 15_000, "the engine to read the PaymentIntent");
  return {
    purchase,
    release: () => {
      w.stripe.clearInterceptor("retrieve");
      release();
    },
  };
}

/** The purchase ended without a sale: not charged, nothing on-chain, the customer told why. */
async function expectCancelledPaused(w: World, purchase: Purchase): Promise<void> {
  const status = await waitCheckout(w, purchase.pi, "cancelled_paused");
  expect(status).toEqual({
    status: "cancelled_paused",
    ticketToken: null,
    message: PAUSED_MESSAGE,
  });
  const intent = w.stripe.intent(purchase.pi);
  expect(intent).toMatchObject({ status: "canceled", cancels: 1, captures: 0, refunds: 0 });
  expect(w.stripe.callsOf("engine", "capture", purchase.pi)).toHaveLength(0);
  expect(await ticketCount(w)).toBe(0n);
  expect(await escrowEvents(w, "TicketPurchased")).toHaveLength(0);
  const [buys] = await w.db<{ n: bigint }[]>`
    select count(*)::bigint as n from chain_txs
    where starts_with(idempotency_key, ${`buyFor:${purchase.pi}`})
  `;
  expect(buys?.n).toBe(0n);
  const [tickets] = await w.db<{ n: bigint }[]>`select count(*)::bigint as n from tickets`;
  expect(tickets?.n).toBe(0n);
}

/** A new checkout goes through and is captured once. */
async function expectSaleAgain(w: World, campaign: LiveCampaign): Promise<void> {
  const again = await buy(w, campaign.slug, 1, customerEmail("bob"));
  const token = await waitTicketed(w, again.pi);
  expect((await api.ticket(token)).phase).toBe("pre_game");
  expect(w.stripe.intent(again.pi)).toMatchObject({ status: "succeeded", captures: 1 });
  expect(await ticketCount(w)).toBe(1n);
}

async function expectPausedPage(w: World, slug: string, state: SaleState): Promise<void> {
  const page = await waitSaleState(w, slug, state);
  expect(page.saleState).toBe(state);
}

describe("pause, then the authorization is cancelled", () => {
  it(
    "1: the merchant pauses before the engine processes the purchase",
    { timeout: SCENARIO_TIMEOUT_MS },
    async () => {
      const { w, campaign } = await liveCampaign();
      const held = await heldPurchase(w, campaign);

      const paused = await api.pause(campaign.merchant.headers, campaign.id);
      expect(paused.saleState).toBe("paused_manual");
      await expectPausedPage(w, campaign.slug, "paused_manual");
      held.release();
      await expectCancelledPaused(w, held.purchase);
      // The pause itself reached the chain.
      await w.waitFor("the pause on-chain", async () => {
        const onchain = await onchainCampaign(w, campaign.onchainId);
        return { ok: onchain.status === 1, seen: onchain };
      });
      expect((await api.publicCampaign(campaign.slug)).saleState).toBe("paused_manual");

      // The merchant resumes: the promo sells again at once (a manual pause has no delay).
      await api.resume(campaign.merchant.headers, campaign.id);
      await waitSaleState(w, campaign.slug, "open");
      expect((await onchainCampaign(w, campaign.onchainId)).status).toBe(0);
      await expectSaleAgain(w, campaign);
    },
  );

  it(
    "2: the price moves above the pause threshold before the engine processes the purchase",
    { timeout: SCENARIO_TIMEOUT_MS },
    async () => {
      const { w, campaign } = await liveCampaign();
      const detail = await api.campaign(campaign.merchant.headers, campaign.id);
      const threshold = detail.pauseThresholdBps;
      const held = await heldPurchase(w, campaign);

      w.gemini.setBook(campaign.symbol, { bidBps: threshold + 500, askBps: threshold + 700 });
      await expectPausedPage(w, campaign.slug, "paused_price");
      held.release();
      await expectCancelledPaused(w, held.purchase);
      expect((await api.publicCampaign(campaign.slug)).saleState).toBe("paused_price");

      // The book comes back below the threshold by a tick; ten seconds later the promo sells.
      const askBps = Math.floor((threshold - 100) / 100) * 100;
      w.gemini.setBook(campaign.symbol, { bidBps: askBps - 200, askBps });
      await waitOpen(w, campaign.slug);
      await expectSaleAgain(w, campaign);
    },
  );

  it(
    "3: the book goes stale before the engine processes the purchase",
    { timeout: SCENARIO_TIMEOUT_MS },
    async () => {
      const { w, campaign } = await liveCampaign();
      const held = await heldPurchase(w, campaign);

      // Gemini goes quiet on the instrument; eleven seconds later its book is stale.
      w.gemini.silence(campaign.symbol);
      await w.advance(11);
      await expectPausedPage(w, campaign.slug, "paused_stale");
      held.release();
      await expectCancelledPaused(w, held.purchase);
      expect((await api.publicCampaign(campaign.slug)).saleState).toBe("paused_stale");

      // Fresh books again; ten seconds later the promo sells.
      w.gemini.resume(campaign.symbol);
      await waitOpen(w, campaign.slug);
      await expectSaleAgain(w, campaign);
    },
  );
});
