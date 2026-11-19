import type { CampaignDetail, SaleState } from "@winz/shared";

import type { PushedCampaign } from "@/lib/realtime/live-campaign";

/**
 * The live figures of a campaign's detail (SPEC MDB-1, criterion 7: a sale shows within 3 seconds):
 * what the API answered, with the row Supabase Realtime pushed on top of it when that row is newer.
 *
 * The pushed row (`live_campaigns`) carries `sales`, `exposure`, `hedgedBps` (`hedged_bps`) and
 * `saleState` (`sale_state`): those four are taken from it. Its `outcome` only decides which of the
 * two is newer; the status and the report it implies, like every other figure (gross sales,
 * received, pending, budget, capacity, chance), still come from the API, which the screen asks again
 * at once when a newer row brings something the API answer did not have (`needsReread`).
 */

/** How often the detail asks the API while the live feed carries the sales. */
export const DETAIL_POLL_MS = 3000;

/**
 * How often it asks when the live feed is down, silent, or absent (the simulated mode, a browser
 * where Supabase is blocked): the re-reads alone then show a sale within 3 seconds.
 */
export const DETAIL_FALLBACK_POLL_MS = 2000;

/** The poll of the detail: slower while the feed is live, fast enough alone when it is not. */
export function detailPollMs(feedLive: boolean): number {
  return feedLive ? DETAIL_POLL_MS : DETAIL_FALLBACK_POLL_MS;
}

/**
 * Whether the pushed row is newer than the API answer, which carries no timestamp of its own. Sales
 * and exposure only grow, and an outcome never goes back to none: a row behind the API on any of
 * them is older, a row ahead is newer. When they are equal, the one that reached the screen last
 * wins (`apiReceivedAt` and `receivedAt` are both this device's clock).
 */
export function pushIsNewer(
  api: Pick<CampaignDetail, "slug" | "sales" | "exposure" | "outcome">,
  apiReceivedAt: number,
  pushed: PushedCampaign,
): boolean {
  const { row } = pushed;
  if (api.slug === null || row.slug !== api.slug) return false;
  if (api.outcome !== null && row.outcome === null) return false;
  if (api.outcome === null && row.outcome !== null) return true;
  if (row.sales !== api.sales) return row.sales > api.sales;
  const pushedExposure = BigInt(row.exposure);
  const apiExposure = BigInt(api.exposure);
  if (pushedExposure !== apiExposure) return pushedExposure > apiExposure;
  return pushed.receivedAt > apiReceivedAt;
}

/** The API's rule: once sales close, the sale state reads `closed` whatever is stored. */
function effectiveSaleState(stored: SaleState, salesCloseAt: string, nowMs: number): SaleState {
  return nowMs >= Date.parse(salesCloseAt) ? "closed" : stored;
}

/**
 * The campaign the screen shows: the API answer, with the four figures of the pushed row when it is
 * newer. A row of another campaign, an older row, or no row leaves the API answer as it is.
 */
export function mergeLiveCampaign(
  api: CampaignDetail,
  apiReceivedAt: number,
  pushed: PushedCampaign | null,
  nowMs: number,
): CampaignDetail {
  if (pushed === null || !pushIsNewer(api, apiReceivedAt, pushed)) return api;
  const { row } = pushed;
  return {
    ...api,
    sales: row.sales,
    exposure: row.exposure,
    hedgedBps: row.hedged_bps,
    saleState: effectiveSaleState(row.sale_state, api.salesCloseAt, nowMs),
  };
}

/**
 * Whether a newer pushed row says something the API answer does not: a sale (the money figures must
 * follow), another sale state, or a result (the status and the report must follow).
 */
export function needsReread(
  api: CampaignDetail,
  apiReceivedAt: number,
  pushed: PushedCampaign,
): boolean {
  if (!pushIsNewer(api, apiReceivedAt, pushed)) return false;
  const { row } = pushed;
  return (
    row.sales !== api.sales ||
    row.exposure !== api.exposure ||
    row.sale_state !== api.saleState ||
    row.outcome !== api.outcome
  );
}

/**
 * Whether the figures on screen are the last ones rather than current ones: the screen has a
 * campaign but its last read of the API failed. The screen then says so and hides the chance,
 * instead of leaving an old number that looks fresh.
 */
export function isStale(hasData: boolean, error: unknown): boolean {
  return hasData && error !== null && error !== undefined;
}

/**
 * The live chance to show: the one the screen tracks, or none (« updating ») when the campaign is
 * not tracked or its figures are stale.
 */
export function shownChance(bps: number | null, tracking: boolean, stale: boolean): number | null {
  return tracking && !stale ? bps : null;
}
