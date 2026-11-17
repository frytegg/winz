import { createHash } from "node:crypto";

import type { Address } from "viem";

import type { Outcome } from "@winz/shared";

/** `IWinzEscrow.Outcome` by result: Yes = 0, No = 1, Void = 2. */
export const ONCHAIN_OUTCOME: Readonly<Record<Outcome, 0 | 1 | 2>> = { yes: 0, no: 1, void: 2 };

/** `IWinzEscrow.Status` indices. */
export const ESCROW_STATUS = {
  live: 0,
  paused: 1,
  settledYes: 2,
  settledNo: 3,
  void: 4,
} as const;

/** True once `settle` went through: SettledYes, SettledNo or Void. */
export function isSettledStatus(status: number): boolean {
  return (
    status === ESCROW_STATUS.settledYes ||
    status === ESCROW_STATUS.settledNo ||
    status === ESCROW_STATUS.void
  );
}

/** The result a settled on-chain status stands for, null before settlement. */
export function outcomeOfStatus(status: number): Outcome | null {
  if (status === ESCROW_STATUS.settledYes) return "yes";
  if (status === ESCROW_STATUS.settledNo) return "no";
  if (status === ESCROW_STATUS.void) return "void";
  return null;
}

/** Splits `items` into consecutive groups of at most `size`, in order. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("chunk size must be at least 1");
  const groups: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    groups.push(items.slice(start, start + size));
  }
  return groups;
}

/** Ascending order of bigints, for `Array.prototype.sort`. */
export function compareBigint(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Idempotency keys of the watcher's transactions. Every key starts with
 * `settlement:<escrow>:<campaign>:<step>` and ends with `:a<attempt>`, so a crashed watcher finds
 * what it already sent, and a step that reverted is retried under a new key a bounded number of
 * times. Steps whose content varies (charges, refunds) carry a digest of that content: the same
 * tickets and amounts give the same key, whichever process computes them.
 */
export function campaignKeyPrefix(escrow: Address, onchainId: bigint): string {
  return `settlement:${escrow.toLowerCase()}:${onchainId.toString()}`;
}

/** Short digest of a list of integers, stable across processes. */
export function digestOf(values: readonly bigint[]): string {
  return createHash("sha256")
    .update(values.map((value) => value.toString()).join(","))
    .digest("hex")
    .slice(0, 24);
}

export function chargeKeyBase(
  prefix: string,
  ticketIds: readonly bigint[],
  amounts: readonly bigint[],
): string {
  return `${prefix}:charge:${digestOf([...ticketIds, -1n, ...amounts])}`;
}

export function settleKeyBase(prefix: string, outcome: Outcome): string {
  return `${prefix}:settle:${outcome}`;
}

export function refundKeyBase(prefix: string, ticketIds: readonly bigint[]): string {
  return `${prefix}:refund:${digestOf(ticketIds)}`;
}

export function payMerchantKeyBase(prefix: string): string {
  return `${prefix}:pay-merchant`;
}

export function releaseKeyBase(prefix: string): string {
  return `${prefix}:release`;
}

/** `<base>:a<attempt>`; attempts start at 1. */
export function attemptKey(base: string, attempt: number): string {
  return `${base}:a${attempt.toString()}`;
}

/** The attempt number of a key built by `attemptKey` on `base`, or null for any other key. */
export function attemptOf(base: string, key: string): number | null {
  if (!key.startsWith(`${base}:a`)) return null;
  const rest = key.slice(base.length + 2);
  if (!/^[1-9][0-9]{0,8}$/.test(rest)) return null;
  return Number(rest);
}

/** The allocation of a ticket's lot, as the hedging lane wrote it. Null fields: no lot row. */
export interface LotAllocation {
  /** `lots.cost`, micro-USDC. */
  cost: bigint | null;
  /** `lots.filled_qty`, micro-contracts. */
  filledQty: bigint | null;
  /** `lots.max_hedge_cost`, micro-USDC. */
  maxHedgeCost: bigint | null;
}

export interface SafetyNetCharge {
  /** micro-USDC, never above the on-chain guarantee. */
  amount: bigint;
  /** False when no hedge was ever allocated to the ticket: it is charged zero. */
  allocated: boolean;
}

/**
 * What the safety net charges a ticket the hedging lane left uncharged: its lot's cost capped at
 * the guarantee (the on-chain `maxHedgeCost`, and the lot's copy of it), or zero when the lot was
 * never allocated anything (no lot row, or a lot with neither a fill nor a cost). Pure.
 */
export function safetyNetCharge(guarantee: bigint, lot: LotAllocation): SafetyNetCharge {
  const filled = lot.filledQty ?? 0n;
  const cost = lot.cost ?? 0n;
  const allocated = lot.cost !== null && (filled > 0n || cost > 0n);
  if (!allocated) return { amount: 0n, allocated: false };
  let amount = cost < guarantee ? cost : guarantee;
  if (lot.maxHedgeCost !== null && lot.maxHedgeCost < amount) amount = lot.maxHedgeCost;
  if (amount < 0n) amount = 0n;
  return { amount, allocated: true };
}

/** Exponential backoff: `baseMs` after the first failure, doubled each time, at most `maxMs`. */
export function retryDelayMs(failures: number, baseMs: number, maxMs: number): number {
  const exponent = Math.min(Math.max(failures, 1) - 1, 30);
  return Math.min(maxMs, baseMs * 2 ** exponent);
}
