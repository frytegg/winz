import { describe, expect, it } from "vitest";

import { copy } from "../copy";

import { promoResult, resultWords, statusBadge } from "./status";

/**
 * Every outcome the API can answer (`settled_yes`, `settled_no`, `void`, with `outcome` yes, no,
 * void) has its own words, in the list and the detail (the badge) and in the report: a cancelled
 * game is never told as a lost promo.
 */
describe("the result of a promo", () => {
  it("won: the promo hit", () => {
    expect(promoResult("settled_yes", "yes")).toBe("won");
    expect(statusBadge("settled_yes")).toBe("Refunded");
    expect(resultWords("won")).toEqual({
      badge: copy.campaignDetail.report.won,
      body: copy.campaignDetail.report.wonBody,
    });
  });

  it("lost: the promo did not hit, which the merchant reads as « No refunds », never « Lost »", () => {
    expect(promoResult("settled_no", "no")).toBe("lost");
    // The good outcome for the merchant: nobody was refunded and every sale is his.
    expect(statusBadge("settled_no")).toBe("No refunds");
    expect(resultWords("lost")).toEqual({
      badge: copy.campaignDetail.report.lost,
      body: copy.campaignDetail.report.lostBody,
    });
    expect(resultWords("lost").badge).toBe("No refunds");
    for (const word of [statusBadge("settled_no"), resultWords("lost").badge]) {
      expect(word).not.toMatch(/\blost\b/i);
    }
    // The fan's side keeps its own words.
    expect(copy.ticket.phases.not_this_time).toBe("Not this time");
  });

  it("cancelled: the game did not count, and it is not a lost promo", () => {
    expect(promoResult("void", "void")).toBe("cancelled");
    expect(statusBadge("void")).toBe("Cancelled");
    expect(resultWords("cancelled")).toEqual({
      badge: copy.campaignDetail.report.cancelled,
      body: copy.campaignDetail.report.cancelledBody,
    });
    expect(resultWords("cancelled").badge).not.toBe(copy.campaignDetail.report.lost);
    expect(resultWords("cancelled").body).not.toBe(copy.campaignDetail.report.lostBody);
  });

  it("reads the outcome while the status has not caught up yet", () => {
    expect(promoResult("sales_closed", "yes")).toBe("won");
    expect(promoResult("sales_closed", "no")).toBe("lost");
    expect(promoResult("sales_closed", "void")).toBe("cancelled");
  });

  it("has no result before the game is settled", () => {
    for (const status of [
      "draft",
      "funding",
      "live",
      "paused",
      "sales_closed",
      "closed",
    ] as const) {
      expect(promoResult(status, null), status).toBeNull();
    }
  });
});
