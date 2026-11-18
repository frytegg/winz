import {
  MICRO_PER_CENT,
  centsToMicroUsdc,
  formatUsd,
  microUsdcToCents,
  parseUsd,
  UnitParseError,
} from "@winz/shared";

/** A card payment is at least $0.50 and at most $999,999.99, in whole cents (BRIEF section 4). */
export const MIN_CARD_AMOUNT_MICRO = 500_000n;
export const MAX_CARD_AMOUNT_MICRO = 999_999_990_000n;
export const MIN_CARD_AMOUNT_CENTS = 50;
export const MAX_CARD_AMOUNT_CENTS = 99_999_999;

function toBigInt(amount: string | bigint): bigint {
  return typeof amount === "bigint" ? amount : BigInt(amount);
}

/** "2145450000" → "2,145.45". Thousands separators on the whole part, never a float. */
export function formatAmount(amount: string | bigint): string {
  const [whole = "0", fraction = "00"] = formatUsd(toBigInt(amount)).split(".");
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}.${fraction}`;
}

/** "20000000" → "$20.00". */
export function formatMoney(amount: string | bigint): string {
  const text = formatAmount(amount);
  return text.startsWith("-") ? `-$${text.slice(1)}` : `$${text}`;
}

/** Whole dollars when the amount has no cents ("$1,000"), otherwise like `formatMoney`. */
export function formatMoneyCompact(amount: string | bigint): string {
  const text = formatAmount(amount);
  const withoutCents = text.endsWith(".00") ? text.slice(0, -3) : text;
  return withoutCents.startsWith("-") ? `-$${withoutCents.slice(1)}` : `$${withoutCents}`;
}

/** The digits of an amount without the `$`, split so the screen can color the `$` lime. */
export function splitMoney(amount: string | bigint): { sign: string; text: string } {
  const text = formatAmount(amount);
  return text.startsWith("-") ? { sign: "-", text: text.slice(1) } : { sign: "", text };
}

/** Cents (a safe integer, what a stepper holds) → micro-USDC. */
export function centsToMicro(cents: number): bigint {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(`Not a number of cents: ${String(cents)}`);
  }
  return centsToMicroUsdc(BigInt(cents));
}

/** Micro-USDC → cents. Throws when the amount is not a whole number of cents. */
export function microToCents(amount: string | bigint): number {
  return Number(microUsdcToCents(toBigInt(amount)));
}

/** Micro-USDC as the string the API expects. */
export function microToWire(amount: bigint): string {
  return amount.toString();
}

/** True when the amount is a multiple of one cent (10,000 micro-USDC). */
export function isWholeCents(amount: bigint): boolean {
  return amount >= 0n && amount % MICRO_PER_CENT === 0n;
}

/**
 * What a merchant typed in a dollar field ("20", "20.5", "$1,000.99") → whole cents, or `null`
 * when it is not an amount. Extra decimals are cut, never rounded (an amount is not a float).
 */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  const match = /^(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").slice(0, 2).padEnd(2, "0");
  const cents = Number(`${whole}${fraction}`);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Keeps a card amount (in cents) inside the allowed range. */
export function clampCardCents(cents: number): number {
  return Math.min(MAX_CARD_AMOUNT_CENTS, Math.max(MIN_CARD_AMOUNT_CENTS, cents));
}

/** Cents → "20.00" for a field. */
export function formatCentsPlain(cents: number): string {
  return formatAmount(centsToMicro(cents)).replace(/,/g, "");
}

export { parseUsd, UnitParseError };
