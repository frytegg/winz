import { limits, type Limits } from "@winz/pricing";
import type { CampaignPreviewRequest, CampaignPreviewResponse } from "@winz/shared";

import { readCachedBook, unhedgedExposure } from "./books";
import type { Db } from "./db";
import { ApiRouteError } from "./route";
import { isoDate } from "./wire";

/** How long a tracking request keeps the engine following an instrument nobody sells yet. */
export const TRACKING_TTL_MINUTES = 10;

/** The terms as the pricing library takes them, after the checks the wire schema cannot make. */
export interface PreviewTerms {
  instrumentSymbol: string;
  unitPrice: bigint;
  refundBps: bigint;
  usualMarginBps: bigint;
  minMarginBps: bigint;
  budget: bigint;
}

/** Validates the terms beyond their schema (400 `invalid_request` with the field name). */
export function parsePreviewTerms(body: CampaignPreviewRequest): PreviewTerms {
  const terms: PreviewTerms = {
    instrumentSymbol: body.instrumentSymbol,
    unitPrice: BigInt(body.unitPrice),
    refundBps: BigInt(body.refundBps),
    usualMarginBps: BigInt(body.usualMarginBps),
    minMarginBps: BigInt(body.minMarginBps),
    budget: BigInt(body.budget),
  };
  if (terms.unitPrice <= 0n) {
    throw new ApiRouteError(400, "invalid_request", "Invalid body.unitPrice: must be above zero");
  }
  if (terms.minMarginBps > terms.usualMarginBps) {
    throw new ApiRouteError(
      400,
      "invalid_request",
      "Invalid body.minMarginBps: must not be above the usual margin",
    );
  }
  return terms;
}

/** `limits()` on the wire (`campaignPreviewResponseSchema`). */
export function toPreviewResponse(
  result: Limits,
  bookObservedAt: Date | null,
): CampaignPreviewResponse {
  return {
    maxCostBps: Number(result.maxCostBps),
    pauseThresholdBps: Number(result.pauseThresholdBps),
    currentProbabilityBps:
      result.currentProbabilityBps === null ? null : Number(result.currentProbabilityBps),
    costPerSale: result.costPerSale === null ? null : result.costPerSale.toString(),
    marginKeptPerSale:
      result.marginKeptPerSale === null ? null : result.marginKeptPerSale.toString(),
    marginKeptBps: result.marginKeptBps === null ? null : Number(result.marginKeptBps),
    capacity: { sales: result.capacity.sales, limitedBy: result.capacity.limitedBy },
    saleState: result.saleState,
    bookAsOf: bookObservedAt === null ? null : isoDate(bookObservedAt),
  };
}

/**
 * The answer for a game whose sales have already closed: a promo created now could not sell, so
 * the state is `closed` and the capacity zero, whatever the book says. The market figures stay, for
 * information.
 */
export function closedPreview(response: CampaignPreviewResponse): CampaignPreviewResponse {
  return {
    ...response,
    capacity: { sales: 0, limitedBy: response.capacity.limitedBy },
    saleState: "closed",
  };
}

/**
 * Asks the engine to follow `symbol` for the next ten minutes (it picks the row up within a
 * couple of seconds). A second request only pushes the expiry further.
 */
export async function trackInstrument(db: Db, symbol: string): Promise<void> {
  await db`
    insert into tracked_instruments (symbol, requested_at, expires_at)
    values (${symbol}, now(), now() + make_interval(mins => ${TRACKING_TTL_MINUTES}))
    on conflict (symbol) do update set
      requested_at = excluded.requested_at,
      expires_at = greatest(tracked_instruments.expires_at, excluded.expires_at)
  `;
}

/**
 * POST /api/campaigns/preview (screen M6): the figures of `limits()` for these terms on the
 * instrument's latest cached book, behind the exposure already sold and not hedged on it. The
 * whole budget is available (nothing is spent before the campaign exists). Without a book yet,
 * the market figures are null and the state is `paused_depth`; the preview also registers a
 * tracking request, so the book is there a couple of seconds later. Once the game's sales have
 * closed (`events.sales_close_at`), the answer is `closed` with no capacity, and nothing is tracked.
 */
export async function previewCampaign(
  db: Db,
  body: CampaignPreviewRequest,
  now: Date,
): Promise<CampaignPreviewResponse> {
  const terms = parsePreviewTerms(body);
  const [instrument] = await db<{ symbol: string; sales_close_at: Date }[]>`
    select i.symbol, e.sales_close_at
    from instruments i
    join events e on e.ticker = i.event_ticker
    where i.symbol = ${terms.instrumentSymbol} and i.active and i.outcome is null
  `;
  if (!instrument) {
    throw new ApiRouteError(404, "not_found", "This promo condition is not available");
  }
  const salesClosed = now.getTime() >= instrument.sales_close_at.getTime();

  if (!salesClosed) await trackInstrument(db, instrument.symbol);
  const [book, pending] = await Promise.all([
    readCachedBook(db, instrument.symbol),
    unhedgedExposure(db, instrument.symbol),
  ]);

  const result = limits({
    book,
    pending,
    nowMs: now.getTime(),
    unitPrice: terms.unitPrice,
    refundBps: terms.refundBps,
    usualMarginBps: terms.usualMarginBps,
    minMarginBps: terms.minMarginBps,
    availableBudget: terms.budget,
  });
  const response = toPreviewResponse(result, book === null ? null : new Date(book.observedAtMs));
  return salesClosed ? closedPreview(response) : response;
}
