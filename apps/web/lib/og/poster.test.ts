import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { API_ROUTES } from "@winz/shared";
import { describe, expect, it } from "vitest";

import {
  POSTER_CACHE,
  POSTER_SIZE,
  POSTER_SLUG,
  POSTER_UNAVAILABLE,
  posterContent,
  posterFilename,
  posterRefusal,
} from "./poster";

const campaign = API_ROUTES.publicCampaign.examples.live;

describe("what the poster shows", () => {
  it("is drawn from four values, and nothing else of the campaign reaches it", () => {
    const content = posterContent(campaign, "https://winz.example");
    expect(Object.keys(content).sort()).toEqual(["eventTitle", "link", "merchantName", "promise"]);
    expect(content).toEqual({
      promise: campaign.promise,
      merchantName: campaign.merchant.name,
      eventTitle: campaign.eventTitle,
      link: `https://winz.example/c/${campaign.slug}`,
    });
  });

  it("holds no figure, price or identifier of the promo", () => {
    const text = JSON.stringify(posterContent(campaign, "https://winz.example"));
    for (const secret of [
      campaign.instrumentSymbol,
      String(campaign.unitPrice),
      campaign.merchant.category,
      campaign.merchant.logoUrl ?? "no-logo",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("is drawn by a component that is given the content, not the campaign", () => {
    const file = fileURLToPath(new URL("../../components/og/promo-poster.tsx", import.meta.url));
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/PublicCampaign|(?<![.\w])campaign\.|\.merchant\./);
    expect(source).toContain("content: PosterContent");
  });

  it("points the code at the promo's page on the domain that served the poster", () => {
    expect(posterContent(campaign, "http://localhost:3000").link).toBe(
      `http://localhost:3000/c/${campaign.slug}`,
    );
  });
});

describe("the poster's file", () => {
  it("is 1080 by 1350", () => {
    expect(POSTER_SIZE).toEqual({ width: 1080, height: 1350 });
  });

  it("is named after the promo", () => {
    expect(posterFilename("joes-texas")).toBe("winz-joes-texas-poster.png");
  });

  it("never lets a strange slug into a file name", () => {
    expect(posterFilename('x"; rm -rf /')).toBe("winz-promo-poster.png");
    expect(posterFilename("../../etc/passwd")).toBe("winz-promo-poster.png");
    expect(posterFilename("a\r\nSet-Cookie: x=1")).toBe("winz-promo-poster.png");
  });

  it("is kept by caches, for a while, and by anyone: it is public", () => {
    expect(POSTER_CACHE).toMatch(/^public,/);
    expect(POSTER_CACHE).toMatch(/s-maxage=\d{3,}/);
    expect(POSTER_CACHE).not.toMatch(/private|no-store/);
  });
});

describe("posterRefusal", () => {
  const ok = { kind: "ok", campaign } as const;

  it("lets a real slug through, before and after the API answers", () => {
    expect(posterRefusal("joes-texas")).toBeNull();
    expect(posterRefusal("joes-texas", ok)).toBeNull();
  });

  it("answers 404 to a slug that cannot exist, without asking the API", () => {
    for (const slug of ["a", "-bad-", "UPPER", "has space", "dot.dot", "x".repeat(70), "%2e%2e"]) {
      expect(POSTER_SLUG.test(slug)).toBe(false);
      expect(posterRefusal(slug)?.status).toBe(404);
    }
  });

  it("answers 404, kept a minute, to a promo that does not exist", () => {
    const refusal = posterRefusal("no-such-promo", { kind: "not_found" });
    expect(refusal).toMatchObject({ status: 404, code: "not_found" });
    expect(refusal?.cacheControl).toMatch(/^public, max-age=60/);
  });

  it("answers 503, kept by nobody, when the API is down", () => {
    const refusal = posterRefusal("joes-texas", { kind: "error" });
    expect(refusal).toBe(POSTER_UNAVAILABLE);
    expect(refusal).toMatchObject({ status: 503, code: "unavailable", cacheControl: "no-store" });
  });

  it("says what is wrong in words, and without a crypto word", () => {
    for (const refusal of [posterRefusal("x"), POSTER_UNAVAILABLE]) {
      expect(refusal?.message.length).toBeGreaterThan(10);
      expect(refusal?.message).not.toMatch(
        /wallet|usdc|blockchain|chain|gas|seed|token|crypto|hedge/i,
      );
    }
  });
});
