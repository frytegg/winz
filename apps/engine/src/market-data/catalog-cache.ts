import type { NormalizedCatalog } from "./normalize";
import { systemClock, type Clock } from "./rate-limiter";

/** SPEC MD-1: the catalogue is re-read from Gemini at most once a minute. */
export const CATALOG_TTL_MS = 60_000;

export interface CatalogCacheOptions {
  /** Fetches and normalizes the catalogue (about 20 Gemini requests). */
  load: () => Promise<NormalizedCatalog>;
  ttlMs?: number;
  now?: Clock;
}

/**
 * Keeps the last catalogue for `ttlMs`. Concurrent callers share one load; a failed load is
 * not cached, so the next call tries again, and the error reaches every waiting caller.
 */
export class CatalogCache {
  private readonly load: () => Promise<NormalizedCatalog>;
  private readonly ttlMs: number;
  private readonly now: Clock;
  private entry: { value: NormalizedCatalog; loadedAtMs: number } | null = null;
  private inFlight: Promise<NormalizedCatalog> | null = null;

  constructor(options: CatalogCacheOptions) {
    this.load = options.load;
    this.ttlMs = options.ttlMs ?? CATALOG_TTL_MS;
    this.now = options.now ?? systemClock;
  }

  get(): Promise<NormalizedCatalog> {
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
