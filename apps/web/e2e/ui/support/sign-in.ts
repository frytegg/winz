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
