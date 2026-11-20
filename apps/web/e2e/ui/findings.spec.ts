import { copy } from "../../lib/copy";

import { expect, test } from "./support/fixtures";
import { signInAsMerchant } from "./support/sign-in";

/**
 * The links a screen only shows after a tap, which the link check of the other flows cannot see,
 * and what SPEC section 5 lists that the screens did not have. Both were kept here as expected
 * failures while the defect stood (support/known-defects.ts); both are fixed, so each is now an
 * ordinary expectation.
 */
test("M0: the « I'm a fan » link opens the fan's space", async ({ page, screens }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: `${copy.start.roleMenu.label}: ${copy.start.roleMenu.venues}` })
    .tap();
  const fanLink = page.getByRole("link", { name: copy.start.roleMenu.fan });
  await expect(fanLink, "the menu offers the fan's space, worded as SPEC M0 says").toBeVisible();
  await expect(fanLink, "the link reads « I'm a fan »").toHaveText(copy.start.roleMenu.fan);
  await expect(fanLink, "the fan's link leads to /tickets").toHaveAttribute("href", "/tickets");
  await screens.shot("m0-role-menu");
  const response = page.waitForResponse((answer) => new URL(answer.url()).pathname === "/tickets", {
    timeout: 60_000,
  });
  await fanLink.tap();
  const answer = await response;

  expect(answer.status(), "the fan's space exists").not.toBe(404);
  await expect(page.getByText(/404|could not be found/i)).toHaveCount(0, { timeout: 5_000 });
  // Nobody is signed in: « My tickets » asks for the fan's sign-in (e2e/ui/tickets.spec.ts goes on).
  await expect(page, "a signed-out fan is asked to sign in").toHaveURL(/\/start\?from=tickets$/);
  await expect(page.getByRole("heading", { name: copy.signIn.fanEmailTitle })).toBeVisible();
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

test("M8: « Share » and « Download QR » keep their whole label, clear of their round icon", async ({
  page,
}) => {
  await signInAsMerchant(page);
  await page.goto("/new/cmp_joes_texas/live");
  await expect(page.getByRole("heading", { name: copy.live.title }), "M8 opens").toBeVisible();
  for (const name of [copy.live.share, copy.live.downloadQr, copy.live.downloadPoster]) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button, `M8 shows « ${name} »`).toBeVisible();
    const fit = await button.evaluate((element) => {
      const label = element.firstElementChild;
      const text = label?.lastElementChild;
      const icon = element.lastElementChild;
      if (
        !(label instanceof HTMLElement) ||
        !(text instanceof HTMLElement) ||
        icon === null ||
        icon === label
      ) {
        return null;
      }
      return {
        text: text.textContent,
        cut: text.scrollWidth > text.clientWidth,
        gap: Math.round(icon.getBoundingClientRect().left - label.getBoundingClientRect().right),
      };
    });
    expect(fit, `« ${name} » has a label and an icon`).not.toBeNull();
    expect(fit?.text).toBe(name);
    expect(fit?.cut, `« ${name} » is not cut`).toBe(false);
    expect(fit?.gap ?? 0, `« ${name} » has room before its icon`).toBeGreaterThanOrEqual(8);
  }
});
