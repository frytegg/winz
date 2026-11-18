/**
 * The live chance over time, for the chart of a campaign. The API has no history (SCREENS, MD: the
 * chart is built from the points received since the screen opened), so the screen keeps what it
 * saw: one point every few seconds, in the tab's session storage so that moving between the tabs of
 * the app does not empty the chart.
 */
export interface OddsPoint {
  /** Milliseconds since the epoch. */
  t: number;
  /** The chance in basis points. */
  bps: number;
}

/** Two points closer than this are one point: the live feed can push several quotes a second. */
export const MIN_GAP_MS = 4000;
/** About 16 minutes at one point every 4 seconds; older ones fall off the left of the chart. */
export const MAX_POINTS = 240;

export function appendPoint(
  points: readonly OddsPoint[],
  point: OddsPoint,
  minGapMs: number = MIN_GAP_MS,
  maxPoints: number = MAX_POINTS,
): OddsPoint[] {
  const last = points[points.length - 1];
  if (last !== undefined && point.t - last.t < minGapMs) return points.slice();
  const next = [...points, point];
  return next.length > maxPoints ? next.slice(next.length - maxPoints) : next;
}

const KEY_PREFIX = "winz.odds.";

function isPoint(value: unknown): value is OddsPoint {
  if (typeof value !== "object" || value === null) return false;
  const { t, bps } = value as Record<string, unknown>;
  return (
    typeof t === "number" && typeof bps === "number" && Number.isFinite(t) && Number.isFinite(bps)
  );
}

export function loadHistory(campaignId: string): OddsPoint[] {
  try {
    const raw = window.sessionStorage.getItem(`${KEY_PREFIX}${campaignId}`);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPoint).slice(-MAX_POINTS) : [];
  } catch {
    return [];
  }
}

export function saveHistory(campaignId: string, points: readonly OddsPoint[]): void {
  try {
    window.sessionStorage.setItem(`${KEY_PREFIX}${campaignId}`, JSON.stringify(points));
  } catch {
    // Storage can be blocked: the chart then only keeps this screen's points.
  }
}

/** The top of the y axis in percent: a multiple of 5 above the highest value and the pause line. */
export function axisMaxPercent(highestBps: number, thresholdBps: number): number {
  const top = Math.max(highestBps, thresholdBps) / 100;
  return Math.max(10, Math.ceil((top * 1.1) / 5) * 5);
}
