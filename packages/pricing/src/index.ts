// Pure pricing functions shared by the web app and the engine (SPEC module `pricing`).
// No I/O, no clock, no floats: money is bigint micro-USDC, prices are bigint basis points,
// contract quantities are bigint micro-contracts. Costs round up, capacities round down.

export { PricingInputError } from "./errors";

export { MAKER_FEE_RATE_BPS, TAKER_FEE_RATE_BPS } from "./fees";
export { costPerContractBps, makerFeeBps, takerFeeBps } from "./fees";
export type { MakerFeeOptions } from "./fees";

export {
  bestAsk,
  bestBid,
  isBookStale,
  isTwoSided,
  micropriceBps,
  midBps,
  spreadBps,
} from "./book";

export { marginalTakerCost, marginalTakerFill } from "./marginal-cost";
export type { TakerFill } from "./marginal-cost";

export { QUOTE_REFUSAL_SALE_STATE, computeQuote, guaranteeCap, saleStateForQuote } from "./quote";
export type {
  AcceptedQuote,
  MarketInput,
  Quote,
  QuoteInput,
  QuoteRefusalReason,
  QuoteSaleState,
  RefusedQuote,
} from "./quote";

export { MAX_CAPACITY_SALES, limits, maxCostBps, pauseThresholdBps } from "./limits";
export type { Capacity, CapacityLimit, Limits, LimitsInput } from "./limits";

export { FULL_REFUND_BPS, HALF_REFUND_BPS, promoTemplates } from "./templates";
export type {
  AvailableTemplate,
  PromoTemplateData,
  PromoTemplateOptions,
  TemplateInstrument,
  TemplateUnavailableReason,
  UnavailableTemplate,
} from "./templates";
