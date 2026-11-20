import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { encodePayload, payloadJson, privateHeaders, signPayload } from "./signer";

/**
 * Gemini's documentation gives the signing recipe but no signature value to check against
 * (developer.gemini.com/authentication/api-key, « Request Signing Code Examples »). The vectors
 * below were computed OUTSIDE this code, with the documentation's own cURL recipe:
 *
 *   PAYLOAD=$(printf '%s' '<json>' | base64 -w0)
 *   printf '%s' "$PAYLOAD" | openssl dgst -sha384 -hmac "winz-test-secret-not-a-real-key"
 *
 * so a mistake shared by the code and the test (the wrong hash, signing the JSON instead of the
 * base64, hex in capitals) cannot pass.
 */
const SECRET = "winz-test-secret-not-a-real-key";

const ORDER_JSON =
  '{"request":"/v1/prediction-markets/order","nonce":1795200000000,"symbol":"GEMI-BTC2611202200-HI100000","orderType":"limit","side":"buy","quantity":"1.00","price":"0.42","outcome":"yes","timeInForce":"good-til-cancel","makerOrCancel":true}';
const ORDER_B64 =
  "eyJyZXF1ZXN0IjoiL3YxL3ByZWRpY3Rpb24tbWFya2V0cy9vcmRlciIsIm5vbmNlIjoxNzk1MjAwMDAwMDAwLCJzeW1ib2wiOiJHRU1JLUJUQzI2MTEyMDIyMDAtSEkxMDAwMDAiLCJvcmRlclR5cGUiOiJsaW1pdCIsInNpZGUiOiJidXkiLCJxdWFudGl0eSI6IjEuMDAiLCJwcmljZSI6IjAuNDIiLCJvdXRjb21lIjoieWVzIiwidGltZUluRm9yY2UiOiJnb29kLXRpbC1jYW5jZWwiLCJtYWtlck9yQ2FuY2VsIjp0cnVlfQ==";
const ORDER_SIGNATURE =
  "f5b1cf1595f28ddaa03eb66031b4a22cf2b8165267907921a630a84f9e98e9a41560ccbedfd3ef2e611ca2725847fef9";

const CANCEL_B64 =
  "eyJyZXF1ZXN0IjoiL3YxL3ByZWRpY3Rpb24tbWFya2V0cy9vcmRlci9jYW5jZWwiLCJub25jZSI6MTc5NTIwMDAwMDAwMSwib3JkZXJJZCI6NzM3OTc3NDY0OTg1ODUyODZ9";
const CANCEL_SIGNATURE =
  "ac8123de0ec25cbeb32186a4559ec4a8581ecf4cab31a911dd4f05635a965984efc9ab57affdcca12399904c3f2bb115";

const orderPayload = {
  request: "/v1/prediction-markets/order",
  nonce: 1_795_200_000_000,
  symbol: "GEMI-BTC2611202200-HI100000",
  orderType: "limit",
  side: "buy",
  quantity: "1.00",
  price: "0.42",
  outcome: "yes",
  timeInForce: "good-til-cancel",
  makerOrCancel: true,
};

describe("Gemini request signing", () => {
  it("encodes the payload's JSON in base64, as the documented recipe does", () => {
    expect(payloadJson(orderPayload)).toBe(ORDER_JSON);
    expect(encodePayload(orderPayload)).toBe(ORDER_B64);
  });

  it("signs the BASE64 payload with HMAC-SHA384, lowercase hex (vector from openssl)", () => {
    expect(signPayload(ORDER_B64, SECRET)).toBe(ORDER_SIGNATURE);
  });

  it("a different secret, or signing the JSON instead of the base64, gives another signature", () => {
    // Positive controls: the vector above is not matched by the likely mistakes.
    expect(signPayload(ORDER_B64, `${SECRET}x`)).not.toBe(ORDER_SIGNATURE);
    expect(createHmac("sha384", SECRET).update(ORDER_JSON).digest("hex")).not.toBe(ORDER_SIGNATURE);
    expect(createHmac("sha256", SECRET).update(ORDER_B64).digest("hex")).not.toBe(ORDER_SIGNATURE);
  });

  it("writes an int64 order id with every digit, never through a float", () => {
    const payload = {
      request: "/v1/prediction-markets/order/cancel",
      nonce: 1_795_200_000_001,
      orderId: 73_797_746_498_585_286n,
    };
    expect(payloadJson(payload)).toBe(
      '{"request":"/v1/prediction-markets/order/cancel","nonce":1795200000001,"orderId":73797746498585286}',
    );
    // As a float the id would end in ...280: the bigint path is what keeps it.
    expect(JSON.stringify({ orderId: Number(73_797_746_498_585_286n) })).toContain(
      "73797746498585280",
    );
    expect(encodePayload(payload)).toBe(CANCEL_B64);
    expect(signPayload(CANCEL_B64, SECRET)).toBe(CANCEL_SIGNATURE);
  });

  it("puts the key, the payload and the signature in the documented headers, with an empty body", () => {
    const headers = privateHeaders("account-test", SECRET, orderPayload);
    expect(headers).toEqual({
      "Content-Type": "text/plain",
      "Content-Length": "0",
      "X-GEMINI-APIKEY": "account-test",
      "X-GEMINI-PAYLOAD": ORDER_B64,
      "X-GEMINI-SIGNATURE": ORDER_SIGNATURE,
      "Cache-Control": "no-cache",
    });
  });
});
