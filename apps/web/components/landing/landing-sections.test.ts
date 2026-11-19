import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { landingCopy } from "@/lib/landing/copy";

import { LandingHero } from "./landing-hero";
import { LandingNav } from "./landing-nav";
import { exportedSrcSet, LandingPicture } from "./landing-picture";
import { LogoStrip } from "./logo-strip";

/** The page's markup as a string, plus the `href` of every link in it. */
function render(node: React.ReactElement): { html: string; hrefs: string[] } {
  const html = renderToStaticMarkup(node);
  const hrefs = [...html.matchAll(/<a [^>]*?href="([^"]*)"/g)].map((match) => match[1] ?? "");
  return { html, hrefs };
}

describe("LandingNav", () => {
  it("has the four anchors of COPY.md, in order, and the button after them", () => {
    const { hrefs } = render(createElement(LandingNav, { liveDemoUrl: "/" }));
    // The menu of a phone repeats them, so the first five are the desktop navigation.
    expect(hrefs.slice(0, 6)).toEqual(["#top", "#how", "#demo", "#features", "#live-demo", "/"]);
  });

  it("names its links as COPY.md does", () => {
    const { html } = render(createElement(LandingNav, { liveDemoUrl: "/" }));
    for (const label of [
      "How it works",
      "Demo video",
      "Features",
      "Live demo",
      "Try the live demo",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain("FAQ");
  });

  it("makes the button inactive, not a dead link, when the live demo has no URL yet", () => {
    const { html, hrefs } = render(createElement(LandingNav, { liveDemoUrl: null }));
    expect(hrefs).not.toContain("#");
    expect(hrefs).not.toContain("");
    // The anchors are still there; the button is not a link any more.
    expect(hrefs.filter((href) => href.startsWith("#"))).toContain("#live-demo");
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain(landingCopy.openingSoon);
  });
});

describe("LandingHero", () => {
  it("reads the H1, the eyebrow and the subtitle of COPY.md, with payback in lime", () => {
    const { html } = render(createElement(LandingHero, { liveDemoUrl: "/" }));
    expect(html).toContain("UBC 2026 · Consumer app track");
    expect(html).toContain('<span class="text-lime">payback</span> if');
    expect(html).toContain("your team wins.");
    expect(html).toContain(
      "Fans pay in one tap, get refunded if their team wins. The merchant&#x27;s risk is hedged.",
    );
  });

  it("carries the alt of the illustration, and nothing for the background", () => {
    const { html } = render(createElement(LandingHero, { liveDemoUrl: "/" }));
    expect(html).toContain(
      'alt="Winz on three phones: picking a game, the merchant dashboard and the promo screen."',
    );
    expect(html).toMatch(/hero-bg-1728\.webp"[^>]*alt=""|alt=""[^>]*hero-bg-1728\.webp/);
  });

  it("makes its button inactive when the live demo has no URL yet", () => {
    const { html, hrefs } = render(createElement(LandingHero, { liveDemoUrl: null }));
    expect(hrefs).toEqual([]);
    expect(html).toContain('aria-disabled="true"');
  });
});

describe("LogoStrip", () => {
  const { html } = render(createElement(LogoStrip));
  const lists = html.split("<ul").slice(1);

  it("is two identical lists of the six tools, so that the loop has no seam", () => {
    expect(lists).toHaveLength(2);
    const names = (list: string): string[] =>
      [...list.matchAll(/src="\/landing\/logos\/([a-z]+)\.svg"/g)].map((match) => match[1] ?? "");
    expect(names(lists[0] ?? "")).toEqual([
      "stripe",
      "arc",
      "gemini",
      "privy",
      "supabase",
      "vercel",
    ]);
    expect(names(lists[1] ?? "")).toEqual(names(lists[0] ?? ""));
  });

  it("names the visible list and hides its copy from assistive technology", () => {
    expect(lists[0]).toContain('aria-label="Technologies used"');
    expect(lists[0]).not.toContain("aria-hidden");
    expect(lists[1]).toContain('aria-hidden="true"');
    expect(lists[1]).not.toContain("aria-label");
    // Each visible logo has its name; the copy has none, or a screen reader says every tool twice.
    for (const name of ["Stripe", "Arc", "Gemini", "Privy", "Supabase", "Vercel"]) {
      expect(lists[0]).toContain(`alt="${name}"`);
    }
    expect(lists[1]).not.toMatch(/alt="[A-Za-z]/);
  });

  it("has the label of COPY.md and a pause control for a keyboard", () => {
    expect(html).toContain("Built with");
    expect(html).toContain("the best tools");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('aria-label="Pause the scrolling logos"');
  });
});

describe("exportedSrcSet", () => {
  it("gives each export its own real width, so the browser can take the smallest sharp one", () => {
    expect(exportedSrcSet("/landing/hero/hero-illustration", [860, 1033, 2066], "avif")).toBe(
      "/landing/hero/hero-illustration-860.avif 860w, /landing/hero/hero-illustration-1033.avif 1033w, /landing/hero/hero-illustration-2066.avif 2066w",
    );
  });
});

describe("LandingPicture", () => {
  const picture = (priority: boolean): string =>
    renderToStaticMarkup(
      createElement(LandingPicture, {
        base: "/landing/hero/hero-illustration",
        widths: [860, 1033, 2066],
        width: 2066,
        height: 1210,
        alt: "Three phones",
        sizes: "100vw",
        priority,
      }),
    );

  it("serves AVIF first, then WebP, and falls back to the widest WebP", () => {
    const html = picture(true);
    expect(html.indexOf('type="image/avif"')).toBeLessThan(html.indexOf('type="image/webp"'));
    expect(html).toContain('src="/landing/hero/hero-illustration-2066.webp"');
  });

  it("is loaded first when it has priority, and lazily when it has not", () => {
    expect(picture(true)).toContain('loading="eager"');
    expect(picture(true)).toContain('fetchPriority="high"');
    expect(picture(false)).toContain('loading="lazy"');
    expect(picture(false)).not.toContain('fetchPriority="high"');
  });

  it("reserves its box from the widest export", () => {
    expect(picture(false)).toContain('width="2066" height="1210"');
  });
});
