import { instrumentId } from "@winz/shared";
import type { Outcome } from "@winz/shared";

import type { Db } from "../db";

import { mapEventStatus, type AwaitedEvent, type CatalogStore } from "./catalog-store";
import { SettlementConflictError } from "./errors";
import type { NormalizedEvent, NormalizedInstrument } from "./normalize";
import { systemClock, type Clock } from "./rate-limiter";

/** Rows per statement. A batch travels as one JSON parameter, so this only bounds its size. */
const BATCH_SIZE = 1_000;

export interface PgCatalogStoreOptions {
  /** Source of `synced_at`; defaults to the system clock. */
  now?: Clock;
}

/** Keeps the last item of each key, sorted by key so concurrent writers lock rows in one order. */
function lastByKey<T>(items: readonly T[], key: (item: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) byKey.set(key(item), item);
  return [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, item]) => item);
}

function batches<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    result.push(items.slice(start, start + BATCH_SIZE));
  }
  return result;
}

/**
 * The catalogue in Postgres: tables `events` and `instruments`.
 *
 * Every method is one transaction. Rows are inserted or updated, never deleted: a campaign,
 * a lot or an order may reference them long after Gemini stopped listing them.
 */
export class PgCatalogStore implements CatalogStore {
  private readonly now: Clock;

  constructor(
    private readonly db: Db,
    options: PgCatalogStoreOptions = {},
  ) {
    this.now = options.now ?? systemClock;
  }

  /**
   * Refreshes every Gemini-owned field of a known event. Its logos are ours and are left alone;
   * an event the settlement sync has closed (`settled`, `void`) keeps that status.
   */
  async upsertEvents(events: readonly NormalizedEvent[]): Promise<void> {
    if (events.length === 0) return;
    const syncedAt = new Date(this.now()).toISOString();
    const rows = lastByKey(events, (event) => event.ticker).map((event) => ({
      ticker: event.ticker,
      title: event.title,
      sport: event.sport,
      league: event.league,
      home_name: event.home.name,
      home_abbreviation: event.home.abbreviation,
      away_name: event.away.name,
      away_abbreviation: event.away.abbreviation,
      starts_at: event.startsAt.toISOString(),
      sales_close_at: event.salesCloseAt.toISOString(),
      status: mapEventStatus(event.status),
      gemini_status: event.status,
      synced_at: syncedAt,
    }));

    await this.db.begin(async (tx) => {
      for (const batch of batches(rows)) {
        await tx`
          insert into events (
            ticker, title, sport, league, home_name, home_abbreviation, away_name,
            away_abbreviation, starts_at, sales_close_at, status, gemini_status, synced_at
          )
          select
            r.ticker, r.title, r.sport, r.league, r.home_name, r.home_abbreviation, r.away_name,
            r.away_abbreviation, r.starts_at, r.sales_close_at, r.status, r.gemini_status,
            r.synced_at
          from jsonb_to_recordset(${tx.json(batch)}::jsonb) as r (
            ticker text, title text, sport text, league text, home_name text,
            home_abbreviation text, away_name text, away_abbreviation text,
            starts_at timestamptz, sales_close_at timestamptz, status text, gemini_status text,
            synced_at timestamptz
          )
          on conflict (ticker) do update set
            title = excluded.title,
            sport = excluded.sport,
            league = excluded.league,
            home_name = excluded.home_name,
            home_abbreviation = excluded.home_abbreviation,
            away_name = excluded.away_name,
            away_abbreviation = excluded.away_abbreviation,
            starts_at = excluded.starts_at,
            sales_close_at = excluded.sales_close_at,
            status = case
              when events.status in ('settled', 'void') then events.status
              else excluded.status
            end,
            gemini_status = excluded.gemini_status,
            synced_at = excluded.synced_at
        `;
      }
    });
  }

  /**
   * Refreshes the label, the quote and the side of a known instrument and marks it active.
   * `outcome` and `settled_at` are never touched here. The events must already be stored.
   */
  async upsertInstruments(instruments: readonly NormalizedInstrument[]): Promise<void> {
    if (instruments.length === 0) return;
    const syncedAt = new Date(this.now()).toISOString();
    const rows = lastByKey(instruments, (instrument) => instrument.symbol).map((instrument) => ({
      symbol: instrument.symbol,
      event_ticker: instrument.eventTicker,
      label: instrument.label,
      type: instrument.type,
      strike: instrument.strike,
      onchain_id: instrumentId(instrument.symbol),
      side: instrument.side,
      best_bid_bps: instrument.bestBidBps === null ? null : Number(instrument.bestBidBps),
      best_ask_bps: instrument.bestAskBps === null ? null : Number(instrument.bestAskBps),
      synced_at: syncedAt,
    }));

    await this.db.begin(async (tx) => {
      for (const batch of batches(rows)) {
        await tx`
          insert into instruments (
            symbol, event_ticker, label, type, strike, onchain_id, side, best_bid_bps,
            best_ask_bps, active, synced_at
          )
          select
            r.symbol, r.event_ticker, r.label, r.type, r.strike, r.onchain_id, r.side,
            r.best_bid_bps, r.best_ask_bps, true, r.synced_at
          from jsonb_to_recordset(${tx.json(batch)}::jsonb) as r (
            symbol text, event_ticker text, label text, type text, strike numeric(10, 2),
            onchain_id text, side text, best_bid_bps integer, best_ask_bps integer,
            synced_at timestamptz
          )
          on conflict (symbol) do update set
            event_ticker = excluded.event_ticker,
            label = excluded.label,
            type = excluded.type,
            strike = excluded.strike,
            onchain_id = excluded.onchain_id,
            side = coalesce(excluded.side, instruments.side),
            best_bid_bps = excluded.best_bid_bps,
            best_ask_bps = excluded.best_ask_bps,
            active = true,
            synced_at = excluded.synced_at
        `;
      }
    });
  }

  /**
   * Only instruments whose game (`events.league`) is of one of `leagues`: a league that was not
   * read completely keeps its games as they are.
   */
  async markDelisted(
    listedSymbols: readonly string[],
    leagues: readonly string[],
  ): Promise<number> {
    if (leagues.length === 0) return 0;
    const listed = [...new Set(listedSymbols)].map((symbol) => ({ symbol }));
    const complete = [...new Set(leagues)].map((league) => ({ league }));
    const result = await this.db.begin(
      (tx) => tx`
        update instruments
        set active = false
        where active
          and event_ticker in (
            select e.ticker from events e
            where e.league in (
              select r.league from jsonb_to_recordset(${tx.json(complete)}::jsonb) as r (league text)
            )
          )
          and symbol not in (
            select r.symbol from jsonb_to_recordset(${tx.json(listed)}::jsonb) as r (symbol text)
          )
      `,
    );
    return result.count;
  }

  /**
   * Campaigns that wait on a result: on-chain, live, paused or with sales closed, past their sales
   * close at `now`, their instrument without an outcome, and no forced demo result (which wins
   * over Gemini's anyway). Grouped by game, longest waiting first.
   */
  async listAwaitedEvents(now: Date): Promise<AwaitedEvent[]> {
    const rows = await this.db<{ event_ticker: string; symbols: string[] }[]>`
      select i.event_ticker, array_agg(distinct i.symbol order by i.symbol) as symbols
      from campaigns c
      join instruments i on i.symbol = c.instrument
      left join demo_overrides d on d.instrument = c.instrument
      where c.onchain_id is not null
        and c.status in ('live', 'paused', 'sales_closed')
        and c.sales_close <= ${now.toISOString()}::timestamptz
        and i.outcome is null
        and d.forced_result is null
      group by i.event_ticker
      order by min(c.sales_close), i.event_ticker
    `;
    return rows.map((row) => ({ eventTicker: row.event_ticker, symbols: row.symbols }));
  }

  /**
   * A settled instrument is no longer tradable: it is marked inactive with its outcome.
   * Besides the outcomes, moves an event to `settled` once every one of its instruments has an
   * outcome, or to `void` when all of them are void (Gemini's `invalid` event).
   */
  async markSettled(outcomes: ReadonlyMap<string, Outcome>, settledAt: Date): Promise<number> {
    if (outcomes.size === 0) return 0;
    const reported = [...outcomes].map(([symbol, outcome]) => ({ symbol, outcome }));

    return this.db.begin(async (tx) => {
      // Locks the known instruments, so two settlement runs cannot both see "not settled yet".
      const known = await tx<{ symbol: string; outcome: Outcome | null; event_ticker: string }[]>`
        select symbol, outcome, event_ticker
        from instruments
        where symbol in (
          select r.symbol from jsonb_to_recordset(${tx.json(reported)}::jsonb) as r (symbol text)
        )
        order by symbol
        for update
      `;

      // Check everything before writing anything; throwing rolls the transaction back anyway.
      const recorded = new Map(known.map((row) => [row.symbol, row.outcome]));
      for (const [symbol, outcome] of outcomes) {
        const current = recorded.get(symbol);
        if (current && current !== outcome) {
          throw new SettlementConflictError(symbol, current, outcome);
        }
      }
      if (known.length === 0) return 0;

      const settled = await tx`
        update instruments i
        set outcome = r.outcome, settled_at = ${settledAt.toISOString()}::timestamptz, active = false
        from jsonb_to_recordset(${tx.json(reported)}::jsonb) as r (symbol text, outcome text)
        where i.symbol = r.symbol and i.outcome is null
      `;

      // Also on a replay, so an event whose last instrument settled in an earlier call is closed.
      const tickers = [...new Set(known.map((row) => row.event_ticker))].map((ticker) => ({
        ticker,
      }));
      await tx`
        update events e
        set status = resolved.status
        from (
          select
            i.event_ticker,
            case when bool_and(i.outcome = 'void') then 'void' else 'settled' end as status
          from instruments i
          where i.event_ticker in (
            select r.ticker from jsonb_to_recordset(${tx.json(tickers)}::jsonb) as r (ticker text)
          )
          group by i.event_ticker
          having bool_and(i.outcome is not null)
        ) resolved
        where e.ticker = resolved.event_ticker and e.status is distinct from resolved.status
      `;

      return settled.count;
    });
  }
}
