import type { CampaignSummary } from "@winz/shared";
import { describe, expect, it } from "vitest";

import { budgetUsedTenths, formatBpsOneDecimal, formatTenths } from "./budget";
import { listTab, orderForTab, sportFromSymbol } from "./campaigns";
import { appendPoint, axisMaxPercent, MIN_GAP_MS } from "./odds-history";
import { allTimeTotals, averageSale, inPeriod, shareBps, totalsFor } from "./stats";

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

  it("reads the sport from the league of the symbol, football by default", () => {
    expect(sportFromSymbol("GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13")).toBe("football");
    expect(sportFromSymbol("GEMI-NBA-2611212030-LAL-BOS-M")).toBe("basketball");
    expect(sportFromSymbol("GEMI-NHL-X")).toBe("hockey");
    expect(sportFromSymbol("GEMI-UNKNOWN-X")).toBe("football");
    expect(sportFromSymbol(null)).toBe("football");
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

  it("sums revenue and sales of the campaigns that sold, in the period", () => {
    const campaigns = [
      summary({
        startsAt: new Date(2026, 10, 20, 12).toISOString(),
        revenue: "240000000",
        sales: 12,
      }),
      summary({
        status: "settled_no",
        startsAt: new Date(2026, 10, 2, 12).toISOString(),
        revenue: "620000000",
        sales: 31,
      }),
      summary({
        status: "funding",
        startsAt: new Date(2026, 10, 20, 12).toISOString(),
        revenue: "5000000",
        sales: 1,
      }),
      summary({
        status: "void",
        startsAt: new Date(2026, 10, 20, 12).toISOString(),
        revenue: "9000000",
        sales: 2,
      }),
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
