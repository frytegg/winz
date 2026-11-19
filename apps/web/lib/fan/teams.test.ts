import type { CampaignEvent } from "@winz/shared";
import { describe, expect, it } from "vitest";

import { totalMicro } from "./amount";
import { gameFromEvent } from "./teams";

const GAME: CampaignEvent = {
  sport: "football",
  league: "NCAAF",
  home: { name: "Texas Longhorns", abbreviation: "TEX", logoUrl: null },
  away: { name: "Arkansas Razorbacks", abbreviation: "ARK", logoUrl: null },
};

describe("gameFromEvent", () => {
  it("takes the names, the abbreviations and the sport from the event, away on the left", () => {
    const game = gameFromEvent(GAME);
    expect(game.sport).toBe("football");
    expect(game.away.name).toBe("Arkansas Razorbacks");
    expect(game.away.abbreviation).toBe("ARK");
    expect(game.home.name).toBe("Texas Longhorns");
    expect(game.home.abbreviation).toBe("TEX");
    expect(game.away.art).not.toBeNull();
    expect(game.away.art).not.toBe(game.home.art);
  });

  it("draws the art of the sport of the game, not always football", () => {
    const game = gameFromEvent({ ...GAME, sport: "basketball", league: "NCAAM" });
    expect(game.away.art).toContain("basketball");
    expect(game.home.art).toContain("basketball");
  });

  it("keeps a team's own logo over the illustration", () => {
    const logo = "https://example.com/tex.png";
    const game = gameFromEvent({ ...GAME, home: { ...GAME.home, logoUrl: logo } });
    expect(game.home.art).toBe(logo);
    expect(game.away.art).toContain("football");
  });

  it("falls back to a monogram (no art) for a sport without illustrations", () => {
    const game = gameFromEvent({ ...GAME, sport: "hockey", league: "NHL" });
    expect(game.away.art).toBeNull();
    expect(game.home.art).toBeNull();
  });
});

describe("totalMicro", () => {
  it("multiplies without a float", () => {
    expect(totalMicro("20000000", 3)).toBe(60_000_000n);
    expect(totalMicro("999999990000", 20)).toBe(19_999_999_800_000n);
  });

  it("refuses a quantity that is not a whole number of at least 1", () => {
    expect(() => totalMicro("20000000", 0)).toThrow(RangeError);
    expect(() => totalMicro("20000000", 1.5)).toThrow(RangeError);
  });
});
