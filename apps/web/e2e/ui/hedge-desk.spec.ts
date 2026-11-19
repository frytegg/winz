import { apiExamples, type HedgeDeskResponse } from "@winz/shared";

import { copy } from "../../lib/copy";
import { formatMoney } from "../../lib/format";
import { formatBpsPercent, formatPriceBps, formatQty } from "../../lib/hedge/format";

import { PHONE_WIDTH, expect, test } from "./support/fixtures";

const T = copy.hedgeDesk;

/** SPEC MDB-3: public, read-only, the execution venue in clear and first. */
test("the Hedge desk, without sign-in: venue first, exposure, position, orders, fills, breaker", async ({
  page,
  screens,
}) => {
  await page.goto("/hedge-desk");
  await expect(page.getByRole("heading", { name: T.title })).toBeVisible();

  const venue = page.getByRole("region", { name: T.venue.title });
  await expect(venue.getByRole("heading"), "the venue is said in clear (SPEC MDB-3)").toHaveText(
    "PAPER · live Gemini book",
  );
  const totals = page.getByRole("region", { name: T.totals.title });
  await expect(totals).toBeVisible();
  const [venueBox, totalsBox] = [await venue.boundingBox(), await totals.boundingBox()];
  expect(
    venueBox !== null && totalsBox !== null && venueBox.y < totalsBox.y,
    "the venue comes first",
  ).toBe(true);

  const I = T.instruments;
  await expect(
    page.getByText(`${I.exposureCode} · ${I.exposure}`).first(),
    "the exposure",
  ).toBeVisible();
  await expect(
    page.getByText(`${I.heldCode} · ${I.held}`).first(),
    "the position held",
  ).toBeVisible();
  await expect(
    page.getByText(`${I.workingCode} · ${I.working}`).first(),
    "the resting orders",
  ).toBeVisible();
  const orders = page.getByRole("region", { name: T.orders.title }).first();
  // Under 768 px each row is a list item (the table is for wider screens).
  await expect(orders.getByRole("listitem").first(), "the orders").toBeVisible();
  const fills = page.getByRole("region", { name: T.fills.title }).first();
  await expect(fills.getByRole("listitem").first(), "the fills").toBeVisible();
  await expect(page.getByText(T.instruments.makerSavings).first(), "maker savings").toBeVisible();
  await expect(
    page.getByLabel(`${T.breaker.title}: ${T.breaker.armed}`).first(),
    "the circuit breaker's state",
  ).toBeVisible();
  await expect(page.getByRole("region", { name: T.params.title }), "the risk limits").toBeVisible();
  await screens.shot("hd-desk");
});

const DESK: HedgeDeskResponse = apiExamples.hedgeDeskExample;

/**
 * SPEC MDB-3, 9.3 and 9.7, and TASKS U-06, line by line at 393 × 852, each figure as the API sends
 * it (`GET /api/hedge-desk`, scenario `default`) written by the app's own formatters: exposure,
 * position, resting orders, orders, fills, maker economics, circuit breaker, the venue in clear,
 * the risk parameters, and the sandbox proof of HE-10.
 */
test.describe("at the iPhone 15's full screen, 393 × 852", () => {
  // Playwright's iPhone 15 profile is 393 × 659 (the screen minus Safari's bars); the review asks
  // for the whole screen, 393 × 852 (REVUE-FRONT-19-NOV.md section 4, U-06).
  test.use({ viewport: { width: PHONE_WIDTH, height: 852 } });

  test("the Hedge desk at 393 × 852, line by line, with the API's numbers", async ({ page }) => {
    expect(page.viewportSize()).toEqual({ width: PHONE_WIDTH, height: 852 });
    await page.goto("/hedge-desk");
    const instrument = DESK.instruments[0];
    if (instrument === undefined) throw new Error("the desk example lists an instrument");

    const venue = page.getByRole("region", { name: T.venue.title });
    await expect(venue.getByRole("heading"), "MDB-3: the venue in clear").toHaveText(
      DESK.venueLabel,
    );
    await expect(venue, "9.7: maker fills are optimistic, said on the desk").toContainText(
      DESK.venueNote,
    );

    const totals = page.getByRole("region", { name: T.totals.title });
    await expect(totals, "the engine's totals (9.4, 9.6)").toContainText(
      `${T.totals.makerSavings}${formatMoney(DESK.totals.makerSavings)}`,
    );
    await expect(totals).toContainText(
      `${T.totals.guaranteeLosses}${formatMoney(DESK.totals.guaranteeLosses)}`,
    );
    await expect(totals).toContainText(
      `${T.totals.crossingGains}${formatMoney(DESK.totals.crossingGains)}`,
    );

    const P = T.params;
    const params = page.getByRole("region", { name: P.title });
    for (const [label, value] of [
      [P.uMax, formatMoney(DESK.params.uMax)],
      [P.makerTtl, P.makerTtlValue(DESK.params.makerTtlSeconds)],
      [P.askMove, P.askMoveValue(DESK.params.askMoveTicks)],
      [P.tolerance, P.toleranceValue(DESK.params.toleranceTicks)],
      [P.forceTaker, P.forceTakerValue(DESK.params.forceTakerMinutes)],
    ] as const) {
      await expect(
        params.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd[1]"),
        `9.3: the risk parameter « ${label} »`,
      ).toHaveText(value);
    }

    const proof = page.getByRole("region", { name: T.proof });
    for (const order of DESK.venueCheck?.orders ?? []) {
      await expect(proof, "HE-10: the sandbox order ids").toContainText(order.venueOrderId);
    }

    const card = page.getByRole("region", { name: instrument.eventTitle });
    await expect(card).toContainText(instrument.label);
    await expect(card, "the venue on the card").toContainText(DESK.venueLabel);
    await expect(card, "the instrument's symbol").toContainText(instrument.symbol);
    const I = T.instruments;
    await expect(card, "the book: bid").toContainText(
      `${I.bid}${formatBpsPercent(instrument.bidBps ?? 0)}`,
    );
    await expect(card, "the book: ask").toContainText(
      `${I.ask}${formatBpsPercent(instrument.askBps ?? 0)}`,
    );
    await expect(card).toContainText(instrument.stale ? I.stale : I.fresh);
    await expect(card, "E, the exposure").toContainText(
      `${I.exposureCode} · ${I.exposure}${formatQty(instrument.exposure)}`,
    );
    await expect(card, "H, the position held").toContainText(
      `${I.heldCode} · ${I.held}${formatQty(instrument.held)}`,
    );
    await expect(card, "W, the resting maker orders").toContainText(
      `${I.workingCode} · ${I.working}${formatQty(instrument.working)}`,
    );
    await expect(card, "the unhedged notional against U_max").toContainText(
      `${formatMoney(instrument.unhedgedNotional)}`,
    );
    await expect(card).toContainText(I.unhedgedOf(formatMoney(DESK.params.uMax)));
    await expect(card, "the maker savings of the instrument, vs 100% taker").toContainText(
      `${I.makerSavings} · ${I.makerSavingsHint}${formatMoney(instrument.makerSavings)}`,
    );
    await expect(card.getByLabel(`${T.breaker.title}: ${T.breaker.armed}`)).toBeVisible();

    const orders = card.getByRole("region", { name: T.orders.title }).getByRole("listitem");
    await expect(orders, "every order of the API, newest first").toHaveCount(
      instrument.orders.length,
    );
    const sortedOrders = [...instrument.orders].sort((a, b) => (a.at < b.at ? 1 : -1));
    for (const [index, order] of sortedOrders.entries()) {
      const row = orders.nth(index);
      await expect(row).toContainText(
        `${T.orders.kind[order.kind]} ${T.orders.side[order.side].toLowerCase()} · ${formatPriceBps(order.priceBps)}`,
      );
      await expect(row).toContainText(T.orders.statuses[order.status]);
      await expect(row).toContainText(
        `${T.orders.filled} ${formatQty(order.filledQty)} / ${formatQty(order.qty)}`,
      );
    }

    const fills = card.getByRole("region", { name: T.fills.title }).getByRole("listitem");
    await expect(fills, "every fill of the API").toHaveCount(instrument.fills.length);
    const sortedFills = [...instrument.fills].sort((a, b) => (a.at < b.at ? 1 : -1));
    for (const [index, fill] of sortedFills.entries()) {
      const row = fills.nth(index);
      await expect(row).toContainText(T.orders.kind[fill.kind]);
      await expect(row).toContainText(formatPriceBps(fill.priceBps));
      await expect(row).toContainText(formatQty(fill.qty));
      await expect(row).toContainText(formatMoney(fill.fee));
    }

    // Nothing runs past the right edge: the page as a whole (checked by every receipt) and each block.
    const overflowing = await page.evaluate((width) => {
      const wide: string[] = [];
      for (const element of document.querySelectorAll("main *")) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (element.closest(".sr-only") !== null) continue;
        if (box.right > width + 0.5 || box.left < -0.5) {
          wide.push(
            `${element.tagName.toLowerCase()}.${element.className.toString().slice(0, 60)}`,
          );
        }
      }
      return wide;
    }, PHONE_WIDTH);
    expect(overflowing, "no element of the desk runs past 393 px").toEqual([]);
  });
});

test("a tripped breaker and an unhedged amount over the limit are said in words", async ({
  page,
  screens,
}) => {
  const base = DESK.instruments[0];
  if (base === undefined) throw new Error("the desk example lists an instrument");
  // No scenario trips the breaker: the test answers the desk itself, in the API's shape.
  const tripped: HedgeDeskResponse = {
    ...DESK,
    instruments: [
      {
        ...base,
        stale: true,
        unhedgedNotional: "312000000",
        breaker: { active: true, reason: "stale_book" },
      },
    ],
  };
  await page.route("**/api/hedge-desk", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(tripped) }),
  );
  await page.goto("/hedge-desk");
  const card = page.getByRole("region", { name: base.eventTitle });
  await expect(
    card.getByLabel(`${T.breaker.title}: ${T.breaker.tripped}, ${T.breaker.reasons.stale_book}`),
    "MDB-3: the breaker's state and its reason",
  ).toBeVisible();
  await expect(card).toContainText(T.instruments.stale);
  await expect(card).toContainText(T.instruments.overLimit);
  await expect(card).toContainText(formatMoney("312000000"));
  await screens.shot("hd-desk-tripped");
});
