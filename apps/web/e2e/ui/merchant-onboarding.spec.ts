import type { Locator, Page } from "@playwright/test";
import { MOCK_SCENARIO_HEADER, apiExamples, type CampaignDetail } from "@winz/shared";

import { copy } from "../../lib/copy";
import { centsToMicro, formatMoney, formatMoneyCompact } from "../../lib/format";
import { LIVE_GIVE_UP_AFTER_MS, LIVE_SLOW_AFTER_MS } from "../../lib/merchant/launch-state";
import { DEFAULT_BUDGET_CENTS } from "../../lib/wizard/draft";

import { CRITERIA, meetsLimit } from "./support/criteria";
import { expect, test } from "./support/fixtures";
import {
  followPreviews,
  fundButton,
  isCreateCampaign,
  loseAnswer,
  marginToReview,
  reachMargin,
  requestIdOf,
  signInAsNewUser,
} from "./support/merchant-flow";
import { recordMeasure, seconds } from "./support/measures";
import { signInAsMerchant } from "./support/sign-in";
import { TapCounter } from "./support/taps";

/** SPEC section 17, criterion 1: strictly fewer than 15 taps and 2 minutes. */
const MAX_TAPS = CRITERIA.onboardingTaps;
const MAX_SECONDS = CRITERIA.onboardingSeconds;
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
  // What M6 and M7 must show: the preview the simulated API computed for the terms sent.
  const lastPreview = followPreviews(page);

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
  const preview = await lastPreview();
  await expect(
    page.getByText(copy.margin.capacity(preview.capacity.sales), { exact: true }),
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
  const reviewed = await lastPreview();
  await expect(
    page.getByLabel(formatMoney(reviewed.costPerSale ?? ""), { exact: true }),
    "M7 shows the cost per sale the preview answered",
  ).toBeVisible();
  await expect(
    page.getByLabel(formatMoney(reviewed.marginKeptPerSale ?? ""), { exact: true }),
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

test("M8: a tap opens the QR code full screen, and Close brings M8 back (U-08)", async ({
  page,
  screens,
}) => {
  await signInAsMerchant(page);
  await page.goto("/new/cmp_joes_texas/live");
  await expect(page.getByRole("heading", { name: copy.live.title }), "M8 opens").toBeVisible();

  const enlarge = page.getByRole("button", { name: copy.live.enlargeQr });
  await expect(enlarge, "M8's QR code can be enlarged").toBeVisible();
  const smallQr = await enlarge.boundingBox();
  await enlarge.tap();

  const fullScreen = page.getByRole("dialog", { name: copy.live.qrAlt });
  await expect(fullScreen, "the tap opens the full-screen QR code").toBeVisible();
  await expect(fullScreen.getByText(copy.live.qrBrightness)).toBeVisible();
  const qr = fullScreen.getByRole("img", { name: copy.live.qrAlt });
  await expect(qr).toBeVisible();
  const bigQr = await qr.boundingBox();
  const viewport = page.viewportSize();
  if (smallQr === null || bigQr === null || viewport === null) {
    throw new Error("the QR code or the viewport has no size");
  }
  expect(bigQr.width, "the full-screen QR code is larger than M8's").toBeGreaterThan(smallQr.width);
  expect(
    bigQr.width,
    "the full-screen QR code takes most of the phone's width",
  ).toBeGreaterThanOrEqual(viewport.width * 0.8);
  await screens.shot("m8-qr-fullscreen", { viewport: true });

  await fullScreen.getByRole("button", { name: copy.live.closeQr }).tap();
  await expect(fullScreen, "Close puts the full-screen QR code away").toBeHidden();
  await expect(page.getByRole("heading", { name: copy.live.title }), "back on M8").toBeVisible();
  await expect(enlarge).toBeVisible();
});

/** What the simulated `GET /api/campaigns/:id` answers for a live promo: M8's other states patch it. */
const DETAIL = apiExamples.campaignDetailExamples.live;
const CAMPAIGN_ID = DETAIL.id;
const PROMO_PAGE = `/campaigns/${CAMPAIGN_ID}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The screen's own error line for a dropped connection (Next's route announcer is an alert too). */
function networkAlert(page: Page): Locator {
  return page.getByRole("alert").filter({ hasText: copy.common.networkError });
}

test.describe("M7: a Fund request is one campaign, whatever happens to its answer (review 1.1)", () => {
  test("the answer is lost, the merchant reloads, steps back to M6 and comes back: the same requestId each time", async ({
    page,
  }) => {
    await signInAsMerchant(page);
    await reachMargin(page);
    await marginToReview(page);

    const sent: string[] = [];
    let losing = true;
    await page.route(isCreateCampaign, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      sent.push(requestIdOf(route.request()));
      if (losing) await loseAnswer(route);
      else await route.fallback();
    });

    // 1. The server creates the campaign and its payment; the answer never comes back.
    await fundButton(page).tap();
    await expect(networkAlert(page), "M7 says the answer did not come").toBeVisible();

    // 2. A reload: the draft comes back from the tab's storage, the review step is mounted again.
    await page.reload();
    await expect(page.getByRole("heading", { name: copy.wizard.steps.review })).toBeVisible();
    await expect(fundButton(page)).toBeEnabled();
    await fundButton(page).tap();
    await expect(networkAlert(page)).toBeVisible();

    // 3. Back to M6 and forward again: another mount of the review step.
    await page.getByRole("button", { name: copy.common.back }).tap();
    await expect(page.getByRole("heading", { name: copy.wizard.steps.margin })).toBeVisible();
    await marginToReview(page);
    losing = false;
    await fundButton(page).tap();
    await expect(
      page.getByRole("heading", { name: copy.live.title }),
      "the third tap gets its answer: M8",
    ).toBeVisible();

    expect(sent, "three taps, three requests").toHaveLength(3);
    expect(sent[0], "a uuid").toMatch(UUID);
    expect(sent, "one request: the same requestId after a reload and a remount").toEqual([
      sent[0],
      sent[0],
      sent[0],
    ]);

    // 4. The promo is created: the next promo, even with the very same terms, is a new request.
    await reachMargin(page);
    await marginToReview(page);
    await fundButton(page).tap();
    await expect(page.getByRole("heading", { name: copy.live.title })).toBeVisible();
    expect(sent, "a fourth request").toHaveLength(4);
    expect(sent[3], "a new promo after a success never reuses the paid request").not.toBe(sent[0]);
  });

  test("the developer kit's payment page keeps its requestId for a retry (/kit/pay)", async ({
    page,
  }) => {
    const sent: string[] = [];
    let losing = true;
    await page.route(isCreateCampaign, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      sent.push(requestIdOf(route.request()));
      if (losing) await loseAnswer(route);
      else await route.fallback();
    });
    await page.goto("/kit/pay");
    await fundButton(page).tap();
    await expect(networkAlert(page)).toBeVisible();
    losing = false;
    await fundButton(page).tap();
    await expect(page.getByTestId("funded")).toContainText(CAMPAIGN_ID);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatch(UUID);
    expect(sent[1], "the retry is the same request").toBe(sent[0]);
  });
});

test("M7: when the review's numbers cannot be computed, it says so and offers to try again (review 2.8)", async ({
  page,
}) => {
  const lastPreview = followPreviews(page);
  await signInAsMerchant(page);
  await reachMargin(page);
  // M6's own preview answers first: only M7's is cut.
  await expect(
    page.getByRole("button", { name: copy.margin.reviewCta }),
    "M6 has its numbers",
  ).toBeEnabled();
  const isPreview = (url: URL): boolean => url.pathname === "/api/campaigns/preview";
  let previews = 0;
  await page.route(isPreview, async (route) => {
    previews += 1;
    await route.abort("blockedbyclient");
  });
  await page.getByRole("button", { name: copy.margin.reviewCta }).tap();
  await expect(page.getByRole("heading", { name: copy.wizard.steps.review })).toBeVisible();

  await expect(networkAlert(page), "M7 says why there are no numbers").toBeVisible();
  const retry = page.getByRole("button", { name: copy.common.tryAgain });
  await expect(retry, "and offers to try again, as M6 does").toBeVisible();
  await expect(fundButton(page), "nothing can be funded without the numbers").toBeDisabled();
  const before = previews;
  await retry.tap();
  await expect
    .poll(() => previews, { message: "« Try again » asks again" })
    .toBeGreaterThan(before);

  await page.unroute(isPreview);
  const preview = await lastPreview();
  await expect(
    page.getByLabel(formatMoney(preview.costPerSale ?? ""), { exact: true }),
    "once the preview answers, M7 shows its numbers",
  ).toBeVisible();
  await expect(fundButton(page)).toBeEnabled();
});

test("M2: a business already created by a lost first tap: the second tap's 409 moves on to M3 (review 2.3)", async ({
  page,
  screens,
}) => {
  await signInAsNewUser(page);
  await page.getByLabel(copy.business.nameLabel).fill("Joe's Texas Bar");
  await page.getByRole("button", { name: copy.business.categories.bar }).tap();

  // Since the first tap, the user has a business, and this body differs from it: the API answers
  // 409, and `GET /api/me` now answers a merchant.
  screens.allowStatus(/\/api\/merchants$/, 409);
  await page.route("**/api/merchants", (route) =>
    route.fulfill({
      status: 409,
      json: { error: { code: "conflict", message: "You already have a business" } },
    }),
  );
  let meAsked = 0;
  await page.route("**/api/me", async (route) => {
    meAsked += 1;
    await route.fallback({
      headers: { ...route.request().headers(), [MOCK_SCENARIO_HEADER]: "merchant" },
    });
  });

  await page.getByRole("button", { name: copy.common.continue }).tap();
  await expect(
    page.getByRole("heading", { name: copy.wizard.steps.game }),
    "the session is read again, the guard sees the business and opens M3",
  ).toBeVisible();
  expect(meAsked, "the session was read again after the 409").toBeGreaterThan(0);
});

test("M2 → M3: Continue keeps M2 on screen until the games are there, with no splash in between", async ({
  page,
}) => {
  await signInAsNewUser(page);
  await page.getByLabel(copy.business.nameLabel).fill("Buzzball’s shop");
  await page.getByRole("button", { name: copy.business.categories.burger }).tap();

  // From here on, every element the page adds is looked at, the moment it is added: a splash that
  // shows for a single frame and is gone the next (the « logo flash » of the onboarding film, 0.3 s
  // of the full-screen W between M2 and M3) is counted as surely as one that stays.
  await page.evaluate(() => {
    const seen = { splashes: 0 };
    (window as unknown as { __seen: typeof seen }).__seen = seen;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches("[data-splash]") || node.querySelector("[data-splash]") !== null) {
            seen.splashes += 1;
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  const splashes = (): Promise<number> =>
    page.evaluate(() => (window as unknown as { __seen: { splashes: number } }).__seen.splashes);

  await page.getByRole("button", { name: copy.common.continue }).tap();
  await expect(
    page.getByRole("heading", { name: copy.wizard.steps.game }),
    "M2 leads to M3",
  ).toBeVisible();
  // The page was not reloaded on the way (the watcher is still there to answer).
  expect(await splashes(), "no splash was shown between M2 and M3").toBe(0);
});

test.describe("M8: every state the promo can be in (review 2.9)", () => {
  const states: readonly {
    name: string;
    detail: CampaignDetail;
    title: string;
    body: string;
  }[] = [
    {
      name: "a cancelled game (void) is not a failed creation",
      detail: {
        ...DETAIL,
        status: "void",
        saleState: "closed",
        outcome: "void",
        probabilityBps: null,
      },
      title: copy.live.cancelledTitle,
      body: copy.live.cancelledBody,
    },
    {
      name: "a paid promo that could never go live is closed and refunded",
      detail: {
        ...DETAIL,
        status: "closed",
        saleState: "closed",
        slug: null,
        url: null,
        liveAt: null,
        onchain: null,
      },
      title: copy.live.failedTitle,
      body: copy.live.refundedBody,
    },
    {
      name: "a promo whose sales are over is not said to be live",
      detail: { ...DETAIL, status: "settled_no", saleState: "closed", outcome: "no" },
      title: copy.live.endedTitle,
      body: copy.live.endedBody,
    },
  ];

  for (const state of states) {
    test(state.name, async ({ page }) => {
      await signInAsMerchant(page);
      await page.route(`**/api/campaigns/${CAMPAIGN_ID}`, (route) =>
        route.fulfill({ json: state.detail }),
      );
      await page.goto(`/new/${CAMPAIGN_ID}/live`);
      await expect(page.getByRole("heading", { name: state.title })).toBeVisible();
      await expect(page.getByText(state.body)).toBeVisible();
      await expect(page.getByRole("heading", { name: copy.live.title })).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: copy.live.openPromo }),
        "M8 says where the promo is",
      ).toHaveAttribute("href", PROMO_PAGE);
    });
  }

  test("a promo that does not go live: the wait is bounded, and says where to find the promo", async ({
    page,
  }) => {
    await signInAsMerchant(page);
    let reads = 0;
    await page.route(`**/api/campaigns/${CAMPAIGN_ID}`, async (route) => {
      reads += 1;
      await route.fulfill({
        json: { ...DETAIL, status: "funding", slug: null, url: null, liveAt: null, onchain: null },
      });
    });
    await page.clock.install();
    await page.goto(`/new/${CAMPAIGN_ID}/live`);
    await expect(page.getByText(copy.live.puttingLive)).toBeVisible();

    await page.clock.fastForward(LIVE_SLOW_AFTER_MS);
    await expect(page.getByRole("heading", { name: copy.live.slowTitle })).toBeVisible();
    await expect(page.getByText(copy.live.slowBody)).toBeVisible();
    await expect(page.getByRole("link", { name: copy.live.openPromo })).toHaveAttribute(
      "href",
      PROMO_PAGE,
    );

    await page.clock.fastForward(LIVE_GIVE_UP_AFTER_MS);
    await expect(page.getByRole("heading", { name: copy.live.gaveUpTitle })).toBeVisible();
    await expect(page.getByText(copy.live.gaveUpBody)).toBeVisible();
    await expect(page.getByRole("link", { name: copy.live.openPromo })).toHaveAttribute(
      "href",
      PROMO_PAGE,
    );
    const stopped = reads;
    await page.clock.fastForward(60_000);
    await page.clock.fastForward(60_000);
    expect(reads, "M8 stopped asking once the wait was over").toBe(stopped);

    await page.getByRole("button", { name: copy.live.checkAgain }).tap();
    await expect
      .poll(() => reads, { message: "« Check again » asks again" })
      .toBeGreaterThan(stopped);
  });
});
