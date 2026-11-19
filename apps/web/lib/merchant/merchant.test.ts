import type { CampaignSummary } from "@winz/shared";
import { describe, expect, it } from "vitest";

import { budgetUsedTenths, formatBpsOneDecimal, formatTenths } from "./budget";
import {
  FUNDING_GRACE_MS,
  isStaleFunding,
  listTab,
  orderForTab,
  visibleCampaigns,
} from "./campaigns";
import { appendPoint, axisMaxPercent, MIN_GAP_MS } from "./odds-history";
import { allTimeTotals, averageSale, inPeriod, launchedAt, shareBps, totalsFor } from "./stats";

function summary(overrides: Partial<CampaignSummary>): CampaignSummary {
  return {
    id: "cmp_1",
    slug: "joes",
    product: "Large pizza",
    promise: "100% back if Texas wins",
    status: "live",
    saleState: "open",
    eventTitle: "Arkansas vs Texas",
    event: {
      sport: "football",
      league: "NCAAF",
      home: { name: "Texas", abbreviation: "TEX", logoUrl: null },
      away: { name: "Arkansas", abbreviation: "ARK", logoUrl: null },
    },
    startsAt: "2026-11-21T20:30:00.000Z",
    salesCloseAt: "2026-11-21T20:25:00.000Z",
    sales: 10,
    revenue: "200000000",
    createdAt: "2026-11-18T18:00:00.000Z",
    liveAt: "2026-11-18T18:01:00.000Z",
    ...overrides,
  };
}

describe("the promo list", () => {
  it("splits the statuses as the spec does", () => {
    expect(listTab("draft")).toBe("inProgress");
    expect(listTab("funding")).toBe("inProgress");
    expect(listTab("live")).toBe("inProgress");
    expect(listTab("paused")).toBe("inProgress");
    expect(listTab("sales_closed")).toBe("inProgress");
    expect(listTab("settled_yes")).toBe("closed");
    expect(listTab("settled_no")).toBe("closed");
    expect(listTab("void")).toBe("closed");
    expect(listTab("closed")).toBe("closed");
  });

  it("orders what is in progress soonest first and what is over latest first, without mutating", () => {
    const input = [
      summary({ id: "late", startsAt: "2026-11-23T00:00:00.000Z" }),
      summary({ id: "soon", startsAt: "2026-11-21T00:00:00.000Z" }),
      summary({ id: "old", status: "settled_no", startsAt: "2026-11-10T00:00:00.000Z" }),
      summary({ id: "older", status: "settled_yes", startsAt: "2026-11-01T00:00:00.000Z" }),
    ];
    const before = input.map((c) => c.id);
    expect(orderForTab(input, "inProgress").map((c) => c.id)).toEqual(["soon", "late"]);
    expect(orderForTab(input, "closed").map((c) => c.id)).toEqual(["old", "older"]);
    expect(input.map((c) => c.id)).toEqual(before);
  });
});

describe("a promo that was never paid", () => {
  const now = new Date("2026-11-20T22:00:00.000Z");
  const minutesAgo = (minutes: number): string =>
    new Date(now.getTime() - minutes * 60_000).toISOString();

  it("is hidden once its creation is older than the grace period, and only if it is funding", () => {
    expect(FUNDING_GRACE_MS).toBe(15 * 60_000);
    const fresh = summary({ status: "funding", liveAt: null, createdAt: minutesAgo(3) });
    const stale = summary({ status: "funding", liveAt: null, createdAt: minutesAgo(16) });
    const justInside = summary({ status: "funding", liveAt: null, createdAt: minutesAgo(15) });
    expect(isStaleFunding(fresh, now)).toBe(false);
    expect(isStaleFunding(justInside, now)).toBe(false);
    expect(isStaleFunding(stale, now)).toBe(true);
    // Old, but live: never hidden, whatever its age.
    expect(isStaleFunding(summary({ status: "live", createdAt: minutesAgo(5000) }), now)).toBe(
      false,
    );
  });

  it("is kept when its creation date is not readable", () => {
    expect(isStaleFunding(summary({ status: "funding", createdAt: "soon" }), now)).toBe(false);
  });

  it("is dropped from the list and everything else stays, in order", () => {
    const list = [
      summary({ id: "a", status: "funding", liveAt: null, createdAt: minutesAgo(40) }),
      summary({ id: "b", status: "funding", liveAt: null, createdAt: minutesAgo(2) }),
      summary({ id: "c", status: "live" }),
    ];
    expect(visibleCampaigns(list, now).map((campaign) => campaign.id)).toEqual(["b", "c"]);
    expect(list).toHaveLength(3);
  });
});

describe("the statistics", () => {
  // Wednesday 18 November 2026, local time.
  const now = new Date(2026, 10, 18, 15, 0, 0);

  it("filters by today, week (Sunday to Saturday) and month in local time", () => {
    expect(inPeriod(new Date(2026, 10, 18, 9).toISOString(), "today", now)).toBe(true);
    expect(inPeriod(new Date(2026, 10, 19, 9).toISOString(), "today", now)).toBe(false);
    expect(inPeriod(new Date(2026, 10, 15, 9).toISOString(), "week", now)).toBe(true);
    expect(inPeriod(new Date(2026, 10, 21, 23).toISOString(), "week", now)).toBe(true);
    expect(inPeriod(new Date(2026, 10, 22, 0, 30).toISOString(), "week", now)).toBe(false);
    expect(inPeriod(new Date(2026, 10, 14, 23).toISOString(), "week", now)).toBe(false);
    expect(inPeriod(new Date(2026, 10, 30, 23).toISOString(), "month", now)).toBe(true);
    expect(inPeriod(new Date(2026, 11, 1, 1).toISOString(), "month", now)).toBe(false);
    expect(inPeriod("not a date", "month", now)).toBe(false);
  });

  it("dates a promo by when it went live, else by its creation, never by the game", () => {
    expect(launchedAt(summary({ createdAt: "2026-11-18T10:00:00.000Z", liveAt: null }))).toBe(
      "2026-11-18T10:00:00.000Z",
    );
    expect(
      launchedAt(
        summary({ createdAt: "2026-11-18T10:00:00.000Z", liveAt: "2026-11-18T10:01:00.000Z" }),
      ),
    ).toBe("2026-11-18T10:01:00.000Z");
  });

  it("sums revenue and sales of the campaigns that sold, in the period", () => {
    // The first one is live since the 17th for a game on the 28th: only the 17th counts.
    const game = new Date(2026, 10, 28, 12).toISOString();
    const at = (day: number): { createdAt: string; liveAt: string } => ({
      createdAt: new Date(2026, 10, day, 11, 59).toISOString(),
      liveAt: new Date(2026, 10, day, 12).toISOString(),
    });
    const campaigns = [
      summary({ startsAt: game, ...at(17), revenue: "240000000", sales: 12 }),
      summary({ status: "settled_no", startsAt: game, ...at(2), revenue: "620000000", sales: 31 }),
      summary({ status: "funding", startsAt: game, ...at(17), revenue: "5000000", sales: 1 }),
      summary({ status: "void", startsAt: game, ...at(17), revenue: "9000000", sales: 2 }),
    ];
    const week = totalsFor(campaigns, "week", now);
    expect(week).toEqual({ grossSales: 240_000_000n, sales: 12, campaigns: 1 });
    const month = totalsFor(campaigns, "month", now);
    expect(month).toEqual({ grossSales: 860_000_000n, sales: 43, campaigns: 2 });
    expect(allTimeTotals(campaigns).sales).toBe(43);
    expect(totalsFor(campaigns, "today", now).campaigns).toBe(0);
  });

  it("averages a sale to the cent and never divides by zero", () => {
    expect(averageSale({ grossSales: 860_000_000n, sales: 43, campaigns: 2 })).toBe(20_000_000n);
    expect(averageSale({ grossSales: 100_000_000n, sales: 3, campaigns: 1 })).toBe(33_330_000n);
    expect(averageSale({ grossSales: 0n, sales: 0, campaigns: 0 })).toBeNull();
  });

  it("gives the share of a part in basis points", () => {
    expect(shareBps(240n, 860n)).toBe(2790);
    expect(shareBps(5n, 0n)).toBe(0);
    expect(shareBps(900n, 100n)).toBe(10_000);
  });
});

describe("the budget", () => {
  it("counts spent plus reserved over the budget, to a tenth of a percent", () => {
    expect(budgetUsedTenths("100000000", "12000000", "1000000000")).toBe(112);
    expect(budgetUsedTenths("0", "0", "1000000000")).toBe(0);
    expect(budgetUsedTenths("0", "0", "0")).toBeNull();
    expect(budgetUsedTenths("2000000000", "0", "1000000000")).toBe(1000);
  });

  it("writes tenths as a percent", () => {
    expect(formatTenths(112)).toBe("11.2%");
    expect(formatTenths(0)).toBe("0.0%");
    expect(formatTenths(1000)).toBe("100.0%");
    expect(formatBpsOneDecimal(1245)).toBe("12.5%");
    expect(formatBpsOneDecimal(590)).toBe("5.9%");
    expect(formatBpsOneDecimal(0)).toBe("0.0%");
  });
});

describe("the odds history", () => {
  it("adds a point once the gap has passed and ignores the quotes in between", () => {
    const first = appendPoint([], { t: 1000, bps: 1200 });
    expect(first).toHaveLength(1);
    expect(appendPoint(first, { t: 1000 + MIN_GAP_MS - 1, bps: 1300 })).toHaveLength(1);
    expect(appendPoint(first, { t: 1000 + MIN_GAP_MS, bps: 1300 })).toHaveLength(2);
  });

  it("keeps the newest points when the cap is reached, without mutating", () => {
    const points = [
      { t: 0, bps: 1 },
      { t: 10_000, bps: 2 },
      { t: 20_000, bps: 3 },
    ];
    const next = appendPoint(points, { t: 30_000, bps: 4 }, MIN_GAP_MS, 3);
    expect(next.map((p) => p.bps)).toEqual([2, 3, 4]);
    expect(points).toHaveLength(3);
  });

  it("puts the top of the axis above the data and the pause line, in steps of 5%", () => {
    expect(axisMaxPercent(1200, 1800)).toBe(20);
    expect(axisMaxPercent(0, 1800)).toBe(20);
    expect(axisMaxPercent(2300, 1800)).toBe(30);
    expect(axisMaxPercent(100, 200)).toBe(10);
  });
});
