import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { MEASURES_DIR } from "./paths";

/** One figure a flow measured, kept for the receipts' README. */
export interface Measure {
  /** What was measured, in French (the README is in French). */
  label: string;
  value: number;
  unit: "taps" | "s";
  /** The limit of the specification, if there is one, in the same unit. */
  limit: number | null;
  /** How the figure was obtained: the taps one by one, or the two moments between which it was timed. */
  detail: string;
  /** ISO 8601, UTC. */
  measuredAt: string;
}

export type MeasureKey =
  | "warmup-seconds"
  | "onboarding-taps"
  | "onboarding-seconds"
  | "fan-taps"
  | "fan-scan-to-ticket-seconds";

/** Writes one measurement of this run; the global teardown gathers them into the README. */
export function recordMeasure(key: MeasureKey, measure: Omit<Measure, "measuredAt">): void {
  mkdirSync(MEASURES_DIR, { recursive: true });
  const full: Measure = { ...measure, measuredAt: new Date().toISOString() };
  writeFileSync(join(MEASURES_DIR, `${key}.json`), `${JSON.stringify(full, null, 2)}\n`);
}

/** Seconds with one decimal, from milliseconds. */
export function seconds(ms: number): number {
  return Math.round(ms / 100) / 10;
}
