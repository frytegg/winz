import { describe, expect, it } from "vitest";

import { PaperVenue, VenueNotImplementedError, createVenue } from "./index";
import { FakeClock, silentLogger } from "./test-support";

describe("createVenue", () => {
  const deps = { clock: new FakeClock(0), logger: silentLogger() };

  it("returns the paper venue for paper", () => {
    const venue = createVenue("paper", deps);
    expect(venue).toBeInstanceOf(PaperVenue);
    expect(venue.name).toBe("paper");
  });

  it.each(["gemini-sandbox", "gemini"] as const)(
    "refuses %s with an error naming task H-07",
    (name) => {
      expect(() => createVenue(name, deps)).toThrow(VenueNotImplementedError);
      expect(() => createVenue(name, deps)).toThrow(/H-07/);
    },
  );
});
