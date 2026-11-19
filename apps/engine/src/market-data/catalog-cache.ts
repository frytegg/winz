import { systemClock, type Clock } from "./rate-limiter";
import type { SportsCatalog } from "./sync";

/** SPEC MD-1: the catalogue is re-read from Gemini at most once a minute. */
export const CATALOG_TTL_MS = 60_000;

export interface CatalogCacheOptions<C = SportsCatalog> {
  /** Fetches and normalizes the catalogue (one listing per league, see `loadSportsCatalog`). */
  load: () => Promise<C>;
  ttlMs?: number;
  now?: Clock;
}

/**
 * Keeps the last catalogue for `ttlMs`. Concurrent callers share one load; a failed load is
 * not cached, so the next call tries again, and the error reaches every waiting caller.
 */
export class CatalogCache<C = SportsCatalog> {
  private readonly load: () => Promise<C>;
  private readonly ttlMs: number;
  private readonly now: Clock;
  private entry: { value: C; loadedAtMs: number } | null = null;
  private inFlight: Promise<C> | null = null;

  constructor(options: CatalogCacheOptions<C>) {
    this.load = options.load;
    this.ttlMs = options.ttlMs ?? CATALOG_TTL_MS;
    this.now = options.now ?? systemClock;
  }

  get(): Promise<C> {
    if (this.entry && this.now() - this.entry.loadedAtMs < this.ttlMs) {
      return Promise.resolve(this.entry.value);
    }
    if (this.inFlight) return this.inFlight;

    const pending = this.load()
      .then((value) => {
        this.entry = { value, loadedAtMs: this.now() };
        return value;
      })
      .finally(() => {
        this.inFlight = null;
      });
    this.inFlight = pending;
    return pending;
  }

  /** Forces the next `get()` to reload. */
  invalidate(): void {
    this.entry = null;
  }
}
