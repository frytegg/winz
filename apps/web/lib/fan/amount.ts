/** Unit price × quantity, in micro-USDC, by `BigInt`: an amount is never a float. */
export function totalMicro(unitPrice: string, qty: number): bigint {
  if (!Number.isInteger(qty) || qty < 1) throw new RangeError(`Not a quantity: ${String(qty)}`);
  return BigInt(unitPrice) * BigInt(qty);
}
