import { describe, expect, it } from "vitest";

import { newestOdds } from "./use-live-odds";

describe("newestOdds: the newest of the API's answer and the pushed quote", () => {
  it("shows the API's answer while nothing was pushed", () => {
    expect(newestOdds(1200, 1000, null)).toBe(1200);
    expect(newestOdds(null, 1000, null)).toBeNull();
  });

  it("shows a quote pushed after the answer, a pushed « no quote » included", () => {
    expect(newestOdds(1200, 1000, { bps: 1500, at: 2000 })).toBe(1500);
    expect(newestOdds(1200, 1000, { bps: null, at: 2000 })).toBeNull();
  });

  it("replaces a pushed quote with a newer answer, even one with the same figure as before", () => {
    // The API said 12% at t=1000, the feed pushed 15% at t=2000, the API says 12% again at t=3000:
    // 12% is the newest.
    expect(newestOdds(1200, 3000, { bps: 1500, at: 2000 })).toBe(1200);
  });

  it("keeps the pushed quote when the caller gives no time for its answers", () => {
    expect(newestOdds(1200, null, { bps: 1500, at: 2000 })).toBe(1500);
  });
});
