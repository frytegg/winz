import { describe, expect, it } from "vitest";

import {
  GeminiAuthError,
  GeminiInsufficientFundsError,
  GeminiNonceError,
  GeminiNotFoundError,
  GeminiRateLimitError,
  GeminiRefusedError,
  GeminiServerError,
  GeminiTermsNotAcceptedError,
  errorFromResponse,
  readErrorBody,
} from "./errors";
import {
  avgPriceToScaled,
  formatPrice,
  formatQuantity,
  geminiCancelSchema,
  geminiOrderSchema,
  geminiOrdersSchema,
  geminiTermsStatusSchema,
  parseGeminiJson,
  priceToBps,
  quantityToMicro,
  scaledToBps,
} from "./schemas";

/** The `orderPlaced` example of prediction-markets.yaml (placeOrder, 201), as Gemini writes it. */
const DOC_ORDER = `{
  "orderId": 12345678901, "status": "open", "symbol": "GEMI-FEDJAN26-DN25", "side": "buy",
  "outcome": "yes", "orderType": "limit", "quantity": "100", "filledQuantity": "0",
  "remainingQuantity": "100", "price": "0.65", "avgExecutionPrice": null,
  "createdAt": "2025-12-15T10:30:00.000Z", "updatedAt": "2025-12-15T10:30:00.000Z",
  "cancelledAt": null,
  "contractMetadata": { "contractId": "contract_123", "eventTicker": "FEDJAN26" }
}`;

describe("answers of the Prediction Markets API", () => {
  it("reads the documentation's placed order", () => {
    const order = geminiOrderSchema.parse(parseGeminiJson(DOC_ORDER));
    expect(order).toMatchObject({
      orderId: "12345678901",
      status: "open",
      symbol: "GEMI-FEDJAN26-DN25",
      quantity: "100",
      filledQuantity: "0",
      price: "0.65",
      avgExecutionPrice: null,
    });
  });

  it("keeps every digit of an order id above 2^53", () => {
    const text = DOC_ORDER.replace("12345678901", "73797746498585286");
    expect(JSON.parse(text).orderId).toBe(73797746498585280); // the float loses the last digits
    expect(geminiOrderSchema.parse(parseGeminiJson(text)).orderId).toBe("73797746498585286");
  });

  it("refuses an order whose status is not one Gemini documents", () => {
    const text = DOC_ORDER.replace('"status": "open"', '"status": "pending_new"');
    expect(geminiOrderSchema.safeParse(parseGeminiJson(text)).success).toBe(false);
  });

  it("refuses an order without its filled quantity, or with a price that is not a decimal", () => {
    const parsed = JSON.parse(DOC_ORDER) as Record<string, unknown>;
    expect(geminiOrderSchema.safeParse({ ...parsed, filledQuantity: undefined }).success).toBe(
      false,
    );
    expect(geminiOrderSchema.safeParse({ ...parsed, price: "65%" }).success).toBe(false);
    expect(geminiOrderSchema.safeParse(parsed).success).toBe(true);
  });

  it("reads the active-orders page, the cancel answer and the terms status", () => {
    const page = geminiOrdersSchema.parse(
      parseGeminiJson(`{"orders":[${DOC_ORDER}],"pagination":{"limit":50,"offset":0,"count":1}}`),
    );
    expect(page.orders).toHaveLength(1);
    expect(geminiCancelSchema.parse({ result: "ok", message: "Order 1 cancelled" }).result).toBe(
      "ok",
    );
    expect(
      geminiTermsStatusSchema.parse({
        hasAcceptedLatest: false,
        acceptedVersion: 2,
        latestVersion: 3,
      }).hasAcceptedLatest,
    ).toBe(false);
    expect(geminiTermsStatusSchema.safeParse({ accepted: true }).success).toBe(false);
  });
});

describe("units", () => {
  it("writes prices and quantities as Gemini reads them", () => {
    expect(formatPrice(6_500n)).toBe("0.65");
    expect(formatPrice(100n)).toBe("0.01");
    expect(formatPrice(9_900n)).toBe("0.99");
    expect(formatPrice(4_250n)).toBe("0.425");
    expect(formatQuantity(1_000_000n)).toBe("1.00");
    expect(formatQuantity(10_000n)).toBe("0.01");
    expect(formatQuantity(1_500_000n)).toBe("1.50");
    expect(() => formatQuantity(15_000n)).toThrow(RangeError);
    expect(() => formatQuantity(0n)).toThrow(RangeError);
  });

  it("reads them back exactly", () => {
    expect(priceToBps("0.65")).toBe(6_500n);
    expect(quantityToMicro("100")).toBe(100_000_000n);
    expect(quantityToMicro("1.5")).toBe(1_500_000n);
    expect(quantityToMicro("0.01")).toBe(10_000n);
  });

  it("an average price keeps 8 decimals, rounded half up, and converts to bps", () => {
    expect(avgPriceToScaled("0.64")).toBe(64_000_000n);
    expect(avgPriceToScaled("0.6466666667")).toBe(64_666_667n);
    expect(avgPriceToScaled("0.6466666644")).toBe(64_666_666n);
    expect(scaledToBps(64_666_667n)).toBe(6_467n);
    expect(scaledToBps(64_000_000n)).toBe(6_400n);
    expect(() => avgPriceToScaled("1.5")).toThrow(RangeError);
  });
});

describe("Gemini's errors, typed", () => {
  it("reads both documented error shapes", () => {
    expect(readErrorBody('{"result":"error","reason":"InvalidSignature","message":"bad"}')).toEqual(
      {
        reason: "InvalidSignature",
        detail: "bad",
      },
    );
    expect(readErrorBody('{"error":"InsufficientFunds","message":"Insufficient funds"}')).toEqual({
      reason: "InsufficientFunds",
      detail: "Insufficient funds",
    });
    expect(
      readErrorBody(
        '{"error":"This account is not permitted to trade prediction markets","code":"ACCOUNT_GROUP_BLOCKED"}',
      ),
    ).toEqual({
      reason: "ACCOUNT_GROUP_BLOCKED",
      detail: "This account is not permitted to trade prediction markets",
    });
    expect(readErrorBody("<html>bad gateway</html>")).toEqual({
      reason: null,
      detail: "<html>bad gateway</html>",
    });
  });

  it.each([
    // Answered by api.sandbox.gemini.com to a made-up key on 20 Nov 2026: 400, not 403.
    [
      400,
      '{"result":"error","reason":"InvalidApiKey","message":"Invalid API key"}',
      GeminiAuthError,
    ],
    // Answered by api.sandbox.gemini.com without the security headers on 20 Nov 2026.
    [
      401,
      '{"result":"error","reason":"MissingSecurityHeaders","message":"Required security headers absent"}',
      GeminiAuthError,
    ],
    [400, '{"result":"error","reason":"InvalidSignature","message":"x"}', GeminiAuthError],
    [
      403,
      '{"result":"error","reason":"MissingRole","message":"Trader role required"}',
      GeminiAuthError,
    ],
    [403, "", GeminiAuthError],
    [400, '{"result":"error","reason":"InvalidNonce","message":"x"}', GeminiNonceError],
    [
      406,
      '{"result":"error","reason":"InsufficientFunds","message":"x"}',
      GeminiInsufficientFundsError,
    ],
    [
      422,
      '{"error":"InsufficientFunds","message":"Insufficient funds"}',
      GeminiInsufficientFundsError,
    ],
    [
      400,
      '{"error":"TERMS_NOT_ACCEPTED","message":"Prediction markets terms must be accepted before placing orders"}',
      GeminiTermsNotAcceptedError,
    ],
    [429, '{"result":"error","reason":"RateLimit","message":"x"}', GeminiRateLimitError],
    [404, '{"error":"OrderNotFound","message":"x"}', GeminiNotFoundError],
    [500, '{"error":"InternalError","message":"x"}', GeminiServerError],
    [503, '{"result":"error","reason":"Maintenance","message":"x"}', GeminiServerError],
    [400, '{"error":"InvalidPrice","message":"x"}', GeminiRefusedError],
    [400, '{"result":"error","reason":"MarketNotOpen","message":"x"}', GeminiRefusedError],
    [422, '{"error":"InvalidOrderState","message":"already filled"}', GeminiRefusedError],
  ] as const)("HTTP %i %s → %o", (status, body, type) => {
    const error = errorFromResponse("/v1/prediction-markets/order", status, body);
    expect(error).toBeInstanceOf(type);
    expect(error.status).toBe(status);
    expect(error.message).toContain("/v1/prediction-markets/order");
  });

  it("a 429 keeps the Retry-After it came with", () => {
    const error = errorFromResponse("/x", 429, "", 3, 2_000);
    expect(error).toBeInstanceOf(GeminiRateLimitError);
    expect((error as GeminiRateLimitError).retryAfterMs).toBe(2_000);
    expect((error as GeminiRateLimitError).attempts).toBe(3);
  });
});
