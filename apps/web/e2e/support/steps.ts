import { expect } from "vitest";
import { getAddress, type Address } from "viem";

import type { CampaignDetail, Outcome } from "@winz/shared";

import { api, apiRefusal } from "./api";
import { waitSaleState, type LiveCampaign } from "./flows";
import { countFor, deskInstrument, expectRefunded, hedgeCharges, type SoldTicket } from "./ledger";
import { WaitTimeoutError } from "./wait";
import { onchainCampaign, tokenBalance, type World } from "./world";

/** Steps and checks shared by the scenarios that run a campaign to its settlement. */

/** The underdog's book: Arkansas wins at 10–12 %. */
export const QUIET_BOOK = { bidBps: 1000, askBps: 1200 };

/** Rounds `fillRestingMaker` allows: one per maker filled, plus those the engine withdrew first. */
const MAX_MAKER_ROUNDS = 12;

/** A desk order in one of these states is gone without having been filled in full. */
const WITHDRAWN_STATUSES: ReadonlySet<string> = new Set(["cancelled", "rejected"]);

/**
 * Hedges the campaign's sales the way a market does: each maker order the engine rests on the
 * paper venue (read from the Hedge desk) is filled by bringing the ask down to its price, then the
 * book goes back to quiet; until `charges` tickets of the campaign are charged on-chain. The
 * engine works one maker at a time per instrument, so sales made while one rests are hedged by
 * the next. Returns the price of every maker filled.
 */
export async function fillRestingMaker(
  w: World,
  campaign: LiveCampaign,
  charges: number,
): Promise<number[]> {
  const prices: number[] = [];
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
    if (resting === null || round >= MAX_MAKER_ROUNDS) {
      throw new Error(`no maker left to fill and only ${charged.toString()} tickets charged`);
    }
    w.gemini.setBook(campaign.symbol, {
      bidBps: Math.min(QUIET_BOOK.bidBps, resting.priceBps - 100),
      askBps: resting.priceBps,
    });
    // The engine withdraws a resting maker and posts another when the exposure changes under it
    // (a sale projected a moment after the desk was read): that order will never fill, so the
    // round ends there and the next one reads the desk again.
    let filled = false;
    await w.waitFor(`the maker ${resting.id} filled, or withdrawn by the engine`, async () => {
      const row = await deskInstrument(campaign.symbol);
      const order = row?.orders.find((item) => item.id === resting.id);
      filled = order?.status === "filled";
      const withdrawn = order === undefined || WITHDRAWN_STATUSES.has(order.status);
      return { ok: filled || withdrawn, seen: order };
    });
    w.gemini.setBook(campaign.symbol, QUIET_BOOK);
    if (filled) prices.push(resting.priceBps);
  }
  await w.waitFor(`exactly ${charges.toString()} tickets charged on-chain`, async () => {
    const charged = await hedgeCharges(w, campaign.onchainId);
    return { ok: charged.length === charges, seen: charged };
  });
  return prices;
}

/**
 * Waits until the campaign page answers open. An automatic pause comes back only after ten
 * seconds of a sellable book (SPEC CA-5), so when the page is not open within a moment, chain time
 * moves forward in steps of two seconds, each followed by a pause long enough for the engine to
 * re-stamp its books (a single jump would age them past staleness), until it is.
 */
export async function waitOpen(w: Pick<World, "waitFor" | "advance">, slug: string): Promise<void> {
  try {
    await waitSaleState(w, slug, "open", 1_500);
    return;
  } catch (error: unknown) {
    // Only a timeout means "still in an automatic pause"; any other failure (a route answering
    // 500, say) is the real cause and must not be hidden behind chain time moving forward.
    if (!(error instanceof WaitTimeoutError)) throw error;
  }
  for (let attempt = 1; ; attempt += 1) {
    for (let step = 0; step < 6; step += 1) {
      await w.advance(2);
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
    }
    try {
      await waitSaleState(w, slug, "open", 3_000);
      return;
    } catch (error: unknown) {
      if (!(error instanceof WaitTimeoutError) || attempt >= 3) throw error;
    }
  }
}

/** Moves chain time past the game's sales close; the campaign answers `sales_closed`. */
export async function closeSales(w: World, campaign: LiveCampaign): Promise<void> {
  const seconds = Math.ceil((w.game.salesCloseAt.getTime() - w.clock.now()) / 1000) + 30;
  await w.advance(seconds);
  await w.waitFor("the campaign to answer sales_closed", async () => {
    const detail = await api.campaign(campaign.merchant.headers, campaign.id);
    return { ok: detail.status === "sales_closed" && detail.saleState === "closed", seen: detail };
  });
  const refusal = await apiRefusal(() => api.checkout(campaign.slug, 1));
  expect(refusal.status).toBe(409);
  expect(refusal.body.error.code).toBe("sales_closed");
}

/** Waits until the escrow holds nothing more for the campaign and the merchant is paid. */
export async function waitSettled(
  w: World,
  campaign: LiveCampaign,
  outcome: Outcome,
): Promise<void> {
  const status = outcome === "yes" ? "settled_yes" : "settled_no";
  await w.waitFor(
    `the campaign to be settled ${outcome} and finished`,
    async () => {
      const onchain = await onchainCampaign(w, campaign.onchainId);
      const detail = await api.campaign(campaign.merchant.headers, campaign.id);
      return {
        ok:
          detail.status === status &&
          onchain.released &&
          onchain.merchantDue === 0n &&
          onchain.lockedRefunds === 0n,
        seen: { detail: { status: detail.status, outcome: detail.outcome }, onchain },
      };
    },
    60_000,
  );
}

/**
 * The guarantee of each ticket respects the campaign's cost cap: computeQuote caps it at
 * floor(paid × (usual margin − minimum margin) / 10 000), so the merchant's budget is never
 * reserved, or charged, beyond what the promo allows to spend per sale.
 */
export function expectGuaranteesCapped(
  campaign: Pick<LiveCampaign, "terms">,
  tickets: readonly SoldTicket[],
): void {
  const maxCostBps = BigInt(campaign.terms.usualMarginBps - campaign.terms.minMarginBps);
  for (const ticket of tickets) {
    expect(
      ticket.maxHedgeCost,
      `guarantee of ticket ${ticket.ticketId.toString()}`,
    ).toBeLessThanOrEqual((ticket.paid * maxCostBps) / 10_000n);
  }
}

export function sum(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

/** The YES ledger of one campaign, to the micro-unit. */
export async function expectYesLedger(
  w: World,
  campaign: LiveCampaign,
  tickets: readonly SoldTicket[],
  charges: readonly { ticketId: bigint; amount: bigint }[],
  treasury: Address,
  treasuryBefore: bigint,
): Promise<void> {
  const budget = campaign.terms.budget;
  const paid = sum(tickets.map((ticket) => ticket.paid));
  const refundable = sum(tickets.map((ticket) => ticket.refundable));
  const spent = sum(charges.map((charge) => charge.amount));
  // One charge per ticket, never above its guarantee.
  expect(charges.map((charge) => charge.ticketId).sort()).toEqual(
    tickets.map((ticket) => ticket.ticketId).sort(),
  );
  for (const ticket of tickets) {
    const charge = charges.find((item) => item.ticketId === ticket.ticketId);
    expect(charge?.amount ?? -1n).toBeLessThanOrEqual(ticket.maxHedgeCost);
  }
  expectGuaranteesCapped(campaign, tickets);
  expect(await countFor(w, "CampaignSettled", campaign.onchainId)).toBe(1);
  expect(await countFor(w, "TicketRefunded", campaign.onchainId)).toBe(tickets.length);
  expect(await countFor(w, "MerchantPaid", campaign.onchainId)).toBe(1);
  expect(await countFor(w, "CampaignReleased", campaign.onchainId)).toBe(1);

  // Every buyer received exactly its refundable amount.
  await expectRefunded(w, tickets);
  // The merchant: the non-refundable part of each sale, its due (the refunds' worth, YES), the
  // unspent budget.
  const merchant = getAddress(campaign.merchant.wallet);
  expect(await tokenBalance(w, merchant)).toBe(paid - refundable + refundable + budget - spent);
  // The escrow holds nothing for the campaign (it is the only one of this escrow).
  expect(await tokenBalance(w, w.escrow.escrow)).toBe(0n);
  const settled = await onchainCampaign(w, campaign.onchainId);
  expect(settled).toMatchObject({
    status: 2,
    hedgeReserved: 0n,
    hedgeSpent: spent,
    lockedRefunds: 0n,
    merchantDue: 0n,
    released: true,
  });
  // What left the treasury: the budget, every sale (paid on the customer's behalf), the due;
  // what came back: the hedge charged.
  const treasuryAfter = await tokenBalance(w, treasury);
  expect(treasuryBefore - treasuryAfter).toBe(budget + paid + refundable - spent);
  // Nothing created or lost: what the treasury spent is what the others hold.
  const buyers = sum(tickets.map((ticket) => ticket.refundable));
  expect(treasuryBefore - treasuryAfter).toBe(
    buyers + (await tokenBalance(w, merchant)) + (await tokenBalance(w, w.escrow.escrow)),
  );
}

/** The merchant's report after settlement agrees with the chain. */
export function expectReport(
  detail: CampaignDetail,
  tickets: readonly SoldTicket[],
  charges: readonly { amount: bigint }[],
  outcome: Outcome,
): void {
  const units = tickets.reduce((total, ticket) => total + ticket.qty, 0);
  const refunds = sum(tickets.map((ticket) => ticket.refundable));
  const spent = sum(charges.map((charge) => charge.amount));
  expect(detail.outcome).toBe(outcome);
  expect(detail.sales).toBe(units);
  expect(detail.hedgeSpent).toBe(spent.toString());
  expect(detail.hedgeReserved).toBe("0");
  expect(detail.demo).toBe(false);
  expect(detail.report).not.toBeNull();
  expect(detail.report).toMatchObject({
    sales: units,
    newCustomers: new Set(tickets.map((ticket) => ticket.buyer)).size,
    hedgeCost: spent.toString(),
    refundsPaid: (outcome === "yes" ? refunds : 0n).toString(),
  });
}
