import type { Outcome } from "@winz/shared";

import { SettlementConflictError } from "./errors";
import type { NormalizedEvent, NormalizedInstrument } from "./normalize";

/**
 * Status of a stored event: ours, not Gemini's. Same strings as the check on `events.status`
 * (supabase/migrations/20261117010000_catalog.sql).
 */
export const EVENT_STATUSES = ["upcoming", "active", "closed", "settled", "void"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/**
 * Gemini event status → stored status. A status we have never seen maps to "closed": nothing
 * may be sold on an event we do not understand, and the raw string is kept beside it.
 */
export function mapEventStatus(geminiStatus: string): EventStatus {
  switch (geminiStatus) {
    case "approved":
      return "upcoming";
    case "active":
      return "active";
    case "settled":
      return "settled";
    case "invalid":
      return "void";
    default:
      return "closed";
  }
}

/**
 * Where the catalogue is persisted (tables `events` and `instruments`, SPEC section 10).
 * The engine uses `PgCatalogStore`; `InMemoryCatalogStore` is for tests that need no database.
 * Nothing is ever deleted: a campaign may reference an event or an instrument for good.
 */
export interface CatalogStore {
  /** Inserts new games and refreshes the fields of known ones, keyed by ticker. */
  upsertEvents(events: readonly NormalizedEvent[]): Promise<void>;
  /** Inserts new instruments and refreshes known ones, keyed by symbol. Never clears an outcome. */
  upsertInstruments(instruments: readonly NormalizedInstrument[]): Promise<void>;
  /**
   * Marks inactive every instrument that is not in `listedSymbols`, the symbols of a complete
   * catalogue. The rows stay. Returns how many instruments were newly marked.
   * An instrument that is listed again becomes active at its next upsert.
   */
  markDelisted(listedSymbols: readonly string[]): Promise<number>;
  /**
   * Records the outcome of the instruments it knows and marks them inactive; unknown symbols
   * are ignored.
   * Idempotent. Returns how many instruments were newly settled.
   * Rejects with `SettlementConflictError` if an instrument already has a different outcome.
   */
  markSettled(outcomes: ReadonlyMap<string, Outcome>, settledAt: Date): Promise<number>;
}

export interface StoredInstrument extends NormalizedInstrument {
  /** False once Gemini no longer lists the contract as tradable. */
  active: boolean;
  outcome: Outcome | null;
  settledAt: Date | null;
}

export class InMemoryCatalogStore implements CatalogStore {
  private readonly events = new Map<string, NormalizedEvent>();
  private readonly instruments = new Map<string, StoredInstrument>();

  upsertEvents(events: readonly NormalizedEvent[]): Promise<void> {
    for (const event of events) this.events.set(event.ticker, event);
    return Promise.resolve();
  }

  upsertInstruments(instruments: readonly NormalizedInstrument[]): Promise<void> {
    for (const instrument of instruments) {
      const known = this.instruments.get(instrument.symbol);
      this.instruments.set(instrument.symbol, {
        ...instrument,
        active: true,
        outcome: known?.outcome ?? null,
        settledAt: known?.settledAt ?? null,
      });
    }
    return Promise.resolve();
  }

  markDelisted(listedSymbols: readonly string[]): Promise<number> {
    const listed = new Set(listedSymbols);
    let delisted = 0;
    for (const [symbol, instrument] of this.instruments) {
      if (!instrument.active || listed.has(symbol)) continue;
      this.instruments.set(symbol, { ...instrument, active: false });
      delisted += 1;
    }
    return Promise.resolve(delisted);
  }

  markSettled(outcomes: ReadonlyMap<string, Outcome>, settledAt: Date): Promise<number> {
    // Check everything before writing anything: a conflict must not leave a half-applied batch.
    for (const [symbol, outcome] of outcomes) {
      const known = this.instruments.get(symbol);
      if (known?.outcome && known.outcome !== outcome) {
        return Promise.reject(new SettlementConflictError(symbol, known.outcome, outcome));
      }
    }
    let newlySettled = 0;
    for (const [symbol, outcome] of outcomes) {
      const known = this.instruments.get(symbol);
      if (!known || known.outcome !== null) continue;
      this.instruments.set(symbol, { ...known, outcome, settledAt, active: false });
      newlySettled += 1;
    }
    return Promise.resolve(newlySettled);
  }

  getEvent(ticker: string): NormalizedEvent | undefined {
    return this.events.get(ticker);
  }

  getInstrument(symbol: string): StoredInstrument | undefined {
    return this.instruments.get(symbol);
  }

  listEvents(): NormalizedEvent[] {
    return [...this.events.values()];
  }

  listInstruments(eventTicker?: string): StoredInstrument[] {
    const all = [...this.instruments.values()];
    return eventTicker === undefined
      ? all
      : all.filter((instrument) => instrument.eventTicker === eventTicker);
  }
}
