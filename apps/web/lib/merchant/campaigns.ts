import type { CampaignStatus, CampaignSummary, Sport } from "@winz/shared";

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

const SPORT_BY_LEAGUE: Record<string, Sport> = {
  NFL: "football",
  NCAAF: "football",
  NBA: "basketball",
  WNBA: "basketball",
  NCAAB: "basketball",
  NHL: "hockey",
  MLB: "baseball",
  MLS: "soccer",
  EPL: "soccer",
  UCL: "soccer",
  LALIGA: "soccer",
};

/**
 * The sport of a campaign, read from the league in its instrument symbol ("GEMI-NCAAF-…" → football).
 * The campaign carries no `sport` (DEMANDES-ALEXANDRE, item 1), so this is a fallback: an unknown
 * league, or no symbol (the list has none), is football, the sport of the first release.
 */
export function sportFromSymbol(symbol: string | null): Sport {
  if (symbol === null) return "football";
  for (const part of symbol.split("-")) {
    const sport = SPORT_BY_LEAGUE[part.toUpperCase()];
    if (sport !== undefined) return sport;
  }
  return "football";
}

/** The statuses whose countdown still means something: after the whistle, "Sales close in" is over. */
export function showsCountdown(status: CampaignStatus): boolean {
  return status === "live" || status === "paused";
}
