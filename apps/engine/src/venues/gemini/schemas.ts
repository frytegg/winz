import { z } from "zod";

import { BPS, CONTRACT_STEP_MICRO, TICK_BPS, parseContracts, parsePriceBps } from "@winz/shared";
import type { Bps, MicroContracts } from "@winz/shared";

/**
 * Answers of Gemini's Prediction Markets API, as the OpenAPI document describes them
 * (developer.gemini.com/specs/openapi/prediction-markets.yaml, read 20 Nov 2026): `OrderResponse`,
 * `OrdersResponse`, the cancel answer, `PredictionMarketsTermsStatus`, and for the public part the
 * events listing and the order book. Every answer is validated before it is used: a field that is
 * not what the document says is an error, never a guess.
 */

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, "must be a decimal string");

/**
 * An int64 order id. `parseGeminiJson` keeps every digit by reading it as a string (ids exceed
 * 2^53); a number that still arrives here is accepted only while it is a safe integer.
 */
const orderIdSchema = z.union([
  z.string().regex(/^\d+$/),
  z
    .number()
    .int()
    .nonnegative()
    .refine((value) => Number.isSafeInteger(value), "order id beyond 2^53 lost its digits")
    .transform((value) => value.toString()),
]);

export const GEMINI_ORDER_STATUSES = ["open", "filled", "cancelled", "closed"] as const;

/** `OrderResponse` (one order, as placement, active orders and history return it). */
export const geminiOrderSchema = z.object({
  orderId: orderIdSchema,
  status: z.enum(GEMINI_ORDER_STATUSES),
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  outcome: z.enum(["yes", "no"]),
  orderType: z.string().min(1),
  quantity: decimalString,
  filledQuantity: decimalString,
  remainingQuantity: decimalString.nullish(),
  price: decimalString,
  avgExecutionPrice: decimalString.nullish(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }).nullish(),
  cancelledAt: z.iso.datetime({ offset: true }).nullish(),
  /** `timeInForce` is listed by the batch answer only; kept when present. */
  timeInForce: z.string().nullish(),
});
export type GeminiOrder = z.infer<typeof geminiOrderSchema>;

/** `OrdersResponse` (active orders, order history). */
export const geminiOrdersSchema = z.object({
  orders: z.array(geminiOrderSchema),
  pagination: z
    .object({
      limit: z.number().int().nullish(),
      offset: z.number().int().nullish(),
      count: z.number().int().nullish(),
    })
    .nullish(),
});
export type GeminiOrders = z.infer<typeof geminiOrdersSchema>;

/** Answer of `POST /v1/prediction-markets/order/cancel`: `{result: "ok", message}`. */
export const geminiCancelSchema = z.object({
  result: z.string(),
  message: z.string().nullish(),
});

/** `PredictionMarketsTermsStatus`. */
export const geminiTermsStatusSchema = z.object({
  hasAcceptedLatest: z.boolean(),
  acceptedVersion: z.number().int().nullish(),
  latestVersion: z.number().int().nullish(),
});
export type GeminiTermsStatus = z.infer<typeof geminiTermsStatusSchema>;

/** `AcceptPredictionMarketsTermsResponse`. */
export const geminiAcceptTermsSchema = z.object({ success: z.boolean() });

/** A contract of the public events listing, with the fields the check reads. */
export const geminiListedContractSchema = z.object({
  instrumentSymbol: z.string().min(1),
  label: z.string().nullish(),
  status: z.string().nullish(),
  marketState: z.string().nullish(),
  expiryDate: z.iso.datetime({ offset: true }).nullish(),
  priceIncrement: decimalString.nullish(),
  quantityIncrement: decimalString.nullish(),
  quantityMinimum: decimalString.nullish(),
  isCombo: z.boolean().nullish(),
  /** Best prices of the book when the listing was made; absent on an empty side. */
  prices: z
    .object({ bestBid: decimalString.nullish(), bestAsk: decimalString.nullish() })
    .nullish(),
});

export const geminiListedEventSchema = z.object({
  ticker: z.string().min(1),
  title: z.string(),
  category: z.string().nullish(),
  status: z.string().nullish(),
  contracts: z.array(geminiListedContractSchema),
});
export type GeminiListedEvent = z.infer<typeof geminiListedEventSchema>;

export const geminiEventsSchema = z.object({
  data: z.array(geminiListedEventSchema),
  pagination: z.object({ total: z.number().int().nonnegative() }).nullish(),
});

/** `GET /v1/book/{symbol}`: levels `{price, amount}`, best first. */
export const geminiBookSchema = z.object({
  bids: z.array(z.object({ price: decimalString, amount: decimalString })),
  asks: z.array(z.object({ price: decimalString, amount: decimalString })),
});

/**
 * JSON.parse that keeps every digit of `orderId` (an int64): read from the source text, as a
 * string, before it becomes a float.
 */
export function parseGeminiJson(text: string): unknown {
  return JSON.parse(text, (key, value: unknown, context?: { source?: string }) => {
    if (key === "orderId" && typeof value === "number" && context?.source !== undefined) {
      return context.source;
    }
    return value;
  });
}

// ---------------------------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------------------------

/** Basis points → Gemini's price string in dollars: 6500n → "0.65". */
export function formatPrice(priceBps: Bps): string {
  if (priceBps < 0n || priceBps > BPS) throw new RangeError(`price out of range: ${priceBps}`);
  const whole = priceBps / BPS;
  const fraction = (priceBps % BPS)
    .toString()
    .padStart(4, "0")
    .replace(/0{1,2}$/, "");
  return `${whole.toString()}.${fraction.length === 0 ? "00" : fraction}`;
}

/** Micro-contracts → Gemini's quantity string, on the 0.01 step: 1 500 000n → "1.50". */
export function formatQuantity(qty: MicroContracts): string {
  if (qty <= 0n || qty % CONTRACT_STEP_MICRO !== 0n) {
    throw new RangeError(`quantity must be a positive multiple of the 0.01 step: ${qty}`);
  }
  const hundredths = qty / CONTRACT_STEP_MICRO;
  return `${(hundredths / 100n).toString()}.${(hundredths % 100n).toString().padStart(2, "0")}`;
}

/** A limit price string ("0.65") → bps. More than 4 decimals is refused (not a price we sent). */
export function priceToBps(price: string): Bps {
  return parsePriceBps(price);
}

/** A quantity string ("1.5", "100") → micro-contracts. More than 6 decimals is refused. */
export function quantityToMicro(quantity: string): MicroContracts {
  return parseContracts(quantity);
}

/** Scale of an average execution price kept exactly: 1e-8 of a dollar. */
export const AVG_PRICE_SCALE = 100_000_000n;

/**
 * An average execution price ("0.6466666667") → units of 1e-8 dollar, rounded half up beyond 8
 * decimals. An average is not on the tick grid, so it is not parsed as a limit price.
 */
export function avgPriceToScaled(price: string): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(price.trim());
  if (match === null) throw new RangeError(`not a decimal price: ${price}`);
  const whole = BigInt(match[1] ?? "0");
  const digits = match[2] ?? "";
  const kept = digits.slice(0, 8).padEnd(8, "0");
  let scaled = whole * AVG_PRICE_SCALE + BigInt(kept);
  const next = digits.charAt(8);
  if (next !== "" && Number(next) >= 5) scaled += 1n;
  if (scaled > AVG_PRICE_SCALE) throw new RangeError(`price above one dollar: ${price}`);
  return scaled;
}

/** Units of 1e-8 dollar → bps, rounded half up. */
export function scaledToBps(scaled: bigint): Bps {
  const per = AVG_PRICE_SCALE / BPS;
  return (scaled + per / 2n) / per;
}

/** Whether `priceBps` is on the 100 bps tick, between one tick and one dollar less a tick. */
export function isTickPrice(priceBps: Bps): boolean {
  return priceBps >= TICK_BPS && priceBps <= BPS - TICK_BPS && priceBps % TICK_BPS === 0n;
}
