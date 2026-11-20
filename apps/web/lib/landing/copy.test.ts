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
    const { before, highlight, firstLineEnd, second } = landingCopy.heroTitle;
    expect(`${before}${highlight}${firstLineEnd} ${second}`).toBe("Get payback if your team wins.");
    expect(highlight).toBe("payback");
  });
});

describe("landingCopy.demoTitle", () => {
  it("reads as the H2 of COPY.md, with a promo as the lime run", () => {
    const { before, highlight, second } = landingCopy.demoTitle;
    expect(`${before}${highlight} ${second}`).toBe("Watch a promo go live and settle.");
    expect(highlight).toBe("a promo");
  });
});

describe("landingCopy.demo", () => {
  it("has the words of COPY.md section 4", () => {
    expect(landingCopy.demo.eyebrow).toBe("Demo");
    expect(landingCopy.demo.cta).toBe("Try the live demo");
    expect(landingCopy.demo.play).toBe("Play the Winz demo video");
    expect(landingCopy.demo.soon).toBe("Demo video coming soon.");
  });
});

describe("landingCopy.features", () => {
  it("has the six cards of COPY.md section 6, in order", () => {
    expect(landingCopy.features.items.map((item) => item.title)).toEqual([
      "One-tap payment",
      "A ticket that stays live",
      "Share by scan",
      "Set a budget",
      "Transparent hedge desk",
      "Payments that behave",
    ]);
    expect(landingCopy.features.items.map((item) => item.icon)).toEqual([
      "icon-01",
      "icon-02",
      "icon-03",
      "icon-04",
      "icon-05",
      "icon-06",
    ]);
  });

  it("has the header of COPY.md", () => {
    expect(landingCopy.features.eyebrow).toBe("Features");
    expect(landingCopy.features.title).toBe("Designed to be adopted.");
    expect(landingCopy.features.subtitle).toBe(
      "Everything a promo needs. Nothing a fan has to learn.",
    );
  });
});
