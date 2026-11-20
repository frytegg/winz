import { describe, expect, it } from "vitest";

import { landingLinks } from "../../app/(landing)/landing.config";

import { isUsableLink, linkOrNull, missingLinks, type LandingLinks } from "./links";

const complete: LandingLinks = {
  liveDemoUrl: "/",
  videoUrl: "https://www.youtube.com/watch?v=abc",
  githubUrl: "https://github.com/frytegg/winz",
  devpostUrl: "https://devpost.com/software/winz",
  repoUrl: "https://github.com/frytegg/winz/",
  teamLinks: [{ name: "Téo", url: "https://x.com/someone" }],
  appInstallUrl: "/",
  appQrUrl: "https://winz-nu.vercel.app/",
};

describe("isUsableLink", () => {
  it("accepts an absolute https URL and a path of this site", () => {
    for (const value of ["https://github.com/frytegg/winz", "/", "/start", "/c/joes-texas?x=1"]) {
      expect(isUsableLink(value)).toBe(true);
    }
  });

  it("refuses everything a page must never put in an href", () => {
    for (const value of [
      "",
      "   ",
      "#",
      "#top",
      "//evil.example",
      "http://example.com",
      "javascript:alert(1)",
      "https://",
      "[placeholder]",
      "TODO",
      "winz.app/c/joes-texas",
    ]) {
      expect(isUsableLink(value)).toBe(false);
    }
    expect(isUsableLink(null)).toBe(false);
    expect(isUsableLink(undefined)).toBe(false);
    expect(isUsableLink(42)).toBe(false);
  });
});

describe("linkOrNull", () => {
  it("returns the trimmed link, or null: never a placeholder", () => {
    expect(linkOrNull(" /start ")).toBe("/start");
    expect(linkOrNull(null)).toBeNull();
    expect(linkOrNull(undefined)).toBeNull();
    expect(linkOrNull("#")).toBeNull();
  });
});

describe("missingLinks", () => {
  it("is empty when every link is set", () => {
    expect(missingLinks(complete)).toEqual([]);
  });

  it("lists every null, with each person of the team by name", () => {
    const keys = missingLinks({
      ...complete,
      liveDemoUrl: null,
      githubUrl: null,
      teamLinks: [
        { name: "Téo", url: null },
        { name: "Alexandre", url: "https://x.com/other" },
      ],
    }).map((entry) => entry.key);
    expect(keys).toEqual(["liveDemoUrl", "githubUrl", "teamLinks.Téo"]);
  });

  it("counts a value a page cannot use as missing, and says why", () => {
    expect(missingLinks({ ...complete, videoUrl: "#" })).toEqual([
      { key: "videoUrl", reason: "not a usable link" },
    ]);
  });
});

describe("landingLinks (the config)", () => {
  it("holds, for every link, either null or something a page can use (a typo is caught here)", () => {
    const values = [
      landingLinks.liveDemoUrl,
      landingLinks.videoUrl,
      landingLinks.githubUrl,
      landingLinks.devpostUrl,
      landingLinks.repoUrl,
      landingLinks.appInstallUrl,
      landingLinks.appQrUrl,
      ...landingLinks.teamLinks.map((person) => person.url),
    ];
    for (const value of values) expect(value === null || isUsableLink(value)).toBe(true);
  });

  it("keeps the QR URL absolute: a code is scanned away from this site, a path would lead nowhere", () => {
    expect(landingLinks.appQrUrl === null || landingLinks.appQrUrl.startsWith("https://")).toBe(
      true,
    );
  });

  it("names the two people of the footer", () => {
    expect(landingLinks.teamLinks.map((person) => person.name)).toEqual(["Téo", "Alexandre"]);
  });
});
