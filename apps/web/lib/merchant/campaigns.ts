import type { CampaignStatus, CampaignSummary } from "@winz/shared";

/** The two tabs of the promo list (SCREENS, MC). */
export type ListTab = "inProgress" | "closed";

const IN_PROGRESS: ReadonlySet<CampaignStatus> = new Set([
  "draft",
  "funding",
  "live",
  "paused",
  "sales_closed",
]);

export function listTab(status: CampaignStatus): ListTab {
  return IN_PROGRESS.has(status) ? "inProgress" : "closed";
}

/** A promo that is on sale or temporarily not: the ones the home screen shows (MH, "Active promos"). */
export function isActivePromo(status: CampaignStatus): boolean {
  return status === "live" || status === "paused";
}

/** Whether the campaign can still change: the budget can be topped up and the sales controlled. */
export function isRunning(status: CampaignStatus): boolean {
  return status === "live" || status === "paused";
}

/** Soonest game first for what is in progress, most recent first for what is over. */
export function orderForTab(
  campaigns: readonly CampaignSummary[],
  tab: ListTab,
): CampaignSummary[] {
  const inTab = campaigns.filter((campaign) => listTab(campaign.status) === tab);
  const direction = tab === "inProgress" ? 1 : -1;
  return inTab.sort(
    (a, b) => direction * (new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
  );
}

/**
 * How long an unpaid promo stays on the list. M7 creates the campaign (`funding`) before the
 * budget is paid; if the merchant closes the screen it stays `funding` for good, because the back end
 * never expires it. After this long it is a promo nobody is going to pay, not one going live.
 */
export const FUNDING_GRACE_MS = 15 * 60 * 1000;

/** A `funding` promo created longer ago than the grace period: its budget was never paid. */
export function isStaleFunding(campaign: CampaignSummary, now: Date): boolean {
  if (campaign.status !== "funding") return false;
  const createdAt = new Date(campaign.createdAt).getTime();
  return !Number.isNaN(createdAt) && now.getTime() - createdAt > FUNDING_GRACE_MS;
}

/** The promos worth showing: every one but the unpaid ones that are past the grace period. */
export function visibleCampaigns(
  campaigns: readonly CampaignSummary[],
  now: Date,
): CampaignSummary[] {
  return campaigns.filter((campaign) => !isStaleFunding(campaign, now));
}

/** The statuses whose countdown still means something: after the whistle, "Sales close in" is over. */
export function showsCountdown(status: CampaignStatus): boolean {
  return status === "live" || status === "paused";
}
