import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { landingCopy } from "@/lib/landing/copy";
import type { LandingLinks } from "@/lib/landing/links";

import { LandingCta } from "./landing-cta";
import { LandingFooter } from "./landing-footer";
import { LandingNav } from "./landing-nav";
import { TryDemoButton } from "./try-demo-button";

/** Everything undecided, as the config is until the owner fills it. */
const NONE: Pick<
  LandingLinks,
  "githubUrl" | "devpostUrl" | "videoUrl" | "teamLinks" | "appInstallUrl"
> = {
  githubUrl: null,
  devpostUrl: null,
  videoUrl: null,
  teamLinks: [
    { name: "Téo", url: null },
    { name: "Alexandre", url: null },
  ],
  appInstallUrl: null,
};

const ALL: typeof NONE = {
  githubUrl: "https://github.com/winz/winz",
  devpostUrl: "https://devpost.com/software/winz",
  videoUrl: "https://youtu.be/abcdefghijk",
  teamLinks: [
    { name: "Téo", url: "https://example.com/teo" },
    { name: "Alexandre", url: "https://example.com/alexandre" },
  ],
  appInstallUrl: "/",
};

function hrefsOf(html: string): string[] {
  return [...html.matchAll(/<a [^>]*?href="([^"]*)"/g)].map((match) => match[1] ?? "");
}

/** The text of a page's markup: what a reader sees, with the tags and the entities gone. */
function textOf(html: string): string {
  return html
    .replace(/<span class="sr-only">[^<]*<\/span>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/ ([.,])/g, "$1")
    .trim();
}

describe("LandingCta", () => {
  it("has the wordmark, the title and the button of COPY.md, in that order", () => {
    const html = renderToStaticMarkup(
      createElement(LandingCta, { githubUrl: "https://github.com/winz" }),
    );
    expect(html.indexOf("logo-winz-dark.svg")).toBeGreaterThan(-1);
    expect(html.indexOf("logo-winz-dark.svg")).toBeLessThan(
      html.indexOf("Refunded if the team wins."),
    );
    expect(html.indexOf("Refunded if the team wins.")).toBeLessThan(html.indexOf("View the code"));
    expect(html).toContain('<h2 id="cta-title"');
    expect(html).toContain('aria-labelledby="cta-title"');
  });

  it("makes the button an external link when the repository is decided", () => {
    const html = renderToStaticMarkup(
      createElement(LandingCta, { githubUrl: "https://github.com/winz" }),
    );
    expect(html).toMatch(
      /<a [^>]*href="https:\/\/github\.com\/winz"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/,
    );
  });

  it("makes the button inactive, with its hint, and not a link, while there is no repository", () => {
    const html = renderToStaticMarkup(createElement(LandingCta, { githubUrl: null }));
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain(landingCopy.openingSoon);
    expect(hrefsOf(html)).toEqual([]);
  });

  it("carries the alt of COPY.md on the phones, and the heading is the only text of the section", () => {
    const html = renderToStaticMarkup(createElement(LandingCta, { githubUrl: null }));
    expect(html).toContain(
      'alt="The Winz app: picking a game, the opening screen and a live promo with its QR code."',
    );
    expect(html).toContain("cta-illustration-849.avif");
    expect(html.match(/<h[1-6]/g)).toHaveLength(1);
  });

  it("is a section the animation can hold back and release", () => {
    const html = renderToStaticMarkup(createElement(LandingCta, { githubUrl: null }));
    expect(html).toContain('data-reveal="visible"');
    expect(html).toContain("cta-fade");
    expect(html).toContain("cta-rise");
  });
});

describe("LandingFooter", () => {
  it("says what COPY.md section 8 says, in order", () => {
    const text = textOf(renderToStaticMarkup(createElement(LandingFooter, { links: ALL })));
    const order = [
      "Every promo is a bet.",
      "Winz hedges it.",
      "Get the app",
      "Winz is a web app. Add it to your home screen.",
      "Add to Home Screen",
      "How it works",
      "Demo video",
      "Features",
      "Live demo",
      "Project",
      "GitHub",
      "Devpost",
      "Built at",
      "UBC 2026",
      "Consumer app track",
      "Austin, Texas",
      "© 2026 Winz · Built by Téo and Alexandre.",
      "Hackathon prototype on test networks. No real funds, no real bets.",
    ];
    let from = 0;
    for (const line of order) {
      const at = text.indexOf(line, from);
      expect(at, `"${line}" after position ${from}`).toBeGreaterThanOrEqual(0);
      from = at + line.length;
    }
  });

  it("sets the statement in two tones, gray then black", () => {
    const html = renderToStaticMarkup(createElement(LandingFooter, { links: ALL }));
    expect(html).toMatch(/text-landing-gray-faint">Every promo is a bet\./);
    expect(html).toMatch(/text-ink">Winz hedges it\./);
  });

  it("renders no dead link while nothing is decided: no #, no empty href, no Project column", () => {
    const html = renderToStaticMarkup(createElement(LandingFooter, { links: NONE }));
    const hrefs = hrefsOf(html);
    expect(hrefs).not.toContain("#");
    expect(hrefs).not.toContain("");
    // Only the page's own anchors are left.
    expect(hrefs.every((href) => href.startsWith("#"))).toBe(true);
    expect(html).not.toContain("footer-project");
    expect(html).not.toContain(">Project<");
    expect(html).not.toContain("GitHub");
    expect(html).not.toContain("Devpost");
  });

  it("does not link the team while it has no links, and shows the names as text", () => {
    const html = renderToStaticMarkup(createElement(LandingFooter, { links: NONE }));
    expect(textOf(html)).toContain("© 2026 Winz · Built by Téo and Alexandre.");
    expect(html).not.toContain("example.com");
  });

  it("draws the Project column with only the links that exist, in order", () => {
    const html = renderToStaticMarkup(
      createElement(LandingFooter, {
        links: { ...NONE, githubUrl: ALL.githubUrl, videoUrl: ALL.videoUrl },
      }),
    );
    expect(html).toContain('id="footer-project"');
    expect(hrefsOf(html)).toEqual(
      expect.arrayContaining(["https://github.com/winz/winz", "https://youtu.be/abcdefghijk"]),
    );
    expect(html).toContain("GitHub");
    expect(html).not.toContain("Devpost");
    // External links open in a tab, and say so.
    expect(html).toMatch(
      /href="https:\/\/github\.com\/winz\/winz" target="_blank" rel="noopener noreferrer"/,
    );
  });

  it("links the team's names when they have links", () => {
    const html = renderToStaticMarkup(createElement(LandingFooter, { links: ALL }));
    expect(hrefsOf(html)).toEqual(
      expect.arrayContaining(["https://example.com/teo", "https://example.com/alexandre"]),
    );
  });

  it("points its Winz column at the sections of the page", () => {
    const html = renderToStaticMarkup(createElement(LandingFooter, { links: ALL }));
    for (const anchor of ["#how", "#demo", "#features", "#live-demo"]) {
      expect(hrefsOf(html)).toContain(anchor);
    }
  });

  it("makes 'Add to Home Screen' a link to the app, and an inactive button while the address is not decided", () => {
    const decided = renderToStaticMarkup(createElement(LandingFooter, { links: ALL }));
    expect(decided).toMatch(/<a [^>]*href="\/"[^>]*aria-haspopup="dialog"/);
    const undecided = renderToStaticMarkup(createElement(LandingFooter, { links: NONE }));
    expect(undecided).toContain('aria-disabled="true"');
    expect(undecided).toContain(landingCopy.openingSoon);
  });

  it("names its landmark and leaves the column titles out of the heading outline", () => {
    const html = renderToStaticMarkup(createElement(LandingFooter, { links: ALL }));
    expect(html).toContain('<footer aria-label="Footer"');
    expect(html).not.toMatch(/<h[1-6]/);
  });
});

describe("TryDemoButton, outside the page's provider", () => {
  it("is the same link as before: the app's address, in a new tab, and nothing else", () => {
    const html = renderToStaticMarkup(
      createElement(TryDemoButton, { href: "/", children: "Try the live demo" }),
    );
    expect(hrefsOf(html)).toEqual(["/"]);
    expect(html).toContain('target="_blank"');
    expect(html).toContain("Try the live demo");
  });

  it("shows no 'Best on your phone' before the page has read the browser", () => {
    const html = renderToStaticMarkup(
      createElement(TryDemoButton, {
        href: "/",
        bestOnPhone: true,
        children: "Try the live demo",
      }),
    );
    expect(html).not.toContain("Best on your phone");
  });

  it("stays inactive, not a link, while the live demo has no address", () => {
    const html = renderToStaticMarkup(
      createElement(TryDemoButton, { href: null, children: "Try the live demo" }),
    );
    expect(hrefsOf(html)).toEqual([]);
    expect(html).toContain('aria-disabled="true"');
  });
});

describe("LandingNav with the install button", () => {
  it("keeps the navigation's links in their order: the four anchors, then the app", () => {
    const html = renderToStaticMarkup(createElement(LandingNav, { liveDemoUrl: "/" }));
    expect(hrefsOf(html).slice(0, 6)).toEqual([
      "#top",
      "#how",
      "#demo",
      "#features",
      "#live-demo",
      "/",
    ]);
  });
});
