import type { Address } from "viem";

import type { Outcome } from "@winz/shared";

import type { CampaignEvents, OnchainCampaignState } from "./chain";
import { WEI_PER_MICRO } from "./estimate";
import type { InvariantResult, PauseProbe, Scenario } from "./types";

/**
 * The invariants checked at the end of a run (TASKS.md Q-04, SPEC section 17 criteria 3, 4, 5),
 * each with the numbers it was decided on. Pure: everything is measured before.
 */

/** The longest the unhedged notional may stay above its limit (criterion 4). */
export const UNHEDGED_GRACE_MS = 5_000;

export interface DeskSample {
  atMs: number;
  /** (E − H) × price, micro-USDC; 0 when the instrument has no row yet. */
  unhedgedNotional: bigint;
  uMax: bigint;
}

export interface MoneyParty {
  role: string;
  address: Address;
  beforeWei: bigint;
  afterWei: bigint;
  /** Gas this account paid between the two snapshots, when gas is paid in the money (Arc). */
  gasWei: bigint;
}

export interface DemoFlag {
  source: string;
  demo: boolean;
}

export interface InvariantInput {
  scenario: Scenario;
  outcome: Outcome;
  pauseThresholdBps: number;
  /** Every ask the rehearsal drove while the campaign's sales were open. */
  drivenAsksWhileOpen: readonly number[];
  /** The book driven above the threshold before any sale, and what the engine and routes did. */
  pauseProbe: PauseProbe | null;
  events: CampaignEvents;
  onchain: OnchainCampaignState;
  escrow: Address;
  treasury: Address;
  merchant: Address;
  /** Every account whose money is followed: treasury, oracle, merchant, buyers, escrow. */
  parties: readonly MoneyParty[];
  deskSamples: readonly DeskSample[];
  demoFlags: readonly DemoFlag[];
  stripe: { budgetPi: string; intentIds: readonly string[]; callIds: readonly string[] };
}

function sum(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

function result(name: string, passed: boolean, details: string): InvariantResult {
  return { name, passed, details };
}

export function everySaleTicketed(input: InvariantInput): InvariantResult {
  const sold = input.events.purchased.length;
  const units = input.events.purchased.reduce((total, ticket) => total + ticket.qty, 0);
  const expected = input.scenario.purchases;
  return result(
    "every sale ticketed on-chain",
    sold === expected && units === expected * input.scenario.unitsPerPurchase,
    `${sold.toString()} tickets for ${units.toString()} units on-chain; ${expected.toString()} sales of ${input.scenario.unitsPerPurchase.toString()} unit(s) replayed`,
  );
}

/**
 * Two halves, both needed. The book the rehearsal drove for the sales stayed under the threshold
 * (a property of the driven book: no per-sale price is stored), and the engine's pause was seen to
 * work: with the book driven above the threshold, the campaign page answered `paused_price` and the
 * demo sale route refused a sale with 409 `sales_paused`.
 */
export function noSaleAbovePauseThreshold(input: InvariantInput): InvariantResult {
  const highest =
    input.drivenAsksWhileOpen.length === 0 ? null : Math.max(...input.drivenAsksWhileOpen);
  const threshold = input.pauseThresholdBps;
  const bookUnder = highest !== null && highest < threshold;
  const probe = input.pauseProbe;
  const probeAbove = probe !== null && probe.skipped === null && probe.bidBps > threshold;
  const paused = probeAbove && probe.saleState === "paused_price";
  const refused = probeAbove && probe.saleRefusal === "409 sales_paused";
  const probeText =
    probe === null
      ? "no pause probe"
      : probe.skipped !== null
        ? `pause probe skipped: ${probe.skipped}`
        : `book driven to bid ${probe.bidBps.toString()} / ask ${probe.askBps.toString()} bps: page answered ${probe.saleState ?? "nothing but open"}, demo sale ${probe.saleRefusal === null ? "accepted" : `refused (${probe.saleRefusal})`}`;
  return result(
    "no sale above the pause threshold",
    bookUnder && paused && refused,
    `highest ask driven while sales were open: ${highest === null ? "none" : `${highest.toString()} bps`}; pause threshold ${threshold.toString()} bps; ${probeText}`,
  );
}

export function noSaleBeyondBudget(input: InvariantInput): InvariantResult {
  const guarantees = sum(input.events.purchased.map((ticket) => ticket.maxHedgeCost));
  const budget = input.events.created[0]?.budget ?? input.scenario.budget;
  const passed = guarantees <= budget && input.onchain.hedgeSpent <= budget;
  return result(
    "no sale beyond the budget",
    passed,
    `guarantees reserved ${guarantees.toString()}, hedge spent ${input.onchain.hedgeSpent.toString()}, budget ${budget.toString()} (micro-USDC)`,
  );
}

export function chargesWithinGuarantee(input: InvariantInput): InvariantResult {
  const byTicket = new Map<bigint, bigint[]>();
  for (const charge of input.events.charged) {
    byTicket.set(charge.ticketId, [...(byTicket.get(charge.ticketId) ?? []), charge.amount]);
  }
  const problems: string[] = [];
  for (const ticket of input.events.purchased) {
    const charges = byTicket.get(ticket.ticketId) ?? [];
    if (charges.length !== 1) {
      problems.push(
        `ticket ${ticket.ticketId.toString()} charged ${charges.length.toString()} times`,
      );
      continue;
    }
    const [amount] = charges;
    if (amount !== undefined && amount > ticket.maxHedgeCost) {
      problems.push(
        `ticket ${ticket.ticketId.toString()} charged ${amount.toString()} above its guarantee ${ticket.maxHedgeCost.toString()}`,
      );
    }
  }
  const owned = new Set(input.events.purchased.map((ticket) => ticket.ticketId));
  for (const ticketId of byTicket.keys()) {
    if (!owned.has(ticketId))
      problems.push(`charge for ticket ${ticketId.toString()} not sold here`);
  }
  const charged = sum(input.events.charged.map((charge) => charge.amount));
  const guaranteed = sum(input.events.purchased.map((ticket) => ticket.maxHedgeCost));
  return result(
    "no hedge charge above its quote's guarantee",
    problems.length === 0,
    problems.length === 0
      ? `${input.events.charged.length.toString()} charges, ${charged.toString()} charged for ${guaranteed.toString()} guaranteed (micro-USDC)`
      : problems.join("; "),
  );
}

export function guaranteesWithinCap(input: InvariantInput): InvariantResult {
  const costBps = BigInt(input.scenario.usualMarginBps - input.scenario.minMarginBps);
  const over = input.events.purchased.filter(
    (ticket) => ticket.maxHedgeCost > (ticket.paid * costBps) / 10_000n,
  );
  const highest = input.events.purchased.reduce(
    (max, ticket) =>
      ticket.paid === 0n
        ? max
        : Math.max(max, Number((ticket.maxHedgeCost * 10_000n) / ticket.paid)),
    0,
  );
  return result(
    "no guarantee above the margins' cap",
    over.length === 0,
    `highest guarantee ${highest.toString()} bps of the price paid; cap ${costBps.toString()} bps (usual margin − minimum margin); ${over.length.toString()} above`,
  );
}

/** Longest stretch, in ms, during which consecutive samples were above the limit. */
export function longestAboveLimitMs(samples: readonly DeskSample[]): number {
  let longest = 0;
  let since: number | null = null;
  for (const sample of samples) {
    if (sample.unhedgedNotional > sample.uMax) {
      since ??= sample.atMs;
      longest = Math.max(longest, sample.atMs - since);
    } else if (since !== null) {
      longest = Math.max(longest, sample.atMs - since);
      since = null;
    }
  }
  return longest;
}

export function unhedgedUnderLimit(input: InvariantInput): InvariantResult {
  const samples = input.deskSamples;
  const longest = longestAboveLimitMs(samples);
  const highest = samples.reduce(
    (max, sample) => (sample.unhedgedNotional > max ? sample.unhedgedNotional : max),
    0n,
  );
  const limit = samples[0]?.uMax ?? null;
  return result(
    "unhedged notional under its limit (at most 5 s above)",
    samples.length > 0 && longest <= UNHEDGED_GRACE_MS,
    `${samples.length.toString()} samples of the Hedge desk; highest ${highest.toString()} micro-USDC; limit ${limit === null ? "unknown" : limit.toString()}; longest above ${longest.toString()} ms`,
  );
}

export function escrowHoldsNothing(input: InvariantInput): InvariantResult {
  const onchain = input.onchain;
  const escrow = input.parties.find((party) => party.address === input.escrow);
  const delta = escrow === undefined ? null : escrow.afterWei - escrow.beforeWei;
  const passed =
    onchain.released &&
    onchain.lockedRefunds === 0n &&
    onchain.merchantDue === 0n &&
    onchain.hedgeReserved === 0n &&
    delta === 0n;
  return result(
    "the escrow holds nothing for the campaign",
    passed,
    `released ${String(onchain.released)}, locked refunds ${onchain.lockedRefunds.toString()}, merchant due ${onchain.merchantDue.toString()}, hedge reserved ${onchain.hedgeReserved.toString()}; escrow balance change ${delta === null ? "unknown" : delta.toString()} (18 decimals)`,
  );
}

export function refundsEqualRefundable(input: InvariantInput): InvariantResult {
  const refunds = input.events.refunded;
  const problems: string[] = [];
  if (input.outcome === "yes") {
    for (const ticket of input.events.purchased) {
      const paid = refunds.filter((refund) => refund.ticketId === ticket.ticketId);
      if (paid.length !== 1) {
        problems.push(
          `ticket ${ticket.ticketId.toString()} refunded ${paid.length.toString()} times`,
        );
      } else if (paid[0]?.amount !== ticket.refundable || paid[0]?.buyer !== ticket.buyer) {
        problems.push(
          `ticket ${ticket.ticketId.toString()} refunded ${String(paid[0]?.amount)} for ${ticket.refundable.toString()} refundable`,
        );
      }
    }
  } else if (refunds.length > 0) {
    problems.push(`${refunds.length.toString()} refunds on a NO`);
  }
  if (input.events.refundFailed.length > 0) {
    problems.push(`${input.events.refundFailed.length.toString()} RefundFailed events`);
  }
  const total = sum(refunds.map((refund) => refund.amount));
  return result(
    "every refund equals the ticket's refundable amount",
    problems.length === 0,
    problems.length === 0
      ? `${refunds.length.toString()} refunds, ${total.toString()} micro-USDC, outcome ${input.outcome}`
      : problems.join("; "),
  );
}

/**
 * What each account must have gained or lost from this campaign's events, 18 decimals: the
 * treasury fronts the budget, every sale and the merchant's due and receives the hedge charges;
 * buyers receive their refunds; the escrow ends where it started; the merchant gets the rest.
 */
export function expectedMoneyChanges(input: InvariantInput): Map<Address, bigint> {
  const events = input.events;
  const budget = sum(events.created.map((created) => created.budget));
  const paid = sum(events.purchased.map((ticket) => ticket.paid));
  const charged = sum(events.charged.map((charge) => charge.amount));
  const merchantPaid = sum(events.merchantPaid.map((payment) => payment.amount));
  const refunded = sum(events.refunded.map((refund) => refund.amount));
  const expected = new Map<Address, bigint>();
  const add = (address: Address, micro: bigint): void => {
    expected.set(address, (expected.get(address) ?? 0n) + micro * WEI_PER_MICRO);
  };
  for (const party of input.parties) add(party.address, 0n);
  add(input.treasury, -budget - paid - merchantPaid + charged);
  for (const refund of events.refunded) add(refund.buyer, refund.amount);
  add(input.merchant, budget + paid + merchantPaid - charged - refunded);
  return expected;
}

export function moneyAddsUp(input: InvariantInput): InvariantResult {
  const expected = expectedMoneyChanges(input);
  const measured = new Map<Address, bigint>();
  const seen = new Set<Address>();
  for (const party of input.parties) {
    if (seen.has(party.address)) continue;
    seen.add(party.address);
    measured.set(party.address, party.afterWei - party.beforeWei + party.gasWei);
  }
  const problems: string[] = [];
  for (const [address, want] of expected) {
    const got = measured.get(address);
    if (got === undefined) {
      problems.push(`${address} not measured`);
    } else if (got !== want) {
      const role = input.parties.find((party) => party.address === address)?.role ?? "?";
      problems.push(`${role} ${address}: changed ${got.toString()}, expected ${want.toString()}`);
    }
  }
  const total = [...measured.values()].reduce((acc, value) => acc + value, 0n);
  if (total !== 0n) problems.push(`the changes add up to ${total.toString()}, not 0`);
  return result(
    "the money adds up to the micro-unit, gas apart",
    problems.length === 0,
    problems.length === 0
      ? `${measured.size.toString()} accounts; every change equals the campaign's events; total 0`
      : problems.join("; "),
  );
}

export function demoFlagsTrue(input: InvariantInput): InvariantResult {
  const falses = input.demoFlags.filter((flag) => !flag.demo);
  const sources = [...new Set(falses.map((flag) => flag.source))];
  return result(
    "every answer about the campaign said demo",
    input.demoFlags.length > 0 && falses.length === 0,
    `${input.demoFlags.length.toString()} answers carrying demo after the first demo action; ${falses.length.toString()} false${sources.length > 0 ? ` (${sources.join(", ")})` : ""}`,
  );
}

export function nothingReachedStripe(input: InvariantInput): InvariantResult {
  const { budgetPi, intentIds, callIds } = input.stripe;
  const strayIntents = intentIds.filter((id) => id !== budgetPi);
  const strayCalls = callIds.filter((id) => id !== budgetPi);
  const demoCalls = callIds.filter((id) => id.startsWith("pi_demo_"));
  return result(
    "no demo payment reached the simulated Stripe",
    strayIntents.length === 0 && strayCalls.length === 0 && demoCalls.length === 0,
    `${callIds.length.toString()} calls to the simulated Stripe, all for the budget payment: ${String(strayCalls.length === 0)}; intents other than the budget: ${strayIntents.length.toString()}; demo payment ids seen: ${demoCalls.length.toString()}`,
  );
}

export function checkInvariants(input: InvariantInput): InvariantResult[] {
  return [
    everySaleTicketed(input),
    noSaleAbovePauseThreshold(input),
    noSaleBeyondBudget(input),
    chargesWithinGuarantee(input),
    guaranteesWithinCap(input),
    unhedgedUnderLimit(input),
    escrowHoldsNothing(input),
    refundsEqualRefundable(input),
    moneyAddsUp(input),
    demoFlagsTrue(input),
    nothingReachedStripe(input),
  ];
}
