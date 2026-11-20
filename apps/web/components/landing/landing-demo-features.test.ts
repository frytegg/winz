import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { landingCopy } from "@/lib/landing/copy";

import { LandingDemo } from "./landing-demo";
import { LandingFeatures } from "./landing-features";

const demo = (props: { liveDemoUrl: string | null; videoUrl: string | null }): string =>
  renderToStaticMarkup(createElement(LandingDemo, props));

const hrefs = (html: string): string[] =>
  [...html.matchAll(/<a [^>]*?href="([^"]*)"/g)].map((match) => match[1] ?? "");

describe("LandingDemo", () => {
  const html = demo({ liveDemoUrl: "/", videoUrl: null });

  it("is the section the navigation's #demo anchor lands on, named by its H2", () => {
    expect(html).toContain('id="demo"');
    expect(html).toContain('aria-labelledby="demo-title"');
    expect(html).toContain('<h2 id="demo-title"');
  });

  it("reads the eyebrow and the title of COPY.md, with a promo in lime and kept in one piece", () => {
    expect(html).toContain(">Demo</p>");
    expect(html).toContain('<span class="whitespace-nowrap text-lime">a promo</span>');
    expect(html).toContain("Watch ");
    expect(html).toContain("go live and settle.");
  });

  it("has the live demo button, a link to the app", () => {
    expect(html).toContain("Try the live demo");
    expect(hrefs(html)).toEqual(["/"]);
  });

  it("makes that button inactive, not a dead link, when the live demo has no URL yet", () => {
    const inactive = demo({ liveDemoUrl: null, videoUrl: null });
    expect(hrefs(inactive)).toEqual([]);
    expect(inactive).toContain(landingCopy.openingSoon);
  });

  it("shows the player inactive, and says why, while there is no video", () => {
    expect(html).toContain('aria-label="Play the Winz demo video"');
    const tag = /<button [^>]*aria-label="Play the Winz demo video"[^>]*>/.exec(html)?.[0] ?? "";
    expect(tag).toContain('aria-disabled="true"');
    const id = /aria-describedby="([^"]+)"/.exec(tag)?.[1];
    expect(id).toBeDefined();
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain("Demo video coming soon.");
  });

  it("loads nothing before the click, whatever the video is", () => {
    for (const videoUrl of [
      "https://youtu.be/dQw4w9WgXcQ",
      "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view",
      "/demo/winz.mp4",
    ]) {
      const page = demo({ liveDemoUrl: "/", videoUrl });
      expect(page).not.toContain("<iframe");
      expect(page).not.toContain("<video");
      expect(page).not.toContain("youtube");
      expect(page).not.toContain("drive.google.com");
      expect(page).not.toContain("winz.mp4");
      // A real button to play it, named, and not the "coming soon" state.
      expect(page).toContain('aria-label="Play the Winz demo video"');
      expect(page).not.toContain("coming soon");
      expect(page).not.toMatch(/aria-disabled="true"[^>]*aria-label="Play/);
    }
  });

  it("opens a video it cannot embed in a new tab, with no opener", () => {
    const page = demo({ liveDemoUrl: "/", videoUrl: "https://vimeo.com/123456789" });
    expect(page).toMatch(
      /<a href="https:\/\/vimeo\.com\/123456789" target="_blank" rel="noopener noreferrer" aria-label="Watch the Winz demo video \(opens in a new tab\)"/,
    );
    expect(page).not.toContain("<iframe");
  });

  it("is what the page is not: no TODO, no placeholder, no link to nowhere", () => {
    expect(html).not.toMatch(/todo|lorem|placeholder|href="#"|href=""/i);
  });

  it("carries a background that decorates only", () => {
    expect(html).toMatch(/demo-winz-bg-1728\.webp"[^>]*alt=""|alt=""[^>]*demo-winz-bg-1728\.webp/);
  });
});

describe("LandingFeatures", () => {
  const html = renderToStaticMarkup(createElement(LandingFeatures));

  it("is the section the navigation's #features anchor lands on, named by its H2", () => {
    expect(html).toContain('id="features"');
    expect(html).toContain('aria-labelledby="features-title"');
    expect(html).toContain('<h2 id="features-title"');
  });

  it("reads the header of COPY.md", () => {
    expect(html).toContain("Features");
    expect(html).toContain("Designed to be adopted.");
    expect(html).toContain("Everything a promo needs. Nothing a fan has to learn.");
  });

  it("holds the six cards of COPY.md, as a list, each with its title as a heading", () => {
    expect(html.match(/<li /g)).toHaveLength(6);
    expect(html.match(/<h3 /g)).toHaveLength(6);
    for (const item of landingCopy.features.items) {
      expect(html).toContain(`>${item.title}</h3>`);
      expect(html).toContain(item.body);
    }
  });

  it("keeps the list a list for a screen reader", () => {
    expect(html).toContain('<ul role="list"');
  });

  it("shows the six icons as decoration, icon-01 and icon-06 being the same file", () => {
    for (const n of ["01", "02", "03", "04", "05", "06"]) {
      expect(html).toContain(`/landing/features/icon-${n}.svg`);
    }
    expect(html.match(/<img [^>]*alt=""/g)).toHaveLength(6);
    expect(html.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("does not make the cards links", () => {
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<button");
  });

  it("is rendered with its cards visible, so that nothing depends on a script arriving", () => {
    expect(html).toContain('data-reveal="visible"');
    expect(html).not.toContain('data-reveal="armed"');
  });
});
