import { copy } from "../../lib/copy";

import { expect, test } from "./support/fixtures";
import { knownDefectFromHere } from "./support/known-defects";
import { signInAsMerchant } from "./support/sign-in";

/**
 * The links a screen only shows after a tap, which the link check of the other flows cannot see,
 * and what SPEC section 5 lists that the screens do not have. Each test asserts what the defect's
 * observation depends on first, as an ordinary expectation, then marks itself expected to fail
 * (knownDefectFromHere) right before the expectation that shows the defect.
 */
test("M0: the « I'm a fan » link opens the fan's space", async ({ page, screens }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: `${copy.start.roleMenu.label}: ${copy.start.roleMenu.venues}` })
    .tap();
  const fanLink = page.getByRole("link", { name: copy.start.roleMenu.tickets });
  await expect(fanLink, "the menu offers the fan's space").toBeVisible();
  await expect(fanLink, "the fan's link leads to /tickets").toHaveAttribute("href", "/tickets");
  await screens.shot("m0-role-menu");
  const response = page.waitForResponse((answer) => new URL(answer.url()).pathname === "/tickets", {
    timeout: 60_000,
  });
  await fanLink.tap();
  const answer = await response;
  await expect(page, "the tap navigates").toHaveURL(/\/tickets$/);

  knownDefectFromHere("fanLinkDeadEnd");
  expect(answer.status(), "the fan's space exists").not.toBe(404);
  await expect(page.getByText(/404|could not be found/i)).toHaveCount(0, { timeout: 5_000 });
});

test("M8 offers the poster download (SPEC M8)", async ({ page }) => {
  // M8 needs a signed-in merchant: the simulated sign-in, `GET /api/me` answering a merchant.
  await signInAsMerchant(page);
  await page.goto("/new/cmp_joes_texas/live");
  await expect(page.getByRole("heading", { name: copy.live.title }), "M8 opens").toBeVisible();
  await expect(
    page.getByRole("img", { name: copy.live.qrAlt }),
    "M8 has loaded its promo (the QR code is drawn)",
  ).toBeVisible();

  await expect(page.getByRole("button", { name: copy.live.downloadPoster })).toBeVisible({
    timeout: 5_000,
  });
});
