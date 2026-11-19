import { apiExamples } from "@winz/shared";

import { copy } from "../../lib/copy";
import { centsToMicro, formatMoney, formatMoneyCompact } from "../../lib/format";
import { DEFAULT_BUDGET_CENTS } from "../../lib/wizard/draft";

import { CRITERIA, meetsLimit } from "./support/criteria";
import { expect, test } from "./support/fixtures";
import { recordMeasure, seconds } from "./support/measures";
import { TapCounter } from "./support/taps";

/** SPEC section 17, criterion 1: strictly fewer than 15 taps and 2 minutes. */
const MAX_TAPS = CRITERIA.onboardingTaps;
const MAX_SECONDS = CRITERIA.onboardingSeconds;
/** What the simulated `POST /api/campaigns/preview` answers by default, shown in M6 and M7. */
const PREVIEW = apiExamples.campaignPreviewExamples.open;
/** M6's budget is left at its default: M7 funds exactly that. */
const BUDGET = formatMoneyCompact(centsToMicro(DEFAULT_BUDGET_CENTS));

/**
 * M0 to M8 as a new user (`?scenario=newUser`: `GET /api/me` answers a user with no business), on
 * the simulated sign-in and the simulated payment. Every gesture goes through the counter.
 */
test("M0 to M8: a new merchant puts a promo live in fewer than 15 taps and 2 minutes", async ({
  page,
  screens,
}) => {
  const taps = new TapCounter();

  // M0
  await page.goto("/?scenario=newUser");
  const startCta = page.getByRole("link", { name: copy.start.cta });
  await expect(page.getByRole("heading", { level: 1 }), "M0 shows the promise").toContainText(
    copy.start.title[0],
  );
  await expect(startCta, "M0 has its one call to action").toBeVisible();
  const started = Date.now();
  const receiptsBefore = screens.receiptMs;
  await screens.shot("m0-home");
  await taps.tap(startCta, `« ${copy.start.cta} » (M0)`);

  // M1, e-mail then code
  await expect(
    page.getByRole("heading", { name: copy.signIn.emailTitle }),
    "M1 opens",
  ).toBeVisible();
  await taps.type(page.getByLabel(copy.signIn.emailLabel), "owner@example.com", "the e-mail (M1)");
  await screens.shot("m1-email");
  await taps.tap(page.getByRole("button", { name: copy.common.continue }), "Continue (M1)");
  await expect(
    page.getByRole("heading", { name: copy.signIn.codeTitle }),
    "M1 asks for the code once the e-mail is sent",
  ).toBeVisible();
  await screens.shot("m1-code");
  // The phone offers the e-mailed code above the keyboard: one gesture fills the six boxes, and
  // the screen sends it by itself on the sixth digit.
  await taps.type(page.getByLabel(copy.signIn.codeDigit(1)), "123456", "the 6-digit code (M1)");

  // M2
  await expect(
    page.getByRole("heading", { name: copy.business.title }),
    "a new user lands on M2 after the code",
  ).toBeVisible();
  await taps.type(
    page.getByLabel(copy.business.nameLabel),
    "Joe's Texas Bar",
    "the business name (M2)",
  );
  await taps.tap(
    page.getByRole("button", { name: copy.business.categories.bar }),
    `the category « ${copy.business.categories.bar} » (M2)`,
  );
  await screens.shot("m2-business");
  await taps.tap(page.getByRole("button", { name: copy.common.continue }), "Continue (M2)");

  // M3
  await expect(
    page.getByRole("heading", { name: copy.wizard.steps.game }),
    "M2 leads to M3, the games",
  ).toBeVisible();
  const games = page.locator("section").getByRole("button", { disabled: false });
  await expect(games.first(), "M3 lists at least one game that can be picked").toBeVisible();
  await screens.shot("m3-game");
  await taps.tap(games.first(), "the first game (M3)");

  // M4
  await expect(
    page.getByRole("heading", { name: copy.wizard.steps.promo }),
    "picking a game moves on to M4 by itself",
  ).toBeVisible();
  const recommended = page.getByRole("button", { name: new RegExp(copy.pickPromo.recommended) });
  await expect(recommended, "M4 recommends one promo").toBeVisible();
  await expect(
    page.getByText(/^Costs you ~\d+% of the price$/).first(),
    "M4 shows the estimated cost on the cards",
  ).toBeVisible();
  await screens.shot("m4-promo");
  await taps.tap(recommended, "the recommended promo (M4)");

  // M5
  await expect(
    page.getByRole("heading", { name: copy.wizard.steps.offer }),
    "picking a promo moves on to M5 by itself",
  ).toBeVisible();
  await expect(
    page.getByLabel(copy.offer.productLabel),
    "M5 pre-fills the product",
  ).not.toHaveValue("");
  await expect(page.getByText(copy.offer.locked), "M5 says the promise is locked").toBeVisible();
  await screens.shot("m5-offer");
  await taps.tap(page.getByRole("button", { name: copy.common.continue }), "Continue (M5)");

  // M6
  await expect(
    page.getByRole("heading", { name: copy.wizard.steps.margin }),
    "M5 leads to M6",
  ).toBeVisible();
  const review = page.getByRole("button", { name: copy.margin.reviewCta });
  await expect(review, "M6 can go on once the preview has answered").toBeEnabled();
  await expect(page.getByText(copy.margin.costLabel), "M6 shows the cost per sale").toBeVisible();
  await expect(
    page.getByText(copy.margin.capacity(PREVIEW.capacity.sales), { exact: true }),
    "M6 shows the capacity the preview answered",
  ).toBeVisible();
  await screens.shot("m6-margin");
  await taps.tap(review, `« ${copy.margin.reviewCta} » (M6)`);

  // M7
  await expect(
    page.getByRole("heading", { name: copy.wizard.steps.review }),
    "M6 leads to M7",
  ).toBeVisible();
  const fund = page.getByRole("button", { name: new RegExp(`^${copy.review.simulatePayment}`) });
  await expect(fund, "M7 can fund the promo (simulated payment)").toBeEnabled();
  await expect(fund, "M7 funds the budget chosen in M6, no more, no less").toHaveAccessibleName(
    copy.review.simulatePaymentOf(BUDGET),
  );
  await expect(
    page.getByLabel(BUDGET, { exact: true }),
    "M7 shows the budget chosen in M6",
  ).toBeVisible();
  await expect(
    page.getByLabel(formatMoney(PREVIEW.costPerSale), { exact: true }),
    "M7 shows the cost per sale the preview answered",
  ).toBeVisible();
  await expect(
    page.getByLabel(formatMoney(PREVIEW.marginKeptPerSale), { exact: true }),
    "M7 shows the margin kept per sale the preview answered",
  ).toBeVisible();
  await screens.shot("m7-review");
  await taps.tap(fund, "the simulated payment (M7)");

  // M8
  await expect(
    page.getByRole("heading", { name: copy.live.title }),
    "the payment leads to M8, the promo is live",
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: copy.live.qrAlt }),
    "M8 shows the QR code",
  ).toBeVisible();
  await expect(page.getByText(/\/c\/[a-z0-9-]+$/), "M8 shows the short link").toBeVisible();
  // The receipts are the test's, not the merchant's: their time is taken out.
  const elapsed = Date.now() - started - (screens.receiptMs - receiptsBefore);
  await expect(
    page.getByRole("button", { name: copy.live.copyLink }),
    "M8 can copy the link",
  ).toBeVisible();
  await expect(page.getByRole("button", { name: copy.live.share }), "M8 can share").toBeVisible();
  await screens.shot("m8-live");

  recordMeasure("onboarding-taps", {
    label: "Onboarding commerçant, M0 → M8 : taps",
    value: taps.count,
    unit: "taps",
    limit: MAX_TAPS,
    detail: taps.log,
  });
  recordMeasure("onboarding-seconds", {
    label: "Onboarding commerçant, M0 → M8 : durée",
    value: seconds(elapsed),
    unit: "s",
    limit: MAX_SECONDS,
    detail:
      "de M0 affiché au QR de M8 affiché, hors prise des captures ; gestes d'un robot, un humain lit et tape plus lentement",
  });
  process.stdout.write(
    `[onboarding] ${taps.count.toString()} taps, ${seconds(elapsed).toString()} s: ${taps.log}\n`,
  );

  expect(
    meetsLimit(taps.count, MAX_TAPS),
    `${taps.count.toString()} taps from M0 to M8, criterion 1 wants fewer than ${MAX_TAPS.toString()}: ${taps.log}`,
  ).toBe(true);
  expect(
    meetsLimit(elapsed, MAX_SECONDS * 1000),
    `${elapsed.toString()} ms from M0 to M8, criterion 1 wants under ${MAX_SECONDS.toString()} s`,
  ).toBe(true);
});
