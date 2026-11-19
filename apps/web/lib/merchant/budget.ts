/**
 * "11.2%": the budget used, spent plus reserved over the budget, in tenths of a percent and through
 * BigInt (an amount never goes through a float). `null` for a budget of zero.
 */
export function budgetUsedTenths(spent: string, reserved: string, budget: string): number | null {
  const total = BigInt(budget);
  if (total <= 0n) return null;
  const used = BigInt(spent) + BigInt(reserved);
  const tenths = (used * 1000n) / total;
  return Number(tenths > 1000n ? 1000n : tenths);
}

/** 112 → "11.2%". */
export function formatTenths(tenths: number): string {
  const whole = Math.floor(tenths / 10);
  return `${whole.toString()}.${(tenths % 10).toString()}%`;
}

/** 1245 → "12.5%": basis points to a percent with one decimal, for the cost of a promo (never a float on money). */
export function formatBpsOneDecimal(bps: number): string {
  return formatTenths(Math.round(bps / 10));
}
