import { formatContracts } from "@winz/shared";

/**
 * How the Hedge desk writes its numbers. Everything is integer arithmetic on basis points and
 * micro-units: no float ever touches a quantity or a price (BRIEF section 4).
 */

function toBigInt(value: string | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

/** Micro-contracts → "441.19", with thousands separators ("1,441.19"). Rounded down to 0.01. */
export function formatQty(micro: string | bigint): string {
  const [whole = "0", fraction = "00"] = formatContracts(toBigInt(micro)).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

/**
 * Basis points of a dollar → a percent, keeping the digits that exist: 1100 → "11%", 1250 → "12.5%",
 * 1205 → "12.05%". The book is quoted in cents, so almost always a whole percent.
 */
export function formatBpsPercent(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const rest = Math.abs(bps % 100);
  if (rest === 0) return `${whole.toString()}%`;
  const fraction = rest.toString().padStart(2, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fraction}%`;
}

/** A contract price in basis points of a dollar → "$0.12", or "$0.1205" when it is off the cent. */
export function formatPriceBps(bps: number): string {
  const whole = Math.trunc(bps / 10_000);
  const rest = (bps % 10_000).toString().padStart(4, "0");
  const decimals = rest.endsWith("00") ? rest.slice(0, 2) : rest.replace(/0$/, "");
  return `$${whole.toString()}.${decimals}`;
}

/**
 * `part` as a share of `whole`, in basis points (0 to 10,000), rounded down. A zero `whole` gives
 * zero: a bar with nothing to measure against stays empty rather than dividing by zero.
 */
export function shareOfBps(part: string | bigint, whole: string | bigint): number {
  const denominator = toBigInt(whole);
  if (denominator <= 0n) return 0;
  const share = (toBigInt(part) * 10_000n) / denominator;
  return Number(share > 10_000n ? 10_000n : share);
}

/** Whole percent of a share in basis points: 6667 → 67. */
export function wholePercentOfShare(shareBps: number): number {
  return Math.round(shareBps / 100);
}
