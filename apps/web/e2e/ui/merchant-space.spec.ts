import type { Page } from "@playwright/test";

import { copy } from "../../lib/copy";

import { expect, test } from "./support/fixtures";
import type { ReceiptName } from "./support/receipts";
import { signInAsMerchant } from "./support/sign-in";

/** The id of the first promo card of the list that leads to a campaign's detail. */
async function firstCampaignHref(page: Page): Promise<string> {
  const card = page.getByRole("link", { name: /^Open the promo: / }).first();
  await expect(card, "the list shows at least one promo").toBeVisible();
  const href = await card.getAttribute("href");
  if (href === null) throw new Error("a promo card without a link");
  return href;
}

test.describe("the merchant space (SPEC 5.2)", () => {
  test("home, and the list with its two tabs", async ({ page, screens }) => {
    await signInAsMerchant(page);
    await expect(
      page.getByText(copy.home.activePromos),
      "the home lists the active promos",
    ).toBeVisible();
    await screens.shot("md-home");

    await page
      .getByRole("navigation", { name: copy.nav.main })
      .getByRole("link", { name: copy.nav.promos })
      .tap();
    await expect(page).toHaveURL(/\/campaigns$/);
    const tabs = page.getByRole("radiogroup", { name: copy.campaigns.tabsLabel });
    await expect(tabs.getByRole("radio", { name: copy.campaigns.inProgress })).toBeChecked();
    await firstCampaignHref(page);
    await expect(
      page.getByText(copy.campaigns.status.live).first(),
      "a live promo says Live",
    ).toBeVisible();
    await screens.shot("md-list-in-progress");

    await tabs.getByRole("radio", { name: copy.campaigns.closed }).tap();
    await expect(tabs.getByRole("radio", { name: copy.campaigns.closed })).toBeChecked();
    await expect(
      page.getByText(copy.campaigns.status.settled_no).first(),
      "the closed tab shows a finished promo with its result",
    ).toBeVisible();
    await screens.shot("md-list-closed");
  });

  test("the list with a promo whose budget was never paid (withFunding)", async ({
    page,
    screens,
  }) => {
    await signInAsMerchant(page);
    await page.goto("/campaigns?scenario=withFunding");
    await firstCampaignHref(page);
    await screens.shot("md-list-with-funding");
  });

  test("a live promo: its three tabs, then pause and resume", async ({ page, screens }) => {
    await signInAsMerchant(page);
    await page.goto("/campaigns");
    const href = await firstCampaignHref(page);
    await page.goto(`${href}?scenario=live`);

    const tabs = page.getByRole("tablist", { name: copy.campaignDetail.tabsLabel });
    await expect(tabs, "the detail opens on its tabs").toBeVisible();
    await expect(page.getByText(copy.campaignDetail.coverage, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: copy.campaignDetail.liveChance })).toBeVisible();
    await screens.shot("md-detail-live-stats");

    await tabs.getByRole("tab", { name: copy.campaignDetail.tabs.budget }).tap();
    await expect(page.getByText(copy.campaignDetail.budgetTitle)).toBeVisible();
    await expect(page.getByRole("button", { name: copy.campaignDetail.addBudget })).toBeVisible();
    await screens.shot("md-detail-live-budget");

    await tabs.getByRole("tab", { name: copy.campaignDetail.tabs.controls }).tap();
    await expect(
      page.getByText("Selling", { exact: true }),
      "a live promo is selling",
    ).toBeVisible();
    const pause = page.getByRole("button", { name: copy.campaignDetail.pause });
    await expect(pause).toBeVisible();
    await screens.shot("md-detail-live-controls");

    await pause.tap();
    await expect(
      page.getByText(copy.campaignDetail.paused, { exact: true }),
      "the pause is confirmed",
    ).toBeVisible();
    await expect(
      page.getByText(copy.campaignDetail.saleState("paused_manual", 0, null)),
    ).toBeVisible();
    const resume = page.getByRole("button", { name: copy.campaignDetail.resume });
    await expect(resume, "a manual pause can be resumed").toBeVisible();
    await screens.shot("md-detail-paused-by-you");

    await resume.tap();
    await expect(
      page.getByText(copy.campaignDetail.resumed),
      "the resume is confirmed",
    ).toBeVisible();
    await expect(page.getByRole("button", { name: copy.campaignDetail.pause })).toBeVisible();
    await screens.shot("md-detail-resumed");
  });

  const STATUSES: readonly {
    scenario: string;
    receipt: ReceiptName;
    badge: string;
    report: string | null;
  }[] = [
    {
      scenario: "paused",
      receipt: "md-detail-paused",
      badge: copy.campaigns.status.paused,
      report: null,
    },
    {
      scenario: "settledYes",
      receipt: "md-detail-settled-yes",
      badge: copy.campaigns.status.settled_yes,
      report: copy.campaignDetail.report.wonBody,
    },
    {
      scenario: "settledNo",
      receipt: "md-detail-settled-no",
      badge: copy.campaigns.status.settled_no,
      report: copy.campaignDetail.report.lostBody,
    },
  ];

  for (const status of STATUSES) {
    test(`a promo ${status.scenario}: its detail${status.report === null ? "" : " and its report"}`, async ({
      page,
      screens,
    }) => {
      await signInAsMerchant(page);
      await page.goto("/campaigns");
      const href = await firstCampaignHref(page);
      await page.goto(`${href}?scenario=${status.scenario}`);
      await expect(
        page.getByText(status.badge, { exact: true }).first(),
        "the status is shown",
      ).toBeVisible();
      if (status.report !== null) {
        await expect(
          page.getByRole("heading", { name: copy.campaignDetail.report.title }),
        ).toBeVisible();
        await expect(page.getByText(status.report)).toBeVisible();
        await expect(page.getByText(copy.campaignDetail.report.newCustomers)).toBeVisible();
        await expect(
          page.getByText(/^Same as a .+ discount… but only when you win\.$/),
        ).toBeVisible();
      }
      await screens.shot(status.receipt);
    });
  }

  test("the settings: profile, balance, technical details folded, sign out", async ({
    page,
    screens,
  }) => {
    await signInAsMerchant(page);
    await page.getByRole("link", { name: copy.merchantSpace.account }).first().tap();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { name: copy.settings.title })).toBeVisible();
    await expect(page.getByText(copy.settings.profile)).toBeVisible();
    await expect(page.getByText(copy.settings.technical)).toBeVisible();
    await expect(
      page.getByText(copy.settings.address),
      "the technical details are folded",
    ).toBeHidden();
    await expect(page.getByRole("button", { name: copy.settings.signOut })).toBeVisible();
    await screens.shot("md-settings");
  });
});
