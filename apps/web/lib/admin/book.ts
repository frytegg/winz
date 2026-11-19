import type { DemoBookRequest } from "@winz/shared";

import { copy } from "@/lib/copy";

/**
 * What the "Drive the odds" panel sends (`POST /api/admin/demo/book`). The server refuses a book
 * that is off the tick, crossed or empty with a 400; checking the same rules here means the person
 * is told which field is wrong before anything is sent, and never reads a 400 for a typo.
 *
 * Prices are typed as whole percents (one tick = 1% = 100 bps), depth as contracts with at most two
 * decimals (0.01 contract = 10 000 micro-contracts). The conversion goes through `BigInt`, never a
 * float: 0.07 × 1 000 000 is 70000.00000000001 in JavaScript.
 */

const T = copy.admin.drive.errors;

/** The chance a fan sees is the middle of bid and ask, so a preset sits one point either side of it. */
export interface OddsPreset {
  /** The chance the preset aims at, in percent. */
  chance: number;
  label: string;
}

export const ODDS_PRESETS: readonly OddsPreset[] = [
  { chance: 12, label: copy.admin.drive.presets.low },
  { chance: 18, label: copy.admin.drive.presets.pause },
  { chance: 25, label: copy.admin.drive.presets.high },
];

/** Depth proposed with a preset: 500 contracts, the example of the API's own README. */
export const DEFAULT_DEPTH = "500";

const MICRO_PER_CONTRACT = 1_000_000n;
const MICRO_PER_HUNDREDTH = 10_000n;
const MAX_WHOLE_CONTRACTS = 1_000_000_000n;

/** `12` → `{ bid: "11", ask: "13" }`. */
export function presetPrices(chance: number): { bid: string; ask: string } {
  return { bid: (chance - 1).toString(), ask: (chance + 1).toString() };
}

/** Whole percents between 1 and 99, as the 100 bps tick of the server allows. */
export function percentToBps(text: string): number | null {
  const value = text.trim();
  if (!/^\d{1,2}$/.test(value)) return null;
  const percent = Number(value);
  return percent >= 1 && percent <= 99 ? percent * 100 : null;
}

/** `"500"` → `"500000000"`, `"0.5"` → `"500000"`, `"1.234"` → `null` (a hundredth is the step). */
export function contractsToMicro(text: string): string | null {
  const value = text.trim();
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(value);
  if (match === null) return null;
  const whole = BigInt(match[1] ?? "0");
  if (whole >= MAX_WHOLE_CONTRACTS) return null;
  const hundredths = BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  const micro = whole * MICRO_PER_CONTRACT + hundredths * MICRO_PER_HUNDREDTH;
  return micro > 0n ? micro.toString() : null;
}

export interface BookInput {
  symbol: string;
  bid: string;
  ask: string;
  depth: string;
}

export type BookField = "symbol" | "bid" | "ask" | "depth";

export type BookCheck =
  | { ok: true; request: DemoBookRequest }
  | { ok: false; errors: Partial<Record<BookField, string>> };

export function checkBook(input: BookInput): BookCheck {
  const errors: Partial<Record<BookField, string>> = {};
  const symbol = input.symbol.trim();
  if (symbol === "") errors.symbol = T.symbol;
  const bidBps = percentToBps(input.bid);
  const askBps = percentToBps(input.ask);
  if (bidBps === null) errors.bid = T.price;
  if (askBps === null) errors.ask = T.price;
  if (bidBps !== null && askBps !== null && bidBps >= askBps) errors.ask = T.crossed;
  const depth = contractsToMicro(input.depth);
  if (depth === null) errors.depth = T.depth;
  if (
    Object.keys(errors).length > 0 ||
    bidBps === null ||
    askBps === null ||
    depth === null ||
    symbol === ""
  ) {
    return { ok: false, errors };
  }
  return { ok: true, request: { instrumentSymbol: symbol, bidBps, askBps, depth } };
}

/** `1100` → `"11%"`, `null` → `"no book"`. A book price is a whole percent on this panel. */
export function bpsToPercentText(bps: number | null): string {
  if (bps === null) return copy.admin.instrument.noBook;
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent.toString() : percent.toFixed(1)}%`;
}

/** `"500000000"` → `"500"`, `"1500000"` → `"1.5"`, `"10000"` → `"0.01"`. */
export function microToContracts(micro: string): string {
  if (!/^\d+$/.test(micro)) return micro;
  const value = BigInt(micro);
  const whole = value / MICRO_PER_CONTRACT;
  const hundredths = (value % MICRO_PER_CONTRACT) / MICRO_PER_HUNDREDTH;
  if (hundredths === 0n) return whole.toString();
  const fraction = hundredths.toString().padStart(2, "0").replace(/0$/, "");
  return `${whole.toString()}.${fraction}`;
}
