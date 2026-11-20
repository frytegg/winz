import { createHmac } from "node:crypto";

/**
 * Gemini private REST authentication (developer.gemini.com/authentication/api-key, read 20 Nov
 * 2026): the JSON payload (`request`, `nonce` and the endpoint's fields) is base64-encoded into
 * `X-GEMINI-PAYLOAD`, signed as `hex(HMAC_SHA384(base64(payload), key = api_secret))` into
 * `X-GEMINI-SIGNATURE`, the key goes in `X-GEMINI-APIKEY`, and the HTTP body is empty.
 */

/** A payload value. `bigint` is written as a JSON number with every digit (order ids are int64). */
export type PayloadValue = string | number | boolean | bigint | null | readonly string[];

export type GeminiPayload = { request: string; nonce: number } & Record<string, PayloadValue>;

/** A string no payload value can contain: JSON.stringify writes NUL as the six characters \u0000. */
const BIGINT_MARK = /"\\u0000bigint:(-?\d+)\\u0000"/g;

/**
 * The payload as JSON. Order ids are int64 and exceed 2^53, so a `bigint` is written as a JSON
 * number with every digit, never through a float: it is first written as a marked string, then the
 * marks and quotes are removed.
 */
export function payloadJson(payload: GeminiPayload): string {
  return JSON.stringify(payload, (_key, value: unknown) =>
    typeof value === "bigint" ? `\u0000bigint:${value.toString()}\u0000` : value,
  ).replace(BIGINT_MARK, "$1");
}

/** `X-GEMINI-PAYLOAD`: the payload's JSON, UTF-8, base64 (standard alphabet, padded). */
export function encodePayload(payload: GeminiPayload): string {
  return Buffer.from(payloadJson(payload), "utf8").toString("base64");
}

/** `X-GEMINI-SIGNATURE`: lowercase hex HMAC-SHA384 of the base64 payload, keyed by the secret. */
export function signPayload(base64Payload: string, apiSecret: string): string {
  return createHmac("sha384", apiSecret).update(base64Payload, "utf8").digest("hex");
}

/** Every header of a private request, the empty body's included. */
export function privateHeaders(
  apiKey: string,
  apiSecret: string,
  payload: GeminiPayload,
): Record<string, string> {
  const encoded = encodePayload(payload);
  return {
    "Content-Type": "text/plain",
    "Content-Length": "0",
    "X-GEMINI-APIKEY": apiKey,
    "X-GEMINI-PAYLOAD": encoded,
    "X-GEMINI-SIGNATURE": signPayload(encoded, apiSecret),
    "Cache-Control": "no-cache",
  };
}
