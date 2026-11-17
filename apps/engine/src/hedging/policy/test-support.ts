/** Helpers shared by the policy tests. Not imported by production code. */
import type { Book, BookLevel, MicroContracts } from "@winz/shared";

import { PaperVenue } from "../../venues";
import type {
  CancelOrderResult,
  ExecutionVenue,
  PlaceOrderRequest,
  PlaceOrderResult,
  VenueDescription,
  VenueEventListener,
  VenueFill,
  VenueOrder,
} from "../../venues";
import { FakeClock, c, level, makeBook, silentLogger } from "../../venues/test-support";
import { DEFAULT_POLICY_PARAMS } from "./params";
import type { PolicyParams } from "./params";
import { PolicyRunner } from "./runner";
import type { PolicyRestore } from "./runner";
import type { BreakerParams } from "./breaker";
import type { PolicyOrder, PolicyState } from "./decide";
import type { PolicyEvent, PolicyEventSink } from "./events";

export { FakeClock, c, level, makeBook, silentLogger };

export const SYM = "GEMI-TEST-2611200000-AAA-BBB-M-AAA";
export const T0 = 1_800_000_000_000;
export const HOUR_MS = 3_600_000;

/** A decide() state with sensible defaults: three hours before the start, no orders. */
export function policyState(overrides: Partial<PolicyState> = {}): PolicyState {
  const nowMs = overrides.nowMs ?? T0;
  return {
    nowMs,
    eventStartMs: nowMs + 3 * HOUR_MS,
    exposure: 0n,
    held: 0n,
    openOrders: [],
    book: makeBook(SYM, nowMs, [level(4800, 500)], [level(5000, 500)]),
    params: DEFAULT_POLICY_PARAMS,
    breakerActive: false,
    reconcile: false,
    ...overrides,
  };
}

export function makerOrder(
  overrides: Partial<PolicyOrder> & { clientOrderId: string },
): PolicyOrder {
  return {
    side: "buy",
    kind: "maker",
    limitPriceBps: 4900n,
    remainingQty: c(10),
    placedAtMs: T0,
    askAtPlacementBps: 5000n,
    ...overrides,
  };
}

/** Records every policy event, in order. */
export class RecordingSink implements PolicyEventSink {
  readonly events: PolicyEvent[] = [];

  async record(event: PolicyEvent): Promise<void> {
    this.events.push(event);
  }

  ofType<T extends PolicyEvent["type"]>(type: T): Extract<PolicyEvent, { type: T }>[] {
    return this.events.filter(
      (event): event is Extract<PolicyEvent, { type: T }> => event.type === type,
    );
  }
}

export type FailMode = "none" | "before" | "after";

/**
 * Wraps a venue and makes its calls throw on demand: `before` throws without reaching the venue,
 * `after` lets the venue act and then loses the answer (a timeout after the order landed).
 * Counts every call.
 */
export class FlakyVenue implements ExecutionVenue {
  readonly name: ExecutionVenue["name"];
  mode: FailMode = "none";
  readonly calls = { place: 0, cancel: 0, get: 0, list: 0 };
  readonly placed: PlaceOrderRequest[] = [];
  /** The next this many calls of each kind throw without reaching the venue. */
  failNextCancels = 0;
  failNextPlaces = 0;
  failNextGets = 0;
  /** Runs before a cancel or a lookup reaches the venue: the market moving during the call. */
  beforeCancel: ((clientOrderId: string) => void) | null = null;
  beforeGetOrder: ((clientOrderId: string) => void) | null = null;
  /**
   * While true, venue events are held back from the runner (a lagging event stream: answers to
   * calls arrive before the events of the same changes). `releaseEvents` delivers them in order.
   */
  holdEvents = false;
  private readonly heldEvents: (() => void)[] = [];

  constructor(private readonly inner: ExecutionVenue) {
    this.name = inner.name;
  }

  private async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.mode === "before") throw new Error("venue unreachable");
    const result = await work();
    if (this.mode === "after") throw new Error("venue timed out");
    return result;
  }

  placeOrder(request: PlaceOrderRequest): Promise<PlaceOrderResult> {
    this.calls.place += 1;
    if (this.failNextPlaces > 0) {
      this.failNextPlaces -= 1;
      return Promise.reject(new Error("venue unreachable"));
    }
    return this.run(async () => {
      this.placed.push(request);
      return this.inner.placeOrder(request);
    });
  }

  cancelOrder(clientOrderId: string): Promise<CancelOrderResult> {
    this.calls.cancel += 1;
    if (this.failNextCancels > 0) {
      this.failNextCancels -= 1;
      return Promise.reject(new Error("venue unreachable"));
    }
    this.beforeCancel?.(clientOrderId);
    return this.run(() => this.inner.cancelOrder(clientOrderId));
  }

  getOrder(clientOrderId: string): Promise<VenueOrder | null> {
    this.calls.get += 1;
    if (this.failNextGets > 0) {
      this.failNextGets -= 1;
      return Promise.reject(new Error("venue unreachable"));
    }
    this.beforeGetOrder?.(clientOrderId);
    return this.run(() => this.inner.getOrder(clientOrderId));
  }

  listOpenOrders(instrumentSymbol?: string): Promise<readonly VenueOrder[]> {
    this.calls.list += 1;
    return this.run(() => this.inner.listOpenOrders(instrumentSymbol));
  }

  onEvent(listener: VenueEventListener): () => void {
    return this.inner.onEvent((event) => {
      if (this.holdEvents) this.heldEvents.push(() => listener(event));
      else listener(event);
    });
  }

  /** Delivers the held events, oldest first, and stops holding. */
  releaseEvents(): void {
    this.holdEvents = false;
    for (let deliver = this.heldEvents.shift(); deliver !== undefined;) {
      deliver();
      deliver = this.heldEvents.shift();
    }
  }

  describe(): VenueDescription {
    return this.inner.describe();
  }
}

export interface ScenarioOptions {
  eventStartMs?: number;
  params?: Partial<PolicyParams>;
  breakerParams?: Partial<BreakerParams>;
  restore?: PolicyRestore;
  idPrefix?: string;
  /** Reuse a venue (restart tests). */
  paper?: PaperVenue;
  clock?: FakeClock;
}

/**
 * A runner on a paper venue, both driven by one fake clock. Books and trades go to the venue
 * first (it fills resting makers), then to the runner, as the engine wiring will do.
 */
export class Scenario {
  readonly clock: FakeClock;
  readonly paper: PaperVenue;
  readonly venue: FlakyVenue;
  readonly sink = new RecordingSink();
  readonly runner: PolicyRunner;
  readonly fills: VenueFill[] = [];
  private bids: readonly BookLevel[] = [];
  private asks: readonly BookLevel[] = [];

  constructor(options: ScenarioOptions = {}) {
    this.clock = options.clock ?? new FakeClock(T0);
    this.paper = options.paper ?? new PaperVenue({ clock: this.clock, logger: silentLogger() });
    this.venue = new FlakyVenue(this.paper);
    this.paper.onEvent((event) => {
      if (event.type === "fill") this.fills.push(event.fill);
    });
    this.runner = new PolicyRunner({
      instrumentSymbol: SYM,
      eventStartMs: options.eventStartMs ?? T0 + 3 * HOUR_MS,
      venue: this.venue,
      clock: this.clock,
      logger: silentLogger(),
      idPrefix: options.idPrefix ?? "hedge",
      sink: this.sink,
      ...(options.params === undefined ? {} : { params: options.params }),
      ...(options.breakerParams === undefined ? {} : { breakerParams: options.breakerParams }),
      ...(options.restore === undefined ? {} : { restore: options.restore }),
    });
  }

  get nowMs(): number {
    return this.clock.ms;
  }

  /** A new book observed now, fed to the venue and then to the runner. */
  async book(bids: readonly BookLevel[], asks: readonly BookLevel[]): Promise<void> {
    this.bids = bids;
    this.asks = asks;
    await this.feed(makeBook(SYM, this.clock.ms, bids, asks));
  }

  async feed(book: Book): Promise<void> {
    this.paper.onBook(book);
    await this.runner.onBook(book);
  }

  /** The last levels again, observed now (the feed's ~1 s heartbeat). */
  async refresh(): Promise<void> {
    await this.book(this.bids, this.asks);
  }

  async trade(priceBps: number, contracts: number): Promise<void> {
    const trade = {
      instrumentSymbol: SYM,
      priceBps: BigInt(priceBps),
      qty: c(contracts),
      atMs: this.clock.ms,
    };
    this.paper.onTrade(trade);
    await this.runner.onTrade(trade);
  }

  async exposure(qty: MicroContracts): Promise<void> {
    await this.runner.onExposure(qty);
  }

  /** Advances the clock by `ms` in steps of `stepMs`, refreshing the book (unless told not to) and ticking. */
  async advance(ms: number, options: { stepMs?: number; refresh?: boolean } = {}): Promise<void> {
    const stepMs = options.stepMs ?? 1_000;
    let left = ms;
    while (left > 0) {
      const step = Math.min(stepMs, left);
      this.clock.advance(step);
      left -= step;
      if (options.refresh ?? true) await this.refresh();
      await this.runner.onTick();
    }
  }

  async openOrders(): Promise<readonly VenueOrder[]> {
    return this.paper.listOpenOrders(SYM);
  }

  /** Sum of what the open maker buys at the venue may still fill. */
  async venueWorking(): Promise<MicroContracts> {
    return (await this.openOrders())
      .filter((order) => order.kind === "maker" && order.side === "buy")
      .reduce((total, order) => total + order.qty - order.filledQty, 0n);
  }

  /** Net contracts bought by every fill at the venue. */
  venueHeld(): MicroContracts {
    return this.fills.reduce(
      (total, fill) => total + (fill.side === "buy" ? fill.qty : -fill.qty),
      0n,
    );
  }
}
