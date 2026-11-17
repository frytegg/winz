/**
 * Units used everywhere money or probability is handled. No floats, ever.
 *
 * - Money: micro-USDC (6 decimals), as `bigint`.
 * - Probabilities and prices: basis points of one dollar (0..10_000), as `bigint`.
 * - Contract quantities: micro-contracts, as `bigint`. One contract pays $1, so
 *   1 micro-USDC of exposure is hedged by exactly 1 micro-contract.
 */

export type MicroUsdc = bigint;
export type Bps = bigint;
export type MicroContracts = bigint;

export const USDC_DECIMALS = 6;
export const MICRO = 1_000_000n;
export const BPS = 10_000n;

/** Gemini price tick: $0.01. */
export const TICK_BPS = 100n;
/** Gemini quantity step: 0.01 contract. */
export const CONTRACT_STEP_MICRO = 10_000n;

export class UnitParseError extends Error {
  constructor(kind: string, input: string) {
    super(`Cannot parse ${kind} from "${input}"`);
    this.name = "UnitParseError";
  }
}

/** `a * b / d`, rounded down. Use for capacities and anything the customer or merchant receives. */
export function mulDivDown(a: bigint, b: bigint, d: bigint): bigint {
  if (d <= 0n) throw new RangeError("mulDivDown: divisor must be positive");
  return (a * b) / d;
}

/** `a * b / d`, rounded up. Use for costs. */
export function mulDivUp(a: bigint, b: bigint, d: bigint): bigint {
  if (d <= 0n) throw new RangeError("mulDivUp: divisor must be positive");
  return (a * b + d - 1n) / d;
}

function parseDecimal(kind: string, input: string, decimals: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(input.trim());
  if (!match) throw new UnitParseError(kind, input);
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) throw new UnitParseError(kind, input);
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

/** "20", "20.5", "12.99" → micro-USDC. Rejects more than 6 decimals rather than rounding. */
export function parseUsd(input: string): MicroUsdc {
  return parseDecimal("USD amount", input, USDC_DECIMALS);
}

/** Micro-USDC → "20.00" (always two decimals, rounded down to the cent). */
export function formatUsd(amount: MicroUsdc): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const cents = abs / 10_000n;
  const whole = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

/** Gemini price string in dollars ("0.54") → basis points (5400n). */
export function parsePriceBps(input: string): Bps {
  const value = parseDecimal("price", input, 4);
  if (value > BPS) throw new UnitParseError("price", input);
  return value;
}

/** Gemini quantity string in contracts ("441.19") → micro-contracts. */
export function parseContracts(input: string): MicroContracts {
  return parseDecimal("contract quantity", input, 6);
}

/** Micro-contracts → Gemini quantity string, rounded DOWN to the 0.01 step ("441.19"). */
export function formatContracts(qty: MicroContracts): string {
  const steps = qty / CONTRACT_STEP_MICRO;
  return `${(steps / 100n).toString()}.${(steps % 100n).toString().padStart(2, "0")}`;
}

/** Rounds a hedge quantity UP to the 0.01-contract step, so exposure is never left uncovered. */
export function ceilToContractStep(qty: MicroContracts): MicroContracts {
  return ((qty + CONTRACT_STEP_MICRO - 1n) / CONTRACT_STEP_MICRO) * CONTRACT_STEP_MICRO;
}

/** Basis points → whole percent for display, rounded to nearest ("12" for 1240n). */
export function bpsToPercent(value: Bps): number {
  return Number((value + 50n) / 100n);
}

/** Refundable part of a purchase: qty × unitPrice × refundBps / 10_000 (matches the contract). */
export function refundableAmount(qty: bigint, unitPrice: MicroUsdc, refundBps: Bps): MicroUsdc {
  return mulDivDown(qty * unitPrice, refundBps, BPS);
}
