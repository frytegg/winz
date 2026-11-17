import { isAddress, type Address } from "viem";

import { TxSenderConfigError } from "./errors";
import {
  createFeePolicy,
  DEFAULT_FEE_BUMP_PERCENT,
  DEFAULT_GAS_MARGIN_PERCENT,
  MIN_REPLACEMENT_BUMP_PERCENT,
  type FeePolicy,
} from "./fees";
import type { TxSenderConfig } from "./types";

/** `TxSenderConfig` with every default applied and every value checked. */
export interface TxSenderSettings {
  chainId: number;
  /** Lowercase. */
  escrowAddress: Address;
  receiptPollMs: number;
  idlePollMs: number;
  replaceAfterMs: number;
  maxFeeBumps: number;
  feeBumpPercent: number;
  gasMarginPercent: number;
  feePolicy: FeePolicy;
  maxPrepareAttempts: number;
  maxPrepareMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  waitPollMs: number;
  defaultWaitTimeoutMs: number;
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TxSenderConfigError(`${name} must be a positive integer, got ${String(value)}`);
  }
  return value;
}

function nonNegativeInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TxSenderConfigError(`${name} must be a non-negative integer, got ${String(value)}`);
  }
  return value;
}

/** Applies the defaults and rejects a configuration that cannot work. */
export function resolveTxSenderSettings(config: TxSenderConfig): TxSenderSettings {
  if (!isAddress(config.escrowAddress, { strict: false })) {
    throw new TxSenderConfigError(
      `escrowAddress is not an address: ${String(config.escrowAddress)}`,
    );
  }
  const feeBumpPercent = positiveInteger(
    "feeBumpPercent",
    config.feeBumpPercent ?? DEFAULT_FEE_BUMP_PERCENT,
  );
  if (feeBumpPercent < MIN_REPLACEMENT_BUMP_PERCENT) {
    throw new TxSenderConfigError(
      `feeBumpPercent must be at least ${MIN_REPLACEMENT_BUMP_PERCENT.toString()}: nodes refuse a smaller replacement`,
    );
  }
  const retryBaseMs = positiveInteger("retryBaseMs", config.retryBaseMs ?? 250);
  const retryMaxMs = positiveInteger("retryMaxMs", config.retryMaxMs ?? 10_000);
  if (retryMaxMs < retryBaseMs) {
    throw new TxSenderConfigError("retryMaxMs must not be below retryBaseMs");
  }
  return {
    chainId: positiveInteger("chainId", config.chainId),
    escrowAddress: config.escrowAddress.toLowerCase() as Address,
    receiptPollMs: positiveInteger("receiptPollMs", config.receiptPollMs ?? 300),
    idlePollMs: positiveInteger("idlePollMs", config.idlePollMs ?? 500),
    replaceAfterMs: positiveInteger("replaceAfterMs", config.replaceAfterMs ?? 15_000),
    maxFeeBumps: nonNegativeInteger("maxFeeBumps", config.maxFeeBumps ?? 3),
    feeBumpPercent,
    gasMarginPercent: nonNegativeInteger(
      "gasMarginPercent",
      config.gasMarginPercent ?? DEFAULT_GAS_MARGIN_PERCENT,
    ),
    feePolicy: createFeePolicy(config),
    maxPrepareAttempts: positiveInteger("maxPrepareAttempts", config.maxPrepareAttempts ?? 6),
    maxPrepareMs: nonNegativeInteger("maxPrepareMs", config.maxPrepareMs ?? 60_000),
    retryBaseMs,
    retryMaxMs,
    waitPollMs: positiveInteger("waitPollMs", config.waitPollMs ?? 250),
    defaultWaitTimeoutMs: positiveInteger(
      "defaultWaitTimeoutMs",
      config.defaultWaitTimeoutMs ?? 60_000,
    ),
  };
}
