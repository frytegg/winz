import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  GeminiAuthError,
  GeminiNetworkError,
  GeminiNonceError,
  GeminiRateLimitError,
  GeminiResponseError,
} from "./errors";
import type { SimGemini } from "./sim-server";
import { SIM_KEY, SIM_SECRET, capturedLogger, simClient, simGemini } from "./test-support";

let sim: SimGemini | null = null;

afterEach(async () => {
  await sim?.stop();
  sim = null;
});

const makerOrder = {
  symbol: "GEMI-BTC2611202200-HI91000",
  orderType: "limit" as const,
  side: "buy" as const,
  quantity: "1.00",
  price: "0.36",
  outcome: "yes" as const,
  timeInForce: "good-til-cancel" as const,
  makerOrCancel: true,
};

describe("GeminiPrivateClient against the simulated Gemini", () => {
  it("signs as documented: key header, empty body, base64 payload with request and nonce, HMAC-SHA384", async () => {
    sim = await simGemini();
    const { logger } = capturedLogger();
    const client = simClient(sim, logger);
    const placed = await client.placeOrder(makerOrder);
    expect(placed.status).toBe("open");
    // The id is above 2^53 and arrives with every digit.
    expect(placed.orderId).toBe("73797746498585286");
    const [request] = sim.privateRequests("/v1/prediction-markets/order");
    if (request === undefined) throw new Error("no request reached the server");
    expect(request.authError).toBeNull();
    expect(request.method).toBe("POST");
    expect(request.headers["x-gemini-apikey"]).toBe(SIM_KEY);
    expect(request.headers["content-length"]).toBe("0");
    expect(request.headers["content-type"]).toBe("text/plain");
    expect(request.headers["cache-control"]).toBe("no-cache");
    expect(request.payload).toEqual({
      request: "/v1/prediction-markets/order",
      nonce: expect.any(Number) as number,
      ...makerOrder,
    });
    // The signature is recomputed here from the raw header, independently of the signer.
    const expected = createHmac("sha384", SIM_SECRET)
      .update(request.rawPayloadHeader ?? "")
      .digest("hex");
    expect(request.rawSignatureHeader).toBe(expected);
  });

  it("sends the cancel's int64 order id as a JSON number with every digit", async () => {
    sim = await simGemini();
    const client = simClient(sim, capturedLogger().logger);
    const placed = await client.placeOrder(makerOrder);
    await client.cancelOrder(placed.orderId);
    const [cancel] = sim.privateRequests("/v1/prediction-markets/order/cancel");
    expect(cancel?.payload?.orderId).toBe(73_797_746_498_585_286n);
    expect(sim.orders[0]?.status).toBe("cancelled");
  });

  it("nonces strictly increase across requests, even sent together", async () => {
    sim = await simGemini();
    const client = simClient(sim, capturedLogger().logger, { now: () => 1_795_200_000_000 });
    await Promise.all([
      client.activeOrders(),
      client.activeOrders(),
      client.termsStatus(),
      client.placeOrder(makerOrder),
    ]);
    const nonces = sim.privateRequests().map((request) => request.payload?.nonce as number);
    expect(nonces).toHaveLength(4);
    expect(sim.privateRequests().every((request) => request.authError === null)).toBe(true);
    for (let i = 1; i < nonces.length; i += 1) {
      expect(nonces[i]).toBeGreaterThan(nonces[i - 1] ?? Number.POSITIVE_INFINITY);
    }
  });

  it("a wrong key is refused by the server and comes back as an auth error, never retried", async () => {
    sim = await simGemini();
    const client = simClient(sim, capturedLogger().logger, { apiKey: "account-WrongKey" });
    await expect(client.activeOrders()).rejects.toBeInstanceOf(GeminiAuthError);
    expect(sim.requests).toHaveLength(1);
    expect(sim.requests[0]?.authError).toBe("InvalidApiKey");
  });

  it("a wrong secret gives InvalidSignature, an auth error", async () => {
    sim = await simGemini();
    const client = simClient(sim, capturedLogger().logger, { apiSecret: "not-the-secret" });
    const error = await client.termsStatus().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GeminiAuthError);
    expect((error as GeminiAuthError).reason).toBe("InvalidSignature");
  });

  it("429 then success: waits, sends again with a new nonce, creates one order", async () => {
    sim = await simGemini();
    sim.script("/v1/prediction-markets/order", {
      status: 429,
      body: '{"result":"error","reason":"RateLimit","message":"Requests were made too frequently"}',
      headers: { "retry-after": "0" },
    });
    const { logger, lines } = capturedLogger();
    const client = simClient(sim, logger);
    const placed = await client.placeOrder(makerOrder);
    expect(placed.status).toBe("open");
    const attempts = sim.privateRequests("/v1/prediction-markets/order");
    expect(attempts.map((request) => request.status)).toEqual([429, 201]);
    expect(attempts[1]?.payload?.nonce as number).toBeGreaterThan(
      attempts[0]?.payload?.nonce as number,
    );
    expect(sim.orders).toHaveLength(1);
    expect(lines.some((line) => line.includes("rate limit"))).toBe(true);
  });

  it("429 every time: gives up after the configured tries with a rate-limit error", async () => {
    sim = await simGemini();
    const busy = { status: 429, body: '{"result":"error","reason":"RateLimit","message":"x"}' };
    sim.script("/v1/prediction-markets/orders/active", busy, busy, busy);
    const client = simClient(sim, capturedLogger().logger, { rateLimitAttempts: 3 });
    const error = await client.activeOrders().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GeminiRateLimitError);
    expect((error as GeminiRateLimitError).attempts).toBe(3);
    expect(sim.privateRequests("/v1/prediction-markets/orders/active")).toHaveLength(3);
  });

  it("an InvalidNonce is sent once more with a fresh nonce; a second one is thrown", async () => {
    sim = await simGemini();
    const nonce = { status: 400, body: '{"result":"error","reason":"InvalidNonce","message":"x"}' };
    sim.script("/v1/prediction-markets/orders/active", nonce);
    const client = simClient(sim, capturedLogger().logger);
    await expect(client.activeOrders()).resolves.toMatchObject({ orders: [] });
    sim.script("/v1/prediction-markets/orders/active", nonce, nonce);
    await expect(client.activeOrders()).rejects.toBeInstanceOf(GeminiNonceError);
  });

  it("a placement without an answer is never sent twice: the outcome is unknown", async () => {
    sim = await simGemini();
    sim.script("/v1/prediction-markets/order", { dropAfterProcessing: true });
    const client = simClient(sim, capturedLogger().logger);
    await expect(client.placeOrder(makerOrder)).rejects.toBeInstanceOf(GeminiNetworkError);
    expect(sim.privateRequests("/v1/prediction-markets/order")).toHaveLength(1);
    // The order exists at Gemini all the same.
    expect(sim.orders).toHaveLength(1);
  });

  it("a read without an answer is tried again", async () => {
    sim = await simGemini();
    sim.script("/v1/prediction-markets/orders/active", { dropBeforeProcessing: true });
    const client = simClient(sim, capturedLogger().logger);
    await expect(client.activeOrders()).resolves.toMatchObject({ orders: [] });
    expect(
      sim.requests.filter((r) => r.path === "/v1/prediction-markets/orders/active"),
    ).toHaveLength(2);
  });

  it("an answer that is not the documented shape is a response error, not a guess", async () => {
    sim = await simGemini();
    sim.script("/v1/prediction-markets/orders/active", { status: 200, body: '{"results":[]}' });
    const client = simClient(sim, capturedLogger().logger);
    await expect(client.activeOrders()).rejects.toBeInstanceOf(GeminiResponseError);
  });

  it("reads the public events and book of the simulated sandbox without a key", async () => {
    sim = await simGemini();
    const client = simClient(sim, capturedLogger().logger);
    const events = await client.listActiveEvents({ category: "Crypto", limit: 100, offset: 0 });
    expect(events.events[0]?.contracts[0]?.instrumentSymbol).toBe("GEMI-BTC2611202200-HI91000");
    const book = await client.getBook("GEMI-BTC2611202200-HI91000");
    expect(book.asks[0]).toEqual({ price: "0.57", amount: "3.0" });
    const publicRequest = sim.requests.find((request) => request.path.startsWith("/v1/book/"));
    expect(publicRequest?.headers["x-gemini-apikey"]).toBeUndefined();
  });
});
