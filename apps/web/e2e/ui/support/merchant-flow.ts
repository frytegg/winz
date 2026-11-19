import type { Locator, Page, Request, Route } from "@playwright/test";

import { copy } from "../../../lib/copy";

import { expect } from "./fixtures";

/**
 * The merchant's steps the money-path specs walk again and again, without counting taps (the
 * timed M0 to M8 flow is in merchant-onboarding.spec.ts), and a way to lose an answer on its way
 * back to the browser.
 */

/** Signs in through the screens as a user with no business yet: ends on M2. */
export async function signInAsNewUser(page: Page): Promise<void> {
  await page.goto("/start?scenario=newUser");
  await page.getByLabel(copy.signIn.emailLabel).fill("new@example.com");
  await page.getByRole("button", { name: copy.common.continue }).tap();
  await page.getByLabel(copy.signIn.codeDigit(1)).fill("123456");
  await expect(page, "a new user's sign-in ends on M2").toHaveURL(/\/business$/);
}

/** From M3 (already signed in as a merchant) to M6, with the first game's recommended promo. */
export async function reachMargin(page: Page, scenario?: string): Promise<void> {
  await page.goto(scenario === undefined ? "/new" : `/new?scenario=${scenario}`);
  await expect(page.getByRole("heading", { name: copy.wizard.steps.game }), "M3").toBeVisible();
  await page.locator("section").getByRole("button", { disabled: false }).first().tap();
  await expect(page.getByRole("heading", { name: copy.wizard.steps.promo }), "M4").toBeVisible();
  await page.getByRole("button", { name: new RegExp(copy.pickPromo.recommended) }).tap();
  await expect(page.getByRole("heading", { name: copy.wizard.steps.offer }), "M5").toBeVisible();
  await page.getByRole("button", { name: copy.common.continue }).tap();
  await expect(page.getByRole("heading", { name: copy.wizard.steps.margin }), "M6").toBeVisible();
}

/** M6 → M7, once M6's preview has answered. */
export async function marginToReview(page: Page): Promise<void> {
  const review = page.getByRole("button", { name: copy.margin.reviewCta });
  await expect(review, "M6 can go on").toBeEnabled();
  await review.tap();
  await expect(page.getByRole("heading", { name: copy.wizard.steps.review }), "M7").toBeVisible();
}

/** M7's one funding button in simulated mode. */
export function fundButton(page: Page): Locator {
  return page.getByRole("button", { name: new RegExp(`^${copy.review.simulatePayment}`) });
}

/** The `requestId` of a `POST /api/campaigns` (or of a top-up). */
export function requestIdOf(request: Request): string {
  const body: unknown = request.postDataJSON();
  if (typeof body !== "object" || body === null || !("requestId" in body)) {
    throw new Error(`${request.url()} was sent without a requestId`);
  }
  const { requestId } = body as { requestId: unknown };
  if (typeof requestId !== "string")
    throw new Error(`requestId is not a string: ${String(requestId)}`);
  return requestId;
}

/**
 * The answer is lost on its way back: the server receives the request and answers it (the
 * simulated API, like the real one, has then done its work), and the browser sees a dropped
 * connection. `blockedbyclient` keeps Chromium's console line among the allowed ones.
 */
export async function loseAnswer(route: Route): Promise<void> {
  await route.fetch();
  await route.abort("blockedbyclient");
}

/** `POST /api/campaigns` exactly (not the preview, not a campaign's own routes). */
export function isCreateCampaign(url: URL): boolean {
  return url.pathname === "/api/campaigns";
}
