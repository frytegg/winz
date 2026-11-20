/**
 * The public Hedge desk state (`live_hedge_desk`, one row per instrument the service hedges): what
 * `GET /api/hedge-desk` and the browser read, validated against `hedgeInstrumentSchema`.
 */
import type { Logger } from "pino";
import type postgres from "postgres";
import { z } from "zod";

import { hedgeInstrumentSchema, type HedgeInstrument, type MicroUsdc } from "@winz/shared";

import type { Db } from "../../db";
import type { FillBookRef } from "../../venues";
import { makerSaving } from "../allocation";
import type { PolicyRunnerSnapshot } from "../policy";

/** Orders and fills shown per instrument, newest first. */
export const DESK_RECENT_ROWS = 20;

/** What the desk shows about an instrument besides the runner's snapshot. */
export interface DeskInstrumentInfo {
  symbol: string;
  label: string;
  eventTitle: string;
  eventStartsAt: Date;
}

const bigintSchema = z
  .union([z.string().regex(/^-?[0-9]+$/), z.number().int()])
  .transform((value) => BigInt(value));

const bookRefSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("book"),
    instrumentSymbol: z.string(),
    observedAtMs: z.number(),
    bookSide: z.enum(["asks", "bids"]),
    levels: z.array(
      z.object({
        priceBps: bigintSchema,
        displayedQty: bigintSchema,
        consumedBeforeQty: bigintSchema,
      }),
    ),
    limitPriceBps: bigintSchema,
    orderRemainingQty: bigintSchema,
    makerFeeWaived: z.boolean(),
  }),
  z.object({
    source: z.literal("trade"),
    instrumentSymbol: z.string(),
    printPriceBps: bigintSchema,
    printedQty: bigintSchema,
    allocatedBeforeQty: bigintSchema,
    printedAtMs: z.number(),
    limitPriceBps: bigintSchema,
    orderRemainingQty: bigintSchema,
    makerFeeWaived: z.boolean(),
  }),
  z.object({
    source: z.literal("venue"),
    instrumentSymbol: z.string(),
    venueOrderId: z.string(),
    limitPriceBps: bigintSchema,
    orderRemainingQty: bigintSchema,
    reportedFilledQty: bigintSchema,
    reportedAvgPrice: z.string().nullable(),
    observedAtMs: z.number(),
    feeFromSchedule: z.boolean(),
    makerFeeWaived: z.boolean(),
  }),
]);

/** A stored `fills.book_ref` (bigints as strings) back as a `FillBookRef`, or null. */
export function parseBookRef(value: unknown): FillBookRef | null {
  if (value === null || value === undefined) return null;
  const parsed = bookRefSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function iso(date: Date): string {
  return date.toISOString();
}

type JSONValue = postgres.JSONValue;

/** The maker savings summed so far for one instrument, and the last fill they include. */
interface SavingsState {
  total: MicroUsdc;
  /**
   * `(created_at, id)` of the last fill summed; null before the first. `created_at` is kept as
   * Postgres prints it: a JS `Date` would drop its microseconds and read the same fill again.
   */
  after: { createdAt: string; id: string } | null;
}

/**
 * Builds and writes the desk rows. Keeps, per instrument, the maker savings already summed and a
 * watermark of the last fill they include: the fills of an instrument are written one at a time
 * by the sink, in increasing `created_at`, so each refresh reads only the fills after it. The
 * cost of a refresh does not grow with the number of fills. Also keeps the payload last written,
 * so an unchanged state writes nothing.
 */
export class HedgeDeskWriter {
  private readonly db: Db;
  private readonly logger: Logger;
  private readonly savings = new Map<string, SavingsState>();
  private readonly lastWritten = new Map<string, string>();

  constructor(db: Db, logger: Logger) {
    this.db = db;
    this.logger = logger.child({ component: "hedging.desk" });
  }

  /** The payload of one instrument, validated. */
  async payload(
    info: DeskInstrumentInfo,
    snapshot: PolicyRunnerSnapshot,
  ): Promise<HedgeInstrument> {
    const orders = await this.db<
      {
        id: string;
        venue_order_id: string | null;
        kind: string;
        side: string;
        price_bps: number;
        qty: bigint;
        filled_qty: bigint;
        status: string;
        created_at: Date;
      }[]
    >`
      select id, venue_order_id, kind, side, price_bps, qty, filled_qty, status, created_at
      from orders where instrument = ${info.symbol}
      order by created_at desc, id desc
      limit ${DESK_RECENT_ROWS}
    `;
    const fills = await this.db<
      { id: string; kind: string; price_bps: number; qty: bigint; fee: bigint; ts: Date }[]
    >`
      select f.id, o.kind, f.price_bps, f.qty, f.fee, f.ts
      from fills f join orders o on o.id = f.order_id
      where o.instrument = ${info.symbol}
      order by f.created_at desc, f.id desc
      limit ${DESK_RECENT_ROWS}
    `;
    const unhedged = snapshot.exposure > snapshot.held ? snapshot.exposure - snapshot.held : 0n;
    const candidate = {
      symbol: info.symbol,
      label: info.label,
      eventTitle: info.eventTitle,
      startsAt: iso(info.eventStartsAt),
      bidBps: snapshot.bidBps === null ? null : Number(snapshot.bidBps),
      askBps: snapshot.askBps === null ? null : Number(snapshot.askBps),
      bookAsOf:
        snapshot.bookObservedAtMs === null ? null : iso(new Date(snapshot.bookObservedAtMs)),
      stale: snapshot.stale,
      exposure: snapshot.exposure.toString(),
      held: snapshot.held.toString(),
      working: snapshot.working.toString(),
      // Without a book the runner cannot price it: shown at $1 a contract, its highest value.
      unhedgedNotional: (snapshot.unhedgedNotional ?? unhedged).toString(),
      breaker: { active: snapshot.breaker.active, reason: snapshot.breaker.reason },
      orders: orders.map((row) => ({
        id: row.venue_order_id ?? row.id,
        kind: row.kind,
        side: row.side,
        priceBps: row.price_bps,
        qty: row.qty.toString(),
        filledQty: row.filled_qty.toString(),
        status: row.status,
        at: iso(row.created_at),
      })),
      fills: fills.map((row) => ({
        id: row.id,
        kind: row.kind,
        priceBps: row.price_bps,
        qty: row.qty.toString(),
        fee: row.fee.toString(),
        at: iso(row.ts),
      })),
      makerSavings: (await this.makerSavings(info.symbol)).toString(),
    };
    return hedgeInstrumentSchema.parse(candidate);
  }

  /** Writes the row of an instrument when its payload changed. Returns true when it wrote. */
  async write(info: DeskInstrumentInfo, snapshot: PolicyRunnerSnapshot): Promise<boolean> {
    const payload = await this.payload(info, snapshot);
    const json = JSON.stringify(payload);
    if (this.lastWritten.get(info.symbol) === json) return false;
    await this.db`
      insert into live_hedge_desk (instrument, payload)
      values (${info.symbol}, ${this.db.json(payload as unknown as JSONValue)})
      on conflict (instrument) do update set payload = excluded.payload
    `;
    this.lastWritten.set(info.symbol, json);
    return true;
  }

  /** Removes the row of an instrument the service no longer hedges. */
  async remove(symbol: string): Promise<void> {
    await this.db`delete from live_hedge_desk where instrument = ${symbol}`;
    this.lastWritten.delete(symbol);
    this.savings.delete(symbol);
  }

  /** What maker execution saved on the instrument's buys against a taker at the recorded ask. */
  private async makerSavings(symbol: string): Promise<MicroUsdc> {
    const state: SavingsState = this.savings.get(symbol) ?? { total: 0n, after: null };
    this.savings.set(symbol, state);
    const after = state.after;
    const rows = await this.db<
      {
        id: string;
        created_at: string;
        side: string;
        kind: string;
        price_bps: number;
        qty: bigint;
        fee: bigint;
        book_ref: unknown;
      }[]
    >`
      select f.id, f.created_at::text as created_at, o.side, o.kind, f.price_bps, f.qty, f.fee, f.book_ref
      from fills f join orders o on o.id = f.order_id
      where o.instrument = ${symbol} and o.side = 'buy'
        ${
          after === null
            ? this.db``
            : this
                .db`and (f.created_at, f.id) > (${after.createdAt}::timestamptz, ${after.id}::uuid)`
        }
      order by f.created_at, f.id
    `;
    for (const row of rows) {
      state.after = { createdAt: row.created_at, id: row.id };
      const bookRef = parseBookRef(row.book_ref);
      if (row.book_ref !== null && bookRef === null) {
        this.logger.warn({ fillId: row.id }, "unreadable book reference: no maker saving counted");
      }
      // The same rule as `engine_pnl.maker_savings` (allocation store), per instrument.
      state.total += makerSaving({
        side: "buy",
        kind: row.kind === "taker" ? "taker" : "maker",
        priceBps: BigInt(row.price_bps),
        qty: row.qty,
        fee: row.fee,
        bookRef,
      });
    }
    return state.total;
  }
}
