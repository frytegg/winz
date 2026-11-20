import type { Logger } from "pino";

import { BPS, CONTRACT_STEP_MICRO, TICK_BPS, parseContracts, parsePriceBps } from "@winz/shared";
import type { Bps, MicroContracts } from "@winz/shared";

import type { OrderSide, VenueOrder } from "../types";
import type { CallOptions, PublicBookLevel } from "./client";
import { GeminiVenueError } from "./errors";
import { MemoryOrderLinkStore, type OrderLinkStore } from "./links";
import type { GeminiListedEvent, GeminiTermsStatus } from "./schemas";
import { GeminiOrderVenue, type GeminiOrderApi } from "./venue";

/**
 * The proof of SPEC HE-10 (`pnpm --filter @winz/engine venue:check`, or once at boot with
 * `APP_VENUE_CHECK_ON_BOOT=true`): real orders on Gemini's sandbox, through the same
 * `GeminiOrderVenue` the hedging engine uses, on a crypto Prediction Markets contract (the sandbox
 * lists no sports market, SPEC section 16):
 *
 * 1. `placed_maker`: one maker-or-cancel buy, priced two ticks under the best bid so that it rests,
 *    read back from Gemini's active orders as `open`, and again after `restConfirmMs`.
 * 2. `cancelled`: that order cancelled, read back from Gemini's order history as `cancelled`.
 * 3. `filled`: one small marketable buy (immediate-or-cancel at the best ask), read back from the
 *    history with a filled quantity above zero.
 *
 * Every step is confirmed by reading the order back, never by the placement's answer alone. A
 * failed step stops the check, says which step and why, and cancels the maker order if it still
 * rests. The report is recorded (`VenueCheckRecorder`) whether it proves or fails.
 */

export const VENUE_CHECK_ACTIONS = ["placed_maker", "cancelled", "filled"] as const;
export type VenueCheckAction = (typeof VENUE_CHECK_ACTIONS)[number];

export const VENUE_CHECK_STEPS = ["preflight", "instrument", ...VENUE_CHECK_ACTIONS] as const;
export type VenueCheckStep = (typeof VENUE_CHECK_STEPS)[number];

export type VenueCheckTrigger = "command" | "boot";

/** One order of the proof, as read back from Gemini. */
export interface VenueCheckOrder {
  action: VenueCheckAction;
  clientOrderId: string;
  venueOrderId: string;
  instrumentSymbol: string;
  side: OrderSide;
  kind: "maker" | "taker";
  limitPriceBps: Bps;
  qty: MicroContracts;
  filledQty: MicroContracts;
  /** Gemini's status when read back: "open", "cancelled", "filled". */
  status: string;
  /** Gemini's average execution price when read back, as written, or null. */
  avgPrice: string | null;
  atMs: number;
}

export interface VenueCheckInstrument {
  symbol: string;
  eventTitle: string;
  bestBidBps: Bps;
  bestAskBps: Bps;
  expiresAtMs: number | null;
}

export interface VenueCheckReport {
  venue: "gemini-sandbox";
  trigger: VenueCheckTrigger;
  startedAtMs: number;
  finishedAtMs: number;
  outcome: "proven" | "failed";
  failedStep: VenueCheckStep | null;
  /** Why it failed, in one line, without any secret. */
  failure: string | null;
  instrument: VenueCheckInstrument | null;
  orders: VenueCheckOrder[];
}

/** Everything the check calls at Gemini. `GeminiPrivateClient` satisfies it. */
export interface GeminiCheckApi extends GeminiOrderApi {
  termsStatus(options?: CallOptions): Promise<GeminiTermsStatus>;
  acceptTerms(options?: CallOptions): Promise<{ success: boolean }>;
  listActiveEvents(
    query: { category: string; limit: number; offset: number },
    options?: CallOptions,
  ): Promise<{ events: GeminiListedEvent[]; total: number | null }>;
  getBook(
    symbol: string,
    options?: CallOptions,
  ): Promise<{ bids: PublicBookLevel[]; asks: PublicBookLevel[] }>;
}

export interface VenueCheckOptions {
  trigger: VenueCheckTrigger;
  /** A contract to use instead of choosing one. */
  symbol?: string;
  /** Accept the latest Prediction Markets terms when they are not accepted yet. Default false. */
  acceptTerms?: boolean;
  /** Contracts of the maker order. Default 1. */
  makerQty?: MicroContracts;
  /** Largest number of contracts of the marketable order. Default 1. */
  takerQty?: MicroContracts;
  /** How long the maker order must be seen resting. Default 3 000 ms. */
  restConfirmMs?: number;
  /** A contract must expire at least this long after the check starts. Default 20 min. */
  minTimeToExpiryMs?: number;
  /** Gap between two public requests (Gemini recommends one a second). Default 1 100 ms. */
  publicGapMs?: number;
  /** Tries of a read-back that does not show the expected state yet. Default 5, 1 s apart. */
  readBackAttempts?: number;
}

export interface VenueCheckDeps {
  api: GeminiCheckApi;
  logger: Logger;
  /** Where the venue keeps its order links. Default: in memory. */
  links?: OrderLinkStore;
  /** Epoch ms. Default `Date.now`. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Aborted: the check stops between two steps and is recorded as failed. */
  signal?: AbortSignal;
}

const CATEGORY = "Crypto";
/** The sandbox listed 81 active crypto events on 20 Nov 2026: two pages of 100 cover them. */
const MAX_EVENT_PAGES = 3;
/** Books read at most to choose the contract. */
const MAX_BOOKS_READ = 6;
const ONE_CONTRACT = 1_000_000n;

class StepFailure extends Error {
  constructor(
    readonly step: VenueCheckStep,
    message: string,
  ) {
    super(message);
    this.name = "StepFailure";
  }
}

function oneLine(error: unknown): string {
  const text =
    error instanceof GeminiVenueError || error instanceof StepFailure
      ? error.message
      : error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 500 ? `${flat.slice(0, 500)}…` : flat;
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** Best bid and ask of a public book, in bps, with the quantity at the best ask. */
export function bestOf(book: { bids: PublicBookLevel[]; asks: PublicBookLevel[] }): {
  bidBps: Bps | null;
  askBps: Bps | null;
  askQty: MicroContracts;
} {
  const bids = book.bids
    .map((level) => ({ price: parsePriceBps(level.price), qty: parseContracts(level.amount) }))
    .filter((level) => level.qty > 0n)
    .sort((a, b) => (a.price > b.price ? -1 : a.price < b.price ? 1 : 0));
  const asks = book.asks
    .map((level) => ({ price: parsePriceBps(level.price), qty: parseContracts(level.amount) }))
    .filter((level) => level.qty > 0n)
    .sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0));
  return {
    bidBps: bids[0]?.price ?? null,
    askBps: asks[0]?.price ?? null,
    askQty: asks[0]?.qty ?? 0n,
  };
}

/**
 * Price of the resting maker buy: two ticks under the best bid, on the tick grid, at least one
 * tick; null when that would not leave it strictly under the best ask by two ticks.
 */
export function makerPriceFor(bidBps: Bps | null, askBps: Bps): Bps | null {
  const reference = bidBps ?? askBps - 3n * TICK_BPS;
  let price = ((reference - 2n * TICK_BPS) / TICK_BPS) * TICK_BPS;
  if (price < TICK_BPS) price = TICK_BPS;
  if (price > askBps - 2n * TICK_BPS) return null;
  return price;
}

/** Runs the check. Never throws: a failure is a report with `outcome: "failed"`. */
export async function runVenueCheck(
  deps: VenueCheckDeps,
  options: VenueCheckOptions,
): Promise<VenueCheckReport> {
  const now = deps.now ?? Date.now;
  const sleep =
    deps.sleep ??
    // Not unref'd: in the command, these waits are all that keeps the process alive. Cut short
    // by the stop signal, so that a shutdown does not wait for them.
    ((ms: number) =>
      new Promise<void>((resolve) => {
        const signal = deps.signal;
        if (signal?.aborted === true) {
          resolve();
          return;
        }
        const done = (): void => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, ms);
        signal?.addEventListener("abort", done, { once: true });
      }));
  const logger = deps.logger.child({ component: "venue-check" });
  const makerQty = options.makerQty ?? ONE_CONTRACT;
  const takerQty = options.takerQty ?? ONE_CONTRACT;
  const restConfirmMs = options.restConfirmMs ?? 3_000;
  const minTimeToExpiryMs = options.minTimeToExpiryMs ?? 20 * 60_000;
  const publicGapMs = options.publicGapMs ?? 1_100;
  const readBackAttempts = options.readBackAttempts ?? 5;
  const runTag = now().toString(36);
  const venue = new GeminiOrderVenue({
    client: deps.api,
    links: deps.links ?? new MemoryOrderLinkStore(),
    clock: { now: () => new Date(now()) },
    logger,
    // The check reads its orders back itself: no background polling.
    config: { pollIntervalMs: 3_600_000 },
  });
  const report: VenueCheckReport = {
    venue: "gemini-sandbox",
    trigger: options.trigger,
    startedAtMs: now(),
    finishedAtMs: now(),
    outcome: "failed",
    failedStep: null,
    failure: null,
    instrument: null,
    orders: [],
  };
  let step: VenueCheckStep = "preflight";
  let restingMakerId: string | null = null;

  const stopIfAborted = (): void => {
    if (deps.signal?.aborted === true) {
      throw new StepFailure(step, "the check was stopped (the engine is shutting down)");
    }
  };

  /** Reads the order back until `accept` holds, `readBackAttempts` times, 1 s apart. */
  const readBack = async (
    clientOrderId: string,
    accept: (order: VenueOrder) => boolean,
  ): Promise<VenueOrder> => {
    let last: VenueOrder | null = null;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= readBackAttempts; attempt += 1) {
      stopIfAborted();
      try {
        last = await venue.getOrder(clientOrderId);
        lastError = null;
        if (last !== null && accept(last)) return last;
      } catch (error: unknown) {
        lastError = error;
      }
      if (attempt < readBackAttempts) await sleep(1_000);
    }
    if (lastError !== null) {
      throw new StepFailure(step, `the order could not be read back: ${oneLine(lastError)}`);
    }
    throw new StepFailure(
      step,
      last === null
        ? "Gemini does not list the order"
        : `Gemini shows the order ${last.status} with ${last.filledQty.toString()} micro-contracts filled`,
    );
  };

  const record = (
    action: VenueCheckAction,
    order: VenueOrder,
    clientOrderId: string,
  ): VenueCheckOrder => {
    const view = venue.geminiView(clientOrderId);
    const entry: VenueCheckOrder = {
      action,
      clientOrderId,
      venueOrderId: order.venueOrderId ?? "",
      instrumentSymbol: order.instrumentSymbol,
      side: order.side,
      kind: order.kind,
      limitPriceBps: order.limitPriceBps,
      qty: order.qty,
      filledQty: order.filledQty,
      status: view?.status ?? order.status,
      avgPrice: view?.avgPrice ?? null,
      atMs: now(),
    };
    report.orders.push(entry);
    logger.info(
      {
        action,
        venueOrderId: entry.venueOrderId,
        instrumentSymbol: entry.instrumentSymbol,
        side: entry.side,
        priceBps: Number(entry.limitPriceBps),
        qty: entry.qty.toString(),
        filledQty: entry.filledQty.toString(),
        status: entry.status,
      },
      "venue check step proven",
    );
    return entry;
  };

  const readTop = async (symbol: string): Promise<ReturnType<typeof bestOf>> => {
    const top = bestOf(await deps.api.getBook(symbol));
    return top;
  };

  try {
    // 1. Preflight: the key answers, and the account accepted the latest terms.
    stopIfAborted();
    const terms = await deps.api.termsStatus();
    if (!terms.hasAcceptedLatest) {
      if (options.acceptTerms !== true) {
        throw new StepFailure(
          step,
          "the account has not accepted the latest Prediction Markets terms: accept them on exchange.sandbox.gemini.com, or set APP_VENUE_CHECK_ACCEPT_TERMS=true (--accept-terms)",
        );
      }
      const accepted = await deps.api.acceptTerms();
      if (!accepted.success) throw new StepFailure(step, "Gemini did not accept the terms");
      logger.info({ version: terms.latestVersion ?? null }, "prediction markets terms accepted");
    }

    // 2. The instrument: an open crypto contract with a two-sided book.
    step = "instrument";
    stopIfAborted();
    report.instrument = await chooseInstrument(deps.api, {
      symbol: options.symbol,
      nowMs: now(),
      minTimeToExpiryMs,
      takerQty,
      sleep: () => sleep(publicGapMs),
    });
    const instrument = report.instrument;
    logger.info(
      {
        instrumentSymbol: instrument.symbol,
        event: instrument.eventTitle,
        bidBps: Number(instrument.bestBidBps),
        askBps: Number(instrument.bestAskBps),
      },
      "venue check instrument chosen",
    );

    // 3. A maker-or-cancel buy that rests, read back open, twice.
    step = "placed_maker";
    stopIfAborted();
    let makerId = `vc-${runTag}-maker`;
    let makerPrice = makerPriceFor(instrument.bestBidBps, instrument.bestAskBps);
    if (makerPrice === null) throw new StepFailure(step, "no price leaves a buy away from the ask");
    let placed = await venue.placeOrder({
      clientOrderId: makerId,
      instrumentSymbol: instrument.symbol,
      side: "buy",
      kind: "maker",
      limitPriceBps: makerPrice,
      qty: makerQty,
    });
    if (!placed.accepted && placed.reason === "would_cross") {
      // The book moved up to our price between the read and the order: read it again, once.
      logger.warn({ priceBps: Number(makerPrice) }, "maker order would have crossed: retrying");
      const top = await readTop(instrument.symbol);
      if (top.askBps === null) throw new StepFailure(step, "the book has no ask any more");
      makerPrice = makerPriceFor(top.bidBps, top.askBps);
      if (makerPrice === null) {
        throw new StepFailure(step, "no price leaves a buy away from the ask");
      }
      makerId = `vc-${runTag}-maker2`;
      placed = await venue.placeOrder({
        clientOrderId: makerId,
        instrumentSymbol: instrument.symbol,
        side: "buy",
        kind: "maker",
        limitPriceBps: makerPrice,
        qty: makerQty,
      });
    }
    if (!placed.accepted) {
      throw new StepFailure(
        step,
        `the maker order was refused (${placed.reason}): ${placed.message}`,
      );
    }
    restingMakerId = makerId;
    const resting = (order: VenueOrder): boolean => order.status === "working";
    await readBack(makerId, resting);
    await sleep(restConfirmMs);
    const stillResting = await readBack(makerId, resting);
    record("placed_maker", stillResting, makerId);

    // 4. Its cancellation, read back from the history.
    step = "cancelled";
    stopIfAborted();
    const cancel = await venue.cancelOrder(makerId);
    if (!cancel.cancelled) {
      throw new StepFailure(
        step,
        cancel.reason === "already_filled"
          ? "the maker order filled before it could be cancelled"
          : `the cancel was not done (${cancel.reason})`,
      );
    }
    const cancelled = await readBack(makerId, (order) => order.status === "cancelled");
    restingMakerId = null;
    record("cancelled", cancelled, makerId);

    // 5. A small marketable buy, read back filled.
    step = "filled";
    stopIfAborted();
    let takerId = `vc-${runTag}-taker`;
    let taken: VenueOrder | null = null;
    for (let attempt = 1; attempt <= 2 && taken === null; attempt += 1) {
      if (attempt > 1) await sleep(publicGapMs);
      const top = await readTop(instrument.symbol);
      if (top.askBps === null || top.askBps > BPS - TICK_BPS) {
        throw new StepFailure(step, "the book has no ask to buy from");
      }
      const qty = (minBig(takerQty, top.askQty) / CONTRACT_STEP_MICRO) * CONTRACT_STEP_MICRO;
      if (qty <= 0n) throw new StepFailure(step, "the best ask shows no quantity");
      if (attempt > 1) takerId = `vc-${runTag}-taker${attempt.toString()}`;
      const result = await venue.placeOrder({
        clientOrderId: takerId,
        instrumentSymbol: instrument.symbol,
        side: "buy",
        kind: "taker",
        limitPriceBps: top.askBps,
        qty,
      });
      if (!result.accepted) {
        throw new StepFailure(
          step,
          `the marketable order was refused (${result.reason}): ${result.message}`,
        );
      }
      if (result.order.filledQty > 0n) taken = result.order;
      else logger.warn({ attempt }, "marketable order filled nothing (the ask moved): retrying");
    }
    if (taken === null) throw new StepFailure(step, "the marketable order filled nothing, twice");
    const filled = await readBack(
      takerId,
      (order) =>
        order.filledQty > 0n && (order.status === "filled" || order.status === "cancelled"),
    );
    record("filled", filled, takerId);

    report.outcome = "proven";
  } catch (error: unknown) {
    report.outcome = "failed";
    report.failedStep = error instanceof StepFailure ? error.step : step;
    report.failure = oneLine(error);
    logger.error({ step: report.failedStep, reason: report.failure }, "venue check failed");
    if (restingMakerId !== null) {
      try {
        const cleanup = await venue.cancelOrder(restingMakerId);
        logger.info(
          { cancelled: cleanup.cancelled },
          "venue check: the maker order left by the failure was cancelled",
        );
      } catch (cleanupError: unknown) {
        logger.error(
          { err: oneLine(cleanupError) },
          "venue check: the maker order left by the failure could not be cancelled",
        );
      }
    }
  } finally {
    await venue.close();
  }
  report.finishedAtMs = now();
  return report;
}

interface ChooseOptions {
  symbol: string | undefined;
  nowMs: number;
  minTimeToExpiryMs: number;
  takerQty: MicroContracts;
  sleep: () => Promise<void>;
}

/**
 * The contract of the check. Given a symbol, that one (its book must be two-sided). Otherwise the
 * open, active, non-combo crypto contracts expiring at least `minTimeToExpiryMs` from now whose
 * listing shows both a bid and an ask leaving room for a resting buy, those nearest an even
 * price first (the most two-sided), then the latest expiry; their books are read, one a second,
 * and the first that is two-sided wins.
 */
async function chooseInstrument(
  api: GeminiCheckApi,
  options: ChooseOptions,
): Promise<VenueCheckInstrument> {
  if (options.symbol !== undefined) {
    const top = bestOf(await api.getBook(options.symbol));
    if (top.askBps === null || makerPriceFor(top.bidBps, top.askBps) === null) {
      throw new StepFailure(
        "instrument",
        `the book of ${options.symbol} has no ask, or no room for a resting buy`,
      );
    }
    return {
      symbol: options.symbol,
      eventTitle: options.symbol,
      bestBidBps: top.bidBps ?? 0n,
      bestAskBps: top.askBps,
      expiresAtMs: null,
    };
  }
  const events: GeminiListedEvent[] = [];
  for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
    const answer = await api.listActiveEvents({
      category: CATEGORY,
      limit: 100,
      offset: page * 100,
    });
    events.push(...answer.events);
    if (answer.events.length < 100) break;
    await options.sleep();
  }
  const candidates: (VenueCheckInstrument & { distance: bigint })[] = [];
  for (const event of events) {
    for (const contract of event.contracts) {
      const expiresAtMs =
        contract.expiryDate === null || contract.expiryDate === undefined
          ? null
          : Date.parse(contract.expiryDate);
      const bid = contract.prices?.bestBid;
      const ask = contract.prices?.bestAsk;
      if (
        contract.status !== "active" ||
        contract.marketState !== "open" ||
        contract.isCombo === true ||
        expiresAtMs === null ||
        expiresAtMs - options.nowMs < options.minTimeToExpiryMs ||
        (contract.priceIncrement != null && contract.priceIncrement !== "0.01") ||
        bid == null ||
        ask == null
      ) {
        continue;
      }
      const bidBps = parsePriceBps(bid);
      const askBps = parsePriceBps(ask);
      if (makerPriceFor(bidBps, askBps) === null || askBps > BPS - TICK_BPS) continue;
      const mid = (bidBps + askBps) / 2n;
      const distance = mid > BPS / 2n ? mid - BPS / 2n : BPS / 2n - mid;
      candidates.push({
        symbol: contract.instrumentSymbol,
        eventTitle: event.title,
        bestBidBps: bidBps,
        bestAskBps: askBps,
        expiresAtMs,
        distance,
      });
    }
  }
  candidates.sort((a, b) =>
    a.distance !== b.distance
      ? a.distance < b.distance
        ? -1
        : 1
      : (b.expiresAtMs ?? 0) - (a.expiresAtMs ?? 0),
  );
  if (candidates.length === 0) {
    throw new StepFailure(
      "instrument",
      `no open crypto contract on the sandbox has a two-sided book and expires in more than ${Math.round(options.minTimeToExpiryMs / 60_000).toString()} min (${events.length.toString()} crypto events listed)`,
    );
  }
  for (const candidate of candidates.slice(0, MAX_BOOKS_READ)) {
    await options.sleep();
    const top = bestOf(await api.getBook(candidate.symbol));
    if (
      top.askBps === null ||
      top.askBps > BPS - TICK_BPS ||
      makerPriceFor(top.bidBps, top.askBps) === null ||
      top.askQty < CONTRACT_STEP_MICRO
    ) {
      continue;
    }
    const { distance: _distance, ...chosen } = candidate;
    return { ...chosen, bestBidBps: top.bidBps ?? 0n, bestAskBps: top.askBps };
  }
  throw new StepFailure(
    "instrument",
    `none of the ${Math.min(candidates.length, MAX_BOOKS_READ).toString()} best crypto contracts has a two-sided book now`,
  );
}
