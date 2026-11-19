import type { SaleState } from "@winz/shared";

/**
 * The market of a game that nobody has asked about yet is not ready: the first preview registers the
 * game with the engine, which opens its order book a few seconds later (measured: about 10 seconds
 * on the real back end). The preview answers `paused_depth` until then. M6 asks again, instead of
 * showing "not ready" for good, and gives up after a minute with a message that says so.
 */

/** How long to wait between two previews while the market is warming up. */
export const MARKET_RETRY_MS = 3000;
/** After this long the screen stops asking and says so. */
export const MARKET_RETRY_CAP_MS = 60_000;

/** `ready`: nothing to wait for. `waiting`: the book is on its way. `gave_up`: it did not come. */
export type MarketWatch = "ready" | "waiting" | "gave_up";

/**
 * Only a market with no book (or a book gone stale) can come back by itself in seconds. A price
 * above the pause threshold, a spent budget or a manual pause do not: waiting would change nothing.
 */
export function isMarketWarming(saleState: SaleState): boolean {
  return saleState === "paused_depth" || saleState === "paused_stale";
}

/** Whether to ask again: the market is warming up and the time allowed is not used up. */
export function shouldRetryPreview(saleState: SaleState, elapsedMs: number): boolean {
  return isMarketWarming(saleState) && elapsedMs < MARKET_RETRY_CAP_MS;
}

export function marketWatch(saleState: SaleState, elapsedMs: number): MarketWatch {
  if (!isMarketWarming(saleState)) return "ready";
  return elapsedMs < MARKET_RETRY_CAP_MS ? "waiting" : "gave_up";
}
