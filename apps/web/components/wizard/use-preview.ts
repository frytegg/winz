"use client";

import type { CampaignTerms, SaleState } from "@winz/shared";
import { useCallback, useRef } from "react";

import { apiFetch } from "@/lib/api/client";
import { useAsync, type AsyncState } from "@/lib/api/use-async";
import { copy } from "@/lib/copy";
import {
  MARKET_RETRY_MS,
  marketWatch,
  shouldRetryPreview,
  type MarketWatch,
} from "@/lib/wizard/market-watch";

type Preview = Awaited<ReturnType<typeof apiFetch<"campaignPreview">>>;

export interface PreviewState extends AsyncState<Preview> {
  /** Whether the game's market is still opening (the preview is asked again), or did not open. */
  market: MarketWatch;
}

/**
 * `POST /api/campaigns/preview` for the terms on screen. Nothing is computed here: the numbers
 * come from the back (`packages/pricing`). A newer set of terms cancels the request in flight, so a
 * late answer to an old slider position never replaces the answer to the current one.
 *
 * The first preview of a game registers it with the engine, which opens its order book a few
 * seconds later; until then the answer is "market not ready". While it is, the preview is asked
 * again every 3 seconds, for about a minute from the moment these terms were first asked, then the
 * state becomes `gave_up` and `reload` starts another minute. Leaving the screen, or changing the
 * terms, cancels the wait (the request in flight and the timer, in `useAsync`).
 */
export function usePreview(terms: CampaignTerms | null, debounceMs: number): PreviewState {
  const key = JSON.stringify(terms);
  const watch = useRef({ key, startedAt: Date.now() });
  if (watch.current.key !== key) watch.current = { key, startedAt: Date.now() };

  const state = useAsync(
    (signal) => {
      if (terms === null) throw new RangeError("usePreview has no terms to preview");
      return apiFetch("campaignPreview", { body: terms, signal });
    },
    [key],
    {
      debounceMs,
      enabled: terms !== null,
      pollMs: MARKET_RETRY_MS,
      shouldPoll: (answer) =>
        shouldRetryPreview(answer.saleState, Date.now() - watch.current.startedAt),
    },
  );

  const { reload } = state;
  const restart = useCallback((): void => {
    watch.current = { key: watch.current.key, startedAt: Date.now() };
    reload();
  }, [reload]);

  const market =
    state.data === null
      ? "ready"
      : marketWatch(state.data.saleState, Date.now() - watch.current.startedAt);
  return { ...state, reload: restart, market };
}

/** Why a promo would not sell right now, in the merchant's words; `null` when it would. */
export function pausedExplanation(saleState: SaleState): string | null {
  switch (saleState) {
    case "open":
      return null;
    case "paused_price":
      return copy.margin.pausedPrice;
    case "paused_budget":
      return copy.margin.limitedByBudget;
    default:
      return copy.margin.pausedMarket;
  }
}
