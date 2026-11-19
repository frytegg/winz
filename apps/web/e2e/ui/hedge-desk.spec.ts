import { copy } from "../../lib/copy";

import { expect, test } from "./support/fixtures";

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
