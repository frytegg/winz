import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { landingCopy } from "@/lib/landing/copy";

import { LandingProcess } from "./landing-process";

const html = renderToStaticMarkup(createElement(LandingProcess));
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
    expect(html).toContain("alex@joespizza.com");
    expect(html).toContain("Your email…");
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
