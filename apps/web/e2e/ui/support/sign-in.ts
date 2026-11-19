import type { Page } from "@playwright/test";

import { copy } from "../../../lib/copy";

import { expect } from "./fixtures";

/**
 * Signs in through the screens, with the simulated provider: `GET /api/me` answers its default, a
 * merchant, so the sign-in ends on the merchant's home. Not counted: the flows that use it are not
 * timed.
 */
export async function signInAsMerchant(page: Page): Promise<void> {
  await page.goto("/start");
  await page.getByLabel(copy.signIn.emailLabel).fill("joe@example.com");
  await page.getByRole("button", { name: copy.common.continue }).tap();
  await page.getByLabel(copy.signIn.codeDigit(1)).fill("123456");
  await expect(page, "a merchant's sign-in ends on the merchant space").toHaveURL(/\/home$/);
}

/**
 * Signs in from the fan's entry (« My tickets », SPEC C4), with the simulated provider: opens
 * `/tickets` signed out, which asks for the sign-in (`/start?from=tickets`), and ends back on the
 * list. `scenario` is the mock scenario of the whole visit (`fan` for `GET /api/me` answering a fan,
 * a `GET /api/tickets` scenario for the list).
 */
export async function signInAsFan(page: Page, scenario: string | null = null): Promise<void> {
  await page.goto(scenario === null ? "/tickets" : `/tickets?scenario=${scenario}`);
  await expect(page, "a signed-out fan is asked to sign in").toHaveURL(/\/start\?from=tickets$/);
  await page.getByLabel(copy.signIn.emailLabel).fill("maya@example.com");
  await page.getByRole("button", { name: copy.common.continue }).tap();
  await page.getByLabel(copy.signIn.codeDigit(1)).fill("123456");
  await expect(page, "the fan's sign-in ends on « My tickets »").toHaveURL(/\/tickets$/);
}
