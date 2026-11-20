import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { landingCopy } from "@/lib/landing/copy";

import { LandingProcess } from "./landing-process";

const QR_URL = "https://winz-nu.vercel.app/";
const render = (qrUrl: string | null): string =>
  renderToStaticMarkup(createElement(LandingProcess, { qrUrl }));
const html = render(QR_URL);
const { steps } = landingCopy.process;

describe("LandingProcess", () => {
  it("is the section the navigation's #live-demo anchor lands on, named by its H2", () => {
    expect(html).toContain('id="live-demo"');
    expect(html).toContain('aria-labelledby="process-title"');
    expect(html).toContain('<h2 id="process-title"');
    expect(html).toContain(">Live demo</p>");
    expect(html).toContain("Test it in three minutes.");
  });

  it("reads as six steps in order, each an article named by its own H3", () => {
    const articles = [
      ...html.matchAll(/<article [^>]*aria-labelledby="(process-step-\d)"[^>]*>(.*?)<\/article>/g),
    ];
    expect(articles).toHaveLength(6);
    articles.forEach((match, index) => {
      const step = steps[index];
      expect(match[2]).toContain(`Step 0${index + 1}`);
      expect(match[2]).toContain(`<h3 id="${match[1]}"`);
      expect(match[2]).toContain(step?.title ?? "?");
      expect(match[2]).toContain(step?.body ?? "?");
    });
  });

  it("puts the text before the pictures in the markup, so that it reads in order without CSS", () => {
    // The sticky card is last, and every picture is decoration.
    expect(html.lastIndexOf("data-process-stage")).toBeGreaterThan(html.lastIndexOf("</article>"));
    for (const tag of html.match(/<div [^>]*data-process-(?:art|stage)[^>]*>/g) ?? []) {
      expect(tag).toContain('aria-hidden="true"');
    }
  });

  it("has a picture for each step beside its text, and the sticky card's six screens", () => {
    expect(html.match(/data-process-art/g)).toHaveLength(6);
    expect(html.match(/data-process-screen/g)).toHaveLength(12);
  });

  it("draws step 01 as the mockup does, ending on the typed e-mail and the code", () => {
    expect(html).toContain("Let&#x27;s get you set up");
    expect(html).toContain("alex@buzzballs.com");
    expect(html).toContain("Your email…");
  });

  it("has a screen with its words for each of the six steps", () => {
    for (const words of [
      "Pick a game",
      "Pay by card",
      "Fund with card",
      "Putting your promo live…",
      "Link copied",
      "Download poster",
      "Pay with Apple Pay",
      "$12.00",
      "Refunded",
      "+$12.00",
    ]) {
      expect(html.toLowerCase()).toContain(words.toLowerCase());
    }
    const text = html.replace(/<!-- -->/g, "");
    expect(text).toContain("Buzzball’s shop");
    expect(text).toContain("Texas");
    expect(text).toContain("Arkansas");
    expect(text).toContain("TEX");
    expect(text).toContain("ARK");
    expect(text).toContain("Live · 17 – 17");
    // Visitors first, as the app's tickets draw a game: Arkansas 17, Texas 31.
    expect(text).toContain("Final · 17 – 31");
    // The promise is the copy's, its figure lit, on the fan's page and on the ticket: each screen is
    // drawn twice (beside its step and in the sticky card), so four times.
    expect(text.match(/<span class="ps-pct">100%<\/span> back if Texas wins!/g)).toHaveLength(4);
  });

  it("tells no other example than the demo video's", () => {
    expect(html).not.toMatch(/pittsburgh|philadelphia|joe[’']?s|pizza|\bPIT\b|\bPHI\b|\$20\.00/i);
    expect(html).toContain("/landing/how/helmet-tex.webp");
    expect(html).toContain("/landing/how/helmet-ark.webp");
  });

  it("draws the live demo's address as the QR, and shows its host in the chip", () => {
    expect(html).toContain("winz-nu.vercel.app");
    expect(html).toMatch(/<svg[^>]*viewBox="-2 -2 [^"]*"[^>]*>\s*<path d="M0 0h7v1h-7z/);
  });

  it("draws a pattern that is not a code, and no host, when there is no live demo", () => {
    const decoration = render(null);
    expect(decoration).toContain("Your promo link");
    expect(decoration).not.toContain("winz-nu.vercel.app");
  });

  it("holds no link, no dead anchor and no marker of unfinished work", () => {
    expect(html).not.toMatch(/<a /);
    expect(html).not.toMatch(/href="#?"/);
    expect(html).not.toMatch(/TODO|FIXME|lorem/i);
  });

  it("says nothing about the chain in the screens a fan would see", () => {
    expect(html).not.toMatch(/USDC|wallet|token|hedge/i);
  });
});
