import { BOOK_STALE_AFTER_MS, liveInstrumentRowSchema } from "@winz/shared";

/**
 * The live odds of a promo ("12% chance it's free"). On the server this is the mid of the
 * `live_instruments` row, and nothing when the quote is stale or too old (`liveProbabilityBps`).
 * The browser applies the same rule to the rows Supabase Realtime pushes, so a figure it shows
 * is never one the API would have hidden.
 */

/**
 * Supabase Realtime sends a timestamp the way Postgres writes it ("2026-11-19T05:52:31.453+00:00"),
 * while the API schemas only accept the "Z" form. Checked against the real feed: without this every
 * pushed row was refused and the odds showed "–". The instant is the same, only the spelling changes.
 */
function withZuluDate(row: unknown): unknown {
  if (typeof row !== "object" || row === null) return row;
  const observedAt = (row as { observed_at?: unknown }).observed_at;
  if (typeof observedAt !== "string") return row;
  const time = new Date(observedAt).getTime();
  return Number.isNaN(time) ? row : { ...row, observed_at: new Date(time).toISOString() };
}

/** A pushed row → the chance in basis points, or `null` when there is no fresh quote. */
export function oddsFromRow(row: unknown, nowMs: number): number | null {
  const parsed = liveInstrumentRowSchema.safeParse(withZuluDate(row));
  if (!parsed.success) return null;
  const { mid_bps: mid, stale, observed_at: observedAt } = parsed.data;
  if (mid === null || stale) return null;
  if (nowMs - new Date(observedAt).getTime() > BOOK_STALE_AFTER_MS) return null;
  return mid;
}

/**
 * The simulated mode has no market: this nudges the figure a little around the one the mock API
 * sends, so the gauge and the figures can be seen moving. It never leaves 1% to 99%, and it only
 * exists when `NEXT_PUBLIC_APP_API_MOCK=true`.
 */
export function wobble(baseBps: number, step: number): number {
  const swing = Math.sin(step * 0.9) * 90 + Math.sin(step * 0.37 + 1) * 60;
  return Math.min(9900, Math.max(100, Math.round(baseBps + swing)));
}

/**
 * How long the feed may stay silent before the screen asks the API every two seconds again. Supabase
 * says "subscribed" even when the table does not exist, is not published or hides its rows, so a
 * subscription alone proves nothing: only a row that arrived does.
 */
export const FEED_SILENT_AFTER_MS = 15_000;

/** The feed counts as live when it is subscribed and has pushed a row recently. */
export function isFeedLive(subscribed: boolean, lastPushAt: number | null, nowMs: number): boolean {
  return subscribed && lastPushAt !== null && nowMs - lastPushAt < FEED_SILENT_AFTER_MS;
}
