import type { CampaignStatus, CampaignSummary } from "@winz/shared";

/** The three periods of the home statistics (MH). */
export type Period = "month" | "week" | "today";

/** A campaign that never sold (not live yet, or cancelled) has nothing to add to the figures. */
export function countsInStats(status: CampaignStatus): boolean {
  return status !== "draft" && status !== "funding" && status !== "void";
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Whether `iso` falls in the period, in the viewer's time zone: today, the current week (Sunday to
 * Saturday, as in the US) or the current calendar month.
 *
 * The campaign has no creation date (DEMANDES-ALEXANDRE, item 6), so callers pass the game's start:
 * a promo opened today for a game next week then counts next week. A fallback, not the real thing.
 */
export function inPeriod(iso: string, period: Period, now: Date): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  if (period === "month") {
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  }
  const today = startOfDay(now);
  const day = startOfDay(date);
  if (period === "today") return day.getTime() === today.getTime();
  const weekStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - today.getDay(),
  );
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7);
  return day.getTime() >= weekStart.getTime() && day.getTime() < weekEnd.getTime();
}

export interface Totals {
  /** Micro-USDC: what customers paid. */
  grossSales: bigint;
  sales: number;
  campaigns: number;
}

function sum(campaigns: readonly CampaignSummary[], keep: (c: CampaignSummary) => boolean): Totals {
  let grossSales = 0n;
  let sales = 0;
  let count = 0;
  for (const campaign of campaigns) {
    if (!countsInStats(campaign.status) || !keep(campaign)) continue;
    grossSales += BigInt(campaign.revenue);
    sales += campaign.sales;
    count += 1;
  }
  return { grossSales, sales, campaigns: count };
}

/** Gross sales (sum of `revenue`) and sales (sum of `sales`) of the campaigns of a period. */
export function totalsFor(
  campaigns: readonly CampaignSummary[],
  period: Period,
  now: Date,
): Totals {
  return sum(campaigns, (campaign) => inPeriod(campaign.startsAt, period, now));
}

/** Every campaign that sold, whatever the date: the figures of the Stats screen. */
export function allTimeTotals(campaigns: readonly CampaignSummary[]): Totals {
  return sum(campaigns, () => true);
}

/** What a sale brings on average, in micro-USDC, cut to the cent; `null` before the first sale. */
export function averageSale(totals: Totals): bigint | null {
  if (totals.sales === 0) return null;
  return (totals.grossSales / 10_000n / BigInt(totals.sales)) * 10_000n;
}

/** Share of `part` in `whole` in basis points (0 to 10 000); 0 when there is no whole. */
export function shareBps(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  const bps = (part * 10_000n) / whole;
  return Number(bps > 10_000n ? 10_000n : bps);
}
