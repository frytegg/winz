import type { Locator, Page } from "@playwright/test";
import { apiExamples, MOCK_SCENARIO_HEADER } from "@winz/shared";

import { copy } from "../../lib/copy";
import { CRYPTO_WORDS } from "../../lib/crypto-words";
import { formatMoney } from "../../lib/format";

import { CRITERIA, meetsLimit } from "./support/criteria";
import { expect, test } from "./support/fixtures";
import { knownDefectFromHere } from "./support/known-defects";
import { recordMeasure, seconds } from "./support/measures";
import type { ReceiptName } from "./support/receipts";
import { TapCounter } from "./support/taps";

/** SPEC section 17, criterion 2: from the scan to the ticket on screen, strictly under 30 s. */
const MAX_SCAN_TO_TICKET_SECONDS = CRITERIA.scanToTicketSeconds;
const SLUG = "joes-texas";
/** What the simulated API answers for C1 and C3 (packages/shared examples): the amounts to show. */
const CAMPAIGN = apiExamples.publicCampaignExamples.live;
const TICKET = apiExamples.ticketExamples;
const CHECKOUT_STATUS = apiExamples.checkoutStatusExamples;

/** Unit price × quantity, in micro-USDC, as the fan must be charged: an amount is never a float. */
function priceOf(qty: number): string {
  return formatMoney(BigInt(CAMPAIGN.unitPrice) * BigInt(qty));
}

/** An amount shown by the `Money` component, found by the accessible name it carries. */
function amount(scope: Page | Locator, text: string): Locator {
  return scope.getByLabel(text, { exact: true });
}

/** No crypto word on a fan's screen (SPEC section 5 and criterion 2). */
async function expectNoCryptoWord(page: Page, screen: string): Promise<void> {
  const text = await page.locator("body").innerText();
  const found = CRYPTO_WORDS.exec(text);
  expect(found?.[0] ?? null, `a crypto word on the fan's screen ${screen}`).toBeNull();
}

function payButton(page: Page): ReturnType<Page["getByRole"]> {
  return page.getByRole("button", { name: new RegExp(`^${copy.checkout.simulatePayment}`) });
}

test.describe("C1, the campaign page, in every state the scenarios offer", () => {
  test("open: the promise, the odds, the countdown and the two ways to pay", async ({
    page,
    screens,
  }) => {
    await page.goto(`/c/${SLUG}?scenario=live`);
    await expect(page.getByRole("heading", { level: 1 }), "C1 shows the promise").toContainText(
      /back if/i,
    );
    await expect(
      page.getByText(copy.campaign.salesCloseIn),
      "C1 counts down to the end of sales",
    ).toBeVisible();
    await expect(
      page.getByText(copy.campaign.chanceSuffix),
      "C1 shows the live chance",
    ).toBeVisible();
    await expect(page.getByRole("button", { name: copy.campaign.buyApplePay })).toBeEnabled();
    await expect(page.getByRole("button", { name: copy.campaign.payWithCard })).toBeEnabled();
    await expectNoCryptoWord(page, "C1 open");
    await screens.shot("c1-open");
  });

  test("paused: says so, and nothing can be bought", async ({ page, screens }) => {
    await page.goto(`/c/${SLUG}?scenario=paused`);
    await expect(
      page.getByRole("main").getByText(copy.campaign.paused),
      "C1 says the promo is paused",
    ).toBeVisible();
    await expect(page.getByRole("button", { name: copy.campaign.buyApplePay })).toBeDisabled();
    await expect(page.getByRole("button", { name: copy.campaign.payWithCard })).toBeDisabled();
    await expectNoCryptoWord(page, "C1 paused");
    await screens.shot("c1-paused");
  });

  test("sales closed: says so, with no button to buy", async ({ page, screens }) => {
    await page.goto(`/c/${SLUG}?scenario=salesClosed`);
    await expect(page.getByRole("heading", { name: copy.campaign.closed })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.campaign.buyApplePay })).toHaveCount(0);
    await expectNoCryptoWord(page, "C1 sales closed");
    await screens.shot("c1-sales-closed");
  });

  test("settled YES: everyone got their money back", async ({ page, screens }) => {
    await page.goto(`/c/${SLUG}?scenario=settledYes`);
    await expect(page.getByRole("heading", { name: copy.campaign.won })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.campaign.buyApplePay })).toHaveCount(0);
    await expectNoCryptoWord(page, "C1 settled YES");
    await screens.shot("c1-settled-yes");
  });

  test("settled NO: not this time", async ({ page, screens }) => {
    await page.goto(`/c/${SLUG}?scenario=settledNo`);
    await expect(page.getByRole("heading", { name: copy.campaign.lost })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.campaign.buyApplePay })).toHaveCount(0);
    await expectNoCryptoWord(page, "C1 settled NO");
    await screens.shot("c1-settled-no");
  });
});

test.describe("C2, the purchase by the simulated payment", () => {
  test("from the scan to the ticket in under 30 seconds, without a crypto word", async ({
    page,
    screens,
  }) => {
    const taps = new TapCounter();
    // The scan opens C1: the clock starts with the navigation.
    const started = Date.now();
    await page.goto(`/c/${SLUG}`);
    const buy = page.getByRole("button", { name: copy.campaign.buyApplePay });
    await expect(buy, "C1 can sell").toBeEnabled();
    await taps.tap(buy, `« ${copy.campaign.buyApplePay} » (C1)`);

    const sheet = page.getByRole("dialog", { name: copy.checkout.title });
    await expect(sheet, "the payment sheet opens over C1").toBeVisible();
    await expect(sheet.getByText(copy.checkout.chargedWhenReady)).toBeVisible();
    await expect(
      amount(sheet, priceOf(1)),
      "the sheet's total is the unit price for one",
    ).toBeVisible();
    await expect(
      payButton(page),
      "the pay button charges the unit price for one",
    ).toHaveAccessibleName(copy.checkout.simulatePaymentOf(priceOf(1)));
    await expectNoCryptoWord(page, "C2");
    const receiptsBefore = screens.receiptMs;
    await screens.shot("c2-checkout");
    await taps.tap(payButton(sheet.page()), "the simulated payment (C2)");

    await expect(page, "the purchase ends on the ticket's own link").toHaveURL(/\/t\/[^/]+$/);
    await expect(
      page.getByRole("img", { name: /% chance this is free$/ }),
      "the ticket is on screen",
    ).toBeVisible();
    const elapsed = Date.now() - started - (screens.receiptMs - receiptsBefore);
    await expectNoCryptoWord(page, "C3");

    recordMeasure("fan-taps", {
      label: "Achat client, C1 → C3 : taps",
      value: taps.count,
      unit: "taps",
      limit: null,
      detail: taps.log,
    });
    recordMeasure("fan-scan-to-ticket-seconds", {
      label: "Achat client, du scan (ouverture de C1) au ticket affiché",
      value: seconds(elapsed),
      unit: "s",
      limit: MAX_SCAN_TO_TICKET_SECONDS,
      detail:
        "navigation vers /c/joes-texas jusqu'à la jauge du ticket visible, hors prise des captures ; comprend 0,5 s d'autorisation simulée et le suivi du paiement (1 s)",
    });
    process.stdout.write(
      `[fan] ${taps.count.toString()} taps, ${seconds(elapsed).toString()} s from the scan to the ticket: ${taps.log}\n`,
    );
    expect(
      meetsLimit(elapsed, MAX_SCAN_TO_TICKET_SECONDS * 1000),
      `${elapsed.toString()} ms from the scan to the ticket, criterion 2 wants under ${MAX_SCAN_TO_TICKET_SECONDS.toString()} s`,
    ).toBe(true);
  });

  test("the quantity: C1 and the sheet charge the unit price times the quantity", async ({
    page,
    screens,
  }) => {
    await page.goto(`/c/${SLUG}`);
    const main = page.getByRole("main");
    await expect(amount(main, priceOf(1)), "C1 starts at one, at the unit price").toBeVisible();
    await page.getByRole("button", { name: copy.common.increase(copy.campaign.quantity) }).tap();
    await expect(amount(main, priceOf(2)), "C1's total follows the quantity").toBeVisible();

    await page.getByRole("button", { name: copy.campaign.buyApplePay }).tap();
    const sheet = page.getByRole("dialog", { name: copy.checkout.title });
    await expect(sheet.getByText(copy.checkout.lineItem(CAMPAIGN.product, 2))).toBeVisible();
    await expect(amount(sheet, priceOf(2)), "the sheet's total is the price of two").toBeVisible();
    await expect(amount(sheet, priceOf(1)), "the price of one is gone from the sheet").toHaveCount(
      0,
    );
    await expect(payButton(page), "the pay button charges the price of two").toHaveAccessibleName(
      copy.checkout.simulatePaymentOf(priceOf(2)),
    );
    await screens.shot("c2-checkout-two");

    const checkout = page.waitForRequest(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname === "/api/checkout",
    );
    await payButton(page).tap();
    const body: unknown = (await checkout).postDataJSON();
    expect(body, "the API is asked for two, the server prices them").toMatchObject({
      slug: SLUG,
      qty: 2,
    });
  });

  test("the wait: « Securing your promo… » while the payment is processed", async ({
    page,
    screens,
  }) => {
    // `processing`: the payment never reaches `ticketed`, so the wait stays on screen.
    await page.goto(`/c/${SLUG}?scenario=processing`);
    await page.getByRole("button", { name: copy.campaign.buyApplePay }).tap();
    await payButton(page).tap();
    await expect(page.getByRole("heading", { name: copy.checkout.securing })).toBeVisible();
    await expectNoCryptoWord(page, "C2 securing");
    await screens.shot("c2-securing");
  });

  test("a promo paused at the moment of paying: the API's refusal, nothing charged", async ({
    page,
    screens,
  }) => {
    screens.allowStatus(/\/api\/checkout$/, 409);
    await page.goto(`/c/${SLUG}?scenario=salesPaused`);
    await page.getByRole("button", { name: copy.campaign.buyApplePay }).tap();
    await payButton(page).tap();
    const sheet = page.getByRole("dialog", { name: copy.checkout.title });
    await expect(sheet.getByRole("alert"), "the sheet shows the refusal").toContainText(/paused/i);
    await expect(page, "no ticket after a refusal").toHaveURL(new RegExp(`/c/${SLUG}`));
    await screens.shot("c2-refused-sales-paused");
  });

  test("a promo whose sales closed at the moment of paying: the API's refusal, nothing charged", async ({
    page,
    screens,
  }) => {
    // `salesClosed` is also a C1 scenario (the page would stop selling before the tap): only the
    // payment request carries it, through the header the simulated API reads.
    screens.allowStatus(/\/api\/checkout$/, 409);
    await page.route("**/api/checkout", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await route.fallback({
        headers: { ...route.request().headers(), [MOCK_SCENARIO_HEADER]: "salesClosed" },
      });
    });
    await page.goto(`/c/${SLUG}`);
    await page.getByRole("button", { name: copy.campaign.buyApplePay }).tap();
    await payButton(page).tap();
    const sheet = page.getByRole("dialog", { name: copy.checkout.title });
    const refusal = sheet.getByRole("alert");
    await expect(refusal, "the sheet shows the refusal").toContainText(/sales are closed/i);
    await expect(refusal, "the fan is told nothing was charged").toContainText(/not charged/i);
    await expect(page, "no ticket after a refusal").toHaveURL(new RegExp(`/c/${SLUG}$`));
    await expectNoCryptoWord(page, "C2 refused, sales closed");
    await screens.shot("c2-refused-sales-closed");
  });

  test("a payment that did not go through: the API's message, try again, a way back", async ({
    page,
    screens,
  }) => {
    // `failed` is a scenario of the payment's status only: C1 stays open.
    await page.goto(`/c/${SLUG}?scenario=failed`);
    await page.getByRole("button", { name: copy.campaign.buyApplePay }).tap();
    await payButton(page).tap();
    const ending = page.getByRole("heading", { name: CHECKOUT_STATUS.failed.message });
    await expect(ending, "the ending shows the API's message as it comes").toBeVisible();
    const tryAgain = page.getByRole("button", { name: copy.common.tryAgain });
    await expect(tryAgain, "a failed payment can be tried again").toBeVisible();
    await expect(page.getByRole("button", { name: copy.checkout.backToPromo })).toBeVisible();
    await expect(page, "no ticket after a failed payment").toHaveURL(new RegExp(`/c/${SLUG}`));
    await expectNoCryptoWord(page, "C2 failed");
    await screens.shot("c2-ended-failed");
    await tryAgain.tap();
    await expect(
      page.getByRole("dialog", { name: copy.checkout.title }),
      "trying again reopens the sheet",
    ).toBeVisible();
    await expect(payButton(page)).toBeEnabled();
  });

  test("a promo that paused during the wait: its own ending and a way back", async ({
    page,
    screens,
  }) => {
    await page.goto(`/c/${SLUG}?scenario=cancelledPaused`);
    await page.getByRole("button", { name: copy.campaign.buyApplePay }).tap();
    await payButton(page).tap();
    const back = page.getByRole("button", { name: copy.checkout.backToPromo });
    await expect(back, "the ending offers the way back to the promo").toBeVisible();
    await expect(page.getByRole("alert").first()).toContainText(/charged/i);
    await expectNoCryptoWord(page, "C2 cancelled");
    await screens.shot("c2-ended-cancelled-paused");
    await back.tap();
    await expect(page.getByRole("button", { name: copy.campaign.buyApplePay })).toBeVisible();
  });
});

const PHASES: readonly {
  scenario: string;
  receipt: ReceiptName;
  title: string;
  check: (page: Page) => Promise<void>;
}[] = [
  {
    scenario: "preGame",
    receipt: "c3-ticket-pre-game",
    title: "before the game: the chance it is free, the gauge, the countdown",
    check: async (page) => {
      await expect(page.getByRole("img", { name: /^\d+% chance this is free$/ })).toBeVisible();
      await expect(page.getByText(copy.ticket.kickoffIn)).toBeVisible();
      await expect(page.getByRole("button", { name: copy.ticket.addToHome })).toBeVisible();
    },
  },
  {
    scenario: "inGame",
    receipt: "c3-ticket-in-game",
    title: "during the game: « Game on » and the odds still moving",
    check: async (page) => {
      await expect(page.getByText(copy.ticket.gameOn, { exact: true })).toBeVisible();
      await expect(page.getByText(copy.ticket.gameOnBody)).toBeVisible();
      await expect(page.getByRole("img", { name: /% chance this is free$/ })).toBeVisible();
    },
  },
  {
    scenario: "refunded",
    receipt: "c3-ticket-refunded",
    title: "condition YES: the lime screen, « Refunded » and the amount",
    check: async (page) => {
      const refunded = page.getByRole("heading", { name: copy.ticket.refunded });
      await expect(refunded).toBeVisible();
      // SPEC 5.4: « REFUNDED $20.00 », the amount the API says is refundable, under the heading.
      await expect(
        amount(refunded.locator("xpath=.."), formatMoney(TICKET.refunded.refundable)),
        "the refunded amount, to the cent",
      ).toBeVisible();
      await expect(
        page.getByLabel(copy.ticket.paid(formatMoney(TICKET.refunded.paid)), { exact: true }),
        "what the fan paid, to the cent",
      ).toBeVisible();
      await expect(page.getByRole("button", { name: copy.ticket.shareWin })).toBeVisible();
    },
  },
  {
    scenario: "notThisTime",
    receipt: "c3-ticket-not-this-time",
    title: "condition NO: « Not this time », « Find another promo »",
    check: async (page) => {
      await expect(
        page.getByRole("heading", { name: /^Not this time\. Thanks for playing with .+\.$/ }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: copy.ticket.findAnother })).toBeVisible();
    },
  },
  {
    scenario: "cancelled",
    receipt: "c3-ticket-cancelled",
    title: "game cancelled: the purchase stands",
    check: async (page) => {
      await expect(page.getByRole("heading", { name: copy.ticket.cancelled })).toBeVisible();
      await expect(page.getByText(copy.ticket.cancelledBody)).toBeVisible();
    },
  },
];

test.describe("C3, the ticket in each of its five phases (SPEC 5.4)", () => {
  for (const phase of PHASES) {
    test(`${phase.scenario}: ${phase.title}`, async ({ page, screens }) => {
      await page.goto(`/t/tkt_example_joes_texas?scenario=${phase.scenario}`);
      await expect(
        page.getByText(copy.ticket.showAtCounter, { exact: true }),
        "the ticket screen opens",
      ).toBeVisible();
      await phase.check(page);
      await expectNoCryptoWord(page, `C3 ${phase.scenario}`);
      await screens.shot(phase.receipt);
    });
  }

  test("an unknown ticket link: says so, without a dead end", async ({ page, screens }) => {
    // No scenario answers 404 for a ticket: the test answers it, as the real API would.
    screens.allowStatus(/\/api\/t\//, 404);
    await page.route("**/api/t/**", (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "not_found", message: "Ticket not found" } }),
      }),
    );
    await page.goto("/t/tkt_unknown");
    await expect(page.getByRole("heading", { name: copy.ticket.notFoundTitle })).toBeVisible();
    await expect(page.getByText(copy.ticket.notFoundBody)).toBeVisible();
    await screens.shot("c3-ticket-not-found");
  });

  test("before the game, the screen says « … chance this is free » (SPEC 5.4)", async ({
    page,
  }) => {
    await page.goto("/t/tkt_example_joes_texas?scenario=preGame");
    await expect(
      page.getByText(copy.ticket.showAtCounter, { exact: true }),
      "the ticket screen opens",
    ).toBeVisible();
    await expect(page.getByRole("img", { name: /chance this is free$/ })).toBeVisible();

    knownDefectFromHere("ticketChanceWording");
    // Visible text, not the accessible name: what the fan reads.
    await expect(page.locator("body")).toContainText(/\d+ ?% chance this is free/i, {
      timeout: 5_000,
    });
  });
});
