import { bpsToPercent } from "@winz/shared";

/** 1240 → 12, 1274 → 13. Basis points are integers; nothing here goes through a float. */
export function bpsToWholePercent(bps: number): number {
  return bpsToPercent(BigInt(Math.round(bps)));
}

/** 1240 → "12%". */
export function formatPercent(bps: number): string {
  return `${bpsToWholePercent(bps).toString()}%`;
}

/** Whole percent → basis points (for steppers and sliders that work in percent). */
export function percentToBps(percent: number): number {
  return Math.round(percent) * 100;
}
