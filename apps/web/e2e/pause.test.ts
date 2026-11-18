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
  type WorldOptions,
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

async function liveCampaign(
  options: WorldOptions = {},
): Promise<{ w: World; campaign: LiveCampaign }> {
  const w = await createWorld(anvil, options);
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

/** The escrow's campaign status: live, paused. */
const ONCHAIN_LIVE = 0;
const ONCHAIN_PAUSED = 1;

/**
 * Receipts read late (the sender's receipt poll and the log poller every 1.5 s instead of every 15
 * and 150 ms), on a chain that mines a block every second instead of one per transaction (see
 * `withBlocksEverySecond`): a transaction is mined on-chain and unknown to the engine for up to
 * 1.5 s, which widens the window in which the page used to answer open while the campaign was
 * already paused on-chain from a few milliseconds to over a second.
 */
const SLOW_RECEIPTS: NonNullable<WorldOptions["tuning"]> = {
  txSender: { receiptPollMs: 1_500 },
  chainIngest: { pollIntervalMs: 1_500 },
};

/** Runs `work` with the shared chain mining a block every second, then back to one per transaction. */
async function withBlocksEverySecond<T>(work: () => Promise<T>): Promise<T> {
  await anvil.rpc("evm_setIntervalMining", [1]);
  try {
    return await work();
  } finally {
    await anvil.rpc("evm_setAutomine", [true]);
  }
}

/** Polls the escrow every 10 ms until the campaign has `status`. */
async function waitOnchainStatus(w: World, campaign: LiveCampaign, status: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const onchain = await onchainCampaign(w, campaign.onchainId);
    if (onchain.status === status) return;
    if (Date.now() > deadline) {
      throw new Error(
        `the escrow did not show status ${String(status)} within 20 s (last: ${String(onchain.status)})`,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

/** How long the page is polled for the sale to open again after a resume. */
const REOPEN_TIMEOUT_MS = 30_000;
/** How long the page keeps being polled once it first answers open. */
const AFTER_OPEN_WATCH_MS = 2_000;

/**
 * From a resume request on: polls the public campaign page until it answers open, then for
 * `AFTER_OPEN_WATCH_MS` more, and reads the escrow right after every `open` answer: each one must
 * have been given while the campaign was live on-chain (status 0), never while it was still paused
 * there. Returns the answers read, in order.
 */
async function expectOpenOnlyWhileLive(w: World, campaign: LiveCampaign): Promise<SaleState[]> {
  const answers: SaleState[] = [];
  const deadline = Date.now() + REOPEN_TIMEOUT_MS;
  let openedAt: number | null = null;
  while (openedAt === null || Date.now() - openedAt < AFTER_OPEN_WATCH_MS) {
    const page = await api.publicCampaign(campaign.slug);
    answers.push(page.saleState);
    if (page.saleState === "open") {
      const onchain = await onchainCampaign(w, campaign.onchainId);
      expect(
        onchain.status,
        `answer ${String(answers.length)} was open while the escrow said status ${String(onchain.status)} (answers so far: ${answers.join(", ")})`,
      ).toBe(ONCHAIN_LIVE);
      openedAt ??= Date.now();
    } else if (openedAt === null && Date.now() > deadline) {
      throw new Error(
        `the campaign page did not answer open within ${String(REOPEN_TIMEOUT_MS)} ms after the resume (answers: ${answers.join(", ")})`,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  return answers;
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
      // The merchant sees the pause on their dashboard (the on-chain pause has been projected)
      // before they resume.
      await w.waitFor("the pause on the merchant's dashboard", async () => {
        const detail = await api.campaign(campaign.merchant.headers, campaign.id);
        return { ok: detail.status === "paused", seen: detail.status };
      });

      // The merchant resumes: the promo sells again at once (a manual pause has no delay).
      await api.resume(campaign.merchant.headers, campaign.id);
      await waitSaleState(w, campaign.slug, "open");
      expect((await onchainCampaign(w, campaign.onchainId)).status).toBe(0);
      await expectSaleAgain(w, campaign);
    },
  );

  it(
    "1b: the merchant resumes as soon as the pause is mined, without waiting for the dashboard",
    { timeout: SCENARIO_TIMEOUT_MS },
    async () => {
      const { w, campaign } = await liveCampaign({ tuning: SLOW_RECEIPTS });
      const answers = await withBlocksEverySecond(async () => {
        const paused = await api.pause(campaign.merchant.headers, campaign.id);
        expect(paused.saleState).toBe("paused_manual");
        // The resume goes out as soon as the escrow says paused, before the engine has read the
        // pause's receipt, let alone projected it.
        await waitOnchainStatus(w, campaign, ONCHAIN_PAUSED);
        await api.resume(campaign.merchant.headers, campaign.id);
        return expectOpenOnlyWhileLive(w, campaign);
      });
      expect(answers.length).toBeGreaterThan(1);
      expect((await onchainCampaign(w, campaign.onchainId)).status).toBe(ONCHAIN_LIVE);
      await expectSaleAgain(w, campaign);
    },
  );

  it(
    "1c: the merchant pauses and resumes back to back",
    { timeout: SCENARIO_TIMEOUT_MS },
    async () => {
      const { w, campaign } = await liveCampaign({ tuning: SLOW_RECEIPTS });
      const answers = await withBlocksEverySecond(async () => {
        const paused = await api.pause(campaign.merchant.headers, campaign.id);
        expect(paused.saleState).toBe("paused_manual");
        await api.resume(campaign.merchant.headers, campaign.id);
        return expectOpenOnlyWhileLive(w, campaign);
      });
      expect(answers.length).toBeGreaterThan(1);
      expect((await onchainCampaign(w, campaign.onchainId)).status).toBe(ONCHAIN_LIVE);
      await expectSaleAgain(w, campaign);
    },
  );

  it(
    "1d: the merchant resumes while the pause transaction is on its way",
    { timeout: SCENARIO_TIMEOUT_MS },
    async () => {
      const { w, campaign } = await liveCampaign({ tuning: SLOW_RECEIPTS });
      const answers = await withBlocksEverySecond(async () => {
        const paused = await api.pause(campaign.merchant.headers, campaign.id);
        expect(paused.saleState).toBe("paused_manual");
        // Back to back, but once the engine has decided to send the pause: the pause reaches the
        // chain although the merchant's last word is "resume".
        await w.waitFor(
          "the pause transaction to be queued",
          async () => {
            const [row] = await w.db<{ n: bigint }[]>`
              select count(*)::bigint as n from chain_txs
              where kind = 'setPaused' and payload ->> 'campaignId' = ${campaign.id}
                and (payload ->> 'paused')::boolean
            `;
            return { ok: (row?.n ?? 0n) > 0n, seen: row?.n };
          },
          20_000,
        );
        await api.resume(campaign.merchant.headers, campaign.id);
        return expectOpenOnlyWhileLive(w, campaign);
      });
      expect(answers.length).toBeGreaterThan(1);
      // The pause did reach the chain, then the resume.
      expect((await escrowEvents(w, "CampaignPaused")).map((event) => event.paused)).toEqual([
        true,
        false,
      ]);
      expect((await onchainCampaign(w, campaign.onchainId)).status).toBe(ONCHAIN_LIVE);
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
