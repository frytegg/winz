import { describe, expect, it } from "vitest";

import { totalMicro } from "./amount";
import { abbreviate, teamsFromTitle } from "./teams";

describe("teamsFromTitle", () => {
  it("cuts the title on vs", () => {
    const teams = teamsFromTitle("Arkansas vs Texas");
    expect(teams?.away.name).toBe("Arkansas");
    expect(teams?.away.abbreviation).toBe("ARK");
    expect(teams?.home.name).toBe("Texas");
    expect(teams?.home.abbreviation).toBe("TEX");
    expect(teams?.away.art).not.toBe(teams?.home.art);
  });

  it("is null when there is no vs, and the screen shows the title", () => {
    expect(teamsFromTitle("Monday night football")).toBeNull();
  });

  it("keeps letters only in an abbreviation", () => {
    expect(abbreviate("Texas A&M")).toBe("TEX");
    expect(abbreviate("49ers")).toBe("ERS");
  });

  it("keeps the first letters of a name with no Latin letter, not an empty badge", () => {
    expect(abbreviate("東京ドーム")).toBe("東京ド");
    expect(abbreviate("Ελλάδα")).toBe("ΕΛΛ");
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
