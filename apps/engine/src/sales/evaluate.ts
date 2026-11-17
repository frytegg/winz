import { computeQuote, maxCostBps } from "@winz/pricing";
import { TICK_BPS } from "@winz/shared";
import type {
  Book,
  Bps,
  CampaignStatus,
  MicroContracts,
  MicroUsdc,
  Outcome,
  SaleState,
} from "@winz/shared";

/**
 * How long a campaign must have been able to sell, without a single refusal, before an automatic
 * pause is lifted (SPEC CA-5: "reprise automatique quand la condition redevient vraie depuis 10 s").
 */
export const RESUME_DELAY_MS = 10_000;

/**
 * Margin required below the pause threshold before a price pause is lifted (SPEC CA-5: "avec une
 * marge d'un tick"): the marginal price must be at most `p_max − 1 tick` for the whole delay.
 */
export const RESUME_MARGIN_BPS: Bps = TICK_BPS;

/** The pauses this module lifts by itself, after the resume delay. */
export const AUTOMATIC_PAUSES = [
  "paused_price",
  "paused_budget",
  "paused_depth",
  "paused_stale",
  "paused_breaker",
] as const satisfies readonly SaleState[];
export type AutomaticPause = (typeof AUTOMATIC_PAUSES)[number];

export function isAutomaticPause(state: SaleState): state is AutomaticPause {
  return (AUTOMATIC_PAUSES as readonly SaleState[]).includes(state);
}

/** Campaign statuses after which nothing is ever sold again (CA-4). */
const SETTLED_STATUSES: readonly CampaignStatus[] = ["settled_yes", "settled_no", "void", "closed"];

/** The commercial terms of a campaign that price one sale. */
export interface SaleTerms {
  /** Price of one unit, micro-USDC. */
  unitPrice: MicroUsdc;
  refundBps: Bps;
  usualMarginBps: Bps;
  minMarginBps: Bps;
  /** `p_max`, as stored on the campaign. */
  pauseThresholdBps: Bps;
}

/**
 * What the evaluator remembers of a campaign between two evaluations. The service keeps it in
 * memory only: after a restart it starts again from the stored sale state with no history, so a
 * paused campaign waits the full delay again (the safe side).
 */
export interface SaleStateMemory {
  /** The state decided last time. */
  state: SaleState;
  /**
   * Since when, epoch milliseconds, every evaluation found the campaign able to sell: not closed,
   * not paused by hand, no breaker, and a single-unit quote accepted. Null when the last
   * evaluation found it unable to.
   */
  acceptedSinceMs: number | null;
  /**
   * Since when it could sell AND the marginal price stayed at least one tick below the threshold.
   * Null when the last evaluation did not find both.
   */
  clearSinceMs: number | null;
  /**
   * True when the price was refused at least once since the campaign was last open: the reopening
   * then also needs the one-tick margin, whatever the pause shows now (a stale book in the middle
   * of a price pause does not waive the margin).
   */
  priceRefused: boolean;
}

/**
 * The memory of a campaign the service has no history for: never evaluated since it started, or
 * whose history was dropped (a failed write, a concurrent change by the web API). A stored
 * `paused_price` keeps the one-tick margin requirement (SPEC CA-5): forgetting it would let a
 * restart reopen a campaign whose price sits exactly at `p_max`, which is the flapping the margin
 * exists to prevent. `priceRefusedBefore` carries a requirement already known for another pause
 * (a stale book seen during a price pause).
 */
export function freshMemory(storedState: SaleState, priceRefusedBefore = false): SaleStateMemory {
  return {
    state: storedState,
    acceptedSinceMs: null,
    clearSinceMs: null,
    priceRefused:
      storedState === "paused_price" || (isAutomaticPause(storedState) && priceRefusedBefore),
  };
}

export interface BreakerView {
  active: boolean;
  reason: string | null;
}

export interface SaleStateInput {
  terms: SaleTerms;
  /** `campaigns.status` (the projection of the on-chain state). */
  status: CampaignStatus;
  outcome: Outcome | null;
  /** False until the creation job has written the campaign on-chain. */
  hasOnchainId: boolean;
  /** The merchant asked to close sales early and the close is not on-chain yet. */
  closeRequested: boolean;
  /** Current time, epoch milliseconds. */
  nowMs: number;
  /** When sales close, epoch milliseconds (at the latest 5 min before the event starts). */
  salesCloseMs: number;
  /** A manual pause is in force (see `isManuallyPaused`). */
  manualPause: boolean;
  /** The hedging breaker of the campaign's instrument. */
  breaker: BreakerView;
  /** Latest book of the instrument, or null when none was received. */
  book: Book | null;
  /** The book feed flags the instrument stale (its watchdog), whatever the book's age says. */
  bookFlaggedStale: boolean;
  /** Exposure of the instrument not hedged yet: exposure − held, floored at 0. */
  pending: MicroContracts;
  /** Budget − charged − reserved, micro-USDC. May be negative. */
  availableBudget: MicroUsdc;
  /** Guarantee tolerance in ticks (risk parameter). Defaults to the pricing default. */
  toleranceTicks?: number;
  /** Age after which a book is stale. Defaults to the pricing default (10 s). */
  staleAfterMs?: number;
  /**
   * What was decided last time, or null for a campaign never evaluated and never stored in a
   * paused state (it opens as soon as it can).
   */
  previous: SaleStateMemory | null;
}

export type SaleStateReason =
  | "settled"
  | "sales_closed"
  | "sales_close_reached"
  | "close_requested"
  | "not_on_chain"
  | "not_live"
  | "manual"
  | "breaker"
  | "stale_book"
  | "no_depth"
  | "above_threshold"
  | "over_budget"
  | "quote_accepted"
  | "resume_delay"
  | "resume_margin"
  | "evaluation_failed";

export interface SaleStateDecision {
  state: SaleState;
  reason: SaleStateReason;
  /** Extra context for the log: the breaker's reason, the time left before a resume. */
  detail: string | null;
  /** Whether a single-unit sale could be quoted at this instant (all the rules above passed). */
  couldOpen: boolean;
  /** Marginal price of the single-unit quote when it was accepted. */
  effectivePriceBps: Bps | null;
  /** To pass back as `previous` next time. */
  memory: SaleStateMemory;
}

function closedReason(input: SaleStateInput): SaleStateReason | null {
  if (SETTLED_STATUSES.includes(input.status) || input.outcome !== null) return "settled";
  if (input.status === "sales_closed") return "sales_closed";
  if (input.nowMs >= input.salesCloseMs) return "sales_close_reached";
  if (!input.hasOnchainId) return "not_on_chain";
  if (input.status !== "live" && input.status !== "paused") return "not_live";
  if (input.closeRequested) return "close_requested";
  return null;
}

function blocked(
  state: SaleState,
  reason: SaleStateReason,
  detail: string | null,
  priceRefused: boolean,
): SaleStateDecision {
  return {
    state,
    reason,
    detail,
    couldOpen: false,
    effectivePriceBps: null,
    memory: { state, acceptedSinceMs: null, clearSinceMs: null, priceRefused },
  };
}

/**
 * The sale state of one campaign at `nowMs` (SPEC CA-4, CA-5, 4.2, 4.3, 4.5, 9.2). Pure: no I/O,
 * no clock. The first rule that matches wins:
 *
 * 1. `closed`: settled (or an outcome is known), status `sales_closed`, sales close reached, not
 *    on-chain yet, not live or paused on-chain (draft, funding), or an early close requested by
 *    the merchant and not mined yet;
 * 2. `paused_manual`: the merchant paused it;
 * 3. `paused_breaker`: the hedging breaker of its instrument is active;
 * 4. a single-unit sale is priced with `computeQuote` (pending exposure, available budget, the
 *    campaign's `p_max` and `c_max`): a stale book → `paused_stale`, no book or not enough depth →
 *    `paused_depth`, above the threshold or the cost cap → `paused_price`, over budget →
 *    `paused_budget`; accepted → the campaign could be open;
 * 5. hysteresis: pausing is immediate, but a campaign in an automatic pause reopens only once it
 *    could be open for `RESUME_DELAY_MS` without interruption and, when its price was refused
 *    during the pause, with the marginal price at least one tick below `p_max` for that whole
 *    delay (a price above `p_max` seen while the breaker or a stale flag was showing counts too).
 *    Until then it keeps its paused state. A campaign that was open, closed (newly live),
 *    paused by hand, or never evaluated opens at once.
 */
export function evaluateSaleState(input: SaleStateInput): SaleStateDecision {
  const previous = input.previous;
  const priceRefusedBefore =
    previous !== null && isAutomaticPause(previous.state) && previous.priceRefused;

  const closed = closedReason(input);
  if (closed !== null) return blocked("closed", closed, null, false);
  if (input.manualPause) return blocked("paused_manual", "manual", null, false);

  // Priced before the breaker and the stale flag are applied, so that a price above `p_max` seen
  // during a breaker trip still requires the one-tick margin before the campaign reopens.
  const quote = computeQuote({
    book: input.book,
    pending: input.pending,
    nowMs: input.nowMs,
    ...(input.staleAfterMs === undefined ? {} : { staleAfterMs: input.staleAfterMs }),
    ...(input.toleranceTicks === undefined ? {} : { toleranceTicks: input.toleranceTicks }),
    qty: 1n,
    unitPrice: input.terms.unitPrice,
    refundBps: input.terms.refundBps,
    pauseThresholdBps: input.terms.pauseThresholdBps,
    maxCostBps: maxCostBps(input.terms.usualMarginBps, input.terms.minMarginBps),
    availableBudget: input.availableBudget,
  });
  const priceRefused = priceRefusedBefore || (!quote.ok && quote.reason === "above_threshold");

  if (input.breaker.active) {
    return blocked("paused_breaker", "breaker", input.breaker.reason, priceRefused);
  }
  if (input.book !== null && input.bookFlaggedStale) {
    return blocked("paused_stale", "stale_book", null, priceRefused);
  }
  if (!quote.ok) {
    switch (quote.reason) {
      case "stale_book":
        return blocked("paused_stale", "stale_book", null, priceRefused);
      case "no_depth":
        return blocked("paused_depth", "no_depth", null, priceRefused);
      case "above_threshold":
        return blocked("paused_price", "above_threshold", null, true);
      case "over_budget":
        return blocked("paused_budget", "over_budget", null, priceRefused);
    }
  }

  const now = input.nowMs;
  const price = quote.effectivePriceBps;
  const withMargin = price === null || price <= input.terms.pauseThresholdBps - RESUME_MARGIN_BPS;
  const acceptedSinceMs = previous?.acceptedSinceMs ?? now;
  const clearSinceMs = withMargin ? (previous?.clearSinceMs ?? now) : null;
  const common = { couldOpen: true, effectivePriceBps: price };

  if (previous === null || !isAutomaticPause(previous.state)) {
    return {
      ...common,
      state: "open",
      reason: "quote_accepted",
      detail: null,
      memory: { state: "open", acceptedSinceMs, clearSinceMs, priceRefused: false },
    };
  }

  const pausedState = previous.state;
  if (previous.priceRefused) {
    const since = clearSinceMs;
    if (since === null || now - since < RESUME_DELAY_MS) {
      const detail =
        since === null
          ? `marginal price ${String(price)} bps is not one tick below the threshold`
          : `${String(RESUME_DELAY_MS - (now - since))} ms left`;
      return {
        ...common,
        state: pausedState,
        reason: "resume_margin",
        detail,
        memory: { state: pausedState, acceptedSinceMs, clearSinceMs, priceRefused: true },
      };
    }
  } else if (now - acceptedSinceMs < RESUME_DELAY_MS) {
    return {
      ...common,
      state: pausedState,
      reason: "resume_delay",
      detail: `${String(RESUME_DELAY_MS - (now - acceptedSinceMs))} ms left`,
      memory: { state: pausedState, acceptedSinceMs, clearSinceMs, priceRefused: false },
    };
  }

  return {
    ...common,
    state: "open",
    reason: "quote_accepted",
    detail: null,
    memory: { state: "open", acceptedSinceMs, clearSinceMs, priceRefused: false },
  };
}

/**
 * The decision when a campaign cannot be evaluated: a source threw (the hedging lane's breaker,
 * the book feed) or the pricing rejected its inputs (`PricingInputError`, e.g. a unit price of 0).
 * It fails closed. The rules that need no market data still apply first (closed, then the manual
 * pause); otherwise a campaign already in an automatic pause keeps it, and any other campaign is
 * paused as `paused_breaker`, the safety stop: it must not keep selling on a decision nobody could
 * take. The resume delay starts over once the evaluation works again, and a price refusal seen
 * before keeps its one-tick margin.
 */
export function failedEvaluation(input: SaleStateInput, detail: string): SaleStateDecision {
  const closed = closedReason(input);
  if (closed !== null) return blocked("closed", closed, null, false);
  if (input.manualPause) return blocked("paused_manual", "manual", null, false);
  const previous = input.previous;
  const keep = previous !== null && isAutomaticPause(previous.state) ? previous.state : null;
  const priceRefused = keep !== null && previous !== null && previous.priceRefused;
  return blocked(keep ?? "paused_breaker", "evaluation_failed", detail, priceRefused);
}
