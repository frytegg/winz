import type { PublicCampaign } from "@winz/shared";

import { copy } from "@/lib/copy";
import type { PublicCampaignResult } from "@/lib/fan/public-campaign";

/**
 * The poster of a promo (`/poster/<slug>`, 1080 × 1350). It is a public route, like the promo's own
 * page, so it carries nothing the page does not already show: the promise, the venue's name, the game
 * and the link as a QR code. No budget, no id, no figure from inside. This module is where that is
 * enforced, in one place that a test pins: the picture is drawn from a `PosterContent`, never from the
 * campaign.
 */
export const POSTER_SIZE = { width: 1080, height: 1350 } as const;

/** The same rule as the API's `slugSchema`: a slug that cannot exist is refused without asking it. */
export const POSTER_SLUG = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

export interface PosterContent {
  promise: string;
  merchantName: string;
  eventTitle: string;
  /** What the QR code opens: the promo's page on the domain that served the poster. */
  link: string;
}

export function posterContent(campaign: PublicCampaign, origin: string): PosterContent {
  return {
    promise: campaign.promise,
    merchantName: campaign.merchant.name,
    eventTitle: campaign.eventTitle,
    link: `${origin}/c/${encodeURIComponent(campaign.slug)}`,
  };
}

/** The file a saved poster is called: `winz-<slug>-poster.png`. */
export function posterFilename(slug: string): string {
  return `winz-${POSTER_SLUG.test(slug) ? slug : "promo"}-poster.png`;
}

/**
 * A poster does not change once the promo is published (its promise is fixed; a venue's renamed
 * business shows within the hour). The browser keeps it five minutes, a shared cache an hour and may
 * serve a stale one for a day while it fetches a new one.
 */
export const POSTER_CACHE = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

export interface PosterRefusal {
  status: 404 | 503;
  code: "not_found" | "unavailable";
  message: string;
  cacheControl: string;
}

/** A promo that does not exist: kept a minute, so a crawler guessing slugs does not reach the API every time. */
const NOT_FOUND: PosterRefusal = {
  status: 404,
  code: "not_found",
  message: copy.poster.notFound,
  cacheControl: "public, max-age=60, s-maxage=60",
};

/** The API being down: nothing may keep this, so the next try gets a real answer. */
export const POSTER_UNAVAILABLE: PosterRefusal = {
  status: 503,
  code: "unavailable",
  message: copy.poster.unavailable,
  cacheControl: "no-store",
};

/**
 * Why there is no poster, or `null` when there is one. Called twice: with the slug alone, before the
 * API is asked (a slug that cannot exist is refused without a request), then with the API's answer.
 */
export function posterRefusal(slug: string, result?: PublicCampaignResult): PosterRefusal | null {
  if (!POSTER_SLUG.test(slug) || result?.kind === "not_found") return NOT_FOUND;
  if (result?.kind === "error") return POSTER_UNAVAILABLE;
  return null;
}
