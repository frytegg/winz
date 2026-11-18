import { describe, expect, it } from "vitest";

import { ARC_MIN_MAX_FEE_PER_GAS_WEI } from "@winz/shared";

import { TxSenderConfigError } from "./errors";
import { resolveTxSenderSettings } from "./settings";
import type { TxSenderConfig } from "./types";

const base: TxSenderConfig = {
  chainId: 5_042_002,
  escrowAddress: "0xAbCdEf0123456789abcdef0123456789ABCDEF01",
};

describe("resolveTxSenderSettings", () => {
  it("applies the documented defaults", () => {
    const settings = resolveTxSenderSettings(base);
    expect(settings).toMatchObject({
      chainId: 5_042_002,
      escrowAddress: "0xabcdef0123456789abcdef0123456789abcdef01",
      receiptPollMs: 300,
      idlePollMs: 500,
      replaceAfterMs: 15_000,
      maxFeeBumps: 3,
      feeBumpPercent: 25,
      gasMarginPercent: 20,
      maxPrepareAttempts: 6,
      maxPrepareMs: 60_000,
      retryBaseMs: 250,
      retryMaxMs: 10_000,
      waitPollMs: 250,
      defaultWaitTimeoutMs: 60_000,
      maxInFlight: 8,
      resendCheckMs: 3_000,
      feeSuggestionMaxAgeMs: 1_000,
    });
    expect(settings.feePolicy.floorWei).toBe(ARC_MIN_MAX_FEE_PER_GAS_WEI);
  });

  it("keeps what the caller sets", () => {
    const settings = resolveTxSenderSettings({ ...base, receiptPollMs: 50, maxFeeBumps: 0 });
    expect(settings.receiptPollMs).toBe(50);
    expect(settings.maxFeeBumps).toBe(0);
  });

  it("accepts a window of 1 (strictly one at a time) and of 64", () => {
    expect(resolveTxSenderSettings({ ...base, maxInFlight: 1 }).maxInFlight).toBe(1);
    expect(resolveTxSenderSettings({ ...base, maxInFlight: 64 }).maxInFlight).toBe(64);
  });

  it.each<[string, Partial<TxSenderConfig>]>([
    ["a malformed escrow address", { escrowAddress: "0x12" as `0x${string}` }],
    ["a zero poll interval", { receiptPollMs: 0 }],
    ["a fractional chain id", { chainId: 1.5 }],
    ["a negative bump count", { maxFeeBumps: -1 }],
    ["a bump below what nodes accept", { feeBumpPercent: 9 }],
    ["a backoff ceiling below its base", { retryBaseMs: 500, retryMaxMs: 100 }],
    ["a fee floor below Arc's", { minMaxFeePerGasWei: 1n }],
    ["zero prepare attempts", { maxPrepareAttempts: 0 }],
    ["a negative prepare budget", { maxPrepareMs: -1 }],
    ["an empty window", { maxInFlight: 0 }],
    ["a window above 64", { maxInFlight: 65 }],
    ["a fractional window", { maxInFlight: 1.5 }],
    ["a zero resend check", { resendCheckMs: 0 }],
    ["a negative fee suggestion age", { feeSuggestionMaxAgeMs: -1 }],
  ])("rejects %s", (_label, override) => {
    expect(() => resolveTxSenderSettings({ ...base, ...override })).toThrow(TxSenderConfigError);
  });
});
