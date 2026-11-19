import type { CampaignDetail } from "@winz/shared";

import { LIVE_SLOW_AFTER_MS } from "./launch-wait";

export { LIVE_SLOW_AFTER_MS };

/**
 * How long M8 asks for the campaign before it stops: five minutes, well past the minute after
 * which it says that the wait is unusual. Past that, polling every 1.5 seconds no longer helps the
 * merchant: the screen says where the promo is (its page in the merchant space, which keeps it
 * whatever its state) and asks again only when the merchant taps « Check again ».
 */
export const LIVE_GIVE_UP_AFTER_MS = 5 * 60_000;

/**
 * What M8 shows for the campaign it was opened for:
 *
 * - `waiting`, `slow`, `gaveUp`: not live yet (`funding`, or no answer yet), by how long M8 has
 *   been waiting. Only `waiting` and `slow` keep asking.
 * - `live`: on sale or paused for now (`live`, `paused`) with its link: the QR code and the link.
 * - `cancelled`: the game was cancelled (`void`). Not a failed creation: the promo went live and
 *   its game did not happen.
 * - `refunded`: paid, but it could never go live (the game closed or settled first): the engine
 *   refunded the budget and closed it (`closed` with no `liveAt`).
 * - `ended`: it went live and its sales are over (`sales_closed`, `settled_yes`, `settled_no`,
 *   `closed`): not "live" any more.
 * - `failed`: a `draft`, which never had a payment (no route writes one today).
 */
export type LaunchStage =
  "waiting" | "slow" | "gaveUp" | "live" | "cancelled" | "refunded" | "ended" | "failed";

export type LaunchCampaign = Pick<CampaignDetail, "status" | "slug" | "url" | "liveAt">;

/** Not live yet: by how long M8 has been waiting (since it opened, or since « Check again »). */
function waitingStage(waitedMs: number): LaunchStage {
  if (waitedMs >= LIVE_GIVE_UP_AFTER_MS) return "gaveUp";
  if (waitedMs >= LIVE_SLOW_AFTER_MS) return "slow";
  return "waiting";
}

/** Pure: the campaign as last read (`null` before any answer), and how long M8 has waited. */
export function launchStage(campaign: LaunchCampaign | null, waitedMs: number): LaunchStage {
  if (campaign === null) return waitingStage(waitedMs);
  switch (campaign.status) {
    case "draft":
      return "failed";
    case "funding":
      return waitingStage(waitedMs);
    case "live":
    case "paused":
      // Its link is written in the same transaction that puts it live; without it, keep waiting.
      return campaign.slug !== null && campaign.url !== null ? "live" : waitingStage(waitedMs);
    case "void":
      return "cancelled";
    case "closed":
      return campaign.liveAt === null ? "refunded" : "ended";
    case "sales_closed":
    case "settled_yes":
    case "settled_no":
      return "ended";
  }
}

/** Whether M8 should ask for the campaign again after this answer. */
export function keepsAsking(stage: LaunchStage): boolean {
  return stage === "waiting" || stage === "slow";
}
