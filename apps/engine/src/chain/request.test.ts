import { describe, expect, it } from "vitest";

import { InvalidTxRequestError } from "./errors";
import { MAX_TX_VALUE_WEI, normalizeTxRequest } from "./request";
import { SENDER_STATE_KEY, type TxRequest } from "./types";

const valid: TxRequest = {
  idempotencyKey: "buy:pi_123",
  signer: "relayer",
  kind: "buyFor",
  to: "0xAbCdEf0123456789abcdef0123456789ABCDEF01",
  data: "0xDEADbeef",
};

describe("normalizeTxRequest", () => {
  it("lowercases the address and the call data and defaults value and payload", () => {
    expect(normalizeTxRequest(valid)).toEqual({
      idempotencyKey: "buy:pi_123",
      signer: "relayer",
      kind: "buyFor",
      to: "0xabcdef0123456789abcdef0123456789abcdef01",
      data: "0xdeadbeef",
      value: 0n,
      payload: {},
    });
  });

  it("stores payload bigints as decimal strings and lowercases addresses in it", () => {
    const normalized = normalizeTxRequest({
      ...valid,
      value: 5n,
      payload: {
        campaignId: 7n,
        amounts: [1n, 2n ** 128n],
        buyer: "0xAbCdEf0123456789abcdef0123456789ABCDEF01",
        nested: { qty: 2, paused: false, note: null },
      },
    });
    expect(normalized.value).toBe(5n);
    expect(normalized.payload).toEqual({
      campaignId: "7",
      amounts: ["1", "340282366920938463463374607431768211456"],
      buyer: "0xabcdef0123456789abcdef0123456789abcdef01",
      nested: { qty: 2, paused: false, note: null },
    });
  });

  it("accepts empty call data and the largest storable value", () => {
    expect(normalizeTxRequest({ ...valid, data: "0x", value: MAX_TX_VALUE_WEI }).value).toBe(
      MAX_TX_VALUE_WEI,
    );
  });

  it.each<[string, Partial<Record<keyof TxRequest, unknown>>]>([
    ["an empty idempotency key", { idempotencyKey: "  " }],
    ["an unknown signer", { signer: "treasury" }],
    ["an empty kind", { kind: "" }],
    ["a short address", { to: "0x1234" }],
    ["call data with half a byte", { data: "0xabc" }],
    ["call data without prefix", { data: "abcd" }],
    ["a negative value", { value: -1n }],
    ["a value above bigint range", { value: MAX_TX_VALUE_WEI + 1n }],
    ["a value that is a number", { value: 1 }],
    ["a payload that is an array", { payload: [] }],
    ["a payload using the reserved key", { payload: { [SENDER_STATE_KEY]: {} } }],
    ["a payload that JSON cannot hold", { payload: { callback: () => undefined } }],
    ["a payload with a non-finite number", { payload: { ratio: Number.NaN } }],
  ])("rejects %s", (_label, override) => {
    expect(() => normalizeTxRequest({ ...valid, ...override } as TxRequest)).toThrow(
      InvalidTxRequestError,
    );
  });
});
