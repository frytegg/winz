import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { startAnvil, type AnvilInstance } from "../../engine/src/testing/anvil";
import { api } from "./support/api";
import {
  buy,
  customerEmail,
  launchCampaign,
  signUpMerchant,
  waitTicketed,
  type Purchase,
} from "./support/flows";
import { countFor, expectEachCapturedOnce, hedgeCharges, soldTickets } from "./support/ledger";
import {
  QUIET_BOOK,
  closeSales,
  expectReport,
  expectYesLedger,
  fillRestingMaker,
  waitOpen,
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

      await w.startEngine();
      await waitTicketed(w, first.pi);
      expect(await ticketCount(w)).toBe(1n);
      // A restarted engine has no book in memory yet: the promo may sit in an automatic pause for
      // its ten seconds before it sells again.
      await waitOpen(w, campaign.slug);

      const second = await buy(w, campaign.slug, 2, customerEmail("bob"));
      await waitTicketed(w, second.pi);
      const purchases: Purchase[] = [first, second];
      await fillRestingMaker(w, campaign, 2);

      // Restart 2: the engine stops right after `settle` is mined, before refunds and payouts.
      const settled = signal();
      let stopped = false;
      await w.restartEngine({
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
      });
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
        expect((await api.ticket(await waitTicketed(w, purchase.pi))).phase).toBe("refunded");
      }
      expectReport(await api.campaign(merchant.headers, campaign.id), tickets, charges, "yes");
    },
  );
});
