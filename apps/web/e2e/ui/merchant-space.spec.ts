import type { Locator, Page } from "@playwright/test";
import { apiExamples } from "@winz/shared";

import { copy } from "../../lib/copy";
import { formatMoney } from "../../lib/format";

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

/**
 * The figure tile (or card) whose label is `label`: the innermost block that holds the label, so
 * the figure read is the one printed under that label and not a same amount elsewhere.
 */
function figureOf(page: Page, label: string): Locator {
  return page
    .locator("div")
    .filter({ has: page.getByText(label, { exact: true }) })
    .last();
}

/** `GET /api/campaigns/:id`, and only it (not `/pause`, `/resume`, `/close`, `/top-up`). */
const DETAIL_URL = /\/api\/campaigns\/[^/?]+(\?.*)?$/;

/** The merchant of the simulated API: his balance, from a settled promo (available) and a live one. */
const BALANCE = apiExamples.meExamples.merchant.balance;

test.describe("the merchant space (SPEC 5.2)", () => {
  test("home, and the list with its two tabs", async ({ page, screens }) => {
    await signInAsMerchant(page);
    await expect(
      page.getByText(copy.home.activePromos),
      "the home lists the active promos",
    ).toBeVisible();
    // The settled promo paid its sales: the balance is not « $0.00 » (the story of the examples).
    expect(BigInt(BALANCE.available)).toBeGreaterThan(0n);
    await expect(
      page.getByLabel(formatMoney(BALANCE.available), { exact: true }).first(),
      "the home shows the available balance",
    ).toBeVisible();
    await expect(page.getByLabel("$0.00", { exact: true })).toHaveCount(0);
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
    // The app says « promo » everywhere, its badge included (not « Live campaign »).
    await expect(page.getByText(copy.campaigns.liveBadge, { exact: true })).toBeVisible();
    await expect(page.getByText(/campaign/i)).toHaveCount(0);
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
    /** The report's closing line, true for that result. */
    closing: string | null;
  }[] = [
    {
      scenario: "paused",
      receipt: "md-detail-paused",
      badge: copy.campaigns.status.paused,
      report: null,
      closing: null,
    },
    {
      scenario: "settledYes",
      receipt: "md-detail-settled-yes",
      badge: copy.campaigns.status.settled_yes,
      report: copy.campaignDetail.report.wonBody,
      closing: "Same as a 12.5% discount. The refunds cost you nothing more.",
    },
    {
      scenario: "settledNo",
      receipt: "md-detail-settled-no",
      badge: copy.campaigns.status.settled_no,
      report: copy.campaignDetail.report.lostBody,
      closing: "Same as a 12.5% discount… but only when you win.",
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
      if (status.scenario === "paused") {
        // A paused promo sells nothing: its Stats tab says why, not « Up to 0 more sales ».
        const paused = apiExamples.campaignDetailExamples.paused;
        await expect(
          page
            .getByRole("tabpanel")
            .getByText(copy.campaignDetail.saleState(paused.saleState, 18, paused.subjectName), {
              exact: true,
            }),
          "the Stats tab says the promo is paused, and why",
        ).toBeVisible();
        await expect(page.getByText(/more sales$/)).toHaveCount(0);
      }
      if (status.report !== null) {
        await expect(
          page.getByRole("heading", { name: copy.campaignDetail.report.title }),
        ).toBeVisible();
        await expect(page.getByText(status.report)).toBeVisible();
        await expect(page.getByText(copy.campaignDetail.report.newCustomers)).toBeVisible();
        await expect(
          page.getByText(status.closing ?? "", { exact: true }),
          "the report ends with a line true for its result",
        ).toBeVisible();
        await expect(page.getByText(/^Same as a .+ discount/)).toHaveCount(1);
      }
      // The merchant's words: a promo that didn't hit is « No refunds », never « Lost ».
      await expect(page.getByText(/\bLost\b/)).toHaveCount(0);
      await screens.shot(status.receipt);
    });
  }

  test("a cancelled game: Cancelled in the detail and its report, never Lost", async ({
    page,
    screens,
  }) => {
    await signInAsMerchant(page);
    await page.goto("/campaigns");
    const href = await firstCampaignHref(page);
    await page.goto(`${href}?scenario=cancelled`);
    await expect(
      page.getByText(copy.campaigns.status.void, { exact: true }).first(),
      "the status says Cancelled",
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: copy.campaignDetail.report.title }),
    ).toBeVisible();
    await expect(
      page.getByText(copy.campaignDetail.report.cancelledBody),
      "the report says what a cancelled game means for the merchant",
    ).toBeVisible();
    await expect(page.getByText(copy.campaignDetail.report.lostBody)).toHaveCount(0);
    await expect(page.getByText(copy.campaignDetail.report.lost, { exact: true })).toHaveCount(0);
    await expect(page.getByText(copy.campaignDetail.report.wonBody)).toHaveCount(0);
    await screens.shot("md-detail-cancelled");
  });

  test("a live promo shows its exposure and its 0 to 100% coverage gauge (SPEC 5.2)", async ({
    page,
  }) => {
    await signInAsMerchant(page);
    await page.goto("/campaigns");
    const href = await firstCampaignHref(page);
    // The live example has exposure = revenue (100% back); a 50% promo tells the two apart, so the
    // figure shown is proven to be `exposure` and not the gross sales.
    await page.route(DETAIL_URL, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ response, json: { ...body, exposure: "72000000", hedgedBps: 6667 } });
    });
    await page.goto(`${href}?scenario=live`);

    const exposure = figureOf(page, copy.campaignDetail.exposure);
    await expect(exposure, "the exposure is shown").toBeVisible();
    await expect(exposure.getByLabel("$72", { exact: true })).toBeVisible();
    await expect(figureOf(page, copy.campaignDetail.grossSales).getByLabel("$144")).toBeVisible();

    const gauge = page.getByRole("progressbar", { name: copy.campaignDetail.coverageBar });
    await expect(gauge, "the coverage is a gauge, not a bare number").toBeVisible();
    await expect(gauge).toHaveAttribute("aria-valuemin", "0");
    await expect(gauge).toHaveAttribute("aria-valuemax", "100");
    await expect(gauge).toHaveAttribute("aria-valuenow", "67");
    await expect(figureOf(page, copy.campaignDetail.coverage)).toContainText("67%");
    // The poll goes on after the last check: stop answering it before the page closes.
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("a sale shows within 3 seconds on polling alone (criterion 7, Realtime absent)", async ({
    page,
    screens,
  }) => {
    await signInAsMerchant(page);
    await page.goto("/campaigns");
    const href = await firstCampaignHref(page);
    // The suite runs the simulated mode, where nothing subscribes to Supabase, and any request
    // leaving the machine would fail the test: only the re-reads of the API can bring the sale.
    let sold = false;
    await page.route(DETAIL_URL, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { sales: number; revenue: string };
      await route.fulfill({
        response,
        json: sold ? { ...body, sales: body.sales + 1, revenue: "156000000" } : body,
      });
    });
    await page.goto(`${href}?scenario=live`);
    const sales = figureOf(page, copy.campaignDetail.sales);
    await expect(sales).toHaveText(/^Sales\s*12$/);

    sold = true;
    const began = Date.now();
    // Checked on every frame in the page, so the time measured is the screen's, not the poll of
    // an assertion.
    await page.waitForFunction(
      (label) =>
        [...document.querySelectorAll("p")].some(
          (p) =>
            p.textContent?.trim() === label && p.nextElementSibling?.textContent?.trim() === "13",
        ),
      copy.campaignDetail.sales,
      { polling: "raf", timeout: 10_000 },
    );
    const elapsed = Date.now() - began;
    expect(elapsed, `the sale showed after ${elapsed.toString()} ms`).toBeLessThan(3000);
    await expect(figureOf(page, copy.campaignDetail.grossSales).getByLabel("$156")).toBeVisible();
    await screens.shot("md-detail-polled-sale");
    // The poll goes on after the last check: stop answering it before the page closes.
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("when the re-reads fail, the figures say they are not fresh", async ({ page, screens }) => {
    await signInAsMerchant(page);
    await page.goto("/campaigns");
    const href = await firstCampaignHref(page);
    let answered = 0;
    screens.allowStatus(DETAIL_URL, 503);
    await page.route(DETAIL_URL, async (route) => {
      answered += 1;
      if (answered === 1) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 503,
        json: { error: { code: "internal", message: "Service unavailable" } },
      });
    });
    await page.goto(`${href}?scenario=live`);
    await expect(figureOf(page, copy.campaignDetail.sales)).toHaveText(/^Sales\s*12$/);

    await expect(
      page.getByText(copy.campaignDetail.reconnecting),
      "a failed re-read is said on screen",
    ).toBeVisible();
    await expect(
      page.getByText(copy.campaignDetail.chartNoQuote).first(),
      "the live chance is no longer shown as current",
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: copy.campaignDetail.liveChance }).locator("xpath=../.."),
    ).toContainText("–");
    // The last figures stay, under the message that they are the last ones.
    await expect(figureOf(page, copy.campaignDetail.sales)).toHaveText(/^Sales\s*12$/);
    await screens.shot("md-detail-stale");
    // The poll goes on after the last check: stop answering it before the page closes.
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("the totals count the sales of a cancelled game, which the merchant keeps (SPEC 4.6, ST-4)", async ({
    page,
    screens,
  }) => {
    // The home's figures are those of this month: the examples are dated November 2026.
    await page.clock.setFixedTime(new Date("2026-11-21T12:00:00-06:00"));
    await signInAsMerchant(page);

    await page.goto("/home?scenario=withCancelled");
    // 12 + 31 + 5 sales of $12: $144 + $372 + $60.
    await expect(figureOf(page, copy.home.grossSales).getByLabel("$576")).toBeVisible();
    await expect(figureOf(page, copy.home.sales)).toHaveText(/^Sales\s*48$/);
    await screens.shot("md-home-with-cancelled");

    await page.goto("/stats?scenario=withCancelled");
    await expect(figureOf(page, copy.stats.grossSales).getByLabel("$576")).toBeVisible();
    await expect(figureOf(page, copy.stats.sales)).toHaveText(/^Sales\s*48$/);
    await expect(figureOf(page, copy.stats.promos)).toHaveText(/^Promos run\s*3$/);
    await expect(page.getByText("100% back if Pitt wins by 7+")).toBeVisible();
    await screens.shot("md-stats-with-cancelled");

    await page.goto("/campaigns?scenario=withCancelled");
    const tabs = page.getByRole("radiogroup", { name: copy.campaigns.tabsLabel });
    await tabs.getByRole("radio", { name: copy.campaigns.closed }).tap();
    await expect(
      page
        .getByRole("link", { name: copy.campaigns.open("100% back if Pitt wins by 7+") })
        .getByText(copy.campaigns.status.void, { exact: true }),
      "the list says Cancelled, not Lost",
    ).toBeVisible();
  });

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
