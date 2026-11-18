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
  waitTicketPhase,
  type Purchase,
} from "./support/flows";
import { countFor, expectEachCapturedOnce, hedgeCharges, soldTickets } from "./support/ledger";
import {
  QUIET_BOOK,
  closeSales,
  expectReport,
  expectYesLedger,
  fillRestingMaker,
  waitSettled,
} from "./support/steps";
import { transientStripeError } from "./support/stripe";
import { within } from "./support/wait";
import {
  createWorld,
  escrowEvents,
  onchainCampaign,
  ticketCount,
  tokenBalance,
  type World,
} from "./support/world";

/**
 * Scenario A with the engine restarted twice in the middle (SPEC HE-1, ST-1 to ST-4): once right
 * after a purchase's `buyFor` is mined and before its capture is recorded, once after sales close
 * and before settlement finishes. After each restart the loop completes and nothing happened
 * twice, counted on the escrow's events and on the simulated Stripe's ledger.
 *
 * Where the engine stops is chosen from the outside: the first time by Stripe failing the capture
 * call while the engine is told to stop (the request never landed, as when a process dies during
 * it), the second time by the settlement's step hook, the engine's own way to stop at a precise
 * point.
 *
 * A restart must not pause the promo either: the engine's sale states keep a campaign's stored
 * state until its instrument's first book (their start-up grace), so from each restart on the
 * campaign page answers open without a break and a checkout made at once is ticketed.
 */

process.env.APP_LOG_LEVEL ??= "warn";

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

/** How long, from a restart on, the campaign page is polled and must answer open every time. */
const OPEN_WATCH_MS = 6_000;

/**
 * How long the instrument's book is held back at each restart. The feed of a fresh engine has no
 * book until the socket delivers one; holding it makes sure the sale states' first passes run
 * without a book, which is the case the start-up grace is for (left to the race, the book often
 * lands first and nothing would be tested). Well below the 10 s after which the book that the
 * previous engine left in book_cache is stale, so a purchase can still be priced meanwhile.
 */
const BOOK_HELD_MS = 1_500;

/**
 * Starts the engine (`start`) with the instrument's book held back from the new feed for
 * `BOOK_HELD_MS`, then lets it through.
 */
async function startWithoutBook(
  w: World,
  symbol: string,
  start: () => Promise<void>,
): Promise<void> {
  w.gemini.silence(symbol);
  try {
    await start();
  } finally {
    setTimeout(() => {
      w.gemini.resume(symbol);
    }, BOOK_HELD_MS);
  }
}

/**
 * Polls the public campaign page from now for `forMs` and fails on the first answer that is not
 * open. Returns the number of answers read.
 */
async function expectOpenThroughout(slug: string, forMs: number): Promise<number> {
  const startedAt = Date.now();
  let answers = 0;
  while (Date.now() - startedAt < forMs) {
    const page = await api.publicCampaign(slug);
    answers += 1;
    expect(
      page.saleState,
      `the campaign page ${String(Date.now() - startedAt)} ms after the restart`,
    ).toBe("open");
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  return answers;
}

/** Waits until a checkout is ticketed, and fails at once if the promo cancelled it as paused. */
async function expectTicketedWithoutPause(w: World, pi: string): Promise<void> {
  await w.waitFor(`the checkout ${pi} to be ticketed`, async () => {
    const status = await api.checkoutStatus(pi);
    if (status.status === "cancelled_paused" || status.status === "failed") {
      throw new Error(`checkout ${pi} answered ${status.status} after the restart`);
    }
    return { ok: status.status === "ticketed", seen: status };
  });
}

/**
 * Right after a restart: watches the campaign page for `OPEN_WATCH_MS` while a customer buys at
 * once, and checks that the purchase is ticketed with no pause in between.
 */
async function buyRightAfterRestart(
  w: World,
  slug: string,
  qty: number,
  email: string,
): Promise<Purchase> {
  const [answers, purchase] = await Promise.all([
    expectOpenThroughout(slug, OPEN_WATCH_MS),
    (async (): Promise<Purchase> => {
      const bought = await buy(w, slug, qty, email);
      await expectTicketedWithoutPause(w, bought.pi);
      return bought;
    })(),
  ]);
  // The page was actually read throughout the window, not once.
  expect(answers).toBeGreaterThan(10);
  return purchase;
}

function signal(): { promise: Promise<void>; fire: () => void } {
  let fire: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    fire = resolve;
  });
  return { promise, fire };
}

describe("restarts in the middle of the loop", () => {
  it(
    "E: the engine restarts after a buyFor is mined and during settlement; nothing happens twice",
    { timeout: 120_000 },
    async () => {
      const w = await createWorld(anvil);
      world = w;
      const symbol = w.game.away.symbol;
      w.gemini.setBook(symbol, QUIET_BOOK);
      const treasury = w.escrow.accounts.treasury.address;
      const treasuryBefore = await tokenBalance(w, treasury);
      const merchant = await signUpMerchant(w, "Joe's Pizza", "pizza");
      const campaign = await launchCampaign(w, merchant, symbol);

      // Restart 1: the capture call arrives (so the ticket is on-chain), the engine is stopped and
      // the call fails as if the process died before Stripe got it.
      const captureReached = signal();
      let interrupted = false;
      w.stripe.setInterceptor("capture", () => {
        if (interrupted) return;
        interrupted = true;
        captureReached.fire();
        w.abortEngine();
        throw transientStripeError("capture");
      });
      const first = await buy(w, campaign.slug, 1, customerEmail("ann"));
      await within(captureReached.promise, 20_000, "the capture of the first purchase");
      await w.engineStopped();
      w.stripe.clearInterceptor("capture");
      // Between the two processes: the ticket exists on-chain, nobody was charged.
      expect(await ticketCount(w)).toBe(1n);
      expect(w.stripe.intent(first.pi)).toMatchObject({ status: "requires_capture", captures: 0 });
      expect((await api.checkoutStatus(first.pi)).status).toBe("processing");

      await startWithoutBook(w, symbol, () => w.startEngine());
      // From the restart on, the promo keeps selling: no wait for a reopening.
      const second = await buyRightAfterRestart(w, campaign.slug, 2, customerEmail("bob"));
      await waitTicketed(w, first.pi);
      expect(await ticketCount(w)).toBe(2n);
      await fillRestingMaker(w, campaign, 2);
      // Hedging moved the book; it is back to quiet and the promo sells before the next restart.
      await waitSaleState(w, campaign.slug, "open", 5_000);

      // Restart 2: the engine stops right after `settle` is mined, before refunds and payouts.
      const settled = signal();
      let stopped = false;
      await startWithoutBook(w, symbol, () =>
        w.restartEngine({
          tuning: {
            settlement: {
              onStep: (event) => {
                if (stopped || event.step !== "settle" || event.phase !== "done") return;
                stopped = true;
                settled.fire();
                w.abortEngine();
              },
            },
          },
        }),
      );
      const third = await buyRightAfterRestart(w, campaign.slug, 1, customerEmail("cat"));
      const purchases: Purchase[] = [first, second, third];
      await fillRestingMaker(w, campaign, purchases.length);
      await closeSales(w, campaign);
      await w.waitFor("the hedge reservation back to zero", async () => {
        const onchain = await onchainCampaign(w, campaign.onchainId);
        return { ok: onchain.hedgeReserved === 0n, seen: onchain };
      });
      w.gemini.settle({ home: "no", away: "yes" });
      await within(settled.promise, 30_000, "the settle step of the campaign");
      await w.engineStopped();
      expect(await countFor(w, "CampaignSettled", campaign.onchainId)).toBe(1);
      const mid = await onchainCampaign(w, campaign.onchainId);
      expect(mid.status).toBe(2);
      expect(mid.released).toBe(false);

      await w.startEngine();
      await waitSettled(w, campaign, "yes");

      // Nothing happened twice.
      const tickets = await soldTickets(w, campaign.onchainId);
      expect(tickets).toHaveLength(purchases.length);
      const [rows] = await w.db<{ n: bigint }[]>`select count(*)::bigint as n from tickets`;
      expect(rows?.n).toBe(BigInt(purchases.length));
      const charges = await hedgeCharges(w, campaign.onchainId);
      expect(charges).toHaveLength(tickets.length);
      expect(new Set(charges.map((charge) => charge.ticketId)).size).toBe(tickets.length);
      expect(await countFor(w, "CampaignSettled", campaign.onchainId)).toBe(1);
      const refunds = (await escrowEvents(w, "TicketRefunded")).map((event) => event.ticketId);
      expect(refunds).toHaveLength(tickets.length);
      expect(new Set(refunds).size).toBe(tickets.length);
      expectEachCapturedOnce(w, purchases);
      await expectYesLedger(w, campaign, tickets, charges, treasury, treasuryBefore);
      for (const purchase of purchases) {
        await waitTicketPhase(w, await waitTicketed(w, purchase.pi), "refunded");
      }
      expectReport(await api.campaign(merchant.headers, campaign.id), tickets, charges, "yes");
    },
  );
});
