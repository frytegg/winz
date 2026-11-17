import { isBookStale } from "@winz/pricing";
import { BOOK_STALE_AFTER_MS, BPS, CONTRACT_STEP_MICRO, ORDER_KINDS, TICK_BPS } from "@winz/shared";
import type { Book, BookLevel, Bps, MicroContracts, OrderKind } from "@winz/shared";
import type { Logger } from "pino";

import { VenueInputError } from "./errors";
import { fillFee, floorToContractStep, isWithinLimit } from "./replay";
import { ORDER_SIDES } from "./types";
import type {
  BookLevelsRef,
  CancelOrderResult,
  ExecutionVenue,
  OrderRejectReason,
  OrderSide,
  PlaceOrderRequest,
  PlaceOrderResult,
  TradePrint,
  VenueClock,
  VenueDescription,
  VenueEvent,
  VenueEventListener,
  VenueFill,
  VenueOrder,
} from "./types";

/** Lowest and highest limit price an order may carry: one tick from either bound. */
export const MIN_LIMIT_PRICE_BPS = TICK_BPS;
export const MAX_LIMIT_PRICE_BPS = BPS - TICK_BPS;

export const PAPER_VENUE_LABEL = "PAPER · live Gemini book";
export const PAPER_VENUE_NOTE =
  "Queue position is not simulated, so maker fills are optimistic: a resting order is filled as soon as the market touches its price.";

export interface PaperVenueConfig {
  /**
   * True while Gemini's maker-fee promotion applies (announced until 31 December 2026): maker
   * fills are then charged nothing. The owner sets it from its own configuration; the venue never
   * reads the date.
   */
  makerFeeWaived: boolean;
  /** A book older than this, by the injected clock, is stale: no taker fills, no maker placement. */
  staleAfterMs: number;
}

export const DEFAULT_PAPER_VENUE_CONFIG: Readonly<PaperVenueConfig> = Object.freeze({
  makerFeeWaived: true,
  staleAfterMs: BOOK_STALE_AFTER_MS,
});

export interface PaperVenueDeps {
  clock: VenueClock;
  logger: Logger;
  /** Missing fields take `DEFAULT_PAPER_VENUE_CONFIG`. */
  config?: Partial<PaperVenueConfig>;
}

interface OrderRecord {
  clientOrderId: string;
  venueOrderId: string | null;
  instrumentSymbol: string;
  side: OrderSide;
  kind: OrderKind;
  limitPriceBps: Bps;
  qty: MicroContracts;
  filledQty: MicroContracts;
  feePaid: bigint;
  status: VenueOrder["status"];
  rejectReason: OrderRejectReason | null;
  createdAtMs: number;
  updatedAtMs: number;
  /** Placement order, for time priority. */
  seq: number;
}

interface InstrumentState {
  book: Book | null;
  /** Taken from each ask level, by price, since `book` arrived. */
  consumedAsks: Map<Bps, MicroContracts>;
  /** Taken from each bid level, by price, since `book` arrived. */
  consumedBids: Map<Bps, MicroContracts>;
}

function isOpen(record: OrderRecord): boolean {
  return record.status === "working" || record.status === "partially_filled";
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function snapshot(record: OrderRecord): VenueOrder {
  return Object.freeze({
    clientOrderId: record.clientOrderId,
    venueOrderId: record.venueOrderId,
    instrumentSymbol: record.instrumentSymbol,
    side: record.side,
    kind: record.kind,
    limitPriceBps: record.limitPriceBps,
    qty: record.qty,
    filledQty: record.filledQty,
    feePaid: record.feePaid,
    status: record.status,
    rejectReason: record.rejectReason,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
  });
}

/**
 * Price-then-time priority among resting orders of one side: the highest buy (lowest sell) first,
 * then the oldest.
 */
function byPriority(side: OrderSide): (a: OrderRecord, b: OrderRecord) => number {
  return (a, b) => {
    if (a.limitPriceBps !== b.limitPriceBps) {
      const better =
        side === "buy" ? a.limitPriceBps > b.limitPriceBps : a.limitPriceBps < b.limitPriceBps;
      return better ? -1 : 1;
    }
    return a.seq - b.seq;
  };
}

function validateLevels(symbol: string, name: "asks" | "bids", levels: readonly BookLevel[]): void {
  let previous: Bps | null = null;
  for (const level of levels) {
    if (level.priceBps < 0n || level.priceBps > BPS) {
      throw new VenueInputError(
        `${symbol} ${name}: price must be between 0 and ${BPS.toString()} bps, got ${level.priceBps.toString()}`,
      );
    }
    if (level.qty < 0n) {
      throw new VenueInputError(
        `${symbol} ${name}: quantity must not be negative, got ${level.qty.toString()}`,
      );
    }
    if (previous !== null) {
      const sorted = name === "asks" ? level.priceBps > previous : level.priceBps < previous;
      if (!sorted) {
        throw new VenueInputError(
          `${symbol} ${name}: levels must be strictly sorted best first, without repeated prices`,
        );
      }
    }
    previous = level.priceBps;
  }
}

/**
 * Best level the market displays, or null: the first level with a quantity above zero. What paper
 * fills consumed from it is deliberately ignored, because paper fills never remove real
 * liquidity: the real venue would still judge a maker-or-cancel order against this price.
 */
function bestDisplayedLevel(levels: readonly BookLevel[]): BookLevel | null {
  for (const level of levels) {
    if (level.qty > 0n) return level;
  }
  return null;
}

function sameLevels(a: readonly BookLevel[], b: readonly BookLevel[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((level, i) => {
    const other = b[i];
    return other !== undefined && other.priceBps === level.priceBps && other.qty === level.qty;
  });
}

/** Whether `next` is the snapshot already held, delivered again (same time, same levels). */
function isSameBook(held: Book, next: Book): boolean {
  return (
    held === next ||
    (held.observedAtMs === next.observedAtMs &&
      sameLevels(held.asks, next.asks) &&
      sameLevels(held.bids, next.bids))
  );
}

/**
 * Paper execution venue (SPEC 9.7, HE-8): orders are filled by simulation against the real
 * production book, read-only. The venue does no I/O: its owner feeds it every book update with
 * `onBook` and every public trade with `onTrade`, and it reads time from the injected clock.
 *
 * - Taker orders walk the opposite side of the latest fresh book up to their limit, within the
 *   displayed quantities minus what earlier fills took since that book arrived, pay the taker fee
 *   per level, and never rest: the remainder is cancelled at once.
 * - Maker orders rest virtually at their limit and never cross. They fill, at their own limit
 *   price, when a later book shows the opposite best price at or through the limit (within the
 *   displayed quantity) or when a trade prints at or through it (within the printed size), shared
 *   among resting orders in price-then-time priority. Queue position is not simulated.
 *
 * Events and re-entrancy: listeners are called synchronously, but only once the operation that
 * produced the events (a placement, a cancel, a book, a print) has finished changing the state.
 * A listener may call back into the venue (cancel a surplus maker when it hears a fill, place a
 * new order); its call sees the final state of the operation it is reacting to, so a cancel the
 * venue acknowledges always holds, and the events of the nested call are delivered after those
 * already queued, in the order the state changed.
 */
export class PaperVenue implements ExecutionVenue {
  readonly name = "paper" as const;

  private readonly clock: VenueClock;
  private readonly logger: Logger;
  private readonly config: Readonly<PaperVenueConfig>;
  private readonly orders = new Map<string, OrderRecord>();
  private readonly placements = new Map<string, PlaceOrderResult>();
  private readonly instruments = new Map<string, InstrumentState>();
  /**
   * Maker orders that may still rest, by instrument. Closed orders are pruned lazily on the next
   * scan, so each book or print scans the open makers of its instrument, not every order ever
   * placed. (The order history itself is kept: `getOrder` and the idempotency of `placeOrder`
   * need it.)
   */
  private readonly restingByInstrument = new Map<string, Set<OrderRecord>>();
  private readonly listeners = new Set<VenueEventListener>();
  /** Events of the operation in progress, delivered when it has finished. */
  private readonly pendingEvents: VenueEvent[] = [];
  private operationDepth = 0;
  private flushing = false;
  private nextOrderSeq = 1;
  private nextFillSeq = 1;

  constructor(deps: PaperVenueDeps) {
    const config: PaperVenueConfig = { ...DEFAULT_PAPER_VENUE_CONFIG, ...deps.config };
    if (typeof config.makerFeeWaived !== "boolean") {
      throw new VenueInputError("paper venue config: makerFeeWaived must be a boolean");
    }
    if (!Number.isFinite(config.staleAfterMs) || config.staleAfterMs < 0) {
      throw new VenueInputError(
        `paper venue config: staleAfterMs must be a finite number >= 0, got ${String(config.staleAfterMs)}`,
      );
    }
    this.clock = deps.clock;
    this.logger = deps.logger;
    this.config = Object.freeze(config);
  }

  describe(): VenueDescription {
    return { name: this.name, label: PAPER_VENUE_LABEL, note: PAPER_VENUE_NOTE };
  }

  /** The configuration in force, defaults applied. */
  getConfig(): Readonly<PaperVenueConfig> {
    return this.config;
  }

  onEvent(listener: VenueEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async placeOrder(request: PlaceOrderRequest): Promise<PlaceOrderResult> {
    return this.atomically(() => this.place(request));
  }

  async cancelOrder(clientOrderId: string): Promise<CancelOrderResult> {
    return this.atomically(() => this.cancel(clientOrderId));
  }

  private cancel(clientOrderId: string): CancelOrderResult {
    const record = this.orders.get(clientOrderId);
    if (record === undefined) return { cancelled: false, reason: "unknown_order", order: null };
    if (record.status === "filled") {
      return { cancelled: false, reason: "already_filled", order: snapshot(record) };
    }
    if (record.status === "rejected") {
      return { cancelled: false, reason: "rejected", order: snapshot(record) };
    }
    if (record.status === "cancelled") {
      return { cancelled: true, order: snapshot(record), alreadyCancelled: true };
    }
    record.status = "cancelled";
    record.updatedAtMs = this.nowMs();
    const order = snapshot(record);
    this.emit({ type: "order", order });
    return { cancelled: true, order, alreadyCancelled: false };
  }

  async getOrder(clientOrderId: string): Promise<VenueOrder | null> {
    const record = this.orders.get(clientOrderId);
    return record === undefined ? null : snapshot(record);
  }

  async listOpenOrders(instrumentSymbol?: string): Promise<readonly VenueOrder[]> {
    return [...this.orders.values()]
      .filter(
        (record) =>
          isOpen(record) &&
          (instrumentSymbol === undefined || record.instrumentSymbol === instrumentSymbol),
      )
      .sort((a, b) => a.seq - b.seq)
      .map(snapshot);
  }

  /**
   * Feeds a book update. It replaces the previous book of the instrument and the memory of the
   * depth consumed from it, then fills resting maker orders the new book touches (unless the book
   * is already stale by the clock). A book older than the one held is ignored, and so is the held
   * snapshot delivered again (same `observedAtMs`, same levels): it is not a new book, so the
   * memory of consumed depth stays. A different snapshot carrying the same time is a new book.
   * Returns the fills it produced, which are also emitted as events.
   */
  onBook(book: Book): readonly VenueFill[] {
    return this.atomically(() => this.ingestBook(book));
  }

  /**
   * Feeds a public trade print. Resting maker orders placed no later than the print, whose limit
   * the print touches (at or below a buy limit, at or above a sell limit), share its size in
   * price-then-time priority, buys first, at their own limit price. Returns the fills produced.
   *
   * Clock assumption: "placed no later than the print" compares the print's `atMs` (the venue's
   * event time, Gemini's clock) with the order's `createdAtMs` (the injected local clock). The
   * owner keeps the host clock synchronised (NTP); a skew of a few hundred milliseconds can let a
   * print that happened just before a placement fill it (optimistic) or skip one just after
   * (pessimistic). The venue does not de-duplicate prints: the owner feeds each print once.
   */
  onTrade(trade: TradePrint): readonly VenueFill[] {
    return this.atomically(() => this.ingestTrade(trade));
  }

  private ingestBook(book: Book): readonly VenueFill[] {
    if (book.instrumentSymbol.length === 0) {
      throw new VenueInputError("book: instrumentSymbol must not be empty");
    }
    if (!Number.isFinite(book.observedAtMs)) {
      throw new VenueInputError(`${book.instrumentSymbol} book: observedAtMs must be a number`);
    }
    validateLevels(book.instrumentSymbol, "asks", book.asks);
    validateLevels(book.instrumentSymbol, "bids", book.bids);

    const state = this.instrument(book.instrumentSymbol);
    if (state.book !== null && book.observedAtMs < state.book.observedAtMs) {
      this.logger.warn(
        {
          instrumentSymbol: book.instrumentSymbol,
          observedAtMs: book.observedAtMs,
          heldObservedAtMs: state.book.observedAtMs,
        },
        "paper venue ignored a book older than the one it holds",
      );
      return [];
    }
    if (state.book !== null && isSameBook(state.book, book)) {
      this.logger.debug(
        { instrumentSymbol: book.instrumentSymbol, observedAtMs: book.observedAtMs },
        "paper venue received the book it holds again: consumed depth is kept",
      );
      return [];
    }
    state.book = book;
    state.consumedAsks = new Map();
    state.consumedBids = new Map();

    if (isBookStale(book, this.nowMs(), this.config.staleAfterMs)) {
      this.logger.debug(
        { instrumentSymbol: book.instrumentSymbol, observedAtMs: book.observedAtMs },
        "paper venue received a stale book: no maker fill against it",
      );
      return [];
    }
    return [
      ...this.fillMakersOnBook(state, book, "buy"),
      ...this.fillMakersOnBook(state, book, "sell"),
    ];
  }

  private ingestTrade(trade: TradePrint): readonly VenueFill[] {
    if (trade.instrumentSymbol.length === 0) {
      throw new VenueInputError("trade: instrumentSymbol must not be empty");
    }
    if (trade.priceBps < 0n || trade.priceBps > BPS) {
      throw new VenueInputError(
        `${trade.instrumentSymbol} trade: price must be between 0 and ${BPS.toString()} bps, got ${trade.priceBps.toString()}`,
      );
    }
    if (trade.qty <= 0n) {
      throw new VenueInputError(
        `${trade.instrumentSymbol} trade: quantity must be positive, got ${trade.qty.toString()}`,
      );
    }
    if (!Number.isFinite(trade.atMs)) {
      throw new VenueInputError(`${trade.instrumentSymbol} trade: atMs must be a number`);
    }

    const fills: VenueFill[] = [];
    let allocated = 0n;
    for (const side of ORDER_SIDES) {
      const candidates = this.restingMakers(trade.instrumentSymbol, side).filter(
        (record) =>
          record.createdAtMs <= trade.atMs &&
          isWithinLimit(side, trade.priceBps, record.limitPriceBps),
      );
      for (const record of candidates) {
        const available = floorToContractStep(trade.qty - allocated);
        if (available === 0n) return fills;
        // Listeners only run once this print is fully allocated, but re-check anyway: a closed
        // order must never be filled.
        const remaining = record.qty - record.filledQty;
        if (!isOpen(record) || remaining <= 0n) continue;
        const qty = minBig(remaining, available);
        const fill = this.recordFill(record, record.limitPriceBps, qty, {
          source: "trade",
          instrumentSymbol: trade.instrumentSymbol,
          printPriceBps: trade.priceBps,
          printedQty: trade.qty,
          allocatedBeforeQty: allocated,
          printedAtMs: trade.atMs,
          limitPriceBps: record.limitPriceBps,
          orderRemainingQty: remaining,
          makerFeeWaived: this.config.makerFeeWaived,
        });
        allocated += qty;
        fills.push(fill);
        this.emitOrder(record);
      }
    }
    return fills;
  }

  private place(request: PlaceOrderRequest): PlaceOrderResult {
    const id: unknown = request.clientOrderId;
    if (typeof id !== "string" || id.length === 0) {
      return {
        accepted: false,
        reason: "invalid_order",
        message: "clientOrderId must be a non-empty string",
        order: null,
      };
    }
    const previous = this.placements.get(id);
    if (previous !== undefined) {
      const first = this.orders.get(id);
      if (
        first !== undefined &&
        (first.instrumentSymbol !== request.instrumentSymbol ||
          first.side !== request.side ||
          first.kind !== request.kind ||
          first.limitPriceBps !== request.limitPriceBps ||
          first.qty !== request.qty)
      ) {
        this.logger.warn(
          { clientOrderId: id },
          "paper venue received a second placement with the same clientOrderId but other terms: the first result is returned",
        );
      }
      return previous;
    }

    const result = this.execute(request);
    this.placements.set(id, result);
    return result;
  }

  private execute(request: PlaceOrderRequest): PlaceOrderResult {
    const nowMs = this.nowMs();
    const reject = (reason: OrderRejectReason, message: string): PlaceOrderResult => {
      const record: OrderRecord = {
        clientOrderId: request.clientOrderId,
        venueOrderId: null,
        instrumentSymbol: request.instrumentSymbol,
        side: request.side,
        kind: request.kind,
        limitPriceBps: request.limitPriceBps,
        qty: request.qty,
        filledQty: 0n,
        feePaid: 0n,
        status: "rejected",
        rejectReason: reason,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
        seq: this.nextOrderSeq++,
      };
      this.orders.set(record.clientOrderId, record);
      const order = snapshot(record);
      this.logger.info(
        { clientOrderId: record.clientOrderId, instrumentSymbol: record.instrumentSymbol, reason },
        "paper venue rejected an order",
      );
      this.emit({ type: "order", order });
      return { accepted: false, reason, message, order };
    };

    if (typeof request.instrumentSymbol !== "string" || request.instrumentSymbol.length === 0) {
      return reject("invalid_order", "instrumentSymbol must be a non-empty string");
    }
    if (!(ORDER_SIDES as readonly string[]).includes(request.side)) {
      return reject("invalid_order", `side must be buy or sell, got ${String(request.side)}`);
    }
    if (!(ORDER_KINDS as readonly string[]).includes(request.kind)) {
      return reject("invalid_order", `kind must be maker or taker, got ${String(request.kind)}`);
    }
    if (
      typeof request.qty !== "bigint" ||
      request.qty <= 0n ||
      request.qty % CONTRACT_STEP_MICRO !== 0n
    ) {
      return reject(
        "invalid_quantity",
        `qty must be a positive multiple of ${CONTRACT_STEP_MICRO.toString()} micro-contracts`,
      );
    }
    if (
      typeof request.limitPriceBps !== "bigint" ||
      request.limitPriceBps < MIN_LIMIT_PRICE_BPS ||
      request.limitPriceBps > MAX_LIMIT_PRICE_BPS ||
      request.limitPriceBps % TICK_BPS !== 0n
    ) {
      return reject(
        "invalid_price",
        `limitPriceBps must be a multiple of ${TICK_BPS.toString()} between ${MIN_LIMIT_PRICE_BPS.toString()} and ${MAX_LIMIT_PRICE_BPS.toString()}`,
      );
    }

    const state = this.instruments.get(request.instrumentSymbol);
    const book = state?.book ?? null;
    if (state === undefined || book === null) {
      return reject("no_book", `no book was ever received for ${request.instrumentSymbol}`);
    }
    if (isBookStale(book, nowMs, this.config.staleAfterMs)) {
      return reject(
        "stale_book",
        `the latest ${request.instrumentSymbol} book is ${(nowMs - book.observedAtMs).toString()} ms old`,
      );
    }

    if (request.kind === "maker") {
      // Judged on the displayed book, as the real venue would: paper takers took nothing from it.
      const opposite =
        request.side === "buy" ? bestDisplayedLevel(book.asks) : bestDisplayedLevel(book.bids);
      if (
        opposite !== null &&
        isWithinLimit(request.side, opposite.priceBps, request.limitPriceBps)
      ) {
        return reject(
          "would_cross",
          `a maker ${request.side} at ${request.limitPriceBps.toString()} bps would cross the best ${request.side === "buy" ? "ask" : "bid"} at ${opposite.priceBps.toString()} bps`,
        );
      }
    }

    const record: OrderRecord = {
      clientOrderId: request.clientOrderId,
      venueOrderId: `paper-${this.nextOrderSeq.toString()}`,
      instrumentSymbol: request.instrumentSymbol,
      side: request.side,
      kind: request.kind,
      limitPriceBps: request.limitPriceBps,
      qty: request.qty,
      filledQty: 0n,
      feePaid: 0n,
      status: "working",
      rejectReason: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      seq: this.nextOrderSeq++,
    };
    this.orders.set(record.clientOrderId, record);

    if (record.kind === "maker") {
      this.restingSet(record.instrumentSymbol).add(record);
      const order = snapshot(record);
      this.emit({ type: "order", order });
      return { accepted: true, order, fills: [] };
    }

    const fills = this.executeTaker(record, state, book);
    if (record.filledQty < record.qty) {
      // A taker order never rests: what the book could not fill is cancelled at once.
      record.status = "cancelled";
      record.updatedAtMs = nowMs;
    }
    const order = snapshot(record);
    this.emit({ type: "order", order });
    return { accepted: true, order, fills };
  }

  private executeTaker(record: OrderRecord, state: InstrumentState, book: Book): VenueFill[] {
    const buying = record.side === "buy";
    const levels = buying ? book.asks : book.bids;
    const consumed = buying ? state.consumedAsks : state.consumedBids;
    const fills: VenueFill[] = [];
    for (const level of levels) {
      const remaining = record.qty - record.filledQty;
      if (remaining === 0n) break;
      if (!isWithinLimit(record.side, level.priceBps, record.limitPriceBps)) break;
      const consumedBefore = consumed.get(level.priceBps) ?? 0n;
      const available = floorToContractStep(level.qty - consumedBefore);
      if (available === 0n) continue;
      const qty = minBig(remaining, available);
      consumed.set(level.priceBps, consumedBefore + qty);
      fills.push(
        this.recordFill(record, level.priceBps, qty, {
          source: "book",
          instrumentSymbol: book.instrumentSymbol,
          observedAtMs: book.observedAtMs,
          bookSide: buying ? "asks" : "bids",
          levels: [
            {
              priceBps: level.priceBps,
              displayedQty: level.qty,
              consumedBeforeQty: consumedBefore,
            },
          ],
          limitPriceBps: record.limitPriceBps,
          orderRemainingQty: remaining,
          makerFeeWaived: this.config.makerFeeWaived,
        }),
      );
    }
    return fills;
  }

  private fillMakersOnBook(state: InstrumentState, book: Book, side: OrderSide): VenueFill[] {
    const buying = side === "buy";
    const levels = buying ? book.asks : book.bids;
    const consumed = buying ? state.consumedAsks : state.consumedBids;
    const fills: VenueFill[] = [];
    const candidates = this.restingMakers(book.instrumentSymbol, side).filter(
      (record) => record.createdAtMs <= book.observedAtMs,
    );
    for (const record of candidates) {
      const remaining = record.qty - record.filledQty;
      if (!isOpen(record) || remaining <= 0n) continue;
      let toFill = remaining;
      const touched: BookLevelsRef["levels"][number][] = [];
      for (const level of levels) {
        if (toFill === 0n) break;
        if (!isWithinLimit(side, level.priceBps, record.limitPriceBps)) break;
        const consumedBefore = consumed.get(level.priceBps) ?? 0n;
        const available = floorToContractStep(level.qty - consumedBefore);
        if (available === 0n) continue;
        const take = minBig(toFill, available);
        touched.push({
          priceBps: level.priceBps,
          displayedQty: level.qty,
          consumedBeforeQty: consumedBefore,
        });
        consumed.set(level.priceBps, consumedBefore + take);
        toFill -= take;
      }
      if (touched.length === 0) continue;
      fills.push(
        this.recordFill(record, record.limitPriceBps, remaining - toFill, {
          source: "book",
          instrumentSymbol: book.instrumentSymbol,
          observedAtMs: book.observedAtMs,
          bookSide: buying ? "asks" : "bids",
          levels: touched,
          limitPriceBps: record.limitPriceBps,
          orderRemainingQty: remaining,
          makerFeeWaived: this.config.makerFeeWaived,
        }),
      );
      this.emitOrder(record);
    }
    return fills;
  }

  /** Applies a fill to its order, emits it, and returns it. Does not emit the order update. */
  private recordFill(
    record: OrderRecord,
    priceBps: Bps,
    qty: MicroContracts,
    bookRef: VenueFill["bookRef"],
  ): VenueFill {
    const nowMs = this.nowMs();
    const fee = fillFee(record.kind, priceBps, qty, this.config.makerFeeWaived);
    record.filledQty += qty;
    record.feePaid += fee;
    record.updatedAtMs = nowMs;
    if (record.filledQty === record.qty) record.status = "filled";
    else if (record.kind === "maker") record.status = "partially_filled";
    const fill: VenueFill = Object.freeze({
      fillId: `paper-fill-${(this.nextFillSeq++).toString()}`,
      clientOrderId: record.clientOrderId,
      instrumentSymbol: record.instrumentSymbol,
      side: record.side,
      kind: record.kind,
      priceBps,
      qty,
      fee,
      atMs: nowMs,
      bookRef: Object.freeze(bookRef),
    });
    this.logger.info(
      {
        fillId: fill.fillId,
        clientOrderId: fill.clientOrderId,
        instrumentSymbol: fill.instrumentSymbol,
        side: fill.side,
        kind: fill.kind,
        priceBps: fill.priceBps.toString(),
        qty: fill.qty.toString(),
        fee: fill.fee.toString(),
        source: bookRef.source,
      },
      "paper venue fill",
    );
    this.emit({ type: "fill", fill });
    return fill;
  }

  private restingMakers(instrumentSymbol: string, side: OrderSide): OrderRecord[] {
    const resting = this.restingByInstrument.get(instrumentSymbol);
    if (resting === undefined) return [];
    const open: OrderRecord[] = [];
    for (const record of resting) {
      if (!isOpen(record)) resting.delete(record);
      else if (record.side === side) open.push(record);
    }
    return open.sort(byPriority(side));
  }

  private restingSet(instrumentSymbol: string): Set<OrderRecord> {
    let resting = this.restingByInstrument.get(instrumentSymbol);
    if (resting === undefined) {
      resting = new Set();
      this.restingByInstrument.set(instrumentSymbol, resting);
    }
    return resting;
  }

  private instrument(symbol: string): InstrumentState {
    let state = this.instruments.get(symbol);
    if (state === undefined) {
      state = { book: null, consumedAsks: new Map(), consumedBids: new Map() };
      this.instruments.set(symbol, state);
    }
    return state;
  }

  private emitOrder(record: OrderRecord): void {
    this.emit({ type: "order", order: snapshot(record) });
  }

  /**
   * Runs one state-changing operation; the events it emits are delivered once the outermost
   * operation has finished, so no listener ever observes, or acts on, a half-applied change.
   */
  private atomically<T>(work: () => T): T {
    this.operationDepth += 1;
    try {
      return work();
    } finally {
      this.operationDepth -= 1;
      if (this.operationDepth === 0) this.flushEvents();
    }
  }

  /**
   * Delivers queued events in order. A listener's call back into the venue queues its own events
   * behind the current ones; the loop already running delivers them, so order is preserved.
   */
  private flushEvents(): void {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (
        let event = this.pendingEvents.shift();
        event !== undefined;
        event = this.pendingEvents.shift()
      ) {
        this.dispatch(event);
      }
    } finally {
      this.flushing = false;
    }
  }

  private emit(event: VenueEvent): void {
    this.pendingEvents.push(event);
  }

  private dispatch(event: VenueEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error: unknown) {
        this.logger.error(
          { err: error, eventType: event.type },
          "paper venue event listener threw",
        );
      }
    }
  }

  private nowMs(): number {
    return this.clock.now().getTime();
  }
}
