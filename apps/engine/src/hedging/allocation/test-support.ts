/**
 * Fixtures of the allocation tests: rows of the catalogue, campaigns, tickets, lots and orders,
 * written straight into a test database, and a small deterministic random generator for the
 * property loops (fast-check is not a dependency of the engine).
 */
import { randomBytes } from "node:crypto";

import type { Db } from "../../db";

/** xorshift128+ on bigint: the same seed always gives the same sequence. */
export class SeededRandom {
  private s0: bigint;
  private s1: bigint;
  private static readonly MASK = (1n << 64n) - 1n;

  constructor(seed: number) {
    this.s0 = (BigInt(seed) * 0x9e3779b97f4a7c15n + 1n) & SeededRandom.MASK;
    this.s1 = (BigInt(seed) * 0xbf58476d1ce4e5b9n + 0x94d049bb133111ebn) & SeededRandom.MASK;
    for (let i = 0; i < 8; i += 1) this.next();
  }

  /** A uniform 64-bit unsigned integer. */
  next(): bigint {
    let x = this.s0;
    const y = this.s1;
    this.s0 = y;
    x = (x ^ (x << 23n)) & SeededRandom.MASK;
    this.s1 = x ^ y ^ (x >> 17n) ^ (y >> 26n);
    return (this.s1 + y) & SeededRandom.MASK;
  }

  /** A bigint in [min, max]. */
  between(min: bigint, max: bigint): bigint {
    if (max < min) throw new RangeError("max < min");
    return min + (this.next() % (max - min + 1n));
  }

  /** An integer in [min, max]. */
  int(min: number, max: number): number {
    return Number(this.between(BigInt(min), BigInt(max)));
  }

  /** True with probability `numerator / denominator`. */
  chance(numerator: number, denominator: number): boolean {
    return this.int(1, denominator) <= numerator;
  }
}

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export interface MarketFixture {
  eventTicker: string;
  instrument: string;
}

/** One event and one instrument of it. */
export async function createMarket(db: Db, suffix: string = hex(4)): Promise<MarketFixture> {
  const eventTicker = `EV-${suffix}`.toUpperCase();
  const instrument = `${eventTicker}-HOME`;
  await db`
    insert into events (ticker, title, sport, league, home_name, home_abbreviation, away_name,
                        away_abbreviation, starts_at, sales_close_at, status)
    values (${eventTicker}, 'Home vs Away', 'football', 'NFL', 'Home', 'HOM', 'Away', 'AWY',
            now() + interval '2 days', now() + interval '1 day', 'active')
  `;
  await db`
    insert into instruments (symbol, event_ticker, label, type, onchain_id)
    values (${instrument}, ${eventTicker}, 'Home wins', 'moneyline', ${`0x${hex(32)}`})
  `;
  return { eventTicker, instrument };
}

let nextOnchainId = 1n;
function onchainId(): bigint {
  const id = nextOnchainId;
  nextOnchainId += 1n;
  return id;
}

export interface CampaignFixture {
  campaignId: string;
  campaignOnchainId: bigint;
  merchantId: string;
}

/** A merchant (and its user) with one live campaign on the instrument. */
export async function createCampaign(
  db: Db,
  market: MarketFixture,
  options: { status?: string; outcome?: string | null; onchain?: boolean; onchainId?: bigint } = {},
): Promise<CampaignFixture> {
  const [user] = await db<{ id: string }[]>`
    insert into users (email, roles) values (${`m-${hex(6)}@example.com`}, ${["merchant"]}::text[])
    returning id
  `;
  if (user === undefined) throw new Error("user insert failed");
  const [merchant] = await db<{ id: string }[]>`
    insert into merchants (user_id, name, category) values (${user.id}, 'Bar', 'bar') returning id
  `;
  if (merchant === undefined) throw new Error("merchant insert failed");
  const campaignOnchainId = options.onchainId ?? onchainId();
  const [campaign] = await db<{ id: string }[]>`
    insert into campaigns (onchain_id, merchant_id, instrument, event_ticker, product, condition_label,
                           promise, unit_price, refund_bps, usual_margin_bps, min_margin_bps,
                           pause_threshold_bps, budget, sales_close, status, outcome)
    values (${options.onchain === false ? null : campaignOnchainId.toString()}::bigint, ${merchant.id},
            ${market.instrument}, ${market.eventTicker}, 'Beer', 'Home wins', 'Refunded if Home wins',
            5000000, 10000, 3000, 1000, 6000, 100000000, now() + interval '1 day',
            ${options.status ?? "live"}, ${options.outcome ?? null})
    returning id
  `;
  if (campaign === undefined) throw new Error("campaign insert failed");
  return { campaignId: campaign.id, campaignOnchainId, merchantId: merchant.id };
}

export interface LotFixture {
  lotId: string;
  ticketId: string;
  ticketOnchainId: bigint;
  seq: bigint;
}

/** A ticket of the campaign and its lot of `qty` micro-contracts guaranteed at `maxHedgeCost`. */
export async function createLot(
  db: Db,
  market: MarketFixture,
  campaign: CampaignFixture,
  qty: bigint,
  maxHedgeCost: bigint,
  options: { onchain?: boolean; seq?: bigint; onchainId?: bigint } = {},
): Promise<LotFixture> {
  const ticketOnchainId = options.onchainId ?? onchainId();
  const paid = qty > maxHedgeCost ? qty : maxHedgeCost;
  const [ticket] = await db<{ id: string }[]>`
    insert into tickets (onchain_id, campaign_id, buyer, qty, paid, refundable, max_hedge_cost, access_token)
    values (${options.onchain === false ? null : ticketOnchainId.toString()}::bigint, ${campaign.campaignId},
            ${`0x${hex(20)}`}, 1, ${paid.toString()}::bigint, ${qty.toString()}::bigint,
            ${maxHedgeCost.toString()}::bigint, ${hex(16)})
    returning id
  `;
  if (ticket === undefined) throw new Error("ticket insert failed");
  const rows =
    options.seq === undefined
      ? await db<{ id: string; seq: bigint }[]>`
          insert into lots (ticket_id, campaign_id, instrument, qty, max_hedge_cost)
          values (${ticket.id}, ${campaign.campaignId}, ${market.instrument}, ${qty.toString()}::bigint,
                  ${maxHedgeCost.toString()}::bigint)
          returning id, seq
        `
      : await db<{ id: string; seq: bigint }[]>`
          insert into lots (seq, ticket_id, campaign_id, instrument, qty, max_hedge_cost)
          overriding system value
          values (${options.seq.toString()}::bigint, ${ticket.id}, ${campaign.campaignId}, ${market.instrument},
                  ${qty.toString()}::bigint, ${maxHedgeCost.toString()}::bigint)
          returning id, seq
        `;
  const lot = rows[0];
  if (lot === undefined) throw new Error("lot insert failed");
  return { lotId: lot.id, ticketId: ticket.id, ticketOnchainId, seq: lot.seq };
}

/** An order row of the instrument, big enough for every fill a test records on it. */
export async function createOrder(
  db: Db,
  market: MarketFixture,
  side: "buy" | "sell",
  options: { kind?: "maker" | "taker"; qty?: bigint; priceBps?: number } = {},
): Promise<string> {
  const [order] = await db<{ id: string }[]>`
    insert into orders (instrument, side, kind, price_bps, qty, venue, status)
    values (${market.instrument}, ${side}, ${options.kind ?? "taker"}, ${options.priceBps ?? 9900},
            ${(options.qty ?? 1_000_000_000_000n).toString()}::bigint, 'paper', 'working')
    returning id
  `;
  if (order === undefined) throw new Error("order insert failed");
  return order.id;
}

export interface LotState {
  id: string;
  seq: bigint;
  campaign_id: string;
  qty: bigint;
  filled_qty: bigint;
  cost: bigint;
  max_hedge_cost: bigint;
  charged: boolean;
}

export async function lotStates(db: Db, instrument: string): Promise<LotState[]> {
  return db<LotState[]>`
    select id, seq, campaign_id, qty, filled_qty, cost, max_hedge_cost, charged
    from lots where instrument = ${instrument} order by seq
  `;
}

/** What the chain projection does when `HedgeCharged` arrives. */
export async function markChargedAsProjectionWould(
  db: Db,
  ticketOnchainId: bigint,
  amount: bigint,
): Promise<void> {
  await db`
    update lots set charged = true, charged_amount = ${amount.toString()}::bigint
    from tickets
    where lots.ticket_id = tickets.id and tickets.onchain_id = ${ticketOnchainId.toString()}::bigint
  `;
}
