import type { Page } from "@playwright/test";
import { apiExamples } from "@winz/shared";

import { copy } from "../../lib/copy";

import { expect, test } from "./support/fixtures";
import { signInAsFan, signInAsMerchant } from "./support/sign-in";

/**
 * Who is signed in, and where each person lands (SPEC 5.1 M0 and M1, ID-1, ID-2; review 2.2, 2.7
 * and section 3), on the simulated sign-in. The simulated session lives in `localStorage`
 * (`lib/auth/mock-auth-provider.tsx`), so a session that is kept is a key that is still there.
 */

const SESSION_KEY = "winz.sim-session";
const SCENARIO_KEY = "winz.mock-scenario";

async function sessionKept(page: Page): Promise<boolean> {
  return page.evaluate((key) => window.localStorage.getItem(key) !== null, SESSION_KEY);
}

test.describe("a slow or cold API never signs a merchant out (review 2.2)", () => {
  test("GET /api/me answers 503: retries, then « Can't reach Winz », the session kept, and a retry that works", async ({
    page,
    screens,
  }) => {
    screens.allowStatus(/\/api\/me$/, 503);
    await signInAsMerchant(page);

    // A reload while the API cannot check the session (`meUnavailable`: 503, as the server answers
    // when it cannot check a token). It is asked four times (now, then after 1 s, 2 s and 4 s).
    const asked: number[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/me") asked.push(Date.now());
    });
    await page.goto("/home?scenario=meUnavailable");
    const heading = page.getByRole("heading", { name: copy.signIn.unreachableTitle });
    await expect(heading, "the person is told the API cannot be reached").toBeVisible({
      timeout: 20_000,
    });
    // At least four: React's development mode may start the restore twice.
    expect(asked.length, "GET /api/me was asked, then retried three times").toBeGreaterThanOrEqual(
      4,
    );
    const first = asked[0] ?? 0;
    const last = asked[asked.length - 1] ?? 0;
    expect(last - first, "after waiting 1 s, 2 s and 4 s").toBeGreaterThanOrEqual(6_500);
    await expect(page, "nobody is sent to the sign-in screen").toHaveURL(/\/home\?scenario=/);
    expect(await sessionKept(page), "the session is not closed").toBe(true);
    await screens.shot("id-unreachable");

    // The API is back: the retry asks again and the merchant space opens, still signed in.
    await page.evaluate((key) => {
      window.sessionStorage.removeItem(key);
      window.history.replaceState(window.history.state, "", "/home");
    }, SCENARIO_KEY);
    await page.getByRole("button", { name: copy.common.tryAgain }).tap();
    await expect(page.getByText(copy.home.activePromos), "the merchant's home").toBeVisible();
    expect(await sessionKept(page)).toBe(true);
  });

  test("GET /api/me answers 403: the session ends, as for a 401", async ({ page, screens }) => {
    screens.allowStatus(/\/api\/me$/, 403);
    await signInAsMerchant(page);
    await page.goto("/home?scenario=meRefused");
    await expect(page, "a refused session goes back to the sign-in").toHaveURL(/\/start$/);
    expect(await sessionKept(page), "the refused session is closed").toBe(false);
  });
});

test.describe("where a person lands after signing in (review 2.7, ID-1, ID-2)", () => {
  test("a fan who signs in from the fan's entry finds his tickets, never « create a business »", async ({
    page,
  }) => {
    await signInAsFan(page, "fan");
    await expect(page.getByRole("heading", { name: copy.tickets.title })).toBeVisible();
    await expect(page.getByText(copy.tickets.signedInAs("maya@example.com"))).toBeVisible();
  });

  test("a new user from the fan's entry also lands on « My tickets »", async ({ page }) => {
    await signInAsFan(page, "newUser");
    await expect(page.getByRole("heading", { name: copy.tickets.title })).toBeVisible();
  });

  test("from the merchant's entry, a fan keeps today's path: create the business", async ({
    page,
  }) => {
    await page.goto("/start?scenario=fan");
    await expect(page.getByRole("heading", { name: copy.signIn.emailTitle })).toBeVisible();
    await page.getByLabel(copy.signIn.emailLabel).fill("maya@example.com");
    await page.getByRole("button", { name: copy.common.continue }).tap();
    await page.getByLabel(copy.signIn.codeDigit(1)).fill("123456");
    await expect(page).toHaveURL(/\/business$/);
  });

  test("a merchant who opens « My tickets » sees his own tickets", async ({ page }) => {
    await signInAsMerchant(page);
    await page.goto("/tickets");
    await expect(page.getByRole("heading", { name: copy.tickets.title })).toBeVisible();
    await expect(
      page.getByText(copy.tickets.signedInAs(apiExamples.meExamples.merchant.user.email ?? "")),
    ).toBeVisible();
    await expect(page.getByRole("list", { name: copy.tickets.listLabel("Live") })).toBeVisible();
  });
});

test.describe("the sign-in's own messages (review section 3)", () => {
  test("a failed resend of the code is said on the code screen", async ({ page }) => {
    await page.clock.install();
    await page.goto("/start");
    await page
      .getByLabel(copy.signIn.emailLabel)
      .fill(apiExamples.meExamples.merchant.user.email ?? "");
    await page.getByRole("button", { name: copy.common.continue }).tap();
    await expect(page.getByRole("heading", { name: copy.signIn.codeTitle })).toBeVisible();

    // The resend is offered after 30 s; the network is gone by then.
    await page.clock.fastForward(31_000);
    const resend = page.getByRole("button", { name: copy.signIn.resend, exact: true });
    await expect(resend).toBeEnabled();
    await page.evaluate(() => {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => false });
    });
    await resend.tap();
    await page.clock.fastForward(1_000);
    await expect(page.getByRole("alert").filter({ hasText: copy.signIn.sendFailed })).toBeVisible();
  });

  test("a sign-in the API refuses after Face ID does not read « Face ID didn't work »", async ({
    page,
    screens,
  }) => {
    screens.allowStatus(/\/api\/me$/, 403);
    await page.goto("/start?scenario=meRefused");
    await page.getByRole("button", { name: copy.signIn.faceId }).tap();
    await expect(page.getByText(copy.signIn.signInFailed)).toBeVisible();
    await expect(page.getByText(copy.signIn.passkeyFailed)).toHaveCount(0);
    await expect(page).toHaveURL(/\/start\?scenario=meRefused$/);
  });
});

test("the installed app's splash uses the design system's background (MASTER: #0B0B0C)", async ({
  page,
}) => {
  const response = await page.request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  const manifest = (await response.json()) as { background_color?: string };
  expect(manifest.background_color?.toUpperCase()).toBe("#0B0B0C");
});
