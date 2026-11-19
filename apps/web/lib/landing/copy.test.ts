import { describe, expect, it } from "vitest";

import { landingCopy } from "./copy";

describe("landingCopy.meta", () => {
  it("is the title and the description the owner decided, word for word", () => {
    expect(landingCopy.meta.title).toBe("Winz · Refunded if the team wins");
    expect(landingCopy.meta.description).toBe(
      "Fans pay in one tap and get refunded if their team wins. The merchant's risk is hedged. Built for UBC 2026.",
    );
  });

  it("fits what a tab and a search result show", () => {
    expect(landingCopy.meta.title.length).toBeLessThanOrEqual(60);
    expect(landingCopy.meta.description.length).toBeLessThanOrEqual(160);
  });
});

describe("landingCopy.heroTitle", () => {
  it("reads as the H1 of COPY.md once the three runs are put together", () => {
    const { before, highlight, after } = landingCopy.heroTitle;
    expect(`${before}${highlight}${after}`).toBe("Get payback if your team wins.");
    expect(highlight).toBe("payback");
  });
});
