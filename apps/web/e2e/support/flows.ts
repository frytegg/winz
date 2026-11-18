import { randomBytes, randomUUID } from "node:crypto";

import { expect } from "vitest";
import { getAddress, type Address } from "viem";

import type {
  CampaignDetail,
  CheckoutStatusResponse,
  MerchantCategory,
  PublicCampaign,
  Ticket,
  TicketPhase,
} from "@winz/shared";

import { randomWallet } from "@/lib/server/testing/fixtures";

import { api, bearer, type AuthHeaders } from "./api";
import type { World } from "./world";

/** The steps a scenario repeats, made only of route calls, payer actions and webhooks. */

export interface MerchantSession {
  headers: AuthHeaders;
  email: string;
  wallet: Address;
  merchantId: string;
}

/** A merchant signs in (fake Privy, with an embedded wallet) and creates their business. */
export async function signUpMerchant(
  world: World,
  name: string,
  category: MerchantCategory = "bar",
): Promise<MerchantSession> {
  const handle = randomBytes(5).toString("hex");
  const token = `token-${handle}`;
  const email = `owner-${handle}@example.com`;
  // Lowercase, as the Privy adapter hands wallets over.
  const lowercase = randomWallet();
  const wallet = getAddress(lowercase);
  world.identity.addUser(token, `did:privy:${handle}`, { email, walletAddress: lowercase });
  const headers = bearer(token);
  const me = await api.me(headers);
  expect(me.merchant).toBeNull();
  const merchant = await api.createMerchant(headers, { name, category });
  return { headers, email, wallet, merchantId: merchant.id };
}

export interface Terms {
  unitPrice: bigint;
  refundBps: number;
  usualMarginBps: number;
  minMarginBps: number;
  budget: bigint;
}

/** $20 a unit, all of it back on YES, a cost cap of 20 % of the price, a $200 hedge budget. */
export const DEFAULT_TERMS: Terms = {
  unitPrice: 20_000_000n,
  refundBps: 10_000,
  usualMarginBps: 6_500,
  minMarginBps: 4_500,
  budget: 200_000_000n,
};

function wireTerms(
  symbol: string,
  terms: Terms,
): {
  instrumentSymbol: string;
  unitPrice: string;
  refundBps: number;
  usualMarginBps: number;
  minMarginBps: number;
  budget: string;
} {
  return {
    instrumentSymbol: symbol,
    unitPrice: terms.unitPrice.toString(),
    refundBps: terms.refundBps,
    usualMarginBps: terms.usualMarginBps,
    minMarginBps: terms.minMarginBps,
    budget: terms.budget.toString(),
  };
}

export interface LiveCampaign {
  id: string;
  slug: string;
  onchainId: bigint;
  budgetPi: string;
  symbol: string;
  terms: Terms;
  merchant: MerchantSession;
}

/**
 * Screens M3 to M7 and the budget payment: the game is listed with this promo, the preview says it
 * can sell (`expectOpen`), the campaign is created, the merchant pays its budget on Stripe's sheet
 * and Stripe's webhook arrives (twice, as Stripe may deliver it); the engine then puts it on-chain
 * and it answers live with its slug.
 */
export async function launchCampaign(
  world: World,
  merchant: MerchantSession,
  symbol: string,
  options: { terms?: Terms; product?: string; expectOpen?: boolean } = {},
): Promise<LiveCampaign> {
  const terms = options.terms ?? DEFAULT_TERMS;
  const listed = await api.events(merchant.headers);
  const game = listed.events.find((event) => event.ticker === world.game.ticker);
  expect(game, "the game is listed by GET /api/events").toBeDefined();

  if (options.expectOpen !== false) {
    // The preview asks the engine to follow the instrument; it can sell once the book is in.
    await world.waitFor("the preview to answer open", async () => {
      const preview = await api.preview(merchant.headers, wireTerms(symbol, terms));
      return { ok: preview.saleState === "open", seen: preview };
    });
  }

  // One requestId per "Fund" tap, as the front sends it: the creation is idempotent on it.
  const created = await api.createCampaign(merchant.headers, {
    ...wireTerms(symbol, terms),
    product: options.product ?? "Large pizza",
    requestId: randomUUID(),
  });
  expect(created.status).toBe("funding");
  expect(created.budgetPayment.amount).toBe(terms.budget.toString());
  const budgetPi = created.budgetPayment.paymentIntentId;

  world.stripe.confirmCard(budgetPi, merchant.email);
  const delivery = world.stripe.webhookDelivery("payment_intent.succeeded", budgetPi);
  await api.stripeWebhook(delivery);
  await api.stripeWebhook(delivery);

  let detail: CampaignDetail | null = null;
  await world.waitFor("the campaign to go live with a slug", async () => {
    detail = await api.campaign(merchant.headers, created.campaignId);
    return { ok: detail.status === "live" && detail.slug !== null, seen: detail };
  });
  const live = detail as CampaignDetail | null;
  if (live === null || live.slug === null || live.onchain === null) {
    throw new Error("the campaign went live without a slug or on-chain id");
  }
  return {
    id: created.campaignId,
    slug: live.slug,
    onchainId: BigInt(live.onchain.campaignId),
    budgetPi,
    symbol,
    terms,
    merchant,
  };
}

/** Waits until the public campaign page answers this sale state. */
export async function waitSaleState(
  world: Pick<World, "waitFor">,
  slug: string,
  saleState: PublicCampaign["saleState"],
  timeoutMs?: number,
): Promise<PublicCampaign> {
  let page: PublicCampaign | null = null;
  await world.waitFor(
    `the campaign page to answer ${saleState}`,
    async () => {
      page = await api.publicCampaign(slug);
      return { ok: page.saleState === saleState, seen: page };
    },
    timeoutMs,
  );
  const answered = page as PublicCampaign | null;
  if (answered === null) throw new Error("unreachable: no campaign page");
  return answered;
}

export interface Purchase {
  pi: string;
  qty: number;
  email: string;
  amount: bigint;
  /** When the confirmation route answered (wall clock, ms). */
  confirmedAtMs: number;
}

/**
 * A customer buys on the campaign page: the checkout route creates the authorization, the
 * customer confirms the card on Stripe's sheet, the front calls the confirmation route, and
 * Stripe's `amount_capturable_updated` webhook arrives too (either can come first in production).
 */
export async function buy(
  world: World,
  slug: string,
  qty: number,
  email: string,
  options: {
    webhook?: boolean;
    /** Runs once the authorization exists, before the customer confirms the card. */
    beforeConfirm?: (paymentIntentId: string) => void;
  } = {},
): Promise<Purchase> {
  const checkout = await api.checkout(slug, qty);
  options.beforeConfirm?.(checkout.paymentIntentId);
  world.stripe.confirmCard(checkout.paymentIntentId, email);
  const confirmed = await api.confirm(checkout.paymentIntentId);
  const confirmedAtMs = Date.now();
  expect(["processing", "ticketed", "cancelled_paused"]).toContain(confirmed.status);
  if (options.webhook !== false) {
    await api.stripeWebhook(
      world.stripe.webhookDelivery(
        "payment_intent.amount_capturable_updated",
        checkout.paymentIntentId,
      ),
    );
  }
  return {
    pi: checkout.paymentIntentId,
    qty,
    email,
    amount: BigInt(checkout.amount),
    confirmedAtMs,
  };
}

/** Polls the checkout status route until it answers `status`. */
export async function waitCheckout(
  world: World,
  pi: string,
  status: CheckoutStatusResponse["status"],
  timeoutMs?: number,
): Promise<CheckoutStatusResponse> {
  let answer: CheckoutStatusResponse | null = null;
  await world.waitFor(
    `the checkout ${pi} to answer ${status}`,
    async () => {
      answer = await api.checkoutStatus(pi);
      return { ok: answer.status === status, seen: answer };
    },
    timeoutMs,
  );
  const answered = answer as CheckoutStatusResponse | null;
  if (answered === null) throw new Error("unreachable: no checkout status");
  return answered;
}

/** The token of a ticketed purchase. */
export async function waitTicketed(world: World, pi: string): Promise<string> {
  const status = await waitCheckout(world, pi, "ticketed");
  if (status.ticketToken === null) throw new Error(`checkout ${pi} ticketed without a token`);
  return status.ticketToken;
}

/**
 * The ticket page showing `phase`. A refund is paid on-chain a moment before its event is
 * projected into the ticket, so a scenario that has seen the money arrive waits for the page
 * instead of reading it once.
 */
export async function waitTicketPhase(
  world: World,
  token: string,
  phase: TicketPhase,
): Promise<Ticket> {
  let shown: Ticket | null = null;
  await world.waitFor(
    `the ticket to show ${phase}`,
    async () => {
      shown = await api.ticket(token);
      return { ok: shown.phase === phase, seen: { phase: shown.phase } };
    },
    15_000,
  );
  const answered = shown as Ticket | null;
  if (answered === null) throw new Error("unreachable: no ticket");
  return answered;
}

/** A fresh customer e-mail. */
export function customerEmail(name: string): string {
  return `${name}-${randomBytes(4).toString("hex")}@example.com`;
}
