import { ARC_MIN_MAX_FEE_PER_GAS_WEI } from "@winz/shared";

import { TxSenderConfigError } from "./errors";
import type { FeeSuggestion } from "./types";

const GWEI = 1_000_000_000n;

export const DEFAULT_MIN_PRIORITY_FEE_PER_GAS_WEI = 1n * GWEI;
export const DEFAULT_MAX_FEE_PER_GAS_CAP_WEI = 1_000n * GWEI;
export const DEFAULT_FEE_BUMP_PERCENT = 25;
export const DEFAULT_GAS_MARGIN_PERCENT = 20;
/** Nodes refuse a replacement that does not raise both fees by at least this much. */
export const MIN_REPLACEMENT_BUMP_PERCENT = 10;

/** Bounds every signed fee stays within, whatever the node suggests. */
export interface FeePolicy {
  /** Lowest `maxFeePerGas` signed. Never below Arc's minimum base fee. */
  floorWei: bigint;
  /** Priority fee offered when the node suggests less. */
  minPriorityWei: bigint;
  /** Highest `maxFeePerGas` signed: a wrong answer from a node cannot drain the key. */
  capWei: bigint;
}

export interface Fees {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

function maxOf(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function minOf(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** `amount` raised by `percent`, rounded up so that a bump is never lost to integer division. */
function raiseByPercent(amount: bigint, percent: number): bigint {
  const numerator = amount * BigInt(100 + percent);
  return (numerator + 99n) / 100n;
}

/** Validates the fee bounds once, at construction. Throws `TxSenderConfigError`. */
export function createFeePolicy(
  options: {
    minMaxFeePerGasWei?: bigint;
    minPriorityFeePerGasWei?: bigint;
    maxFeePerGasCapWei?: bigint;
  } = {},
): FeePolicy {
  const floorWei = options.minMaxFeePerGasWei ?? ARC_MIN_MAX_FEE_PER_GAS_WEI;
  const minPriorityWei = options.minPriorityFeePerGasWei ?? DEFAULT_MIN_PRIORITY_FEE_PER_GAS_WEI;
  const capWei = options.maxFeePerGasCapWei ?? DEFAULT_MAX_FEE_PER_GAS_CAP_WEI;
  if (floorWei < ARC_MIN_MAX_FEE_PER_GAS_WEI) {
    throw new TxSenderConfigError(
      `minMaxFeePerGasWei (${floorWei.toString()}) is below Arc's minimum base fee (${ARC_MIN_MAX_FEE_PER_GAS_WEI.toString()})`,
    );
  }
  if (capWei < floorWei) {
    throw new TxSenderConfigError(
      `maxFeePerGasCapWei (${capWei.toString()}) is below the fee floor (${floorWei.toString()})`,
    );
  }
  if (minPriorityWei < 0n || minPriorityWei > capWei) {
    throw new TxSenderConfigError(
      `minPriorityFeePerGasWei (${minPriorityWei.toString()}) must be between 0 and the fee cap`,
    );
  }
  return { floorWei, minPriorityWei, capWei };
}

/**
 * Fees of a first attempt: `maxFeePerGas` is the node's suggestion, raised to the floor and
 * lowered to the cap; the priority fee is the node's suggestion, at least the configured
 * minimum, and never above `maxFeePerGas` (EIP-1559 rejects a tip larger than the fee cap).
 */
export function computeFees(suggestion: FeeSuggestion, policy: FeePolicy): Fees {
  const suggestedMaxFee = maxOf(suggestion.maxFeePerGas, 0n);
  const suggestedPriority = maxOf(suggestion.maxPriorityFeePerGas, 0n);
  const maxFeePerGas = minOf(maxOf(suggestedMaxFee, policy.floorWei), policy.capWei);
  const maxPriorityFeePerGas = minOf(maxOf(suggestedPriority, policy.minPriorityWei), maxFeePerGas);
  return { maxFeePerGas, maxPriorityFeePerGas };
}

/**
 * Fees of a replacement for the same nonce: both fees rise by `percent` over the previous
 * attempt, or to what the node now suggests if that is higher. Returns `undefined` when the
 * cap does not leave room for a replacement the node would accept.
 */
export function bumpFees(
  previous: Fees,
  suggestion: FeeSuggestion,
  policy: FeePolicy,
  percent: number = DEFAULT_FEE_BUMP_PERCENT,
): Fees | undefined {
  const fresh = computeFees(suggestion, policy);
  const maxFeePerGas = maxOf(raiseByPercent(previous.maxFeePerGas, percent), fresh.maxFeePerGas);
  if (maxFeePerGas > policy.capWei) return undefined;
  // A tip of zero would stay zero after any percentage: one wei more is the smallest raise.
  const raisedPriority = maxOf(
    raiseByPercent(previous.maxPriorityFeePerGas, percent),
    previous.maxPriorityFeePerGas + 1n,
  );
  const maxPriorityFeePerGas = minOf(
    maxOf(raisedPriority, fresh.maxPriorityFeePerGas),
    maxFeePerGas,
  );
  return { maxFeePerGas, maxPriorityFeePerGas };
}

/** Gas limit signed for an estimate: the estimate plus a margin, rounded up. */
export function addGasMargin(
  estimate: bigint,
  percent: number = DEFAULT_GAS_MARGIN_PERCENT,
): bigint {
  return raiseByPercent(estimate, percent);
}

/** Delay before retry number `attempt` (1-based): `baseMs`, doubled each time, at most `maxMs`. */
export function backoffDelayMs(attempt: number, baseMs: number, maxMs: number): number {
  const exponent = Math.min(Math.max(attempt, 1) - 1, 30);
  return Math.min(maxMs, baseMs * 2 ** exponent);
}
