import { describe, expect, it } from "vitest";

import { nameSeparator, projectLinks, teamNames } from "./footer";

const labels = { github: "GitHub", devpost: "Devpost", video: "Demo video" };
const none = { githubUrl: null, devpostUrl: null, videoUrl: null };

describe("projectLinks", () => {
  it("is empty while nothing is decided, so the column is not drawn", () => {
    expect(projectLinks(none, labels)).toEqual([]);
  });

  it("keeps the order of COPY.md and only the links that are decided", () => {
    expect(
      projectLinks(
        { githubUrl: "https://github.com/winz", devpostUrl: null, videoUrl: "https://youtu.be/x" },
        labels,
      ),
    ).toEqual([
      { label: "GitHub", href: "https://github.com/winz" },
      { label: "Demo video", href: "https://youtu.be/x" },
    ]);
  });

  it("drops what a page cannot use: #, an empty string, http:, javascript:", () => {
    for (const bad of ["#", "", "  ", "http://example.com", "javascript:alert(1)", "//evil.com"]) {
      expect(projectLinks({ ...none, githubUrl: bad }, labels)).toEqual([]);
    }
  });
});

describe("teamNames", () => {
  it("links a name that has a usable link and leaves the others as text", () => {
    expect(
      teamNames([
        { name: "Téo", url: "https://example.com/teo" },
        { name: "Alexandre", url: null },
      ]),
    ).toEqual([
      { name: "Téo", href: "https://example.com/teo" },
      { name: "Alexandre", href: null },
    ]);
  });

  it("does not link a name to something unusable", () => {
    expect(teamNames([{ name: "Téo", url: "#" }])).toEqual([{ name: "Téo", href: null }]);
  });
});

describe("nameSeparator", () => {
  const join = (names: string[]): string =>
    names.map((name, index) => `${nameSeparator(index, names.length, "and")}${name}`).join("");

  it("reads as a list of names", () => {
    expect(join(["Téo"])).toBe("Téo");
    expect(join(["Téo", "Alexandre"])).toBe("Téo and Alexandre");
    expect(join(["A", "B", "C"])).toBe("A, B and C");
  });
});
