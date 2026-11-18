import { MICRO_PER_CENT, refundableAmount } from "@winz/shared";

import { MIN_CARD_AMOUNT } from "@/lib/server/campaign-writes";

import type { Scenario, ScenarioInput } from "./types";

/**
 * The scenario of a rehearsal: defaults, checks, and the amounts it moves. Pure functions.
 *
 * The unit price defaults to $0.50, not less: the campaign route takes a unit price and a budget
 * only as card-payable amounts, whole cents from Stripe's $0.50 floor (`MIN_CARD_AMOUNT`), and the
 * rehearsal drives that route exactly as a merchant does.
 */

export const MAX_PURCHASES = 300;
/** The demo sale route's limit on one sale. */
export const MAX_UNITS_PER_PURCHASE = 20;
export const MAX_PARALLEL = 10;

export const SCENARIO_DEFAULTS = {
  purchases: 12,
  unitsPerPurchase: 1,
  unitPrice: MIN_CARD_AMOUNT,
  refundBps: 10_000,
  usualMarginBps: 6_500,
  minMarginBps: 4_500,
  outcome: "yes",
  buyers: 6,
  parallel: 3,
} as const;

/** Every amount the scenario moves, at worst, in micro-USDC. */
export interface ScenarioAmounts {
  /** What one sale costs (units × unit price). */
  perSalePaid: bigint;
  perSaleRefundable: bigint;
  /** Largest guarantee of one sale: floor(paid × (usual − minimum margin) / 10 000). */
  perSaleGuaranteeCap: bigint;
  totalPaid: bigint;
  totalRefundable: bigint;
  totalGuaranteeCap: bigint;
}

export function scenarioAmounts(
  scenario: Pick<
    Scenario,
    "purchases" | "unitsPerPurchase" | "unitPrice" | "refundBps" | "usualMarginBps" | "minMarginBps"
  >,
): ScenarioAmounts {
  const units = BigInt(scenario.unitsPerPurchase);
  const perSalePaid = units * scenario.unitPrice;
  const perSaleRefundable = refundableAmount(units, scenario.unitPrice, BigInt(scenario.refundBps));
  const costBps = BigInt(Math.max(0, scenario.usualMarginBps - scenario.minMarginBps));
  const perSaleGuaranteeCap = (perSalePaid * costBps) / 10_000n;
  const count = BigInt(scenario.purchases);
  return {
    perSalePaid,
    perSaleRefundable,
    perSaleGuaranteeCap,
    totalPaid: perSalePaid * count,
    totalRefundable: perSaleRefundable * count,
    totalGuaranteeCap: perSaleGuaranteeCap * count,
  };
}

function ceilToCent(amount: bigint): bigint {
  return ((amount + MICRO_PER_CENT - 1n) / MICRO_PER_CENT) * MICRO_PER_CENT;
}

/**
 * The default budget: enough for every sale's largest guarantee, so that the run never pauses on
 * its budget, rounded up to the cent and never below $0.50.
 */
export function defaultBudget(
  scenario: Pick<
    Scenario,
    "purchases" | "unitsPerPurchase" | "unitPrice" | "refundBps" | "usualMarginBps" | "minMarginBps"
  >,
): bigint {
  const cap = scenarioAmounts(scenario).totalGuaranteeCap;
  const budget = ceilToCent(cap);
  return budget < MIN_CARD_AMOUNT ? MIN_CARD_AMOUNT : budget;
}

function integerIn(
  problems: string[],
  name: string,
  value: number,
  min: number,
  max: number,
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    problems.push(`${name} must be a whole number from ${min.toString()} to ${max.toString()}`);
  }
}

function cardAmount(problems: string[], name: string, value: bigint): void {
  if (value < MIN_CARD_AMOUNT || value % MICRO_PER_CENT !== 0n) {
    problems.push(
      `${name} must be a whole number of cents of at least $0.50 (the campaign route takes card-payable amounts only)`,
    );
  }
}

/** The scenario with its defaults, or the list of what is wrong with it. */
export function resolveScenario(input: ScenarioInput): {
  scenario: Scenario | null;
  problems: string[];
} {
  const base = {
    purchases: input.purchases ?? SCENARIO_DEFAULTS.purchases,
    unitsPerPurchase: input.unitsPerPurchase ?? SCENARIO_DEFAULTS.unitsPerPurchase,
    unitPrice: input.unitPrice ?? SCENARIO_DEFAULTS.unitPrice,
    refundBps: input.refundBps ?? SCENARIO_DEFAULTS.refundBps,
    usualMarginBps: input.usualMarginBps ?? SCENARIO_DEFAULTS.usualMarginBps,
    minMarginBps: input.minMarginBps ?? SCENARIO_DEFAULTS.minMarginBps,
  };
  const scenario: Scenario = {
    ...base,
    budget: input.budget ?? defaultBudget(base),
    outcome: input.outcome ?? SCENARIO_DEFAULTS.outcome,
    buyers: input.buyers ?? Math.min(SCENARIO_DEFAULTS.buyers, base.purchases),
    parallel: input.parallel ?? SCENARIO_DEFAULTS.parallel,
  };

  const problems: string[] = [];
  integerIn(problems, "purchases", scenario.purchases, 1, MAX_PURCHASES);
  integerIn(problems, "units per purchase", scenario.unitsPerPurchase, 1, MAX_UNITS_PER_PURCHASE);
  integerIn(problems, "refund (bps)", scenario.refundBps, 1, 10_000);
  integerIn(problems, "usual margin (bps)", scenario.usualMarginBps, 0, 10_000);
  integerIn(problems, "minimum margin (bps)", scenario.minMarginBps, 0, 10_000);
  integerIn(problems, "buyers", scenario.buyers, 1, Math.max(1, scenario.purchases));
  integerIn(problems, "parallel sales", scenario.parallel, 1, MAX_PARALLEL);
  if (scenario.minMarginBps >= scenario.usualMarginBps) {
    problems.push(
      "the minimum margin must be below the usual margin (nothing to spend on hedging)",
    );
  }
  if (scenario.outcome !== "yes" && scenario.outcome !== "no") {
    problems.push("the outcome must be yes or no");
  }
  cardAmount(problems, "unit price", scenario.unitPrice);
  cardAmount(problems, "budget", scenario.budget);
  if (problems.length === 0) {
    const cap = scenarioAmounts(scenario).totalGuaranteeCap;
    if (scenario.budget < cap) {
      problems.push(
        `the budget (${scenario.budget.toString()} micro-USDC) is below the largest guarantee of all the sales (${cap.toString()}): the campaign could pause on its budget before the last sale`,
      );
    }
  }
  return { scenario: problems.length === 0 ? scenario : null, problems };
}

/** The e-mail of a demo buyer of a run. Never written to a receipt (buyers are numbered there). */
export function buyerEmail(runId: string, buyer: number): string {
  return `rehearsal-${runId}-buyer-${buyer.toString().padStart(3, "0")}@example.com`;
}

/** The e-mail of the merchant of a run. Never written to a receipt. */
export function merchantEmail(runId: string): string {
  return `rehearsal-${runId}-merchant@example.com`;
}

/** The buyer (1-based) of the sale `index` (0-based): sales go round the buyers in turn. */
export function buyerOf(index: number, buyers: number): number {
  return (index % buyers) + 1;
}
