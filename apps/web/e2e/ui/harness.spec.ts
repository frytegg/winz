import { expect, test, type Page } from "@playwright/test";

import { CRITERIA, meetsLimit } from "./support/criteria";
import { PHONE_WIDTH, Screens, horizontalOverflow, isUnaskedFailure } from "./support/fixtures";

/**
 * Positive and negative controls of the suite's own checks: each guard must be seen to fire on a
 * planted defect, or a green run proves nothing. These tests use Playwright's plain `test`, not the
 * suite's fixture, because they plant on purpose what the fixture would fail the test for.
 */

const PAGE = "/hedge-desk";

test.describe("the sideways-scroll check, at the iPhone 15 profile", () => {
  test("runs at 393 px, and finds no overflow on a screen that fits", async ({ page }) => {
    expect(page.viewportSize()?.width, "the project's viewport").toBe(PHONE_WIDTH);
    await page.goto(PAGE);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await horizontalOverflow(page), "the Hedge desk fits in 393 px today").toBeNull();
  });

  test("reports a planted 900 px element", async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Plant only once React has hydrated the page: an element added to the server's HTML before
    // hydration is removed by it, and the check then measured 393 px (seen twice on the full
    // suite). The desk's instruments are drawn from its client-side read, so they mean hydrated.
    await expect(page.locator("#desk-instruments"), "the desk has loaded its data").toBeVisible();
    await page.evaluate(() => {
      const wide = document.createElement("div");
      wide.style.width = "900px";
      wide.style.height = "4px";
      // Where a too-wide image or table would be: in the flow of the screen, under its title.
      document.querySelector("h1")?.after(wide);
    });
    const widths = await page.evaluate(() => ({
      inner: window.innerWidth,
      content: document.documentElement.scrollWidth,
    }));
    // The trap the check must avoid: under mobile emulation innerWidth widens with the content.
    expect(widths.content, "the planted element widens the content").toBeGreaterThan(PHONE_WIDTH);
    expect(await horizontalOverflow(page), "the check sees the overflow").toEqual({
      content: widths.content,
      viewport: PHONE_WIDTH,
    });
  });
});

test.describe("the response check", () => {
  test("classifies statuses: 404 and 5xx anywhere, other 4xx from the API only", () => {
    const origin = "http://localhost:3460";
    expect(isUnaskedFailure(404, `${origin}/tickets`, origin)).toBe(true);
    expect(isUnaskedFailure(500, `${origin}/home`, origin)).toBe(true);
    expect(isUnaskedFailure(400, `${origin}/api/campaigns/preview`, origin)).toBe(true);
    expect(isUnaskedFailure(401, `${origin}/api/me`, origin)).toBe(true);
    expect(isUnaskedFailure(409, `${origin}/api/checkout`, origin)).toBe(true);
    expect(isUnaskedFailure(200, `${origin}/api/me`, origin)).toBe(false);
    expect(isUnaskedFailure(304, `${origin}/_next/static/x.js`, origin)).toBe(false);
    expect(isUnaskedFailure(401, `${origin}/home`, origin)).toBe(false);
  });

  /** A malformed body sent from the page: the API answers it 400 invalid_request. */
  async function plantBadRequest(page: Page): Promise<number> {
    const answered = page.waitForResponse((response) =>
      response.url().endsWith("/api/campaigns/preview"),
    );
    await page.evaluate(async () => {
      await fetch("/api/campaigns/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    });
    // Screens' listener was attached first, so it has run once this resolves.
    return (await answered).status();
  }

  test("reports a 4xx from the API that the test did not ask for", async ({ page, baseURL }) => {
    if (baseURL === undefined) throw new Error("playwright.config.ts must set use.baseURL");
    const origin = new URL(baseURL).origin;
    const watched = new Screens(page, origin);
    await watched.attach();
    await page.goto(PAGE);
    expect(watched.problemsSoFar, "the page itself is clean").toEqual([]);
    const status = await plantBadRequest(page);
    expect(status, "the planted request is refused with a 4xx").toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    expect(watched.problemsSoFar, "the check reports the 4xx with its URL").toEqual([
      `${status.toString()} POST ${origin}/api/campaigns/preview`,
    ]);
  });

  test("does not report a 4xx the test asked for", async ({ page, baseURL }) => {
    if (baseURL === undefined) throw new Error("playwright.config.ts must set use.baseURL");
    const watched = new Screens(page, new URL(baseURL).origin);
    watched.allowStatus(/\/api\/campaigns\/preview$/, 400);
    await watched.attach();
    await page.goto(PAGE);
    expect(await plantBadRequest(page)).toBe(400);
    expect(watched.problemsSoFar).toEqual([]);
  });
});

test("the dev server downloads no font: Sora's @font-face is the local fixture's", async ({
  page,
}) => {
  await page.goto("/");
  const faces = await page.evaluate(() => {
    const found: { family: string; src: string }[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSFontFaceRule) {
          found.push({
            family: rule.style.getPropertyValue("font-family"),
            src: rule.style.getPropertyValue("src"),
          });
        }
      }
    }
    return found;
  });
  const sora = faces.filter((face) => /sora/i.test(face.family) && !/fallback/i.test(face.family));
  expect(sora.length, `Sora's @font-face rules: ${JSON.stringify(faces)}`).toBeGreaterThan(0);
  for (const face of sora) {
    expect(face.src, "no file fetched from Google, only the fixture's local() names").toContain(
      "e2e-ui-no-network",
    );
    expect(face.src).not.toContain("url(");
  }
});

test("the limits of SPEC 17 are strict: 15 taps miss criterion 1", () => {
  expect(meetsLimit(CRITERIA.onboardingTaps - 1, CRITERIA.onboardingTaps)).toBe(true);
  expect(meetsLimit(CRITERIA.onboardingTaps, CRITERIA.onboardingTaps)).toBe(false);
  expect(meetsLimit(29_999, CRITERIA.scanToTicketSeconds * 1000)).toBe(true);
  expect(meetsLimit(30_000, CRITERIA.scanToTicketSeconds * 1000)).toBe(false);
});
