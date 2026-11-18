import { ARC_MIN_MAX_FEE_PER_GAS_WEI, REFUND_BATCH_SIZE } from "@winz/shared";

import { scenarioAmounts } from "./scenario";
import type { Estimate, MoneyMode, Scenario } from "./types";

/**
 * The worst case of a run, computed before anything is sent: what the treasury fronts, and the
 * gas of every transaction at the node's current fee. Pure.
 *
 * Gas units per transaction are the ones measured on Arc testnet (docs/arc-testnet.md: buyFor
 * 243 761, createCampaignFor 161 513, chargeHedge of one ticket 85 043, settle 57 439, refundBatch
 * of one ticket 79 144, payMerchant 73 984, release 70 083, closeSales 32 662), raised by about
 * half and counted as if every ticket were charged in its own transaction. Four more buyFor are
 * counted for transactions the sender may have to replace.
 */
export const GAS_UNITS = {
  createCampaignFor: 250_000n,
  buyFor: 380_000n,
  chargeHedgePerTicket: 130_000n,
  closeSales: 60_000n,
  settle: 100_000n,
  refundBatchBase: 60_000n,
  refundPerTicket: 60_000n,
  payMerchant: 120_000n,
  release: 120_000n,
  sweepTransfer: 21_000n,
  spareRelayerTransactions: 4n * 380_000n,
} as const;

/** Balances must cover the worst case with this margin (20 %). */
export const MARGIN_PERCENT = 20n;

/** Micro-USDC to the 18-decimal unit of the native coin on Arc. */
export const WEI_PER_MICRO = 1_000_000_000_000n;

export function withMargin(amount: bigint): bigint {
  return (amount * (100n + MARGIN_PERCENT) + 99n) / 100n;
}

export interface EstimateInput {
  scenario: Scenario;
  /** The node's current `maxFeePerGas`. */
  nodeMaxFeePerGasWei: bigint;
  moneyMode: MoneyMode;
}

export function estimateRun(input: EstimateInput): Estimate {
  const { scenario } = input;
  const amounts = scenarioAmounts(scenario);
  const sales = BigInt(scenario.purchases);
  const batches = (sales + BigInt(REFUND_BATCH_SIZE) - 1n) / BigInt(REFUND_BATCH_SIZE);

  // On YES the treasury pays the merchant the refunds' worth (payMerchant): count it whatever
  // the outcome asked, so that a run is never started on a balance that only covers NO.
  const treasuryLocks = scenario.budget + amounts.totalPaid + amounts.totalRefundable;

  const relayerGas =
    GAS_UNITS.createCampaignFor +
    GAS_UNITS.buyFor * sales +
    GAS_UNITS.closeSales +
    GAS_UNITS.refundBatchBase * batches +
    GAS_UNITS.refundPerTicket * sales +
    // Counted whatever the outcome: only YES pays the merchant, but the worst case is YES.
    GAS_UNITS.payMerchant +
    GAS_UNITS.release +
    GAS_UNITS.spareRelayerTransactions;
  const oracleGas = GAS_UNITS.chargeHedgePerTicket * sales + GAS_UNITS.settle;
  // Every buyer and the merchant: one transfer each.
  const sweepGas = GAS_UNITS.sweepTransfer * BigInt(scenario.buyers + 1);

  const fee =
    input.nodeMaxFeePerGasWei > ARC_MIN_MAX_FEE_PER_GAS_WEI || input.moneyMode === "erc20"
      ? input.nodeMaxFeePerGasWei
      : ARC_MIN_MAX_FEE_PER_GAS_WEI;
  const relayerGasWei = relayerGas * fee;
  const oracleGasWei = oracleGas * fee;
  const sweepGasWei = sweepGas * fee;

  // On Arc the treasury is the relayer and gas is paid in USDC from the same balance.
  const treasuryNeeds =
    input.moneyMode === "native-usdc"
      ? treasuryLocks * WEI_PER_MICRO + relayerGasWei
      : treasuryLocks * WEI_PER_MICRO;
  return {
    feePerGasWei: fee,
    treasuryLocks,
    relayerGas,
    oracleGas,
    sweepGas,
    relayerGasWei,
    oracleGasWei,
    sweepGasWei,
    treasuryNeedsWithMargin: withMargin(treasuryNeeds),
    relayerGasNeedsWithMarginWei: withMargin(relayerGasWei),
    oracleNeedsWithMarginWei: withMargin(oracleGasWei),
  };
}

/** One line per figure of the estimate, for the operator. */
export function describeEstimate(estimate: Estimate, moneyMode: MoneyMode): string[] {
  const gasUnit = moneyMode === "native-usdc" ? "USDC" : "native coin (not USDC)";
  return [
    `fee per gas used for the estimate: ${formatWei(estimate.feePerGasWei, 9)} gwei`,
    `treasury fronts at worst: ${formatMicro(estimate.treasuryLocks)} USDC (budget, every sale, the merchant's due on YES; the unspent part comes back through the sweep)`,
    `relayer gas at worst: ${estimate.relayerGas.toString()} gas = ${formatWei(estimate.relayerGasWei, 18)} ${gasUnit}`,
    `oracle gas at worst: ${estimate.oracleGas.toString()} gas = ${formatWei(estimate.oracleGasWei, 18)} ${gasUnit}`,
    `sweep gas at worst: ${estimate.sweepGas.toString()} gas = ${formatWei(estimate.sweepGasWei, 18)} ${gasUnit}`,
    `treasury needs, with ${MARGIN_PERCENT.toString()} % margin: ${formatWei(estimate.treasuryNeedsWithMargin, 18)} USDC`,
  ];
}

/** 1 234 567 micro-USDC → "1.234567". */
export function formatMicro(amount: bigint): string {
  return formatWei(amount, 6);
}

/** An integer amount with `decimals` decimals, every digit kept. */
export function formatWei(amount: bigint, decimals: number): string {
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction === "" ? "" : `.${fraction}`}`;
}
