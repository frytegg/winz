import type { CampaignStatus, Outcome } from "@winz/shared";

import { copy } from "@/lib/copy";

/** The badge of a campaign: "Live campaign" while it sells (as on the mockups), else its status. */
export function statusBadge(status: CampaignStatus): string {
  return status === "live" ? copy.campaigns.liveBadge : copy.campaigns.status[status];
}

/** Whether the badge's dot pulses: only a promo that is on sale. */
export function isPulsing(status: CampaignStatus): boolean {
  return status === "live";
}

/** How a settled promo ended: the promo hit, it did not, or the game was cancelled (VOID). */
export type PromoResult = "won" | "lost" | "cancelled";

/**
 * The result of a promo, from its status, or from its outcome while the status has not caught up
 * yet; `null` before the game is settled. A cancelled game is its own result, never a lost promo.
 */
export function promoResult(status: CampaignStatus, outcome: Outcome | null): PromoResult | null {
  if (status === "settled_yes") return "won";
  if (status === "settled_no") return "lost";
  if (status === "void") return "cancelled";
  if (outcome === "yes") return "won";
  if (outcome === "no") return "lost";
  if (outcome === "void") return "cancelled";
  return null;
}

/** The words of the after-the-game report for a result: its badge and what it means. */
export function resultWords(result: PromoResult): { badge: string; body: string } {
  const t = copy.campaignDetail.report;
  switch (result) {
    case "won":
      return { badge: t.won, body: t.wonBody };
    case "lost":
      return { badge: t.lost, body: t.lostBody };
    case "cancelled":
      return { badge: t.cancelled, body: t.cancelledBody };
  }
}
