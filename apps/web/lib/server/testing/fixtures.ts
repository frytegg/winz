import { createHash, randomBytes } from "node:crypto";

import type { CampaignStatus, MerchantCategory, Outcome, SaleState } from "@winz/shared";

import {
  InvalidAccessTokenError,
  type AuthDeps,
  type AuthVerifier,
  type DirectoryUser,
  type IdentityDirectory,
  type VerifiedToken,
} from "../auth";
import type { Db } from "../db";
import type { ServerConfig, ServerDeps } from "../deps";
import type { PaymentGateway } from "../payments-gateway";
import { FakePaymentGateway } from "./fake-payments";

/**
 * Test-only helpers: a fake identity provider and row builders for the real test database. The SQL
 * of the modules under test runs for real; only Privy is replaced.
 */

export const ADMIN_KEY = "test-admin-key-0123456789";
export const TEST_CONFIG: ServerConfig = {
  adminKey: ADMIN_KEY,
  baseUrl: "https://winz.test",
  escrowAddress: "0x2222222222222222222222222222222222222222",
  executionVenue: "paper",
};

/** The words no customer-facing answer may contain (SPEC section 5). */
export const CRYPTO_WORDS = ["wallet", "usdc", "blockchain", "gas", "seed", "crypto"] as const;

/** The crypto words found in a JSON payload, case-insensitive. */
export function cryptoWordsIn(payload: unknown): string[] {
  const text = JSON.stringify(payload).toLowerCase();
  return CRYPTO_WORDS.filter((word) => text.includes(word));
}

/** A fake of Privy: tokens map to user ids, user ids to profiles. */
export class FakeIdentity implements AuthVerifier, IdentityDirectory {
  readonly tokens = new Map<string, string>();
  readonly users = new Map<string, DirectoryUser>();
  getUserCalls = 0;
  /** Delay of `getUser`, to make concurrent first requests overlap. */
  delayMs = 0;
  /** Thrown by `verify` instead of a rejection, to simulate an outage. */
  failure: Error | null = null;

  addUser(
    token: string,
    privyUserId: string,
    profile: { email: string | null; walletAddress?: string | null },
  ): void {
    this.tokens.set(token, privyUserId);
    this.users.set(privyUserId, {
      email: profile.email,
      walletAddress: profile.walletAddress ?? null,
    });
  }

  async verify(accessToken: string): Promise<VerifiedToken> {
    if (this.failure) throw this.failure;
    const privyUserId = this.tokens.get(accessToken);
    if (privyUserId === undefined) throw new InvalidAccessTokenError("unknown token");
    return { privyUserId };
  }

  async getUser(privyUserId: string): Promise<DirectoryUser> {
    this.getUserCalls += 1;
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const user = this.users.get(privyUserId);
    if (!user) throw new Error(`unknown privy user ${privyUserId}`);
    return user;
  }

  async findOrCreateWalletByEmail(
    email: string,
  ): Promise<{ privyUserId: string; walletAddress: string }> {
    for (const [privyUserId, user] of this.users) {
      if (user.email === email && user.walletAddress) {
        return { privyUserId, walletAddress: user.walletAddress };
      }
    }
    const privyUserId = `did:privy:${randomBytes(6).toString("hex")}`;
    const walletAddress = randomWallet();
    this.users.set(privyUserId, { email, walletAddress });
    return { privyUserId, walletAddress };
  }
}

export function authDeps(db: Db, identity: FakeIdentity): AuthDeps {
  return { db, verifier: identity, directory: identity, adminKey: () => ADMIN_KEY };
}

export function serverDepsFor(
  db: Db,
  identity: FakeIdentity,
  now: Date,
  payments: PaymentGateway = new FakePaymentGateway(),
): ServerDeps {
  return {
    db,
    verifier: identity,
    directory: identity,
    payments,
    config: () => TEST_CONFIG,
    now: () => now,
  };
}

export function randomWallet(): string {
  return `0x${randomBytes(20).toString("hex")}`;
}

function onchainIdOf(symbol: string): string {
  return `0x${createHash("sha256").update(symbol).digest("hex")}`;
}

const MINUTE = 60_000;

export function minutesFrom(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * MINUTE);
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

export interface EventInput {
  ticker: string;
  title?: string;
  sport?: string;
  league?: string;
  home?: { name: string; abbreviation: string; logoUrl?: string | null };
  away?: { name: string; abbreviation: string; logoUrl?: string | null };
  startsAt: Date;
  salesCloseAt?: Date;
  status?: string;
}

export async function insertEvent(db: Db, input: EventInput): Promise<void> {
  const home = input.home ?? { name: "Texas Longhorns", abbreviation: "TEX" };
  const away = input.away ?? { name: "Arkansas Razorbacks", abbreviation: "ARK" };
  const salesCloseAt = input.salesCloseAt ?? new Date(input.startsAt.getTime() - 5 * MINUTE);
  await db`
    insert into events (
      ticker, title, sport, league, home_name, home_abbreviation, home_logo_url,
      away_name, away_abbreviation, away_logo_url, starts_at, sales_close_at, status
    ) values (
      ${input.ticker}, ${input.title ?? "Arkansas vs Texas"}, ${input.sport ?? "football"},
      ${input.league ?? "NCAAF"}, ${home.name}, ${home.abbreviation}, ${home.logoUrl ?? null},
      ${away.name}, ${away.abbreviation}, ${away.logoUrl ?? null},
      ${input.startsAt}, ${salesCloseAt}, ${input.status ?? "active"}
    )
  `;
}

export interface InstrumentInput {
  symbol: string;
  eventTicker: string;
  label: string;
  type?: "moneyline" | "spread" | "total";
  bidBps?: number | null;
  askBps?: number | null;
  syncedAt?: Date | null;
  active?: boolean;
}

export async function insertInstrument(db: Db, input: InstrumentInput): Promise<void> {
  await db`
    insert into instruments (
      symbol, event_ticker, label, type, onchain_id, best_bid_bps, best_ask_bps, active, synced_at
    ) values (
      ${input.symbol}, ${input.eventTicker}, ${input.label}, ${input.type ?? "spread"},
      ${onchainIdOf(input.symbol)}, ${input.bidBps ?? null}, ${input.askBps ?? null},
      ${input.active ?? true}, ${input.syncedAt === undefined ? new Date() : input.syncedAt}
    )
  `;
}

/** A users row with a business. Returns both ids. */
export async function insertMerchant(
  db: Db,
  input: {
    email: string;
    privyId?: string | null;
    wallet?: string | null;
    name?: string;
    category?: MerchantCategory;
  },
): Promise<{ userId: string; merchantId: string }> {
  const [user] = await db<{ id: string }[]>`
    insert into users (email, privy_id, wallet, roles)
    values (${input.email}, ${input.privyId ?? null}, ${input.wallet ?? null}, '{merchant}')
    returning id
  `;
  if (!user) throw new Error("users insert returned no row");
  const [merchant] = await db<{ id: string }[]>`
    insert into merchants (user_id, name, category)
    values (${user.id}, ${input.name ?? "Joe's Pizza"}, ${input.category ?? "pizza"})
    returning id
  `;
  if (!merchant) throw new Error("merchants insert returned no row");
  return { userId: user.id, merchantId: merchant.id };
}

export interface CampaignInput {
  merchantId: string;
  instrument: string;
  eventTicker: string;
  salesClose: Date;
  slug?: string | null;
  onchainId?: bigint | null;
  product?: string;
  conditionLabel?: string;
  promise?: string;
  unitPrice?: bigint;
  refundBps?: number;
  usualMarginBps?: number;
  minMarginBps?: number;
  pauseThresholdBps?: number;
  budget?: bigint;
  status?: CampaignStatus;
  saleState?: SaleState;
  outcome?: Outcome | null;
  demo?: boolean;
  createdAt?: Date;
}

export async function insertCampaign(db: Db, input: CampaignInput): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    insert into campaigns (
      merchant_id, instrument, event_ticker, product, condition_label, promise, unit_price,
      refund_bps, usual_margin_bps, min_margin_bps, pause_threshold_bps, budget, sales_close,
      status, sale_state, slug, outcome, onchain_id, demo, created_at
    ) values (
      ${input.merchantId}, ${input.instrument}, ${input.eventTicker},
      ${input.product ?? "Large pizza"}, ${input.conditionLabel ?? "Texas wins by 14+"},
      ${input.promise ?? "100% back if Texas wins by 14+"}, ${input.unitPrice ?? 20_000_000n},
      ${input.refundBps ?? 10_000}, ${input.usualMarginBps ?? 6500}, ${input.minMarginBps ?? 4500},
      ${input.pauseThresholdBps ?? 1800}, ${input.budget ?? 1_000_000_000n}, ${input.salesClose},
      ${input.status ?? "live"}, ${input.saleState ?? "open"},
      ${input.slug === undefined ? null : input.slug}, ${input.outcome ?? null},
      ${input.onchainId ?? null}, ${input.demo ?? false}, ${input.createdAt ?? new Date()}
    )
    returning id
  `;
  if (!row) throw new Error("campaigns insert returned no row");
  return row.id;
}

export interface TicketInput {
  campaignId: string;
  buyer: string;
  qty?: number;
  paid?: bigint;
  refundable?: bigint;
  maxHedgeCost?: bigint;
  status?: "issued" | "refunded" | "refund_failed";
  token?: string;
  purchasedAt?: Date;
  refundedAt?: Date | null;
}

export async function insertTicket(
  db: Db,
  input: TicketInput,
): Promise<{ id: string; token: string }> {
  const token = input.token ?? `tkt_${randomBytes(12).toString("hex")}`;
  const [row] = await db<{ id: string }[]>`
    insert into tickets (
      campaign_id, buyer, qty, paid, refundable, max_hedge_cost, status, access_token,
      purchased_at, refunded_at
    ) values (
      ${input.campaignId}, ${input.buyer}, ${input.qty ?? 1}, ${input.paid ?? 20_000_000n},
      ${input.refundable ?? 20_000_000n}, ${input.maxHedgeCost ?? 2_748_000n},
      ${input.status ?? "issued"}, ${token}, ${input.purchasedAt ?? new Date()},
      ${input.refundedAt ?? null}
    )
    returning id
  `;
  if (!row) throw new Error("tickets insert returned no row");
  return { id: row.id, token };
}

export async function insertLot(
  db: Db,
  input: {
    ticketId: string;
    campaignId: string;
    instrument: string;
    qty: bigint;
    filledQty: bigint;
    maxHedgeCost: bigint;
    chargedAmount: bigint | null;
  },
): Promise<void> {
  await db`
    insert into lots (
      ticket_id, campaign_id, instrument, qty, max_hedge_cost, filled_qty, charged, charged_amount
    ) values (
      ${input.ticketId}, ${input.campaignId}, ${input.instrument}, ${input.qty},
      ${input.maxHedgeCost}, ${input.filledQty}, ${input.chargedAmount !== null},
      ${input.chargedAmount}
    )
  `;
}

export async function insertLive(
  db: Db,
  input: { symbol: string; bidBps: number; askBps: number; observedAt: Date; stale?: boolean },
): Promise<void> {
  await db`
    insert into live_instruments (symbol, bid_bps, ask_bps, mid_bps, observed_at, stale)
    values (
      ${input.symbol}, ${input.bidBps}, ${input.askBps},
      ${Math.floor((input.bidBps + input.askBps) / 2)}, ${input.observedAt}, ${input.stale ?? false}
    )
  `;
}

export async function insertBook(
  db: Db,
  input: {
    symbol: string;
    bids: { priceBps: number; qty: bigint }[];
    asks: { priceBps: number; qty: bigint }[];
    observedAt: Date;
  },
): Promise<void> {
  const level = (entry: { priceBps: number; qty: bigint }): { priceBps: number; qty: string } => ({
    priceBps: entry.priceBps,
    qty: entry.qty.toString(),
  });
  await db`
    insert into book_cache (symbol, bids, asks, observed_at, source)
    values (
      ${input.symbol}, ${db.json(input.bids.map(level))}, ${db.json(input.asks.map(level))},
      ${input.observedAt}, 'ws'
    )
  `;
}

export async function insertPosition(
  db: Db,
  input: { instrument: string; exposure: bigint; held: bigint },
): Promise<void> {
  await db`
    insert into positions (instrument, exposure, held)
    values (${input.instrument}, ${input.exposure}, ${input.held})
  `;
}
