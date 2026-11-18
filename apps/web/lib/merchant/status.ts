import type { CampaignStatus } from "@winz/shared";

import { copy } from "@/lib/copy";

/** The badge of a campaign: "Live campaign" while it sells (as on the mockups), else its status. */
export function statusBadge(status: CampaignStatus): string {
  return status === "live" ? copy.campaigns.liveBadge : copy.campaigns.status[status];
}

/** Whether the badge's dot pulses: only a promo that is on sale. */
export function isPulsing(status: CampaignStatus): boolean {
  return status === "live";
}
