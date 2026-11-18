import { describe, expect, it } from "vitest";

import { pickSingleTeamArt, pickTeamArt } from "./team-art";

describe("pickTeamArt", () => {
  it("is stable: the same teams always get the same art", () => {
    expect(pickTeamArt("football", "ARK", "TEX")).toEqual(pickTeamArt("football", "ARK", "TEX"));
  });

  it("never gives the two teams of a game the same illustration", () => {
    for (const [away, home] of [
      ["PIT", "PHI"],
      ["ARK", "TEX"],
      ["AAA", "AAA"],
      ["HOU", "DAL"],
    ] as const) {
      const art = pickTeamArt("football", away, home);
      expect(art?.away).not.toBe(art?.home);
    }
  });

  it("returns null for a sport with no illustration, so the monogram shows", () => {
    expect(pickTeamArt("hockey", "BOS", "MTL")).toBeNull();
    expect(pickSingleTeamArt("baseball", "NYY")).toBeNull();
  });

  it("only picks files that exist for the sport", () => {
    expect(pickTeamArt("basketball", "VILL", "PITT")?.away).toMatch(
      /^\/sports\/basketball-4[3-6]\.png$/,
    );
    expect(pickSingleTeamArt("soccer", "ATX")).toMatch(/^\/sports\/soccer-(47|48|49|50)\.png$/);
  });
});
