import { describe, expect, it } from "vitest";

import {
  GeminiOrderVenue,
  MemoryOrderLinkStore,
  PaperVenue,
  VenueInputError,
  VenueNotAllowedError,
  createVenue,
} from "./index";
import type { GeminiOrderApi } from "./index";
import { FakeClock, silentLogger } from "./test-support";

describe("createVenue", () => {
  const deps = { clock: new FakeClock(0), logger: silentLogger() };
  const unusedClient: GeminiOrderApi = {
    placeOrder: () => Promise.reject(new Error("not called")),
    cancelOrder: () => Promise.reject(new Error("not called")),
    allActiveOrders: () => Promise.reject(new Error("not called")),
    orderHistory: () => Promise.reject(new Error("not called")),
  };

  it("returns the paper venue for paper", () => {
    const venue = createVenue("paper", deps);
    expect(venue).toBeInstanceOf(PaperVenue);
    expect(venue.name).toBe("paper");
  });

  it("returns the real Gemini adapter for gemini-sandbox, labelled as real orders", () => {
    const venue = createVenue("gemini-sandbox", {
      ...deps,
      gemini: { client: unusedClient, links: new MemoryOrderLinkStore() },
    });
    expect(venue).toBeInstanceOf(GeminiOrderVenue);
    expect(venue.name).toBe("gemini-sandbox");
    // The label the web app shows for this venue (apps/web/lib/server/hedge-desk.ts), word for word.
    expect(venue.describe().label).toBe("GEMINI SANDBOX · test orders");
  });

  it("refuses gemini-sandbox without its client, naming the two keys", () => {
    expect(() => createVenue("gemini-sandbox", deps)).toThrow(VenueInputError);
    expect(() => createVenue("gemini-sandbox", deps)).toThrow(/GEMINI_SANDBOX_API_KEY/);
  });

  it("refuses Gemini production on purpose, even with a client", () => {
    const withClient = {
      ...deps,
      gemini: { client: unusedClient, links: new MemoryOrderLinkStore() },
    };
    expect(() => createVenue("gemini", withClient)).toThrow(VenueNotAllowedError);
    expect(() => createVenue("gemini", withClient)).toThrow(/read-only/);
  });
});
