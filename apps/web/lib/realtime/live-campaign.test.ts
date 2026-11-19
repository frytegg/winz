import { describe, expect, it } from "vitest";

import { campaignRowFrom, newerPush, type PushedCampaign } from "./live-campaign";

/** A row exactly as Realtime pushes it: bigint as a JSON number, timestamp with an offset. */
function pushedRow(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: "joes-texas",
    sale_state: "open",
    sales: 13,
    exposure: 260000000,
    hedged_bps: 6154,
    outcome: null,
    updated_at: "2026-11-21T19:00:01.123456+00:00",
    ...patch,
  };
}

describe("campaignRowFrom", () => {
  it("reads a pushed row of this campaign, money as the API's string", () => {
    expect(campaignRowFrom(pushedRow(), "joes-texas")).toEqual({
      slug: "joes-texas",
      sale_state: "open",
      sales: 13,
      exposure: "260000000",
      hedged_bps: 6154,
      outcome: null,
      updated_at: "2026-11-21T19:00:01.123456+00:00",
    });
  });

  it("drops the row of another campaign", () => {
    expect(campaignRowFrom(pushedRow({ slug: "joes-pitt" }), "joes-texas")).toBeNull();
  });

  it("drops a malformed row instead of showing it", () => {
    for (const patch of [
      { sales: "13" },
      { exposure: -1 },
      { sale_state: "selling" },
      { outcome: "maybe" },
      { updated_at: "yesterday" },
      { hedged_bps: null },
    ]) {
      expect(campaignRowFrom(pushedRow(patch), "joes-texas"), JSON.stringify(patch)).toBeNull();
    }
    expect(campaignRowFrom(null, "joes-texas")).toBeNull();
    expect(campaignRowFrom("joes-texas", "joes-texas")).toBeNull();
  });
});

describe("newerPush", () => {
  function push(updatedAt: string, receivedAt: number): PushedCampaign {
    const row = campaignRowFrom(pushedRow({ updated_at: updatedAt }), "joes-texas");
    if (row === null) throw new Error("fixture");
    return { row, receivedAt };
  }

  it("takes the first row", () => {
    const first = push("2026-11-21T19:00:01+00:00", 10);
    expect(newerPush(null, first)).toBe(first);
  });

  it("keeps the newer row when an older one arrives late", () => {
    const newer = push("2026-11-21T19:00:05+00:00", 10);
    const late = push("2026-11-21T19:00:01+00:00", 20);
    expect(newerPush(newer, late)).toBe(newer);
    expect(newerPush(late, newer)).toBe(newer);
  });

  it("at the same instant, keeps the one that arrived last", () => {
    const a = push("2026-11-21T19:00:01+00:00", 10);
    const b = push("2026-11-21T19:00:01.000+00:00", 20);
    expect(newerPush(a, b)).toBe(b);
  });
});
