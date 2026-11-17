import { createHash } from "node:crypto";

/**
 * Prefix of the client order ids of an instrument's runner: `wz.<16 hex of sha256(symbol)>`.
 * Gemini symbols contain `-`, which the runner reserves as the separator of `<prefix>-<seq>`, so
 * the symbol is hashed rather than copied: one prefix per instrument, never a prefix of another
 * instrument's ids, and short enough for a venue's client order id field.
 */
export function orderIdPrefix(instrumentSymbol: string): string {
  const hash = createHash("sha256").update(instrumentSymbol, "utf8").digest("hex");
  return `wz.${hash.slice(0, 16)}`;
}

/** The sequence number of `<prefix>-<seq>`, or null when the id is not of this prefix. */
export function orderSeqOf(prefix: string, clientOrderId: string): number | null {
  if (!clientOrderId.startsWith(`${prefix}-`)) return null;
  const tail = clientOrderId.slice(prefix.length + 1);
  if (!/^[0-9]{1,15}$/.test(tail)) return null;
  const seq = Number(tail);
  return Number.isSafeInteger(seq) ? seq : null;
}
