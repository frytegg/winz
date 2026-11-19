import { CAMPAIGN_STATUSES, apiExamples, type CampaignStatus } from "@winz/shared";
import { describe, expect, it } from "vitest";

import {
  LIVE_GIVE_UP_AFTER_MS,
  LIVE_SLOW_AFTER_MS,
  keepsAsking,
  launchStage,
  type LaunchCampaign,
  type LaunchStage,
} from "./launch-state";
import { FUNDING_GRACE_MS } from "./campaigns";

const live = apiExamples.campaignDetailExamples.live;
const notLiveYet: LaunchCampaign = { status: "funding", slug: null, url: null, liveAt: null };

function withStatus(status: CampaignStatus, patch: Partial<LaunchCampaign> = {}): LaunchCampaign {
  return { status, slug: live.slug, url: live.url, liveAt: live.liveAt, ...patch };
}

describe("M8's wait for a promo that is not live yet", () => {
  it("waits, then says it is slow after a minute, then stops after the bound", () => {
    expect(launchStage(notLiveYet, 0)).toBe("waiting");
    expect(launchStage(notLiveYet, LIVE_SLOW_AFTER_MS - 1)).toBe("waiting");
    expect(launchStage(notLiveYet, LIVE_SLOW_AFTER_MS)).toBe("slow");
    expect(launchStage(notLiveYet, LIVE_GIVE_UP_AFTER_MS - 1)).toBe("slow");
    expect(launchStage(notLiveYet, LIVE_GIVE_UP_AFTER_MS)).toBe("gaveUp");
  });

  it("does the same before the first answer (no answer, or the reads fail)", () => {
    expect(launchStage(null, 0)).toBe("waiting");
    expect(launchStage(null, LIVE_SLOW_AFTER_MS)).toBe("slow");
    expect(launchStage(null, LIVE_GIVE_UP_AFTER_MS)).toBe("gaveUp");
  });

  it("asks again only while it waits: the bound stops the reads", () => {
    expect(keepsAsking("waiting")).toBe(true);
    expect(keepsAsking("slow")).toBe(true);
    const stops: LaunchStage[] = ["gaveUp", "live", "cancelled", "refunded", "ended", "failed"];
    for (const stage of stops) expect(keepsAsking(stage)).toBe(false);
  });

  it("gives up before the promo list stops showing an unpaid-looking promo", () => {
    expect(LIVE_SLOW_AFTER_MS).toBeLessThan(LIVE_GIVE_UP_AFTER_MS);
    expect(LIVE_GIVE_UP_AFTER_MS).toBeLessThan(FUNDING_GRACE_MS);
  });
});

describe("M8 for each status the API can answer", () => {
  it("opens a live or paused promo with its link", () => {
    expect(launchStage(withStatus("live"), 0)).toBe("live");
    expect(launchStage(withStatus("paused"), LIVE_GIVE_UP_AFTER_MS)).toBe("live");
  });

  it("keeps waiting for a live promo whose link is not there yet", () => {
    expect(launchStage(withStatus("live", { slug: null, url: null }), 0)).toBe("waiting");
  });

  it("says a cancelled game (void) is cancelled, not a failed creation", () => {
    expect(launchStage(withStatus("void"), 0)).toBe("cancelled");
  });

  it("tells a promo refunded before it could go live from one whose sales are over", () => {
    expect(launchStage(withStatus("closed", { slug: null, url: null, liveAt: null }), 0)).toBe(
      "refunded",
    );
    expect(launchStage(withStatus("closed"), 0)).toBe("ended");
    expect(launchStage(withStatus("sales_closed"), 0)).toBe("ended");
    expect(launchStage(withStatus("settled_yes"), 0)).toBe("ended");
    expect(launchStage(withStatus("settled_no"), 0)).toBe("ended");
  });

  it("keeps a draft, which never had a payment, as a failed creation", () => {
    expect(launchStage(withStatus("draft", { slug: null, url: null, liveAt: null }), 0)).toBe(
      "failed",
    );
  });

  it("has an answer for every status of the API", () => {
    for (const status of CAMPAIGN_STATUSES) {
      expect(typeof launchStage(withStatus(status), 0)).toBe("string");
    }
  });
});
