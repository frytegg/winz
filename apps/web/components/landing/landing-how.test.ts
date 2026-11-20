import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { landingCopy } from "@/lib/landing/copy";

import { LandingHow } from "./landing-how";

const html = renderToStaticMarkup(createElement(LandingHow));

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

  it("shows the three Merchant pictures, each with an alt text", () => {
    for (const n of ["01", "02", "03"]) expect(html).toContain(`/landing/how/merchant-${n}.svg`);
    for (const card of landingCopy.how.merchant) {
      expect(html).toContain(`alt="${attr(card.alt)}"`);
    }
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
      "Refunded · +$20.00",
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

  it("uses the example of the Merchant tab: Pittsburgh, Philadelphia, Joe's Pizza, $20.00", () => {
    expect(landingCopy.how.scene.promise).toBe("100% back if Pittsburgh wins!");
    expect(landingCopy.how.scene.merchant).toBe("Joe's Pizza");
    expect(landingCopy.how.scene.amount).toBe("+$20.00");
    expect(landingCopy.how.scene.pit).toBe("PIT");
    expect(landingCopy.how.scene.phi).toBe("PHI");
  });

  it("never renders a dead link or a TODO", () => {
    expect(html).not.toMatch(/href="#?"/);
    expect(html).not.toMatch(/TODO|FIXME|lorem|\[placeholder\]/i);
  });
});
