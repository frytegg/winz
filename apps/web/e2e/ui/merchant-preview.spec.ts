import type { Page } from "@playwright/test";
import { apiExamples } from "@winz/shared";

import { copy } from "../../lib/copy";
import { EMPTY_DRAFT, acceptedCostBps, resolveOffer } from "../../lib/wizard/draft";
import { MARKET_RETRY_CAP_MS } from "../../lib/wizard/market-watch";

import { expect, test } from "./support/fixtures";
import type { ReceiptName } from "./support/receipts";
import { signInAsMerchant } from "./support/sign-in";

/**
 * M4 to M6 when the promo would not sell today: the scenarios of `POST /api/campaigns/preview`
 * other than `open` (`aboveThreshold`: the odds are past the pause threshold; `noBook`: the market
 * has no book yet), and M4's template that cannot be picked (the default list of games has one).
 */

const FIRST_EVENT = apiExamples.eventsExample.events[0];

/** The template of the first game that has no book: shown greyed, not offered. */
function unavailableTemplate(): { headline: string } {
  const template = FIRST_EVENT?.templates.find((candidate) => !candidate.available);
  if (template === undefined) {
    throw new Error("the default list of games no longer has a template without a book");
  }
  return template;
}

/** From the merchant's home to M6 for the first game's recommended promo, under `scenario`. */
async function reachMargin(page: Page, scenario: string): Promise<void> {
  await signInAsMerchant(page);
  await page.goto(`/new?scenario=${scenario}`);
  await expect(
    page.getByRole("heading", { name: copy.wizard.steps.game }),
    "M3 opens",
  ).toBeVisible();
  await page.locator("section").getByRole("button", { disabled: false }).first().tap();
  await expect(page.getByRole("heading", { name: copy.wizard.steps.promo }), "M4").toBeVisible();
  await page.getByRole("button", { name: new RegExp(copy.pickPromo.recommended) }).tap();
  await expect(page.getByRole("heading", { name: copy.wizard.steps.offer }), "M5").toBeVisible();
  await page.getByRole("button", { name: copy.common.continue }).tap();
  await expect(page.getByRole("heading", { name: copy.wizard.steps.margin }), "M6").toBeVisible();
}

test("M4: a promo whose market has no book is shown greyed and cannot be picked", async ({
  page,
}) => {
  const { headline } = unavailableTemplate();
  await signInAsMerchant(page);
  await page.goto("/new");
  await page.locator("section").getByRole("button", { disabled: false }).first().tap();
  await expect(page.getByRole("heading", { name: copy.wizard.steps.promo })).toBeVisible();
  await expect(page.getByText(headline, { exact: true }), "the template is listed").toBeVisible();
  await expect(
    page.getByText(copy.pickPromo.noBook),
    "it says why it cannot be picked",
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: new RegExp(headline.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }),
    "it is not a button",
  ).toHaveCount(0);
  await expect(
    page.getByText(copy.pickPromo.recommended),
    "only one promo is recommended, and not the greyed one",
  ).toHaveCount(1);
});

/** The cost a sale may have with the merchant's M6 defaults, from the same function M4 greys with. */
const MERCHANT = apiExamples.meExamples.merchant.merchant;
const CAP_BPS = acceptedCostBps(resolveOffer(EMPTY_DRAFT, MERCHANT));

function escaped(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

test("M4: on Saturday's game, the promo priced around 91% costs more than the margins allow: greyed, with the reason (scenario aboveThreshold)", async ({
  page,
}) => {
  const templates = FIRST_EVENT?.templates ?? [];
  const tooDear = templates.find((template) => template.probabilityBps === 9100);
  const other = templates.find((template) => template.id === "tpl_ark_ml_full");
  if (tooDear?.costBps == null || other?.costBps == null) {
    throw new Error("Saturday's game no longer has its 91% template and the Arkansas one");
  }
  expect(tooDear.costBps, "the 91% side costs more than the merchant accepts").toBeGreaterThan(
    CAP_BPS,
  );
  expect(other.costBps, "the other side costs less").toBeLessThanOrEqual(CAP_BPS);

  await signInAsMerchant(page);
  await page.goto("/new?scenario=aboveThreshold");
  await page.locator("section").getByRole("button", { disabled: false }).first().tap();
  await expect(page.getByRole("heading", { name: copy.wizard.steps.promo })).toBeVisible();

  await expect(page.getByText(tooDear.headline, { exact: true }), "it is listed").toBeVisible();
  await expect(
    page.getByRole("button", { name: escaped(tooDear.headline) }),
    "it cannot be picked",
  ).toHaveCount(0);
  await expect(
    page.getByText(copy.pickPromo.aboveCap(CAP_BPS / 100), { exact: true }),
    "it says why",
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: escaped(other.headline) }),
    "the other side of the game can be picked",
  ).toBeEnabled();
});

const BLOCKED: readonly {
  scenario: "aboveThreshold" | "noBook";
  receipt: ReceiptName;
  explanation: string;
  costShown: boolean;
  /**
   * A market with no book may open by itself within seconds (the first preview of a game makes the
   * engine open it): M6 first says it is opening and asks again, and only after
   * `MARKET_RETRY_CAP_MS` says it did not open. A price past the threshold is not waited for.
   */
  waitsForMarket: boolean;
}[] = [
  {
    scenario: "aboveThreshold",
    receipt: "m6-above-threshold",
    explanation: copy.margin.pausedPrice,
    costShown: true,
    waitsForMarket: false,
  },
  {
    scenario: "noBook",
    receipt: "m6-no-book",
    explanation: copy.margin.marketStillClosed,
    costShown: false,
    waitsForMarket: true,
  },
];

for (const blocked of BLOCKED) {
  test(`M6 with the preview ${blocked.scenario}: says why, and offers another promo instead of the review`, async ({
    page,
    screens,
  }) => {
    const preview = apiExamples.campaignPreviewExamples[blocked.scenario];
    await reachMargin(page, blocked.scenario);
    if (blocked.waitsForMarket) {
      // The wait is real: a minute of previews every few seconds, then the message.
      test.setTimeout(MARKET_RETRY_CAP_MS + 150_000);
      await expect(
        page.getByRole("status").filter({ hasText: copy.margin.marketOpening }),
        "M6 says the market is opening",
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: copy.margin.reviewCta }),
        "the review cannot be reached while the market opens",
      ).toHaveCount(0);
    }
    await expect(
      page.getByRole("status").filter({ hasText: blocked.explanation }),
      "M6 says why the promo would not sell",
    ).toBeVisible({ timeout: blocked.waitsForMarket ? MARKET_RETRY_CAP_MS + 30_000 : 10_000 });
    if (blocked.waitsForMarket) {
      await expect(
        page.getByRole("button", { name: copy.margin.checkAgain }),
        "M6 offers to check again once it has given up",
      ).toBeVisible();
    }
    await expect(
      page.getByText(copy.margin.capacity(preview.capacity.sales), { exact: true }),
      "M6 shows the capacity the preview answered",
    ).toBeVisible();
    await expect(
      page.getByText(copy.margin.costLabel),
      blocked.costShown ? "the cost per sale is shown" : "no cost per sale without a book",
    ).toHaveCount(blocked.costShown ? 1 : 0);
    await expect(
      page.getByRole("button", { name: copy.margin.reviewCta }),
      "the review cannot be reached",
    ).toHaveCount(0);
    const another = page.getByRole("button", { name: copy.margin.pickAnother });
    await expect(another, "M6 offers to pick another promo").toBeVisible();
    await screens.shot(blocked.receipt);
    await another.tap();
    await expect(
      page.getByRole("heading", { name: copy.wizard.steps.promo }),
      "« Pick another promo » leads back to M4",
    ).toBeVisible();
  });
}
