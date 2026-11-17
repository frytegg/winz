import type {
  Bps,
  ExecutionVenueName,
  MicroContracts,
  MicroUsdc,
  OrderKind,
  OrderStatus,
} from "@winz/shared";

/**
 * The contract between the execution policy (SPEC 9.3) and wherever hedge orders execute. The
 * policy only knows this interface: it must behave the same whether the venue is the paper venue
 * (simulated against the live production book, SPEC 9.7) or the real Gemini adapter (task H-07).
 *
 * Every order buys or sells YES contracts of one instrument. Prices are basis points of a dollar
 * on the 100 bps tick, quantities are micro-contracts on the 0.01 contract step, money is
 * micro-USDC.
 */
export interface ExecutionVenue {
  /** Which venue this is, one of the shared `EXECUTION_VENUES`. */
  readonly name: ExecutionVenueName;

  /**
   * Places an order. Never throws for a market reason (no book, stale book, would cross, invalid
   * quantity or price): those come back as a typed rejection. Idempotent on `clientOrderId`:
   * placing the same id again returns the first result and creates nothing.
   */
  placeOrder(request: PlaceOrderRequest): Promise<PlaceOrderResult>;

  /**
   * Cancels a working or partially filled order. Idempotent: cancelling a cancelled order
   * succeeds again. A filled, rejected or unknown order comes back as a typed result.
   */
  cancelOrder(clientOrderId: string): Promise<CancelOrderResult>;

  /** The order as the venue sees it now, or null when the id was never placed. */
  getOrder(clientOrderId: string): Promise<VenueOrder | null>;

  /** Working and partially filled orders, of one instrument or of all, oldest first. */
  listOpenOrders(instrumentSymbol?: string): Promise<readonly VenueOrder[]>;

  /** Subscribes to order updates and fills. Returns the function that unsubscribes. */
  onEvent(listener: VenueEventListener): () => void;

  /** Label and known limit shown on the Hedge desk. */
  describe(): VenueDescription;
}

export const ORDER_SIDES = ["buy", "sell"] as const;
/** Buy or sell YES contracts. */
export type OrderSide = (typeof ORDER_SIDES)[number];

export interface PlaceOrderRequest {
  /** Chosen by the caller; the idempotency key of the order. */
  clientOrderId: string;
  instrumentSymbol: string;
  side: OrderSide;
  /** `maker`: rests at its limit and never crosses. `taker`: fills what it can now, never rests. */
  kind: OrderKind;
  /** A multiple of the 100 bps tick, between 100 and 9 900 bps. */
  limitPriceBps: Bps;
  /** Micro-contracts, a positive multiple of the 0.01 contract step. */
  qty: MicroContracts;
}

/** Why an order was refused. Every one of them is a market or input reason, never an exception. */
export const ORDER_REJECT_REASONS = [
  /** Empty `clientOrderId` or `instrumentSymbol`, unknown side or kind. */
  "invalid_order",
  /** Not a positive multiple of the 0.01 contract step. */
  "invalid_quantity",
  /** Not a multiple of the 100 bps tick between 100 and 9 900 bps. */
  "invalid_price",
  /** No book was ever received for the instrument. */
  "no_book",
  /** The latest book is older than `BOOK_STALE_AFTER_MS`. */
  "stale_book",
  /** A maker order at or through the opposite best price (a maker-or-cancel order would be refused). */
  "would_cross",
] as const;
export type OrderRejectReason = (typeof ORDER_REJECT_REASONS)[number];

/** An order as the venue sees it. Snapshots: a later change produces a new object. */
export interface VenueOrder {
  clientOrderId: string;
  /** The venue's own id; null for a rejected order, which the venue never created. */
  venueOrderId: string | null;
  instrumentSymbol: string;
  side: OrderSide;
  kind: OrderKind;
  limitPriceBps: Bps;
  qty: MicroContracts;
  filledQty: MicroContracts;
  /** Fees of every fill so far, micro-USDC. */
  feePaid: MicroUsdc;
  /**
   * `working` and `partially_filled` are open. A taker order never rests: it ends `filled`, or
   * `cancelled` with whatever it filled in `filledQty`.
   */
  status: OrderStatus;
  /** Set when, and only when, `status` is `rejected`. */
  rejectReason: OrderRejectReason | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export type PlaceOrderResult =
  | {
      accepted: true;
      /** The order right after placement: a taker order is already final. */
      order: VenueOrder;
      /** Fills produced by the placement itself (taker orders only; makers fill later). */
      fills: readonly VenueFill[];
    }
  | {
      accepted: false;
      reason: OrderRejectReason;
      message: string;
      /** The rejected order, kept so the id stays idempotent; null when the id itself is invalid. */
      order: VenueOrder | null;
    };

export type CancelOrderResult =
  | {
      cancelled: true;
      order: VenueOrder;
      /** True when the order was already cancelled before this call. */
      alreadyCancelled: boolean;
    }
  | {
      cancelled: false;
      reason: "unknown_order" | "already_filled" | "rejected";
      order: VenueOrder | null;
    };

/** One execution: one price, one quantity, one fee. A taker walking three levels makes three fills. */
export interface VenueFill {
  fillId: string;
  clientOrderId: string;
  instrumentSymbol: string;
  side: OrderSide;
  kind: OrderKind;
  priceBps: Bps;
  qty: MicroContracts;
  /** Micro-USDC, rounded up. */
  fee: MicroUsdc;
  atMs: number;
  /** What the fill was executed against, enough to replay it (SPEC 9.7, last bullet). */
  bookRef: FillBookRef;
}

/**
 * A fill against book levels: the levels touched, as displayed, with what earlier fills had
 * already taken from them since that book arrived.
 */
export interface BookLevelsRef {
  source: "book";
  instrumentSymbol: string;
  observedAtMs: number;
  /** `asks` for a buy, `bids` for a sell. */
  bookSide: "asks" | "bids";
  /** In walking order, best first. A taker fill touches exactly one level. */
  levels: readonly {
    priceBps: Bps;
    displayedQty: MicroContracts;
    /** Taken from this level by earlier fills since the book arrived. */
    consumedBeforeQty: MicroContracts;
  }[];
  limitPriceBps: Bps;
  /** What the order still had to fill just before this fill. */
  orderRemainingQty: MicroContracts;
  /** The venue's maker-fee waiver when the fill happened. */
  makerFeeWaived: boolean;
}

/** A maker fill triggered by a public trade print. */
export interface TradePrintRef {
  source: "trade";
  instrumentSymbol: string;
  printPriceBps: Bps;
  printedQty: MicroContracts;
  /** Taken from this print by resting orders with priority over this one. */
  allocatedBeforeQty: MicroContracts;
  printedAtMs: number;
  limitPriceBps: Bps;
  orderRemainingQty: MicroContracts;
  makerFeeWaived: boolean;
}

export type FillBookRef = BookLevelsRef | TradePrintRef;

export type VenueEvent =
  | { type: "order"; order: VenueOrder }
  | {
      type: "fill";
      fill: VenueFill;
    };

export type VenueEventListener = (event: VenueEvent) => void;

export interface VenueDescription {
  name: ExecutionVenueName;
  /** Shown as-is on the Hedge desk, e.g. "PAPER · live Gemini book". */
  label: string;
  /** The known limit of the venue, in one sentence. */
  note: string;
}

/** A public trade on the venue, as the market-data feed reports it. */
export interface TradePrint {
  instrumentSymbol: string;
  priceBps: Bps;
  qty: MicroContracts;
  atMs: number;
}

/** Wall clock. Structurally compatible with the engine's other clocks (`now(): Date`). */
export interface VenueClock {
  now(): Date;
}
