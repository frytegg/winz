import type { ExecutionVenueName } from "@winz/shared";

import { VenueInputError, VenueNotImplementedError } from "./errors";
import { PaperVenue } from "./paper-venue";
import type { PaperVenueDeps } from "./paper-venue";
import type { ExecutionVenue } from "./types";

export { FillReplayError, VenueError, VenueInputError, VenueNotImplementedError } from "./errors";
export {
  DEFAULT_PAPER_VENUE_CONFIG,
  MAX_LIMIT_PRICE_BPS,
  MIN_LIMIT_PRICE_BPS,
  PAPER_VENUE_LABEL,
  PAPER_VENUE_NOTE,
  PaperVenue,
} from "./paper-venue";
export type { PaperVenueConfig, PaperVenueDeps } from "./paper-venue";
export { fillFee, floorToContractStep, isWithinLimit, replayFill } from "./replay";
export type { ReplayedFill } from "./replay";
export { ORDER_REJECT_REASONS, ORDER_SIDES } from "./types";
export type {
  BookLevelsRef,
  CancelOrderResult,
  ExecutionVenue,
  FillBookRef,
  OrderRejectReason,
  OrderSide,
  PlaceOrderRequest,
  PlaceOrderResult,
  TradePrint,
  TradePrintRef,
  VenueClock,
  VenueDescription,
  VenueEvent,
  VenueEventListener,
  VenueFill,
  VenueOrder,
} from "./types";

/** The task that builds the real Gemini order adapter behind `ExecutionVenue`. */
export const REAL_VENUE_TASK = "H-07";

/**
 * The execution venue for `name`. Only the paper venue exists today; the real Gemini adapter
 * ("gemini-sandbox", "gemini") is task H-07, and asking for it throws rather than pretending.
 */
export function createVenue(name: ExecutionVenueName, deps: PaperVenueDeps): ExecutionVenue {
  switch (name) {
    case "paper":
      return new PaperVenue(deps);
    case "gemini-sandbox":
    case "gemini":
      throw new VenueNotImplementedError(name, REAL_VENUE_TASK);
    default: {
      const unknown: never = name;
      throw new VenueInputError(`unknown execution venue "${String(unknown)}"`);
    }
  }
}
