import type { Locator, Page } from "@playwright/test";
import { apiExamples, MOCK_SCENARIO_HEADER } from "@winz/shared";

import { copy } from "../../lib/copy";
import { CRYPTO_WORDS } from "../../lib/crypto-words";
import { formatMoney } from "../../lib/format";

import { CRITERIA, meetsLimit } from "./support/criteria";
import { expect, horizontalOverflow, test } from "./support/fixtures";
import { recordMeasure, seconds } from "./support/measures";
import type { ReceiptName } from "./support/receipts";
import { TapCounter } from "./support/taps";

/** SPEC section 17, criterion 2: from the scan to the ticket on screen, strictly under 30 s. */
const MAX_SCAN_TO_TICKET_SECONDS = CRITERIA.scanToTicketSeconds;
/** The public link of the running example (the simulated API answers its example for any slug). */
const SLUG = apiExamples.publicCampaignExamples.live.slug;
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

  test("the two teams are named in full at phone width, never cut (« Arkansas R… »)", async ({
    page,
  }) => {
    await page.goto(`/c/${SLUG}?scenario=live`);
    const { away, home } = CAMPAIGN.event;
    const teams = page.getByRole("group", { name: copy.campaign.teams(away.name, home.name) });
    await expect(teams, "C1 shows the game").toBeVisible();
    for (const name of [away.name, home.name]) {
      const label = teams.getByText(name, { exact: true });
      await expect(label, `${name} is written out`).toBeVisible();
      const fit = await label.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          cut: element.scrollWidth > element.clientWidth,
          ellipsis: style.textOverflow === "ellipsis" && style.overflow !== "visible",
        };
      });
      expect(fit, `${name} is not cut`).toEqual({ cut: false, ellipsis: false });
    }
    expect(await horizontalOverflow(page), "no sideways scroll at 393 px").toBeNull();
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
      page.getByRole("img", { name: /% chance it's free$/ }),
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
      detail: `navigation vers /c/${SLUG} jusqu'à la jauge du ticket visible, hors prise des captures ; comprend 0,5 s d'autorisation simulée et le suivi du paiement (1 s)`,
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
      await expect(page.getByRole("img", { name: /^\d+% chance it's free$/ })).toBeVisible();
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
      await expect(page.getByRole("img", { name: /% chance it's free$/ })).toBeVisible();
    },
  },
  {
    scenario: "refunded",
    receipt: "c3-ticket-refunded",
    title: "condition YES: the lime screen, « Refunded » and the amount",
    check: async (page) => {
      const refunded = page.getByRole("heading", { name: copy.ticket.refunded });
      await expect(refunded).toBeVisible();
      // SPEC 5.4: « REFUNDED $12.00 », the amount the API says is refundable, under the heading.
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

  test("before the game, the screen says the chance in words, « … chance it's free » as C1 does (SPEC 5.4)", async ({
    page,
  }) => {
    await page.goto("/t/tkt_example_joes_texas?scenario=preGame");
    await expect(
      page.getByText(copy.ticket.showAtCounter, { exact: true }),
      "the ticket screen opens",
    ).toBeVisible();
    await expect(page.getByRole("img", { name: /chance it's free$/ })).toBeVisible();

    // Visible text, not the accessible name: what the fan reads.
    await expect(page.locator("body")).toContainText(/\d+ ?% chance it's free/i, {
      timeout: 5_000,
    });
    // One wording on every fan screen (C1, the gauge, the tickets list): not a second one here.
    await expect(page.locator("body")).not.toContainText(/chance this is free/i);
  });
});

/** The payment the simulated API creates, and the ticket its status opens. */
const CHECKOUT = apiExamples.checkoutExample;
const TICKET_URL = new RegExp(`/t/${CHECKOUT_STATUS.ticketed.ticketToken}$`);
/** Where C2 keeps the purchase it started (lib/fan/pending-purchase.ts). */
const KEPT_PURCHASE = `winz.purchase.${SLUG}`;
const PIXEL_7 =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

/** Counts the payments the page asks the API to create (`POST /api/checkout`). */
function countCheckouts(page: Page): { readonly count: number } {
  const counter = { count: 0 };
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/checkout") {
      counter.count += 1;
    }
  });
  return counter;
}

function keptPurchase(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), KEPT_PURCHASE);
}

/** What `navigator.onLine` says, without touching the network. */
async function setOnline(page: Page, online: boolean): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
  }, online);
}

/** A purchase this browser kept for the promo before the page opens, as a lost page leaves it. */
async function keepPurchaseBeforeOpening(
  page: Page,
  purchase: { paymentIntentId: string; authorized: boolean },
): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      try {
        // Once: the page itself changes it afterwards.
        if (window.sessionStorage.getItem("seeded") !== null) return;
        window.sessionStorage.setItem("seeded", "1");
        window.localStorage.setItem(key, value);
      } catch {
        // about:blank has no storage.
      }
    },
    [KEPT_PURCHASE, JSON.stringify(purchase)] as const,
  );
}

/** The status read of the payment answers `answer()` while it is not null, the API otherwise. */
async function answerStatus(
  page: Page,
  answer: () => { status: string; ticketToken: string | null; message: string | null } | null,
): Promise<void> {
  await page.route(`**/api/checkout/${CHECKOUT.paymentIntentId}`, (route) => {
    const body = route.request().method() === "GET" ? answer() : null;
    return body === null
      ? route.fallback()
      : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

/** The next status read of the simulated payment. */
function nextStatusRead(page: Page): Promise<unknown> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === `/api/checkout/${CHECKOUT.paymentIntentId}`,
  );
}

const NOT_PAID_YET = { status: "requires_payment", ticketToken: null, message: null };

/**
 * Answers the confirmation of the simulated payment (`POST /api/checkout/:pi/confirm`, which reads
 * Stripe itself): a body with 200, or a status alone (502: Stripe could not be read).
 */
async function answerConfirm(
  page: Page,
  answer: { status: string; ticketToken: string | null; message: string | null } | number,
): Promise<void> {
  await page.route(`**/api/checkout/${CHECKOUT.paymentIntentId}/confirm`, (route) =>
    typeof answer === "number"
      ? route.fulfill({
          status: answer,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "internal",
              message: "The payment service is unavailable right now, please try again in a moment",
            },
          }),
        })
      : route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(answer),
        }),
  );
}

/** Every read of the promo (C1) or of the ticket (C3) fails, as when the API is unreachable. */
async function failReads(page: Page, pattern: string): Promise<void> {
  await page.route(pattern, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "internal", message: "Service unavailable" } }),
        })
      : route.fallback(),
  );
}

test.describe("C2 and C3, the fan's money path", () => {
  test("an answer lost after the tap: the next tap pays the same payment, and one ticket", async ({
    page,
  }) => {
    const checkouts = countCheckouts(page);
    await page.route("**/api/checkout", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const response = await route.fetch();
      // The payment exists; the card's answer is then lost: the simulated authorization (0.5 s)
      // fails when the browser says it is offline, as Stripe would. Only `navigator.onLine` is
      // changed, so no other request of the page fails meanwhile.
      await setOnline(page, false);
      await route.fulfill({ response });
    });
    await page.goto(`/c/${SLUG}`);
    await page.getByRole("button", { name: copy.campaign.buyApplePay }).tap();
    await payButton(page).tap();
    const sheet = page.getByRole("dialog", { name: copy.checkout.title });
    await expect(sheet.getByRole("alert"), "the lost answer is shown in the sheet").toHaveText(
      copy.common.networkError,
    );
    await setOnline(page, true);
    expect(await keptPurchase(page), "the purchase is kept from the API's answer").toContain(
      CHECKOUT.paymentIntentId,
    );

    await payButton(page).tap();
    await expect(page, "the second tap ends on the ticket").toHaveURL(TICKET_URL);
    expect(checkouts.count, "one payment created for the two taps").toBe(1);
    expect(await keptPurchase(page), "the purchase is forgotten once ticketed").toBeNull();
  });

  test("a page lost during « Securing your promo… »: reopening the promo opens the ticket", async ({
    page,
  }) => {
    // `processing`: the payment never ends while the first page is open.
    await page.goto(`/c/${SLUG}?scenario=processing`);
    await page.getByRole("button", { name: copy.campaign.buyApplePay }).tap();
    await payButton(page).tap();
    await expect(page.getByRole("heading", { name: copy.checkout.securing })).toBeVisible();
    const kept = await keptPurchase(page);
    expect(kept, "the purchase is kept for this promo").toContain(CHECKOUT.paymentIntentId);
    expect(kept, "and its card is known authorized").toContain('"authorized":true');

    // The page is lost; the fan opens the promo again, and the payment has ended on its ticket.
    const checkouts = countCheckouts(page);
    await page.goto(`/c/${SLUG}?scenario=ticketed`);
    await expect(page, "the promo's page opens the ticket by itself").toHaveURL(TICKET_URL);
    expect(checkouts.count, "nothing is bought again").toBe(0);
    expect(await keptPurchase(page), "the purchase is forgotten once ticketed").toBeNull();
  });

  test("a payment that ended without a ticket is forgotten, and the promo is not taken over", async ({
    page,
  }) => {
    await page.goto(`/c/${SLUG}?scenario=failed`);
    await page.getByRole("button", { name: copy.campaign.buyApplePay }).tap();
    await payButton(page).tap();
    await expect(page.getByRole("heading", { name: CHECKOUT_STATUS.failed.message })).toBeVisible();
    expect(await keptPurchase(page), "a payment over without a ticket is forgotten").toBeNull();
    await page.goto(`/c/${SLUG}`);
    await expect(page.getByRole("button", { name: copy.campaign.buyApplePay })).toBeEnabled();
    await expect(page).toHaveURL(new RegExp(`/c/${SLUG}$`));
  });

  test("back from a payment redirect (3-D Secure): the promo's page follows that payment to its ticket", async ({
    page,
  }) => {
    // What Stripe adds to the return address (`return_url` is the promo's page), in a browser that
    // kept nothing: the address alone is enough.
    await page.goto(
      `/c/${SLUG}?payment_intent=${CHECKOUT.paymentIntentId}&payment_intent_client_secret=${CHECKOUT.clientSecret}&redirect_status=succeeded`,
    );
    await expect(page, "the redirect ends on the ticket").toHaveURL(TICKET_URL);
  });

  test("the wait has an end: past a minute, the fan is told what is true and what to do", async ({
    page,
  }) => {
    await page.clock.install();
    await page.goto(`/c/${SLUG}?scenario=processing`);
    await page.getByRole("button", { name: copy.campaign.buyApplePay }).tap();
    // The wait's clock starts once the confirmation has answered: the first status read proves it.
    const polling = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === `/api/checkout/${CHECKOUT.paymentIntentId}`,
    );
    await payButton(page).tap();
    await expect(page.getByRole("heading", { name: copy.checkout.securing })).toBeVisible();
    await polling;
    // Past WAIT_LIMIT_SECONDS (60 s, lib/fan/checkout-flow.ts).
    await page.clock.fastForward(120_000);
    await expect(
      page.getByRole("heading", { name: copy.checkout.unresolvedTitle }),
      "the wait stops and says so",
    ).toBeVisible();
    await expect(page.getByText(copy.checkout.unresolvedBody)).toBeVisible();
    expect(await keptPurchase(page), "the purchase stays kept for the next visit").toContain(
      CHECKOUT.paymentIntentId,
    );
    await expectNoCryptoWord(page, "C2 unresolved");
    await expect(page.getByRole("button", { name: copy.checkout.checkAgain })).toBeVisible();
    await page.getByRole("button", { name: copy.checkout.backToPromo }).tap();
    await expect(page.getByRole("button", { name: copy.campaign.buyApplePay })).toBeVisible();
  });

  test("a purchase picked up after a reload, still on its way: a new tap follows it, never pays again", async ({
    page,
  }) => {
    const checkouts = countCheckouts(page);
    await page.clock.install();
    await page.goto(`/c/${SLUG}?scenario=processing`);
    await page.getByRole("button", { name: copy.campaign.buyApplePay }).tap();
    await payButton(page).tap();
    await expect(page.getByRole("heading", { name: copy.checkout.securing })).toBeVisible();
    expect(checkouts.count).toBe(1);

    // The page is lost and reopened, as the screen tells the fan to do; the wait reaches its bound.
    const polling = nextStatusRead(page);
    await page.goto(`/c/${SLUG}?scenario=processing`);
    await expect(page.getByRole("heading", { name: copy.checkout.securing })).toBeVisible();
    await polling;
    await page.clock.fastForward(120_000);
    await expect(page.getByRole("heading", { name: copy.checkout.unresolvedTitle })).toBeVisible();

    await page.getByRole("button", { name: copy.checkout.backToPromo }).tap();
    await page.getByRole("button", { name: copy.campaign.buyApplePay }).tap();
    const sheet = page.getByRole("dialog", { name: copy.checkout.title });
    await expect(
      sheet.getByText(copy.checkout.stillOnItsWay),
      "the sheet says a purchase is still on its way",
    ).toBeVisible();
    const followed = nextStatusRead(page);
    await payButton(page).tap();
    await expect(
      page.getByRole("heading", { name: copy.checkout.securing }),
      "the tap follows the purchase on its way",
    ).toBeVisible();
    await followed;
    expect(checkouts.count, "one payment created for one intended purchase").toBe(1);
  });

  test("a tap during the quiet pick-up of an unseen payment waits for it: no second payment", async ({
    page,
  }) => {
    // A page lost before Stripe's answer: the card was in fact authorized, which the status read
    // finds out after a few seconds (it asks Stripe once the row has waited 5 s).
    await keepPurchaseBeforeOpening(page, {
      paymentIntentId: CHECKOUT.paymentIntentId,
      authorized: false,
    });
    let reads = 0;
    await answerStatus(page, () => {
      reads += 1;
      return reads <= 4 ? NOT_PAID_YET : null;
    });
    const checkouts = countCheckouts(page);
    const firstRead = nextStatusRead(page);
    await page.goto(`/c/${SLUG}`);
    await firstRead;
    await page.getByRole("button", { name: copy.campaign.buyApplePay }).tap();
    await payButton(page).tap();
    await expect(page, "the payment picked up ends on its ticket").toHaveURL(TICKET_URL);
    expect(checkouts.count, "the tap did not create a second payment").toBe(0);
    expect(await keptPurchase(page), "the purchase is forgotten once ticketed").toBeNull();
  });

  test("an unseen payment that was never authorized is let go, and the waiting tap then pays once", async ({
    page,
  }) => {
    await keepPurchaseBeforeOpening(page, {
      paymentIntentId: CHECKOUT.paymentIntentId,
      authorized: false,
    });
    const checkouts = countCheckouts(page);
    // Unpaid for as long as no new payment was asked for, and Stripe itself says so: the
    // confirmation, which reads Stripe, answers « still unpaid ».
    await answerStatus(page, () => (checkouts.count === 0 ? NOT_PAID_YET : null));
    await answerConfirm(page, NOT_PAID_YET);
    await page.clock.install();
    const firstRead = nextStatusRead(page);
    await page.goto(`/c/${SLUG}`);
    await firstRead;
    await page.getByRole("button", { name: copy.campaign.buyApplePay }).tap();
    const another = nextStatusRead(page);
    await payButton(page).tap();
    await another;
    expect(checkouts.count, "the tap waits for the purchase picked up").toBe(0);
    // Past RESUME_UNSEEN_LIMIT_SECONDS (15 s, lib/fan/checkout-flow.ts): the record is let go.
    await page.clock.fastForward(20_000);
    await expect.poll(() => checkouts.count, { message: "then pays, once" }).toBe(1);
    await expect(page, "and ends on the ticket").toHaveURL(TICKET_URL);
    expect(checkouts.count).toBe(1);
  });

  test("an unseen payment whose card Stripe cannot be asked about stays kept: no second payment", async ({
    page,
    screens,
  }) => {
    // The server's status read answers the row (`requires_payment`) when it could not read
    // Stripe, for a card that may well be authorized; the confirmation, which reads Stripe itself,
    // answers 502. Nothing proves the card unpaid: the record stays and a tap pays nothing.
    screens.allowStatus(/\/api\/checkout\/[^/]+\/confirm$/, 502);
    await keepPurchaseBeforeOpening(page, {
      paymentIntentId: CHECKOUT.paymentIntentId,
      authorized: false,
    });
    const checkouts = countCheckouts(page);
    await answerStatus(page, () => NOT_PAID_YET);
    await answerConfirm(page, 502);
    await page.clock.install();
    const firstRead = nextStatusRead(page);
    await page.goto(`/c/${SLUG}`);
    await firstRead;
    // Past the quiet bound and the minute's: the pick-up ends « still on its way », kept.
    await page.clock.fastForward(70_000);
    await expect(page.getByRole("heading", { name: copy.checkout.unresolvedTitle })).toBeVisible();
    expect(await keptPurchase(page), "the purchase is still kept").not.toBeNull();

    await page.getByRole("button", { name: copy.checkout.backToPromo }).tap();
    await page.getByRole("button", { name: copy.campaign.buyApplePay }).tap();
    const followed = nextStatusRead(page);
    await payButton(page).tap();
    await followed;
    expect(checkouts.count, "no second payment while the first card may be authorized").toBe(0);
  });

  test("the sheet closed while paying: a refusal reopens it with its message", async ({
    page,
    screens,
  }) => {
    screens.allowStatus(/\/api\/checkout$/, 409);
    await page.route("**/api/checkout", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      // Time for the fan to close the sheet before the refusal comes back.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fallback({
        headers: { ...route.request().headers(), [MOCK_SCENARIO_HEADER]: "salesPaused" },
      });
    });
    await page.goto(`/c/${SLUG}`);
    await page.getByRole("button", { name: copy.campaign.buyApplePay }).tap();
    await payButton(page).tap();
    const sheet = page.getByRole("dialog", { name: copy.checkout.title });
    await sheet.getByRole("button", { name: copy.common.close }).tap();
    await expect(sheet, "the sheet closes while the payment is on its way").toBeHidden();
    await expect(sheet, "the refusal brings the sheet back").toBeVisible();
    await expect(sheet.getByRole("alert")).toContainText(/paused/i);
  });

  test("a promo whose sales close while the sheet is open says so, not « Paused for now »", async ({
    page,
  }) => {
    await page.goto(`/c/${SLUG}`);
    await page.getByRole("button", { name: copy.campaign.buyApplePay }).tap();
    const sheet = page.getByRole("dialog", { name: copy.checkout.title });
    await expect(payButton(page)).toBeEnabled();
    await page.route("**/api/c/**", (route) =>
      route.request().method() === "GET"
        ? route.fallback({
            headers: { ...route.request().headers(), [MOCK_SCENARIO_HEADER]: "salesClosed" },
          })
        : route.fallback(),
    );
    await expect(sheet.getByText(copy.campaign.closed), "the sheet says sales closed").toBeVisible({
      timeout: 15_000,
    });
    await expect(sheet.getByText(copy.campaign.paused)).toHaveCount(0);
    await expect(payButton(page)).toBeDisabled();
  });
});

test.describe("C1 and C3 when the API cannot be read (review 2.4)", () => {
  test("C1: the chance turns unknown, and buying stops while the last read is too old", async ({
    page,
    screens,
  }) => {
    screens.allowStatus(/\/api\/c\//, 503);
    await page.goto(`/c/${SLUG}`);
    const buy = page.getByRole("button", { name: copy.campaign.buyApplePay });
    await expect(page.getByText(copy.campaign.chanceSuffix)).toBeVisible();
    await expect(buy).toBeEnabled();

    await failReads(page, "**/api/c/**");
    await expect(
      page.getByText(copy.campaign.chanceUpdating),
      "a failed read shows the chance as unknown",
    ).toBeVisible();
    await expect(page.getByText(copy.campaign.chanceSuffix)).toHaveCount(0);
    await expect(buy, "no sale on a read older than 10 s").toBeDisabled({ timeout: 20_000 });
    await expect(page.getByRole("main").getByText(copy.campaign.reconnecting)).toBeVisible();
    await expectNoCryptoWord(page, "C1 reconnecting");

    await page.unroute("**/api/c/**");
    await expect(buy, "buying is back with the next read").toBeEnabled();
    await expect(page.getByText(copy.campaign.chanceSuffix)).toBeVisible();
  });

  test("C3: the gauge turns unknown when the ticket cannot be re-read", async ({
    page,
    screens,
  }) => {
    screens.allowStatus(/\/api\/t\//, 503);
    await page.goto("/t/tkt_example_joes_texas?scenario=preGame");
    await expect(page.getByRole("img", { name: /^\d+% chance it's free$/ })).toBeVisible();
    await failReads(page, "**/api/t/**");
    await expect(
      page.getByRole("img", { name: copy.pickPromo.staleBook }),
      "a failed read shows the chance as unknown",
    ).toBeVisible();
    await expect(page.getByText(/\d+ ?% chance it's free/i)).toHaveCount(0);
  });
});

test.describe("C1 shows the venue (review 2.11)", () => {
  test("the merchant's logo when it has one", async ({ page, baseURL }) => {
    const logo = `${baseURL ?? ""}/brand/icon-winz-lime.svg`;
    await page.route("**/api/c/**", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      const json = (await response.json()) as { merchant: { logoUrl: string | null } };
      json.merchant.logoUrl = logo;
      await route.fulfill({ response, json });
    });
    await page.goto(`/c/${SLUG}`);
    await expect(page.getByRole("main").locator(`img[src="${logo}"]`)).toBeVisible();
  });

  test("its initial when it has none, as on the ticket", async ({ page }) => {
    await page.goto(`/c/${SLUG}`);
    const initial = CAMPAIGN.merchant.name.slice(0, 1).toUpperCase();
    await expect(
      page
        .getByRole("main")
        .locator("span[aria-hidden='true']")
        .filter({ hasText: new RegExp(`^${initial}$`) }),
    ).toBeVisible();
  });
});

test.describe("C1 on Android (review section 3)", () => {
  test.use({ userAgent: PIXEL_7 });

  test("the main button names Google Pay, never Apple Pay", async ({ page }) => {
    await page.goto(`/c/${SLUG}`);
    await expect(page.getByRole("button", { name: copy.campaign.buyGooglePay })).toBeEnabled();
    await expect(page.getByRole("button", { name: copy.campaign.buyApplePay })).toHaveCount(0);
  });
});
