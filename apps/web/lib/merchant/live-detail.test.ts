import { apiExamples, type CampaignDetail } from "@winz/shared";
import { describe, expect, it } from "vitest";

import { campaignRowFrom, type PushedCampaign } from "../realtime/live-campaign";

import {
  DETAIL_FALLBACK_POLL_MS,
  DETAIL_POLL_MS,
  detailPollMs,
  isStale,
  mergeLiveCampaign,
  needsReread,
  pushIsNewer,
  shownChance,
} from "./live-detail";

/** The live example of the API: 12 sales, $144 of exposure, 66.67% covered, selling. */
const API: CampaignDetail = apiExamples.campaignDetailExamples.live;
const API_AT = 1_000;
/** The public slug of the example, which a pushed row must carry to be about this promo. */
const SLUG = API.slug ?? "";
/** Before the sales close of the example (2026-11-21T20:25Z). */
const NOW = Date.parse("2026-11-21T19:00:00.000Z");

function push(patch: Record<string, unknown>, receivedAt: number): PushedCampaign {
  const row = campaignRowFrom(
    {
      slug: SLUG,
      sale_state: "open",
      sales: 12,
      exposure: 144000000,
      hedged_bps: 6667,
      outcome: null,
      updated_at: "2026-11-21T19:00:00+00:00",
      ...patch,
    },
    typeof patch.slug === "string" ? patch.slug : SLUG,
  );
  if (row === null) throw new Error("fixture row refused");
  return { row, receivedAt };
}

describe("mergeLiveCampaign", () => {
  it("takes sales, exposure, coverage and sale state from a newer pushed row", () => {
    const pushed = push(
      { sales: 13, exposure: 156000000, hedged_bps: 6154, sale_state: "paused_price" },
      500,
    );
    const merged = mergeLiveCampaign(API, API_AT, pushed, NOW);
    expect(merged).toEqual({
      ...API,
      sales: 13,
      exposure: "156000000",
      hedgedBps: 6154,
      saleState: "paused_price",
    });
    // Only the API says these: they stay what it answered until it is asked again.
    expect(merged.revenue).toBe(API.revenue);
    expect(merged.received).toBe(API.received);
    expect(merged.pending).toBe(API.pending);
    expect(merged.status).toBe(API.status);
    expect(needsReread(API, API_AT, pushed)).toBe(true);
  });

  it("never shows a pushed row older than the API answer", () => {
    // Fewer sales than the API counted: the row was written before the API read.
    const behind = push({ sales: 11, exposure: 132000000, hedged_bps: 9000 }, 5_000);
    expect(pushIsNewer(API, API_AT, behind)).toBe(false);
    expect(mergeLiveCampaign(API, API_AT, behind, NOW)).toBe(API);
    expect(needsReread(API, API_AT, behind)).toBe(false);
    // Same sales, but it reached the screen before the API answer did.
    const earlier = push({ sale_state: "paused_manual", hedged_bps: 9000 }, API_AT - 1);
    expect(mergeLiveCampaign(API, API_AT, earlier, NOW)).toBe(API);
    // No result in the row while the API already has one.
    const settled = { ...API, outcome: "no" as const, status: "settled_no" as const };
    const beforeResult = push({ sales: 12 }, 5_000);
    expect(mergeLiveCampaign(settled, API_AT, beforeResult, NOW)).toBe(settled);
  });

  it("at equal sales, takes the row that arrived after the API answer", () => {
    const later = push({ sale_state: "paused_manual", hedged_bps: 7000 }, API_AT + 1);
    expect(mergeLiveCampaign(API, API_AT, later, NOW)).toMatchObject({
      sales: 12,
      saleState: "paused_manual",
      hedgedBps: 7000,
    });
  });

  it("drops the row of another campaign", () => {
    const other = push(
      { slug: "buzzballs-shop-pittsburgh-wins", sales: 40, exposure: 480000000 },
      5_000,
    );
    expect(pushIsNewer(API, API_AT, other)).toBe(false);
    expect(mergeLiveCampaign(API, API_AT, other, NOW)).toBe(API);
    expect(
      mergeLiveCampaign({ ...API, slug: null }, API_AT, push({ sales: 13 }, 5_000), NOW),
    ).toEqual({ ...API, slug: null });
  });

  it("is the API answer alone when nothing was pushed (socket down, malformed rows dropped)", () => {
    expect(mergeLiveCampaign(API, API_AT, null, NOW)).toBe(API);
    expect(campaignRowFrom({ slug: SLUG, sales: "13" }, SLUG)).toBeNull();
  });

  it("reads a result in the row as newer, and asks the API for the status and the report", () => {
    const result = push({ outcome: "void", sale_state: "closed" }, 5_000);
    expect(pushIsNewer(API, API_AT, result)).toBe(true);
    expect(mergeLiveCampaign(API, API_AT, result, NOW).saleState).toBe("closed");
    expect(mergeLiveCampaign(API, API_AT, result, NOW).status).toBe("live");
    expect(needsReread(API, API_AT, result)).toBe(true);
  });

  it("reads the sale state as closed once sales close, as the API does", () => {
    const pushed = push({ sales: 13, exposure: 156000000 }, 5_000);
    const after = Date.parse(API.salesCloseAt);
    expect(mergeLiveCampaign(API, API_AT, pushed, after).saleState).toBe("closed");
  });

  it("asks the API again for a newer row that only carries a new sale", () => {
    // The row has the count and the exposure; the gross sales, received and pending figures of
    // the same screen only come from the API, and must not lag behind the count.
    expect(needsReread(API, API_AT, push({ sales: API.sales + 1 }, API_AT + 1))).toBe(true);
    expect(needsReread(API, API_AT, push({ exposure: 999_000_000 }, API_AT + 1))).toBe(true);
  });

  it("does not ask again for a newer row that changes nothing the API said", () => {
    expect(needsReread(API, API_AT, push({}, API_AT + 1))).toBe(false);
    expect(needsReread(API, API_AT, push({ hedged_bps: 7000 }, API_AT + 1))).toBe(false);
  });
});

describe("the polling of the detail", () => {
  it("asks every 2 seconds without the live feed, so a sale shows within 3 seconds", () => {
    expect(detailPollMs(false)).toBe(DETAIL_FALLBACK_POLL_MS);
    expect(DETAIL_FALLBACK_POLL_MS).toBeLessThan(3000);
    expect(detailPollMs(true)).toBe(DETAIL_POLL_MS);
  });
});

describe("stale figures", () => {
  it("are the ones kept after a failed read", () => {
    expect(isStale(true, new Error("offline"))).toBe(true);
    expect(isStale(true, null)).toBe(false);
    // Nothing on screen yet: the error screen shows, not stale figures.
    expect(isStale(false, new Error("offline"))).toBe(false);
  });

  it("hide the live chance (« updating ») instead of an old one", () => {
    expect(shownChance(1200, true, false)).toBe(1200);
    expect(shownChance(1200, true, true)).toBeNull();
    expect(shownChance(1200, false, false)).toBeNull();
    expect(shownChance(null, true, false)).toBeNull();
  });
});
