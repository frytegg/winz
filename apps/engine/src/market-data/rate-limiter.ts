export type Clock = () => number;
export type Sleep = (ms: number) => Promise<void>;

export const systemClock: Clock = () => Date.now();
export const systemSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface TokenBucketOptions {
  /** Largest burst: requests that can leave back to back after an idle period. */
  capacity: number;
  /** Sustained rate once the burst is spent. */
  refillPerMinute: number;
  now?: Clock;
  sleep?: Sleep;
}

/**
 * Gemini allows 120 requests per minute on public endpoints. A token bucket lets at most
 * `capacity + refillPerMinute` requests through in any 60-second window, so the defaults
 * (20 + 80) keep the client at or under 100 per minute however the calls are spread.
 */
export const GEMINI_BUCKET_DEFAULTS = { capacity: 20, refillPerMinute: 80 } as const;

/** What the REST client needs from a limiter. */
export interface RateLimiter {
  /** Resolves once the caller may send one request. */
  acquire(): Promise<void>;
}

export class TokenBucket implements RateLimiter {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: Clock;
  private readonly sleep: Sleep;
  private tokens: number;
  private lastRefillMs: number;
  /** Waiters are served strictly in arrival order. */
  private tail: Promise<void> = Promise.resolve();

  constructor(options: TokenBucketOptions) {
    if (options.capacity < 1) throw new RangeError("TokenBucket: capacity must be at least 1");
    if (options.refillPerMinute <= 0) {
      throw new RangeError("TokenBucket: refillPerMinute must be positive");
    }
    this.capacity = options.capacity;
    this.refillPerMs = options.refillPerMinute / 60_000;
    this.now = options.now ?? systemClock;
    this.sleep = options.sleep ?? systemSleep;
    this.tokens = options.capacity;
    this.lastRefillMs = this.now();
  }

  acquire(): Promise<void> {
    const turn = this.tail.then(() => this.take());
    // A failed sleep must not block every later caller; the failing caller still sees it.
    this.tail = turn.catch(() => undefined);
    return turn;
  }

  private async take(): Promise<void> {
    this.refill();
    while (this.tokens < 1) {
      await this.sleep(Math.ceil((1 - this.tokens) / this.refillPerMs));
      this.refill();
    }
    this.tokens -= 1;
  }

  private refill(): void {
    const nowMs = this.now();
    const elapsedMs = Math.max(0, nowMs - this.lastRefillMs);
    this.tokens = Math.min(this.capacity, this.tokens + elapsedMs * this.refillPerMs);
    this.lastRefillMs = nowMs;
  }
}
