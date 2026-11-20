/**
 * The nonce of Gemini's private API (developer.gemini.com/authentication/api-key, « Nonce
 * Management »). A key is created in one of two modes:
 *
 * - `incremental` (the default here): each request of a key must carry a higher nonce than the
 *   one before. The nonce is the epoch in milliseconds, raised to one above the previous nonce when
 *   the clock has not moved on (or went back). Across a restart, the new process starts from the
 *   clock, which is already past every nonce of the previous one, unless that one ran ahead of
 *   its clock, which only the guard does and by at most one millisecond per request sent within
 *   the same millisecond.
 * - `time`: the nonce is the epoch in SECONDS and must be within 30 s of Gemini's clock. Requests
 *   are also kept strictly increasing; rather than running ahead of the clock, the next request
 *   waits for the next second (`waitMs`).
 *
 * Gemini evaluates the nonce per key, and an older nonce that arrives after a newer one is
 * refused: the client sends one signed request at a time.
 */
export const NONCE_MODES = ["incremental", "time"] as const;
export type NonceMode = (typeof NONCE_MODES)[number];

export interface NextNonce {
  nonce: number;
  /** How long to wait before sending, so that a `time` nonce is never ahead of the clock. */
  waitMs: number;
}

export class NonceGuard {
  private last = 0;

  constructor(readonly mode: NonceMode) {}

  /** The nonce of the next request, at `nowMs`. Strictly above every nonce it returned before. */
  next(nowMs: number): NextNonce {
    if (!Number.isFinite(nowMs)) throw new RangeError("NonceGuard.next: nowMs must be finite");
    if (this.mode === "incremental") {
      const nonce = Math.max(Math.floor(nowMs), this.last + 1);
      this.last = nonce;
      return { nonce, waitMs: 0 };
    }
    const seconds = Math.floor(nowMs / 1000);
    if (seconds > this.last) {
      this.last = seconds;
      return { nonce: seconds, waitMs: 0 };
    }
    const nonce = this.last + 1;
    this.last = nonce;
    return { nonce, waitMs: Math.max(0, nonce * 1000 - Math.floor(nowMs)) };
  }

  /** The last nonce returned, 0 before the first. */
  lastNonce(): number {
    return this.last;
  }
}
