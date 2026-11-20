import type { Logger } from "pino";

import { BPS, CONTRACT_STEP_MICRO, ORDER_KINDS } from "@winz/shared";
import type { MicroContracts } from "@winz/shared";

import { MAX_LIMIT_PRICE_BPS, MIN_LIMIT_PRICE_BPS } from "../paper-venue";
import { fillFee } from "../replay";
import { ORDER_SIDES } from "../types";
import type {
  CancelOrderResult,
  ExecutionVenue,
  OrderRejectReason,
  PlaceOrderRequest,
  PlaceOrderResult,
  VenueClock,
  VenueDescription,
  VenueEvent,
  VenueEventListener,
  VenueFill,
  VenueOrder,
  VenueReportRef,
} from "../types";
import type { CallOptions, GeminiOrderRequest, OrderHistoryQuery } from "./client";
import {
  GeminiNotFoundError,
  GeminiOrderUnknownYetError,
  GeminiRefusedError,
  GeminiVenueError,
} from "./errors";
import type { OrderLink, OrderLinkStore } from "./links";
import {
  AVG_PRICE_SCALE,
  avgPriceToScaled,
  formatPrice,
  formatQuantity,
  priceToBps,
  quantityToMicro,
  scaledToBps,
  type GeminiOrder,
  type GeminiOrders,
} from "./schemas";

export const GEMINI_SANDBOX_LABEL = "GEMINI SANDBOX · test orders";
export const GEMINI_SANDBOX_NOTE =
  "Real orders on Gemini's sandbox, paid with test funds. Gemini's order API does not report fees, so each fill's fee is computed from Gemini's published schedule.";

/** The part of `GeminiPrivateClient` the venue uses (a fake in unit tests). */
export interface GeminiOrderApi {
  placeOrder(request: GeminiOrderRequest, options?: CallOptions): Promise<GeminiOrder>;
  cancelOrder(orderId: string, options?: CallOptions): Promise<{ result: string }>;
  allActiveOrders(symbol?: string, options?: CallOptions): Promise<GeminiOrder[]>;
  orderHistory(query: OrderHistoryQuery, options?: CallOptions): Promise<GeminiOrders>;
}

export interface GeminiOrderVenueConfig {
  /** As the paper venue's: true while Gemini's maker-fee promotion applies. */
  makerFeeWaived: boolean;
  /** How often open orders are read back to see their fills. Default 2 000 ms. */
  pollIntervalMs: number;
  /**
   * How long after its placement an order Gemini does not show (neither active nor in the
   * history) is still waited for. Past it, an order whose placement got no answer is taken as
   * never created. Default 30 000 ms.
   */
  notVisibleGraceMs: number;
  /** The history is read from this long before the order's placement. Default 60 000 ms. */
  historyLookBackMs: number;
}

export const DEFAULT_GEMINI_VENUE_CONFIG: Readonly<GeminiOrderVenueConfig> = Object.freeze({
  makerFeeWaived: true,
  pollIntervalMs: 2_000,
  notVisibleGraceMs: 30_000,
  historyLookBackMs: 60_000,
});

export interface GeminiOrderVenueDeps {
  client: GeminiOrderApi;
  links: OrderLinkStore;
  clock: VenueClock;
  logger: Logger;
  config?: Partial<GeminiOrderVenueConfig>;
}

interface Tracked {
  link: OrderLink;
  /** The latest snapshot. */
  order: VenueOrder;
  /** Filled quantity × average price so far, in micro-contracts × 1e-8 dollar. */
  costScaled: bigint;
  /** The first answer to `placeOrder`, returned again for the same id. */
  firstResult: PlaceOrderResult | null;
  /** Gemini's own status and average price in the latest answer, as Gemini wrote them. */
  geminiStatus: string | null;
  geminiAvgPrice: string | null;
}

const OPEN = new Set<VenueOrder["status"]>(["working", "partially_filled"]);
const FINAL = new Set<VenueOrder["status"]>(["filled", "cancelled", "rejected"]);

function isOpen(order: VenueOrder): boolean {
  return OPEN.has(order.status);
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** What a refusal of Gemini means for the caller. */
function rejectReasonOf(error: GeminiVenueError): OrderRejectReason {
  if (error.reason === "InvalidPrice") return "invalid_price";
  if (error.reason === "InvalidQuantity") return "invalid_quantity";
  return "invalid_order";
}

/**
 * The real Gemini order adapter (SPEC HE-10, task H-07), behind the same `ExecutionVenue` as the
 * paper venue. Orders buy or sell YES contracts of a Prediction Markets instrument through the
 * documented REST routes (developer.gemini.com/rest-api/prediction-markets/order-management):
 *
 * - maker: `orderType: "limit"`, `timeInForce: "good-til-cancel"`, `makerOrCancel: true`. An
 *   order that would take liquidity is cancelled by Gemini instead of filling: it comes back as a
 *   `would_cross` rejection (its Gemini id is kept on the rejected order, since Gemini created it).
 * - taker: `orderType: "limit"`, `timeInForce: "immediate-or-cancel"`: fills what it can now, the
 *   rest is cancelled by Gemini, never rests.
 * - cancel: `POST /v1/prediction-markets/order/cancel`, then the order is read back.
 * - status: Gemini has no single-order status route for Prediction Markets. An order is read back
 *   from the active orders (`/orders/active`, filtered by symbol) or, once closed, from the
 *   history (`/orders/history`, by symbol and close time).
 * - fills: Gemini reports, per order, the filled quantity and the average execution price. Each
 *   increase of the filled quantity seen in an answer is one fill, priced at what the average
 *   implies for that increase, rounded to the bps; its fee is computed from the published schedule
 *   (`packages/pricing`), the order API reporting none. Open orders are read back every
 *   `pollIntervalMs` while there are some; each new fill and each change is emitted as an event.
 *
 * The REST order request carries no client id, so the link from the caller's `clientOrderId` to
 * Gemini's `orderId` is kept in an `OrderLinkStore`, written before the placement is sent. A
 * placement that got no answer (network error, 5xx, an answer that cannot be read) is thrown, its
 * outcome unknown; `getOrder` later finds it among Gemini's orders by its terms (symbol, side,
 * price, quantity, placed after it was sent, linked to no other id), or, past
 * `notVisibleGraceMs`, answers that it was never created.
 *
 * Throws (never a market reason): a `GeminiVenueError` when Gemini cannot be reached or refuses
 * the account (key, nonce, funds, terms, rate limit). A refusal of the order itself (invalid
 * price, unknown symbol, market not open) is a typed rejection.
 */
export class GeminiOrderVenue implements ExecutionVenue {
  readonly name = "gemini-sandbox" as const;

  private readonly client: GeminiOrderApi;
  private readonly links: OrderLinkStore;
  private readonly clock: VenueClock;
  private readonly logger: Logger;
  private readonly config: Readonly<GeminiOrderVenueConfig>;
  private readonly tracked = new Map<string, Tracked>();
  private readonly listeners = new Set<VenueEventListener>();
  private pollTimer: NodeJS.Timeout | null = null;
  private polling: Promise<void> | null = null;
  private closed = false;

  constructor(deps: GeminiOrderVenueDeps) {
    const config = { ...DEFAULT_GEMINI_VENUE_CONFIG, ...deps.config };
    for (const key of ["pollIntervalMs", "notVisibleGraceMs", "historyLookBackMs"] as const) {
      if (!Number.isFinite(config[key]) || config[key] <= 0) {
        throw new RangeError(`gemini venue config: ${key} must be a positive number`);
      }
    }
    this.client = deps.client;
    this.links = deps.links;
    this.clock = deps.clock;
    this.logger = deps.logger;
    this.config = Object.freeze(config);
  }

  describe(): VenueDescription {
    return { name: this.name, label: GEMINI_SANDBOX_LABEL, note: GEMINI_SANDBOX_NOTE };
  }

  onEvent(listener: VenueEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Stops reading open orders back. Orders keep resting at Gemini: cancel them first if needed. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    await this.polling;
  }

  // -------------------------------------------------------------------------------------------
  // Placement
  // -------------------------------------------------------------------------------------------

  async placeOrder(request: PlaceOrderRequest): Promise<PlaceOrderResult> {
    const id: unknown = request.clientOrderId;
    if (typeof id !== "string" || id.length === 0) {
      return {
        accepted: false,
        reason: "invalid_order",
        message: "clientOrderId must be a non-empty string",
        order: null,
      };
    }
    const known = this.tracked.get(id);
    if (known?.firstResult != null) {
      if (!this.sameTerms(known.link, request)) {
        this.logger.warn(
          { clientOrderId: id },
          "gemini venue received a second placement with the same clientOrderId but other terms: the first result is returned",
        );
      }
      return known.firstResult;
    }
    const stored = known?.link ?? (await this.links.get(id));
    if (stored !== null) return this.resultOfExisting(stored);

    const invalid = this.validate(request);
    if (invalid !== null) return this.rejectLocally(request, invalid.reason, invalid.message);

    const nowMs = this.nowMs();
    const link: OrderLink = {
      clientOrderId: id,
      venue: this.name,
      instrumentSymbol: request.instrumentSymbol,
      side: request.side,
      kind: request.kind,
      limitPriceBps: request.limitPriceBps,
      qty: request.qty,
      placedAtMs: nowMs,
      venueOrderId: null,
      state: "pending",
      refusal: null,
      cancelRequested: false,
    };
    // Written first: an answer lost on the way back still leaves the link to find the order by.
    await this.links.save(link);

    let answer: GeminiOrder;
    try {
      answer = await this.client.placeOrder({
        symbol: request.instrumentSymbol,
        orderType: "limit",
        side: request.side,
        quantity: formatQuantity(request.qty),
        price: formatPrice(request.limitPriceBps),
        outcome: "yes",
        timeInForce: request.kind === "maker" ? "good-til-cancel" : "immediate-or-cancel",
        ...(request.kind === "maker" ? { makerOrCancel: true } : {}),
      });
    } catch (error: unknown) {
      return this.placementFailed(link, error);
    }

    link.venueOrderId = answer.orderId;
    link.state = "placed";
    await this.saveLink(link);
    const tracked = this.track(link, answer);
    const fills = this.absorb(tracked, answer);
    const order = tracked.order;
    const result: PlaceOrderResult =
      order.status === "rejected"
        ? {
            accepted: false,
            reason: "would_cross",
            message: `gemini cancelled maker-or-cancel order ${answer.orderId}: it would have taken liquidity`,
            order,
          }
        : { accepted: true, order, fills };
    tracked.firstResult = result;
    this.logger.info(
      {
        clientOrderId: id,
        venueOrderId: answer.orderId,
        instrumentSymbol: link.instrumentSymbol,
        side: link.side,
        kind: link.kind,
        priceBps: Number(link.limitPriceBps),
        qty: link.qty.toString(),
        status: order.status,
        filledQty: order.filledQty.toString(),
      },
      "gemini order placed",
    );
    this.schedulePoll();
    return result;
  }

  private async placementFailed(link: OrderLink, error: unknown): Promise<PlaceOrderResult> {
    if (!(error instanceof GeminiVenueError)) throw error;
    const definitive =
      error.kind === "refused" ||
      error.kind === "auth" ||
      error.kind === "nonce" ||
      error.kind === "insufficient_funds" ||
      error.kind === "terms" ||
      error.kind === "rate_limit" ||
      error.kind === "not_found";
    if (!definitive) {
      // No answer, a 5xx or an unreadable answer: the order may exist. The link stays pending.
      this.logger.warn(
        { clientOrderId: link.clientOrderId, err: error.message },
        "gemini placement got no usable answer: its outcome is unknown until the order is read back",
      );
      throw error;
    }
    link.state = "refused";
    link.refusal = error.reason ?? error.kind;
    await this.saveLink(link);
    const reason = rejectReasonOf(error);
    const order = this.rejectedOrder(link, null, reason);
    const tracked: Tracked = {
      link,
      order,
      costScaled: 0n,
      firstResult: null,
      geminiStatus: null,
      geminiAvgPrice: null,
    };
    this.tracked.set(link.clientOrderId, tracked);
    this.logger.warn(
      { clientOrderId: link.clientOrderId, kind: error.kind, err: error.message },
      "gemini refused the order",
    );
    if (error instanceof GeminiRefusedError || error.kind === "not_found") {
      const result: PlaceOrderResult = {
        accepted: false,
        reason,
        message: `gemini refused the order: ${error.message}`,
        order,
      };
      tracked.firstResult = result;
      this.emit([{ type: "order", order }]);
      return result;
    }
    // A refusal of the account (key, funds, terms, rate): thrown, so that the caller counts the
    // venue as failing; the order is known as rejected if it asks.
    this.emit([{ type: "order", order }]);
    throw error;
  }

  private async resultOfExisting(link: OrderLink): Promise<PlaceOrderResult> {
    const order = await this.getOrder(link.clientOrderId);
    if (order === null || order.status === "rejected") {
      return {
        accepted: false,
        reason: order?.rejectReason ?? "invalid_order",
        message: `order ${link.clientOrderId} was placed before: ${link.refusal ?? "it does not exist at Gemini"}`,
        order,
      };
    }
    return { accepted: true, order, fills: [] };
  }

  private sameTerms(link: OrderLink, request: PlaceOrderRequest): boolean {
    return (
      link.instrumentSymbol === request.instrumentSymbol &&
      link.side === request.side &&
      link.kind === request.kind &&
      link.limitPriceBps === request.limitPriceBps &&
      link.qty === request.qty
    );
  }

  private validate(
    request: PlaceOrderRequest,
  ): { reason: OrderRejectReason; message: string } | null {
    if (typeof request.instrumentSymbol !== "string" || request.instrumentSymbol.length === 0) {
      return { reason: "invalid_order", message: "instrumentSymbol must be a non-empty string" };
    }
    if (!(ORDER_SIDES as readonly string[]).includes(request.side)) {
      return { reason: "invalid_order", message: `side must be buy or sell` };
    }
    if (!(ORDER_KINDS as readonly string[]).includes(request.kind)) {
      return { reason: "invalid_order", message: `kind must be maker or taker` };
    }
    if (
      typeof request.qty !== "bigint" ||
      request.qty <= 0n ||
      request.qty % CONTRACT_STEP_MICRO !== 0n
    ) {
      return {
        reason: "invalid_quantity",
        message: `qty must be a positive multiple of ${CONTRACT_STEP_MICRO.toString()} micro-contracts`,
      };
    }
    if (
      typeof request.limitPriceBps !== "bigint" ||
      request.limitPriceBps < MIN_LIMIT_PRICE_BPS ||
      request.limitPriceBps > MAX_LIMIT_PRICE_BPS ||
      request.limitPriceBps % MIN_LIMIT_PRICE_BPS !== 0n
    ) {
      return {
        reason: "invalid_price",
        message: `limitPriceBps must be a multiple of ${MIN_LIMIT_PRICE_BPS.toString()} between ${MIN_LIMIT_PRICE_BPS.toString()} and ${MAX_LIMIT_PRICE_BPS.toString()}`,
      };
    }
    return null;
  }

  private rejectLocally(
    request: PlaceOrderRequest,
    reason: OrderRejectReason,
    message: string,
  ): PlaceOrderResult {
    const nowMs = this.nowMs();
    const link: OrderLink = {
      clientOrderId: request.clientOrderId,
      venue: this.name,
      instrumentSymbol: String(request.instrumentSymbol),
      side: request.side,
      kind: request.kind,
      limitPriceBps: typeof request.limitPriceBps === "bigint" ? request.limitPriceBps : 0n,
      qty: typeof request.qty === "bigint" ? request.qty : 0n,
      placedAtMs: nowMs,
      venueOrderId: null,
      state: "refused",
      refusal: message,
      cancelRequested: false,
    };
    const order = this.rejectedOrder(link, null, reason);
    const result: PlaceOrderResult = { accepted: false, reason, message, order };
    this.tracked.set(link.clientOrderId, {
      link,
      order,
      costScaled: 0n,
      firstResult: result,
      geminiStatus: null,
      geminiAvgPrice: null,
    });
    this.emit([{ type: "order", order }]);
    return result;
  }

  // -------------------------------------------------------------------------------------------
  // Cancel
  // -------------------------------------------------------------------------------------------

  async cancelOrder(clientOrderId: string): Promise<CancelOrderResult> {
    const current = await this.getOrder(clientOrderId);
    if (current === null) return { cancelled: false, reason: "unknown_order", order: null };
    if (current.status === "rejected")
      return { cancelled: false, reason: "rejected", order: current };
    if (current.status === "filled") {
      return { cancelled: false, reason: "already_filled", order: current };
    }
    if (current.status === "cancelled") {
      return { cancelled: true, order: current, alreadyCancelled: true };
    }
    const tracked = this.tracked.get(clientOrderId);
    const venueOrderId = tracked?.link.venueOrderId ?? current.venueOrderId;
    if (tracked === undefined || venueOrderId === null) {
      return { cancelled: false, reason: "unknown_order", order: current };
    }
    tracked.link.cancelRequested = true;
    await this.saveLink(tracked.link);
    try {
      await this.client.cancelOrder(venueOrderId);
    } catch (error: unknown) {
      if (!(error instanceof GeminiNotFoundError) && !(error instanceof GeminiRefusedError)) {
        throw error;
      }
      // Gemini cannot cancel it: already filled, already cancelled, or unknown. Read it back.
      this.logger.info(
        { clientOrderId, venueOrderId, reason: error.reason, status: error.status },
        "gemini did not cancel the order: reading it back",
      );
      const after = await this.readBack(tracked, { history: true });
      if (after === null) return { cancelled: false, reason: "unknown_order", order: current };
      if (after.status === "filled") {
        return { cancelled: false, reason: "already_filled", order: after };
      }
      if (after.status === "cancelled") {
        return { cancelled: true, order: after, alreadyCancelled: true };
      }
      throw error;
    }
    // Cancelled by Gemini's answer. Read back for the final filled quantity: the order leaves the
    // active list and enters the history, possibly not at once.
    let after: VenueOrder | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      after = await this.readBack(tracked, { history: true });
      if (after !== null && FINAL.has(after.status)) break;
    }
    if (after === null || !FINAL.has(after.status)) {
      this.logger.warn(
        { clientOrderId, venueOrderId },
        "gemini acknowledged the cancel but does not show the order closed yet: taken as cancelled",
      );
      const order = this.withStatus(tracked, "cancelled");
      return { cancelled: true, order, alreadyCancelled: false };
    }
    if (after.status === "filled")
      return { cancelled: false, reason: "already_filled", order: after };
    this.logger.info(
      { clientOrderId, venueOrderId, filledQty: after.filledQty.toString() },
      "gemini order cancelled",
    );
    return { cancelled: true, order: after, alreadyCancelled: false };
  }

  // -------------------------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------------------------

  async getOrder(clientOrderId: string): Promise<VenueOrder | null> {
    let tracked = this.tracked.get(clientOrderId);
    if (tracked === undefined) {
      const link = await this.links.get(clientOrderId);
      if (link === null) return null;
      tracked = {
        link,
        order: this.placeholderOrder(link),
        costScaled: 0n,
        firstResult: null,
        geminiStatus: null,
        geminiAvgPrice: null,
      };
      this.tracked.set(clientOrderId, tracked);
    }
    const link = tracked.link;
    if (link.state === "refused") {
      return tracked.order.status === "rejected"
        ? tracked.order
        : this.rejectedOrder(link, null, "invalid_order");
    }
    if (link.state === "absent") return null;
    if (FINAL.has(tracked.order.status) && link.venueOrderId !== null) return tracked.order;
    if (link.venueOrderId === null) return this.resolvePending(tracked);
    const order = await this.readBack(tracked, { history: true });
    if (order === null) {
      if (this.nowMs() - link.placedAtMs < this.config.notVisibleGraceMs) {
        throw new GeminiOrderUnknownYetError(clientOrderId, "Gemini does not list it yet");
      }
      throw new GeminiOrderUnknownYetError(
        clientOrderId,
        `Gemini lists order ${link.venueOrderId} neither as active nor in its history`,
      );
    }
    return order;
  }

  async listOpenOrders(instrumentSymbol?: string): Promise<readonly VenueOrder[]> {
    const active = await this.client.allActiveOrders(instrumentSymbol);
    const linked = await this.linksOf(active);
    const orders: VenueOrder[] = [];
    for (const answer of active) {
      if (instrumentSymbol !== undefined && answer.symbol !== instrumentSymbol) continue;
      const link = linked.get(answer.orderId);
      if (link === undefined) {
        orders.push(this.foreignOrder(answer));
        continue;
      }
      const tracked = this.trackedFor(link, answer);
      this.absorb(tracked, answer);
      orders.push(tracked.order);
    }
    // Ours that left the active list since they were last seen: closed, read from the history.
    for (const tracked of this.tracked.values()) {
      if (
        isOpen(tracked.order) &&
        tracked.link.venueOrderId !== null &&
        (instrumentSymbol === undefined || tracked.link.instrumentSymbol === instrumentSymbol) &&
        !active.some((answer) => answer.orderId === tracked.link.venueOrderId)
      ) {
        await this.readBack(tracked, { history: true, skipActive: true });
      }
    }
    this.schedulePoll();
    return orders.filter((order) => isOpen(order)).sort((a, b) => a.createdAtMs - b.createdAtMs);
  }

  /**
   * Gemini's own words for the order in the latest answer read: its status ("open", "filled",
   * "cancelled") and average execution price. Null before any answer. For receipts.
   */
  geminiView(clientOrderId: string): { status: string | null; avgPrice: string | null } | null {
    const tracked = this.tracked.get(clientOrderId);
    if (tracked === undefined) return null;
    return { status: tracked.geminiStatus, avgPrice: tracked.geminiAvgPrice };
  }

  // -------------------------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------------------------

  private async linksOf(active: readonly GeminiOrder[]): Promise<Map<string, OrderLink>> {
    const result = new Map<string, OrderLink>();
    const missing: string[] = [];
    for (const answer of active) {
      const local = [...this.tracked.values()].find(
        (tracked) => tracked.link.venueOrderId === answer.orderId,
      );
      if (local !== undefined) result.set(answer.orderId, local.link);
      else missing.push(answer.orderId);
    }
    for (const id of missing) {
      const link = await this.links.byVenueOrderId(this.name, id);
      if (link !== null) result.set(id, link);
    }
    return result;
  }

  private trackedFor(link: OrderLink, answer: GeminiOrder): Tracked {
    const existing = this.tracked.get(link.clientOrderId);
    if (existing !== undefined) return existing;
    return this.track(link, answer);
  }

  private track(link: OrderLink, answer: GeminiOrder): Tracked {
    const existing = this.tracked.get(link.clientOrderId);
    if (existing !== undefined) {
      existing.link = link;
      return existing;
    }
    const tracked: Tracked = {
      link,
      order: { ...this.placeholderOrder(link), createdAtMs: Date.parse(answer.createdAt) },
      costScaled: 0n,
      firstResult: null,
      geminiStatus: null,
      geminiAvgPrice: null,
    };
    this.tracked.set(link.clientOrderId, tracked);
    return tracked;
  }

  /**
   * The order as Gemini shows it now: in the active orders, or else in the history. Null when
   * neither lists it. Every change is absorbed (fills and order events).
   */
  private async readBack(
    tracked: Tracked,
    options: { history: boolean; skipActive?: boolean },
  ): Promise<VenueOrder | null> {
    const link = tracked.link;
    const id = link.venueOrderId;
    if (id === null) return null;
    if (options.skipActive !== true) {
      const active = await this.client.allActiveOrders(link.instrumentSymbol);
      const answer = active.find((order) => order.orderId === id);
      if (answer !== undefined) {
        this.absorb(tracked, answer);
        return tracked.order;
      }
    }
    if (!options.history) return null;
    const answer = await this.findInHistory(link, (order) => order.orderId === id);
    if (answer === undefined) return null;
    this.absorb(tracked, answer);
    return tracked.order;
  }

  private async findInHistory(
    link: OrderLink,
    match: (order: GeminiOrder) => boolean,
  ): Promise<GeminiOrder | undefined> {
    const from = Math.max(0, Math.floor(link.placedAtMs - this.config.historyLookBackMs));
    const to = Math.floor(this.nowMs() + this.config.historyLookBackMs);
    const history = await this.client.orderHistory({
      symbol: link.instrumentSymbol,
      from,
      to,
      limit: 1000,
    });
    return history.orders.find(match);
  }

  /**
   * A placement whose answer never came: finds it at Gemini by its terms. Found, it is linked and
   * returned; not found within the grace period, the lookup is "not yet" (thrown); not found past
   * it, it was never created (null, and remembered as absent).
   */
  private async resolvePending(tracked: Tracked): Promise<VenueOrder | null> {
    const link = tracked.link;
    const active = await this.client.allActiveOrders(link.instrumentSymbol);
    const candidates = [...active];
    const history = await this.client.orderHistory({
      symbol: link.instrumentSymbol,
      from: Math.max(0, Math.floor(link.placedAtMs - this.config.historyLookBackMs)),
      to: Math.floor(this.nowMs() + this.config.historyLookBackMs),
      limit: 1000,
    });
    candidates.push(...history.orders);
    const taken = await this.links.linkedVenueOrderIds(
      this.name,
      candidates.map((order) => order.orderId),
    );
    // Gemini's clock and ours may differ by a little: 5 s of slack before the send time.
    const notBefore = link.placedAtMs - 5_000;
    const match = candidates
      .filter(
        (order) =>
          !taken.has(order.orderId) &&
          order.symbol === link.instrumentSymbol &&
          order.side === link.side &&
          order.outcome === "yes" &&
          quantityToMicro(order.quantity) === link.qty &&
          order.price === formatPrice(link.limitPriceBps) &&
          Date.parse(order.createdAt) >= notBefore,
      )
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
    if (match !== undefined) {
      link.venueOrderId = match.orderId;
      link.state = "placed";
      await this.saveLink(link);
      tracked.order = { ...tracked.order, venueOrderId: match.orderId };
      this.absorb(tracked, match);
      this.logger.info(
        { clientOrderId: link.clientOrderId, venueOrderId: match.orderId },
        "gemini placement without an answer found at Gemini by its terms",
      );
      this.schedulePoll();
      return tracked.order;
    }
    if (this.nowMs() - link.placedAtMs < this.config.notVisibleGraceMs) {
      throw new GeminiOrderUnknownYetError(
        link.clientOrderId,
        "its placement got no answer and Gemini does not list it yet",
      );
    }
    link.state = "absent";
    await this.saveLink(link);
    this.logger.warn(
      { clientOrderId: link.clientOrderId },
      "gemini placement without an answer was never created: Gemini does not list it",
    );
    return null;
  }

  /**
   * Applies one answer of Gemini to the tracked order: a fill for each increase of the filled
   * quantity, then the new snapshot. Emits the events. Returns the fills.
   */
  private absorb(tracked: Tracked, answer: GeminiOrder): VenueFill[] {
    const link = tracked.link;
    const previous = tracked.order;
    const reportedQty = quantityToMicro(answer.quantity);
    if (reportedQty !== link.qty) {
      this.logger.error(
        {
          clientOrderId: link.clientOrderId,
          venueOrderId: answer.orderId,
          sent: link.qty.toString(),
          reported: reportedQty.toString(),
        },
        "gemini reports another quantity than the one sent: Gemini's is kept",
      );
    }
    const qty = reportedQty;
    let filled = quantityToMicro(answer.filledQuantity);
    if (filled < previous.filledQty) {
      this.logger.error(
        {
          clientOrderId: link.clientOrderId,
          before: previous.filledQty.toString(),
          now: filled.toString(),
        },
        "gemini reports less filled than before: the higher quantity is kept",
      );
      filled = previous.filledQty;
    }
    const nowMs = this.nowMs();
    const fills: VenueFill[] = [];
    let feePaid = previous.feePaid;
    if (filled > previous.filledQty) {
      const delta = filled - previous.filledQty;
      const avg =
        answer.avgExecutionPrice === null || answer.avgExecutionPrice === undefined
          ? null
          : avgPriceToScaled(answer.avgExecutionPrice);
      const limitScaled = (link.limitPriceBps * AVG_PRICE_SCALE) / BPS;
      const costScaled = avg === null ? tracked.costScaled + delta * limitScaled : filled * avg;
      const fillCost = costScaled - tracked.costScaled;
      const perContract = fillCost <= 0n ? limitScaled : (fillCost + delta / 2n) / delta;
      let priceBps = scaledToBps(perContract);
      if (priceBps < 0n) priceBps = 0n;
      if (priceBps > BPS) priceBps = BPS;
      const fee = fillFee(link.kind, priceBps, delta, this.config.makerFeeWaived);
      feePaid += fee;
      tracked.costScaled = costScaled;
      const bookRef: VenueReportRef = {
        source: "venue",
        instrumentSymbol: link.instrumentSymbol,
        venueOrderId: answer.orderId,
        limitPriceBps: link.limitPriceBps,
        orderRemainingQty: qty - previous.filledQty,
        reportedFilledQty: filled,
        reportedAvgPrice: answer.avgExecutionPrice ?? null,
        observedAtMs: nowMs,
        feeFromSchedule: true,
        makerFeeWaived: this.config.makerFeeWaived,
      };
      fills.push({
        fillId: `${answer.orderId}:${filled.toString()}`,
        clientOrderId: link.clientOrderId,
        instrumentSymbol: link.instrumentSymbol,
        side: link.side,
        kind: link.kind,
        priceBps,
        qty: delta,
        fee,
        atMs: nowMs,
        bookRef,
      });
    }
    const status = this.statusOf(link, answer, filled, qty);
    const updatedAtMs =
      answer.updatedAt === null || answer.updatedAt === undefined
        ? nowMs
        : Date.parse(answer.updatedAt);
    const order: VenueOrder = Object.freeze({
      clientOrderId: link.clientOrderId,
      venueOrderId: answer.orderId,
      instrumentSymbol: link.instrumentSymbol,
      side: link.side,
      kind: link.kind,
      limitPriceBps: link.limitPriceBps,
      qty,
      filledQty: filled,
      feePaid,
      status,
      rejectReason: status === "rejected" ? "would_cross" : null,
      createdAtMs: Date.parse(answer.createdAt),
      updatedAtMs,
    });
    const changed =
      previous.status !== order.status ||
      previous.filledQty !== order.filledQty ||
      previous.venueOrderId !== order.venueOrderId;
    tracked.order = order;
    tracked.geminiStatus = answer.status;
    tracked.geminiAvgPrice = answer.avgExecutionPrice ?? null;
    const events: VenueEvent[] = fills.map((fill) => ({ type: "fill", fill }));
    if (changed) events.push({ type: "order", order });
    this.emit(events);
    return fills;
  }

  private statusOf(
    link: OrderLink,
    answer: GeminiOrder,
    filled: MicroContracts,
    qty: MicroContracts,
  ): VenueOrder["status"] {
    if (filled >= qty) return "filled";
    switch (answer.status) {
      case "open":
        return filled > 0n ? "partially_filled" : "working";
      case "filled":
        return "filled";
      case "cancelled":
      case "closed":
        // A maker cancelled with nothing filled and no cancel asked: Gemini's maker-or-cancel
        // refusal of an order that would have taken liquidity.
        return link.kind === "maker" && filled === 0n && !link.cancelRequested
          ? "rejected"
          : "cancelled";
    }
  }

  private withStatus(tracked: Tracked, status: VenueOrder["status"]): VenueOrder {
    const order = Object.freeze({ ...tracked.order, status, updatedAtMs: this.nowMs() });
    tracked.order = order;
    this.emit([{ type: "order", order }]);
    return order;
  }

  /** An order of the account this adapter did not place (or whose link is lost). */
  private foreignOrder(answer: GeminiOrder): VenueOrder {
    const filled = quantityToMicro(answer.filledQuantity);
    return Object.freeze({
      clientOrderId: `gemini:${answer.orderId}`,
      venueOrderId: answer.orderId,
      instrumentSymbol: answer.symbol,
      side: answer.side,
      kind: "maker",
      limitPriceBps: priceToBps(answer.price),
      qty: quantityToMicro(answer.quantity),
      filledQty: filled,
      feePaid: 0n,
      status: filled > 0n ? "partially_filled" : "working",
      rejectReason: null,
      createdAtMs: Date.parse(answer.createdAt),
      updatedAtMs: Date.parse(answer.updatedAt ?? answer.createdAt),
    });
  }

  private placeholderOrder(link: OrderLink): VenueOrder {
    return Object.freeze({
      clientOrderId: link.clientOrderId,
      venueOrderId: link.venueOrderId,
      instrumentSymbol: link.instrumentSymbol,
      side: link.side,
      kind: link.kind,
      limitPriceBps: link.limitPriceBps,
      qty: link.qty,
      filledQty: 0n,
      feePaid: 0n,
      status: "working",
      rejectReason: null,
      createdAtMs: link.placedAtMs,
      updatedAtMs: link.placedAtMs,
    });
  }

  private rejectedOrder(
    link: OrderLink,
    venueOrderId: string | null,
    reason: OrderRejectReason,
  ): VenueOrder {
    return Object.freeze({
      ...this.placeholderOrder(link),
      venueOrderId,
      status: "rejected",
      rejectReason: reason,
    });
  }

  private async saveLink(link: OrderLink): Promise<void> {
    try {
      await this.links.save(link);
    } catch (error: unknown) {
      // The order exists (or not) whatever the store says: losing the link only matters after a
      // restart. Logged loudly, not thrown, so the caller still gets Gemini's answer.
      this.logger.error(
        {
          clientOrderId: link.clientOrderId,
          venueOrderId: link.venueOrderId,
          err: describeError(error),
        },
        "gemini order link could not be saved",
      );
    }
  }

  private emit(events: readonly VenueEvent[]): void {
    for (const event of events) {
      for (const listener of [...this.listeners]) {
        try {
          listener(event);
        } catch (error: unknown) {
          this.logger.error({ err: describeError(error) }, "venue event listener threw");
        }
      }
    }
  }

  /** Reads open orders back every `pollIntervalMs` while some are open, to see their fills. */
  private schedulePoll(): void {
    if (this.closed || this.pollTimer !== null) return;
    if (![...this.tracked.values()].some((tracked) => isOpen(tracked.order))) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.polling = this.pollOnce().finally(() => {
        this.polling = null;
        this.schedulePoll();
      });
    }, this.config.pollIntervalMs);
    this.pollTimer.unref();
  }

  private async pollOnce(): Promise<void> {
    const symbols = new Set<string>();
    for (const tracked of this.tracked.values()) {
      if (isOpen(tracked.order) && tracked.link.venueOrderId !== null) {
        symbols.add(tracked.link.instrumentSymbol);
      }
    }
    for (const symbol of symbols) {
      if (this.closed) return;
      try {
        await this.refreshSymbol(symbol);
      } catch (error: unknown) {
        this.logger.warn(
          { instrumentSymbol: symbol, err: describeError(error) },
          "gemini open orders could not be read back: tried again at the next poll",
        );
      }
    }
  }

  private async refreshSymbol(symbol: string): Promise<void> {
    const active = await this.client.allActiveOrders(symbol);
    const byId = new Map(active.map((order) => [order.orderId, order]));
    for (const tracked of [...this.tracked.values()]) {
      const id = tracked.link.venueOrderId;
      if (!isOpen(tracked.order) || id === null || tracked.link.instrumentSymbol !== symbol) {
        continue;
      }
      const answer = byId.get(id);
      if (answer !== undefined) this.absorb(tracked, answer);
      else await this.readBack(tracked, { history: true, skipActive: true });
    }
  }

  private nowMs(): number {
    return this.clock.now().getTime();
  }
}
