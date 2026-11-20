import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { landingCopy } from "@/lib/landing/copy";
import { decorativeQr } from "@/lib/landing/qr-target";
import { buildQrMatrix, qrPath } from "@/lib/qr";

import { LandingHow } from "./landing-how";

const LIVE_DEMO = "https://winz-nu.vercel.app/";
const html = renderToStaticMarkup(createElement(LandingHow, { qrUrl: LIVE_DEMO }));

/** React writes an apostrophe in an attribute as `&#x27;`. */
const attr = (text: string): string => text.replaceAll("'", "&#x27;");

describe("LandingHow", () => {
  it("is the section the navigation's #how anchor lands on, named by its H2", () => {
    expect(html).toContain('id="how"');
    expect(html).toContain('aria-labelledby="how-title"');
    expect(html).toContain('<h2 id="how-title"');
    expect(html).toContain("How a promo works.");
    expect(html).toContain("How it works");
  });

  it("reads the subtitle of COPY.md and the two tabs", () => {
    expect(html).toContain("The merchant sets it up in a minute.");
    expect(html).toContain("The fan never has to learn anything.");
    expect(html).toContain(">Merchant</button>");
    expect(html).toContain(">Fan</button>");
  });

  it("is a tablist of two tabs, each paired with a tabpanel", () => {
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(2);
    expect(html).toContain('role="tablist"');
    // Merchant is on first, and the only tab in the tab order.
    expect(html).toMatch(/aria-selected="true"[^>]*tabindex="0"[^>]*>Merchant/);
    expect(html).toMatch(/aria-selected="false"[^>]*tabindex="-1"[^>]*>Fan/);
  });

  it("holds the six cards, with the titles and descriptions of COPY.md", () => {
    for (const card of [...landingCopy.how.merchant, ...landingCopy.how.fan]) {
      expect(html).toContain(card.title);
      expect(html).toContain(card.body);
    }
    expect(html.match(/<article/g)).toHaveLength(6);
  });

  it("describes each Merchant scene as one picture, with the alt text of its card", () => {
    for (const card of landingCopy.how.merchant) {
      expect(html).toContain(`role="img" aria-label="${attr(card.alt)}"`);
    }
    // Drawn in the page, not pictures of text: the mockup's Figma exports are gone.
    expect(html).not.toMatch(/merchant-0\d\.svg/);
  });

  it("draws the Merchant scenes with the example's words, chips and link", () => {
    const text = html.replace(/<!-- -->/g, "");
    for (const words of [
      "Budget",
      "Promo",
      "Texas",
      "Arkansas",
      "TEX",
      "ARK",
      "91%",
      "9%",
      "2:30",
      "PM",
      "Nov 21",
      "Fund with Apple Pay",
      "Fund with card",
      "Buzzball’s shop",
      "winz-nu.vercel.app/c/buzzballs-shop-texas-wins",
      "Download QR",
    ]) {
      expect(text).toContain(words);
    }
    // The QR code is drawn by lib/qr.ts, with the Winz mark in its middle.
    expect(html).toMatch(
      /<svg viewBox="0 0 \d+ \d+"[^>]*>\s*<g transform="translate\(2 2\)"><path d="M/,
    );
  });

  it("makes the Show the QR code scan to the live demo, never to the example promo, which does not exist", () => {
    expect(html).toContain(`<path d="${qrPath(buildQrMatrix(LIVE_DEMO))}"`);
    expect(html).not.toContain(
      `<path d="${qrPath(buildQrMatrix(`https://${landingCopy.example.link}`))}"`,
    );
    // Without a live demo address, a pattern that cannot be read rather than a code that leads nowhere.
    const unlinked = renderToStaticMarkup(createElement(LandingHow, { qrUrl: null }));
    expect(unlinked).toContain(`<path d="${qrPath(decorativeQr())}"`);
  });

  it("draws the two helmets of the example's teams, and no other", () => {
    expect(html).toContain("/landing/how/helmet-tex.webp");
    expect(html).toContain("/landing/how/helmet-ark.webp");
    expect(html).not.toMatch(/helmet-(?!tex|ark)[a-z]+\.webp/);
  });

  it("describes each Fan scene as one picture, and puts the chips of COPY.md in them", () => {
    for (const card of landingCopy.how.fan) {
      expect(html).toContain(`role="img" aria-label="${attr(card.alt)}"`);
    }
    for (const chip of [
      "Scan the QR",
      "Pay with Apple Pay",
      "Live",
      "Win chance",
      "Final",
      "Refunded · +$12.00",
    ]) {
      expect(html.replace(/<!-- -->/g, "")).toContain(chip);
    }
  });

  it("says nothing crypto in the Fan tab", () => {
    const fanTab = html.slice(html.indexOf("aria-labelledby", html.indexOf('role="tabpanel"') + 1));
    expect(fanTab).not.toMatch(/wallet|usdc|chain|crypto|token|\barc\b|hedge|web3/i);
    const fanCopy = JSON.stringify([landingCopy.how.fan, landingCopy.how.scene]);
    expect(fanCopy).not.toMatch(/wallet|usdc|chain|crypto|token|\barc\b|hedge|web3/i);
  });

  it("uses the example of the demo video: Arkansas at Texas, Buzzball’s shop, $12.00", () => {
    expect(landingCopy.how.scene.promise).toBe("100% back if Texas wins!");
    expect(landingCopy.how.scene.merchant).toBe("Buzzball’s shop");
    expect(landingCopy.how.scene.amount).toBe("+$12.00");
    expect(landingCopy.how.scene.home).toBe("TEX");
    expect(landingCopy.how.scene.away).toBe("ARK");
    expect(landingCopy.how.scene.score).toEqual({ home: 31, away: 17 });
    // Visitors first, as the app's tickets draw a game: Arkansas 17, Texas 31.
    expect(html.replace(/<!-- -->/g, "")).toContain('17 <span class="text-muted">–</span> 31');
  });

  it("tells no other example than the demo video's, in its words or in its alt texts", () => {
    const words = [html, JSON.stringify(landingCopy.how)].join(" ");
    expect(words).not.toMatch(/pittsburgh|philadelphia|joe[’']?s|pizza|\bPIT\b|\bPHI\b|\$20\.00/i);
  });

  it("never renders a dead link or a TODO", () => {
    expect(html).not.toMatch(/href="#?"/);
    expect(html).not.toMatch(/TODO|FIXME|lorem|\[placeholder\]/i);
  });
});
