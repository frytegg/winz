"use client";

import type { CampaignTerms, SaleState } from "@winz/shared";

import { apiFetch } from "@/lib/api/client";
import { useAsync, type AsyncState } from "@/lib/api/use-async";
import { copy } from "@/lib/copy";

type Preview = Awaited<ReturnType<typeof apiFetch<"campaignPreview">>>;

/**
 * `POST /api/campaigns/preview` for the terms on screen. Nothing is computed here: the numbers
 * come from the back (`packages/pricing`). A newer set of terms cancels the request in flight, so a
 * late answer to an old slider position never replaces the answer to the current one.
 */
export function usePreview(terms: CampaignTerms | null, debounceMs: number): AsyncState<Preview> {
  return useAsync(
    (signal) => {
      if (terms === null) throw new RangeError("usePreview has no terms to preview");
      return apiFetch("campaignPreview", { body: terms, signal });
    },
    [JSON.stringify(terms)],
    { debounceMs, enabled: terms !== null },
  );
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
