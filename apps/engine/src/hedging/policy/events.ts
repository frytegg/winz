import type { MicroContracts } from "@winz/shared";

import type { OrderRejectReason, PlaceOrderRequest, VenueFill, VenueOrder } from "../../venues";
import type { BreakerReason } from "./breaker";
import type { PolicyActionReason } from "./decide";

/**
 * What the policy runner reports to its persistence layer (task H-05 and the engine wiring):
 * enough to write `orders`, `fills`, `positions` and `live_hedge_desk` without asking the venue.
 * Every event carries the runner's clock time `atMs` and the instrument.
 */
export type PolicyEvent =
  | {
      /**
       * Written ahead of the placement and awaited: if the process dies between this and the
       * venue's answer, the persistence layer knows the id and hands it back in
       * `PolicyRestore.unsettledOrders`, so the order is looked up, never placed again.
       */
      type: "order_intent";
      atMs: number;
      instrumentSymbol: string;
      request: PlaceOrderRequest;
      reason: PolicyActionReason;
    }
  | {
      type: "order_placed";
      atMs: number;
      instrumentSymbol: string;
      order: VenueOrder;
      reason: PolicyActionReason;
    }
  | {
      type: "order_rejected";
      atMs: number;
      instrumentSymbol: string;
      clientOrderId: string;
      rejectReason: OrderRejectReason;
      message: string;
    }
  | {
      /** The venue call threw: the order may or may not exist. It is looked up on the next cycles. */
      type: "order_unconfirmed";
      atMs: number;
      instrumentSymbol: string;
      clientOrderId: string;
      error: string;
    }
  | {
      /** An unconfirmed placement the venue does not know: it never existed. */
      type: "order_abandoned";
      atMs: number;
      instrumentSymbol: string;
      clientOrderId: string;
    }
  | {
      type: "order_cancelled";
      atMs: number;
      instrumentSymbol: string;
      order: VenueOrder;
      reason: PolicyActionReason;
    }
  | {
      /** Any change the venue reported on one of the runner's orders (fills, close, reject). */
      type: "order_updated";
      atMs: number;
      instrumentSymbol: string;
      order: VenueOrder;
    }
  | {
      type: "fill";
      atMs: number;
      instrumentSymbol: string;
      fill: VenueFill;
      /**
       * The part of `fill.qty` the position changes by. Below `fill.qty` only when a restore had
       * already recovered that part from a venue snapshot (`position_recovered`): the fill row
       * keeps its price and fee, the position must not count those contracts twice.
       */
      countedQty: MicroContracts;
    }
  | {
      /**
       * After a restart: an order the persistence layer had recorded with `recordedFilledQty`
       * has filled `qty` more at the venue meanwhile. The fills themselves were missed: the
       * position is corrected by `qty` (bought for a buy, sold for a sell).
       */
      type: "position_recovered";
      atMs: number;
      instrumentSymbol: string;
      order: VenueOrder;
      qty: MicroContracts;
    }
  | {
      type: "breaker_tripped";
      atMs: number;
      instrumentSymbol: string;
      reason: BreakerReason;
      causes: readonly BreakerReason[];
    }
  | {
      type: "breaker_reset";
      atMs: number;
      instrumentSymbol: string;
    };

/** Implemented by the persistence layer. A rejection is logged; only `order_intent` is fatal to its placement. */
export interface PolicyEventSink {
  record(event: PolicyEvent): Promise<void>;
}
