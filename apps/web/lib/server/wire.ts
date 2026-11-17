import { BOOK_STALE_AFTER_MS, BPS, mulDivUp, type SaleState } from "@winz/shared";

/**
 * Small pure conversions from database values to the wire format of `packages/shared` (money as
 * strings of micro-USDC digits, basis points as integers, ISO dates in UTC).
 */

/** A timestamptz as the wire's ISO 8601 string. */
export function isoDate(value: Date): string {
  return value.toISOString();
}

/** Micro-USDC or micro-contracts as a string of digits; negative values never reach the wire. */
export function digits(value: bigint): string {
  if (value < 0n) throw new RangeError(`negative amount ${value.toString()} cannot be sent`);
  return value.toString();
}

/** A stored URL when it is an absolute http(s) URL, else null (the wire schema requires a URL). */
export function safeUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    // Not a URL at all: shown as "no logo" rather than failing the whole answer.
    return null;
  }
}

/** Basis points as a percent for labels: 10000 → "100", 1250 → "12.5", 1234 → "12.34". */
export function percentLabel(bps: bigint | number): string {
  const value = BigInt(bps);
  const whole = value / 100n;
  const fraction = value % 100n;
  if (fraction === 0n) return whole.toString();
  return `${whole.toString()}.${fraction.toString().padStart(2, "0").replace(/0$/, "")}`;
}

/** `a / b` in basis points, rounded down, clamped to 0..10 000; 0 when `b` is 0. */
export function ratioBps(a: bigint, b: bigint): number {
  if (b <= 0n || a <= 0n) return 0;
  const ratio = (a * BPS) / b;
  return Number(ratio > BPS ? BPS : ratio);
}

/**
 * `a / b` in basis points, rounded up, clamped to 0..10 000; 0 when `b` is 0. For costs shown to the
 * merchant: a cost is never understated (SPEC PR-5).
 */
export function ratioBpsUp(a: bigint, b: bigint): number {
  if (b <= 0n || a <= 0n) return 0;
  const ratio = mulDivUp(a, BPS, b);
  return Number(ratio > BPS ? BPS : ratio);
}

/** A row of `live_instruments`, the engine's live quote of one instrument. */
export interface LiveQuoteRow {
  mid_bps: number | null;
  stale: boolean;
  observed_at: Date;
}

/**
 * The live probability shown to people: the mid of `live_instruments`. Null when there is no row,
 * no mid, the engine flagged the quote stale or it is older than `BOOK_STALE_AFTER_MS` (the engine
 * itself may be down), and once the condition is settled.
 */
export function liveProbabilityBps(
  live: LiveQuoteRow | null,
  settled: boolean,
  now: Date,
): number | null {
  if (settled || live === null || live.mid_bps === null || live.stale) return null;
  if (now.getTime() - live.observed_at.getTime() > BOOK_STALE_AFTER_MS) return null;
  return live.mid_bps;
}

/**
 * The sale state to show: the stored one, except that nothing sells after `sales_close` even if
 * the engine has not written `closed` yet (SPEC 4.5).
 */
export function effectiveSaleState(stored: SaleState, salesClose: Date, now: Date): SaleState {
  return now.getTime() >= salesClose.getTime() ? "closed" : stored;
}
