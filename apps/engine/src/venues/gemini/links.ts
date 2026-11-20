import type { Bps, ExecutionVenueName, MicroContracts, OrderKind } from "@winz/shared";

import type { Db } from "../../db";
import type { OrderSide } from "../types";

/**
 * Gemini's Prediction Markets REST order request has no client order id (the `OrderRequest`
 * schema of prediction-markets.yaml lists none; only the WebSocket `order.place` takes one). The
 * adapter therefore keeps, for each order it places, the link between the caller's
 * `clientOrderId` and Gemini's `orderId`, with the terms of the order, which Gemini's answers do
 * not all carry (maker or taker). The link is written BEFORE the placement is sent, so an order
 * whose placement got no answer can still be found and matched afterwards, even by another
 * process.
 */
export interface OrderLink {
  clientOrderId: string;
  venue: ExecutionVenueName;
  instrumentSymbol: string;
  side: OrderSide;
  kind: OrderKind;
  limitPriceBps: Bps;
  qty: MicroContracts;
  /** Epoch ms when the placement was sent. */
  placedAtMs: number;
  /** Gemini's order id; null until known. */
  venueOrderId: string | null;
  /**
   * `pending`: sent, no answer yet (or no answer at all). `placed`: Gemini answered with an id.
   * `refused`: Gemini refused it, nothing exists. `absent`: never found after the grace period.
   */
  state: "pending" | "placed" | "refused" | "absent";
  /** Why it was refused, for `refused`. */
  refusal: string | null;
  /** True once a cancel was asked: a cancelled maker is then not a maker-or-cancel refusal. */
  cancelRequested: boolean;
}

export interface OrderLinkStore {
  get(clientOrderId: string): Promise<OrderLink | null>;
  byVenueOrderId(venue: ExecutionVenueName, venueOrderId: string): Promise<OrderLink | null>;
  /** Venue order ids already linked to some client order, among `ids`. */
  linkedVenueOrderIds(venue: ExecutionVenueName, ids: readonly string[]): Promise<Set<string>>;
  /** Inserts or replaces the link of `link.clientOrderId`. */
  save(link: OrderLink): Promise<void>;
}

/** Links in memory: for a process that does not outlive its orders (the `venue:check` command). */
export class MemoryOrderLinkStore implements OrderLinkStore {
  private readonly links = new Map<string, OrderLink>();

  async get(clientOrderId: string): Promise<OrderLink | null> {
    const link = this.links.get(clientOrderId);
    return link === undefined ? null : { ...link };
  }

  async byVenueOrderId(venue: ExecutionVenueName, venueOrderId: string): Promise<OrderLink | null> {
    for (const link of this.links.values()) {
      if (link.venue === venue && link.venueOrderId === venueOrderId) return { ...link };
    }
    return null;
  }

  async linkedVenueOrderIds(
    venue: ExecutionVenueName,
    ids: readonly string[],
  ): Promise<Set<string>> {
    const wanted = new Set(ids);
    const found = new Set<string>();
    for (const link of this.links.values()) {
      if (link.venue === venue && link.venueOrderId !== null && wanted.has(link.venueOrderId)) {
        found.add(link.venueOrderId);
      }
    }
    return found;
  }

  async save(link: OrderLink): Promise<void> {
    this.links.set(link.clientOrderId, { ...link });
  }
}

interface LinkRow {
  client_order_id: string;
  venue: string;
  instrument: string;
  side: string;
  kind: string;
  limit_price_bps: number;
  qty: bigint;
  placed_at: Date;
  venue_order_id: string | null;
  state: string;
  refusal: string | null;
  cancel_requested: boolean;
}

function fromRow(row: LinkRow): OrderLink {
  return {
    clientOrderId: row.client_order_id,
    venue: row.venue as ExecutionVenueName,
    instrumentSymbol: row.instrument,
    side: row.side as OrderSide,
    kind: row.kind as OrderKind,
    limitPriceBps: BigInt(row.limit_price_bps),
    qty: BigInt(row.qty),
    placedAtMs: row.placed_at.getTime(),
    venueOrderId: row.venue_order_id,
    state: row.state as OrderLink["state"],
    refusal: row.refusal,
    cancelRequested: row.cancel_requested,
  };
}

/** Links in `venue_order_links` (migration 20261120000000_venue_checks.sql): survive a restart. */
export class PgOrderLinkStore implements OrderLinkStore {
  constructor(private readonly db: Db) {}

  async get(clientOrderId: string): Promise<OrderLink | null> {
    const rows = await this.db<LinkRow[]>`
      select client_order_id, venue, instrument, side, kind, limit_price_bps, qty, placed_at,
             venue_order_id, state, refusal, cancel_requested
      from venue_order_links where client_order_id = ${clientOrderId}
    `;
    const row = rows[0];
    return row === undefined ? null : fromRow(row);
  }

  async byVenueOrderId(venue: ExecutionVenueName, venueOrderId: string): Promise<OrderLink | null> {
    const rows = await this.db<LinkRow[]>`
      select client_order_id, venue, instrument, side, kind, limit_price_bps, qty, placed_at,
             venue_order_id, state, refusal, cancel_requested
      from venue_order_links where venue = ${venue} and venue_order_id = ${venueOrderId}
    `;
    const row = rows[0];
    return row === undefined ? null : fromRow(row);
  }

  async linkedVenueOrderIds(
    venue: ExecutionVenueName,
    ids: readonly string[],
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db<{ venue_order_id: string }[]>`
      select venue_order_id from venue_order_links
      where venue = ${venue} and venue_order_id in ${this.db([...ids])}
    `;
    return new Set(rows.map((row) => row.venue_order_id));
  }

  async save(link: OrderLink): Promise<void> {
    await this.db`
      insert into venue_order_links (client_order_id, venue, instrument, side, kind,
                                     limit_price_bps, qty, placed_at, venue_order_id, state,
                                     refusal, cancel_requested)
      values (${link.clientOrderId}, ${link.venue}, ${link.instrumentSymbol}, ${link.side},
              ${link.kind}, ${Number(link.limitPriceBps)}, ${link.qty.toString()}::bigint,
              ${new Date(link.placedAtMs)}, ${link.venueOrderId}, ${link.state}, ${link.refusal},
              ${link.cancelRequested})
      on conflict (client_order_id) do update set
        venue_order_id = excluded.venue_order_id,
        state = excluded.state,
        refusal = excluded.refusal,
        cancel_requested = excluded.cancel_requested,
        updated_at = now()
    `;
  }
}
