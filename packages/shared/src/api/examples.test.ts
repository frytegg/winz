import { describe, expect, it } from "vitest";

import { BPS, mulDivDown, refundableAmount } from "../units";

import {
  campaignDetailExamples,
  campaignPreviewRequestExample,
  campaignsExample,
  campaignsWithCancelledExample,
  checkoutExample,
  hedgeDeskExample,
  meExamples,
  merchantExample,
  publicCampaignExamples,
  ticketExamples,
  ticketsExample,
  ticketsExamples,
} from "./examples";
import { API_ROUTES } from "./routes";

/**
 * The examples tell one story, the one of the promos filmed for the demo: « Buzzball’s shop » sells
 * a $12 smash burger. Every figure is derived from that price, and the derived figures add up.
 */

const NAME = "Buzzball’s shop";
const PRODUCT = "Smash burger";
const PRICE = 12_000_000n;

const detail = campaignDetailExamples.live;

describe("the running example: Buzzball’s shop, a $12 smash burger", () => {
  it("names the merchant as production stores it, typographic apostrophe included", () => {
    expect(merchantExample.name).toBe(NAME);
    expect(merchantExample.name).toContain("’");
    expect(merchantExample.name).not.toContain("'");
    expect(meExamples.merchant.merchant.name).toBe(NAME);
    expect(publicCampaignExamples.live.merchant.name).toBe(NAME);
    expect(ticketExamples.preGame.merchant.name).toBe(NAME);
  });

  it("sells the same product at the same price on every screen", () => {
    expect(BigInt(detail.unitPrice)).toBe(PRICE);
    expect(BigInt(publicCampaignExamples.live.unitPrice)).toBe(PRICE);
    expect(BigInt(campaignPreviewRequestExample.unitPrice)).toBe(PRICE);
    expect(BigInt(checkoutExample.amount)).toBe(PRICE);
    for (const product of [
      detail.product,
      publicCampaignExamples.live.product,
      ticketExamples.preGame.product,
      ...campaignsExample.campaigns.map((campaign) => campaign.product),
    ]) {
      expect(product).toBe(PRODUCT);
    }
  });

  it("leaves no trace of the former example", () => {
    const text = JSON.stringify(
      Object.fromEntries(Object.entries(API_ROUTES).map(([name, route]) => [name, route.examples])),
    );
    expect(text).not.toMatch(/Joe's|Large pizza|joes-texas|joes-pitt|joe@/);
  });

  it("adds up the gross sales and the exposure of every promo", () => {
    for (const campaign of campaignsWithCancelledExample.campaigns) {
      expect(BigInt(campaign.revenue), campaign.id).toBe(BigInt(campaign.sales) * PRICE);
    }
    for (const [scenario, campaign] of Object.entries(campaignDetailExamples)) {
      expect(BigInt(campaign.revenue), scenario).toBe(BigInt(campaign.sales) * PRICE);
      expect(BigInt(campaign.exposure), scenario).toBe(
        refundableAmount(BigInt(campaign.sales), PRICE, BigInt(campaign.refundBps)),
      );
      expect(BigInt(campaign.budgetAvailable), scenario).toBe(
        BigInt(campaign.budget) - BigInt(campaign.hedgeSpent) - BigInt(campaign.hedgeReserved),
      );
      expect(BigInt(campaign.received) + BigInt(campaign.pending), scenario).toBe(
        BigInt(campaign.revenue),
      );
    }
  });

  it("reports what the promo cost and paid, once the game is over", () => {
    for (const scenario of ["settledYes", "settledNo", "cancelled"] as const) {
      const campaign = campaignDetailExamples[scenario];
      const report = campaign.report;
      expect(report, scenario).not.toBeNull();
      if (report === null) continue;
      expect(report.sales).toBe(campaign.sales);
      expect(BigInt(report.paidToMerchant), scenario).toBe(BigInt(campaign.received));
      expect(BigInt(report.paidToMerchant), scenario).toBe(BigInt(campaign.revenue));
      expect(BigInt(report.hedgeCostBps), scenario).toBe(
        mulDivDown(BigInt(report.hedgeCost), BPS, BigInt(campaign.revenue)),
      );
      expect(BigInt(report.refundsPaid), scenario).toBe(
        scenario === "settledYes" ? BigInt(campaign.exposure) : 0n,
      );
    }
  });

  it("gives the merchant the balance of his promos: settled ones available, live ones pending", () => {
    const balance = meExamples.merchant.balance;
    const settled = campaignsExample.campaigns.filter((c) => c.status === "settled_no");
    const running = campaignsExample.campaigns.filter((c) => c.status === "live");
    expect(settled.length).toBeGreaterThan(0);
    expect(BigInt(balance.available)).toBe(
      settled.reduce((sum, campaign) => sum + BigInt(campaign.revenue), 0n),
    );
    expect(BigInt(balance.available)).toBeGreaterThan(0n);
    expect(BigInt(balance.pending)).toBe(
      running.reduce((sum, campaign) => sum + BigInt(campaign.revenue), 0n),
    );
  });

  it("prices every ticket from the unit price, and totals the refunds", () => {
    const lists = [ticketsExample, ...Object.values(ticketsExamples)];
    for (const list of lists) {
      let refunded = 0n;
      for (const ticket of list.tickets) {
        expect(BigInt(ticket.paid), ticket.token).toBe(BigInt(ticket.qty) * PRICE);
        expect(ticket.merchant.name).toBe(NAME);
        if (ticket.phase === "refunded") refunded += BigInt(ticket.refundable);
      }
      expect(BigInt(list.refundedTotal)).toBe(refunded);
    }
  });

  it("covers on the Hedge desk the exposure of the live promo", () => {
    const instrument = hedgeDeskExample.instruments[0];
    expect(instrument?.exposure).toBe(detail.exposure);
    if (instrument === undefined) return;
    expect(BigInt(instrument.held) + BigInt(instrument.working)).toBe(BigInt(instrument.exposure));
    const filled = instrument.orders.reduce((sum, order) => sum + BigInt(order.filledQty), 0n);
    expect(filled).toBe(BigInt(instrument.held));
    const fills = instrument.fills.reduce((sum, fill) => sum + BigInt(fill.qty), 0n);
    expect(fills).toBe(BigInt(instrument.held));
  });
});
