import type { Outcome } from "@winz/shared";

import { SettlementConflictError } from "./errors";
import type { NormalizedEvent, NormalizedInstrument } from "./normalize";

/**
 * Where the catalogue is persisted (tables `events` and `instruments`, SPEC section 10).
 * The Postgres implementation lands with the schema; until then the engine and the tests
 * use `InMemoryCatalogStore`.
 */
export interface CatalogStore {
  /** Inserts new games and refreshes the fields of known ones, keyed by ticker. */
  upsertEvents(events: readonly NormalizedEvent[]): Promise<void>;
  /** Inserts new instruments and refreshes known ones, keyed by symbol. Never clears an outcome. */
  upsertInstruments(instruments: readonly NormalizedInstrument[]): Promise<void>;
  /**
   * Records the outcome of the instruments it knows; unknown symbols are ignored.
   * Idempotent. Returns how many instruments were newly settled.
   * Rejects with `SettlementConflictError` if an instrument already has a different outcome.
   */
  markSettled(outcomes: ReadonlyMap<string, Outcome>, settledAt: Date): Promise<number>;
}

export interface StoredInstrument extends NormalizedInstrument {
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
        outcome: known?.outcome ?? null,
        settledAt: known?.settledAt ?? null,
      });
    }
    return Promise.resolve();
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
      this.instruments.set(symbol, { ...known, outcome, settledAt });
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
