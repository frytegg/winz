import { SALE_STATES } from "@winz/shared";
import { describe, expect, it } from "vitest";

import {
  MARKET_RETRY_CAP_MS,
  MARKET_RETRY_MS,
  isMarketWarming,
  marketWatch,
  shouldRetryPreview,
} from "./market-watch";

describe("the market of a game that is warming up", () => {
  it("is asked about every 3 seconds, for about a minute", () => {
    expect(MARKET_RETRY_MS).toBe(3000);
    expect(MARKET_RETRY_CAP_MS).toBe(60_000);
  });

  it("only waits for a market with no book or a stale one", () => {
    expect(isMarketWarming("paused_depth")).toBe(true);
    expect(isMarketWarming("paused_stale")).toBe(true);
    for (const state of SALE_STATES) {
      if (state === "paused_depth" || state === "paused_stale") continue;
      expect(isMarketWarming(state)).toBe(false);
    }
  });

  it("asks again while the time allowed is not used up, and stops at the cap", () => {
    expect(shouldRetryPreview("paused_depth", 0)).toBe(true);
    expect(shouldRetryPreview("paused_depth", MARKET_RETRY_CAP_MS - 1)).toBe(true);
    expect(shouldRetryPreview("paused_depth", MARKET_RETRY_CAP_MS)).toBe(false);
  });

  it("never asks again for a state that waiting cannot change", () => {
    expect(shouldRetryPreview("open", 0)).toBe(false);
    expect(shouldRetryPreview("paused_price", 0)).toBe(false);
    expect(shouldRetryPreview("paused_budget", 0)).toBe(false);
  });

  it("tells ready, waiting and gave up apart", () => {
    expect(marketWatch("open", 0)).toBe("ready");
    expect(marketWatch("paused_price", 10 * MARKET_RETRY_CAP_MS)).toBe("ready");
    expect(marketWatch("paused_depth", 5000)).toBe("waiting");
    expect(marketWatch("paused_depth", MARKET_RETRY_CAP_MS)).toBe("gave_up");
  });
});
