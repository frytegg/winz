/**
 * J-03 and SPEC ID-1 together: two purchases made at the same moment by the same new buyer (a
 * double tap, two tabs, two sales of one demo buyer) both end ticketed, to one wallet, on a local
 * chain with the real escrow and a real Postgres. The identity directory holds both lookups until
 * the two jobs have asked it, so the two writes of the buyer's users row really overlap.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { BookLevel } from "@winz/shared";

import type { IdentityDirectory } from "../../identity";
import { createPurchaseHandler } from "./purchase";
import {
  CONTRACT,
  USDC,
  checksum,
  createJobsHarness,
  createLiveCampaign,
  onchainTickets,
  runHandler,
  seedPayment,
  type JobsHarness,
  type LiveCampaign,
} from "./test-support";

const ASKS: BookLevel[] = [
  { priceBps: 3_000n, qty: 5_000n * CONTRACT },
  { priceBps: 3_100n, qty: 5_000n * CONTRACT },
];
const BIDS: BookLevel[] = [{ priceBps: 2_900n, qty: 100n * CONTRACT }];
/** Longest a lookup waits for the other job before answering anyway. */
const GATE_TIMEOUT_MS = 5_000;
const ROUNDS = 40;

let harness: JobsHarness;
let campaign: LiveCampaign;

beforeAll(async () => {
  harness = await createJobsHarness();
  // A budget that covers every ticket of every round, so no sale is paused for lack of it.
  campaign = await createLiveCampaign(harness, "same-buyer", { budget: 10_000n * USDC });
});

afterAll(async () => {
  await harness?.close();
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The harness's directory, answering only once `round` lookups have arrived (or the timeout). */
class GatedDirectory implements IdentityDirectory {
  private waiting: (() => void)[] = [];

  constructor(
    private readonly inner: IdentityDirectory,
    private readonly round: number,
  ) {}

  async findOrCreateWalletByEmail(
    email: string,
  ): Promise<{ privyUserId: string; walletAddress: string }> {
    const gate = new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
    if (this.waiting.length >= this.round) {
      const released = this.waiting;
      this.waiting = [];
      for (const release of released) release();
    }
    // The timeout's timer is cleared once the gate opens, so no round leaves one pending.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, GATE_TIMEOUT_MS);
    });
    try {
      await Promise.race([gate, timeout]);
    } finally {
      clearTimeout(timer);
    }
    await sleep(5);
    return this.inner.findOrCreateWalletByEmail(email);
  }
}

interface PaymentRow {
  status: string;
  message: string | null;
  buyer: string | null;
  ticket_id: string | null;
}

describe("purchase job: one new buyer, two purchases at once", () => {
  it(`both end ticketed, to one wallet and one users row (${ROUNDS} buyers)`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      harness.books.set(campaign.symbol, { asks: ASKS, bids: BIDS });
      const email = `twice-${round}-${Date.now().toString(36)}@example.com`;
      const pis: string[] = [];
      for (let i = 0; i < 2; i += 1) {
        pis.push(
          await seedPayment(harness, {
            campaignId: campaign.campaignId,
            qty: 1,
            unitPrice: campaign.terms.unitPrice,
            // The second payment has only the payment sheet's e-mail, spelled otherwise.
            ...(i === 0 ? { email } : { email: null, payerEmail: `  ${email.toUpperCase()} ` }),
          }),
        );
      }
      const handler = createPurchaseHandler(
        harness.deps({ identity: new GatedDirectory(harness.identity, 2) }),
      );

      await Promise.all(pis.map((pi) => runHandler(harness, handler, { paymentIntentId: pi })));

      const rows = await harness.db<PaymentRow[]>`
        select status, message, buyer, ticket_id from payments
        where stripe_pi in ${harness.db(pis)}
      `;
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.status).toBe("ticketed");
        expect(row.message).toBeNull();
        expect(row.ticket_id).not.toBeNull();
      }
      const buyers = new Set(rows.map((row) => row.buyer));
      expect(buyers.size).toBe(1);
      const [buyer] = [...buyers];
      expect(buyer).toMatch(/^0x[0-9a-f]{40}$/);

      const users = await harness.db<{ wallet: string | null; roles: string[] }[]>`
        select wallet, roles from users where email = ${email}
      `;
      expect(users).toEqual([{ wallet: buyer, roles: ["fan"] }]);

      for (const pi of pis) {
        expect(harness.gateway.effectsOf(pi)).toEqual({ captures: 1, cancels: 0, refunds: 0 });
      }
      const tickets = (await onchainTickets(harness)).filter(
        (ticket) =>
          ticket.campaignId === campaign.onchainId && ticket.buyer === checksum(buyer ?? ""),
      );
      expect(tickets).toHaveLength(2);
    }
  });
});
