import type { ExecutionVenueName } from "@winz/shared";

import { VenueInputError, VenueNotAllowedError } from "./errors";
import type { OrderLinkStore } from "./gemini/links";
import { GeminiOrderVenue } from "./gemini/venue";
import type { GeminiOrderApi, GeminiOrderVenueConfig } from "./gemini/venue";
import { PaperVenue } from "./paper-venue";
import type { PaperVenueDeps } from "./paper-venue";
import type { ExecutionVenue } from "./types";

export { FillReplayError, VenueError, VenueInputError, VenueNotAllowedError } from "./errors";
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
  VenueReportRef,
} from "./types";
export {
  DEFAULT_GEMINI_VENUE_CONFIG,
  GEMINI_SANDBOX_LABEL,
  GEMINI_SANDBOX_NOTE,
  GeminiOrderVenue,
} from "./gemini/venue";
export type { GeminiOrderApi, GeminiOrderVenueConfig, GeminiOrderVenueDeps } from "./gemini/venue";
export type { OrderLink, OrderLinkStore } from "./gemini/links";
export { MemoryOrderLinkStore, PgOrderLinkStore } from "./gemini/links";

/** What the real Gemini venue is built on, given by the engine when it runs on the sandbox. */
export interface GeminiVenueWiring {
  client: GeminiOrderApi;
  links: OrderLinkStore;
  config?: Partial<GeminiOrderVenueConfig>;
}

export interface CreateVenueDeps extends PaperVenueDeps {
  /** Required for "gemini-sandbox": the sandbox client (with its keys) and the order links. */
  gemini?: GeminiVenueWiring;
}

/**
 * The execution venue for `name`: the paper venue (`paper`, the default everywhere), or the real
 * Gemini order adapter on the sandbox (`gemini-sandbox`, task H-07). Gemini production
 * (`gemini`) is refused on purpose: it would trade real money.
 */
export function createVenue(name: ExecutionVenueName, deps: CreateVenueDeps): ExecutionVenue {
  switch (name) {
    case "paper":
      return new PaperVenue(deps);
    case "gemini-sandbox": {
      if (deps.gemini === undefined) {
        throw new VenueInputError(
          'execution venue "gemini-sandbox" needs the sandbox client: GEMINI_SANDBOX_API_KEY and GEMINI_SANDBOX_API_SECRET',
        );
      }
      return new GeminiOrderVenue({
        client: deps.gemini.client,
        links: deps.gemini.links,
        clock: deps.clock,
        logger: deps.logger,
        ...(deps.gemini.config === undefined ? {} : { config: deps.gemini.config }),
      });
    }
    case "gemini":
      throw new VenueNotAllowedError(name);
    default: {
      const unknown: never = name;
      throw new VenueInputError(`unknown execution venue "${String(unknown)}"`);
    }
  }
}
