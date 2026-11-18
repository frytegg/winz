import { expect } from "vitest";
import { getAddress, type Address } from "viem";

import type { HedgeInstrument } from "@winz/shared";

import { bestAskOf, fillCost, takerCost } from "../../../engine/src/hedging/allocation";
import { parseBookRef } from "../../../engine/src/hedging/runtime/desk";
import { api } from "./api";
import type { Purchase } from "./flows";
import { escrowEvents, onchainTicket, tokenBalance, type World } from "./world";

/**
 * What the chain and the database say about the money of a campaign, read back for assertions.
 * Nothing here writes.
 */

export interface SoldTicket {
  ticketId: bigint;
  campaignOnchainId: bigint;
  buyer: Address;
  qty: number;
  paid: bigint;
  refundable: bigint;
  maxHedgeCost: bigint;
}

/** Every `TicketPurchased` of one on-chain campaign. */
export async function soldTickets(world: World, campaignOnchainId: bigint): Promise<SoldTicket[]> {
  const events = await escrowEvents(world, "TicketPurchased");
  return events
    .filter((event) => event.id === campaignOnchainId)
    .map((event) => ({
      ticketId: event.ticketId as bigint,
      campaignOnchainId: event.id as bigint,
      buyer: getAddress(event.buyer as string),
      qty: Number(event.qty as number | bigint),
      paid: event.paid as bigint,
      refundable: event.refundable as bigint,
      maxHedgeCost: event.maxHedgeCost as bigint,
    }))
    .sort((a, b) => (a.ticketId < b.ticketId ? -1 : 1));
}

/** `HedgeCharged` amounts of one on-chain campaign, by ticket id. */
export async function hedgeCharges(
  world: World,
  campaignOnchainId: bigint,
): Promise<{ ticketId: bigint; amount: bigint }[]> {
  const events = await escrowEvents(world, "HedgeCharged");
  return events
    .filter((event) => event.id === campaignOnchainId)
    .map((event) => ({ ticketId: event.ticketId as bigint, amount: event.amount as bigint }));
}

/** How many times the escrow emitted `eventName` for this campaign (field `id`). */
export async function countFor(
  world: World,
  eventName: Parameters<typeof escrowEvents>[1],
  campaignOnchainId: bigint,
): Promise<number> {
  return (await escrowEvents(world, eventName)).filter((event) => event.id === campaignOnchainId)
    .length;
}

/** The Hedge desk's row of an instrument, or null while it has none. */
export async function deskInstrument(symbol: string): Promise<HedgeInstrument | null> {
  const desk = await api.hedgeDesk();
  return desk.instruments.find((instrument) => instrument.symbol === symbol) ?? null;
}

export interface HedgeFill {
  kind: "maker" | "taker";
  priceBps: bigint;
  qty: bigint;
  fee: bigint;
  /** Best ask of the book the fill was matched against, when recorded. */
  bestAskBps: bigint | null;
}

/** Every buy fill of an instrument, as the engine recorded it. */
export async function hedgeFills(world: World, symbol: string): Promise<HedgeFill[]> {
  const rows = await world.db<
    { kind: "maker" | "taker"; price_bps: number; qty: bigint; fee: bigint; book_ref: unknown }[]
  >`
    select o.kind, f.price_bps, f.qty, f.fee, f.book_ref
    from fills f join orders o on o.id = f.order_id
    where o.instrument = ${symbol} and o.side = 'buy'
    order by f.created_at
  `;
  return rows.map((row) => ({
    kind: row.kind,
    priceBps: BigInt(row.price_bps),
    qty: row.qty,
    fee: row.fee,
    bestAskBps: bestAskOf(parseBookRef(row.book_ref)),
  }));
}

/** The real cost of the fills, fees included (what the venue was paid). */
export function fillsCost(fills: readonly HedgeFill[]): bigint {
  return fills.reduce((sum, fill) => sum + fillCost(fill.priceBps, fill.qty, fill.fee), 0n);
}

/** What resting as maker saved against taking the best ask each fill's book showed. */
export function makerSavingsOf(fills: readonly HedgeFill[]): bigint {
  return fills
    .filter((fill) => fill.kind === "maker" && fill.bestAskBps !== null)
    .reduce(
      (sum, fill) =>
        sum +
        (takerCost(fill.bestAskBps ?? 0n, fill.qty) - fillCost(fill.priceBps, fill.qty, fill.fee)),
      0n,
    );
}

/** `engine_pnl` of the game. */
export async function enginePnl(
  world: World,
): Promise<{ makerSavings: bigint; guaranteeLosses: bigint; resaleResult: bigint }> {
  const [row] = await world.db<
    { maker_savings: bigint; guarantee_losses: bigint; resale_result: bigint }[]
  >`
    select maker_savings, guarantee_losses, resale_result from engine_pnl
    where event_ticker = ${world.game.ticker}
  `;
  return {
    makerSavings: row?.maker_savings ?? 0n,
    guaranteeLosses: row?.guarantee_losses ?? 0n,
    resaleResult: row?.resale_result ?? 0n,
  };
}

/** Balances of every party, to compare before and after. */
export async function balances(
  world: World,
  accounts: readonly Address[],
): Promise<Map<Address, bigint>> {
  const result = new Map<Address, bigint>();
  for (const account of accounts) result.set(account, await tokenBalance(world, account));
  return result;
}

/**
 * The simulated Stripe charged each purchase exactly once, for its amount, and did nothing else:
 * no cancel, no refund, every engine call one of retrieve or capture.
 */
export function expectEachCapturedOnce(
  world: Pick<World, "stripe">,
  purchases: readonly Purchase[],
): void {
  for (const purchase of purchases) {
    const intent = world.stripe.intent(purchase.pi);
    expect(intent.metadata.kind).toBe("purchase");
    expect(intent.status).toBe("succeeded");
    expect(intent.captures, `captures of ${purchase.pi}`).toBe(1);
    // A second capture under a new idempotency key leaves `captures` at 1 (Stripe answers
    // payment_intent_unexpected_state, which the engine treats as done), so count the keys: the
    // engine must have asked for one capture per purchase, however many times it retried it.
    const keys = new Set(
      world.stripe.callsOf("engine", "capture", purchase.pi).map((call) => call.idempotencyKey),
    );
    expect(keys.size, `capture idempotency keys of ${purchase.pi}`).toBe(1);
    expect(intent.capturedAmount).toBe(purchase.amount);
    expect(intent.cancels).toBe(0);
    expect(intent.refunds).toBe(0);
  }
  const engineMethods = new Set(
    world.stripe.calls.filter((call) => call.side === "engine").map((call) => call.method),
  );
  for (const method of engineMethods) expect(["retrieve", "capture"]).toContain(method);
  const captured = world.stripe.calls.filter(
    (call) => call.side === "engine" && call.method === "capture",
  );
  // A capture call never reached Stripe for anything but these purchases.
  const ids = new Set(purchases.map((purchase) => purchase.pi));
  for (const call of captured) expect(ids.has(call.id)).toBe(true);
}

/** Every ticket's buyer now holds exactly its refundable amount (a fresh wallet per customer). */
export async function expectRefunded(world: World, tickets: readonly SoldTicket[]): Promise<void> {
  const owed = new Map<Address, bigint>();
  for (const ticket of tickets) {
    owed.set(ticket.buyer, (owed.get(ticket.buyer) ?? 0n) + ticket.refundable);
    const onchain = await onchainTicket(world, ticket.ticketId);
    expect(onchain.paidOut).toBe(true);
  }
  for (const [buyer, amount] of owed) {
    expect(await tokenBalance(world, buyer), `refund of ${buyer}`).toBe(amount);
  }
}
