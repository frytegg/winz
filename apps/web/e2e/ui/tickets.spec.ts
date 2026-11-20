import type { Page } from "@playwright/test";

import { copy } from "../../lib/copy";
import { CRYPTO_WORDS } from "../../lib/crypto-words";

import { expect, horizontalOverflow, test } from "./support/fixtures";
import { signInAsFan } from "./support/sign-in";

/**
 * « My tickets » (SPEC C4, LT-2, TASKS U-09) on the simulated API: the list in each scenario of
 * `GET /api/tickets` (`default`, `severalTickets`, `noTickets`, `demoTicket`, and the refusal
 * `ticketsUnavailable`), opening a ticket, and the way in for someone signed out.
 */

const SCENARIO_KEY = "winz.mock-scenario";

/** No crypto word on a fan's screen (SPEC section 5 and criterion 2). */
async function expectNoCryptoWord(page: Page, screen: string): Promise<void> {
  const text = await page.locator("body").innerText();
  const found = CRYPTO_WORDS.exec(text);
  expect(found?.[0] ?? null, `a crypto word on the fan's screen ${screen}`).toBeNull();
}

function group(page: Page, title: string): ReturnType<Page["getByRole"]> {
  return page.getByRole("list", { name: copy.tickets.listLabel(title) });
}

test.describe("C4, « My tickets »", () => {
  test("signed out: asks to sign in with the e-mail of the purchase, then comes back to the list", async ({
    page,
    screens,
  }) => {
    await page.goto("/tickets?scenario=fan");
    await expect(page, "a signed-out fan is asked to sign in").toHaveURL(/\/start\?from=tickets$/);
    await expect(page.getByRole("heading", { name: copy.signIn.fanEmailTitle })).toBeVisible();
    await expect(page.getByText(copy.signIn.fanEmailBody)).toBeVisible();
    await expect(page.getByRole("button", { name: copy.signIn.faceId })).toBeVisible();
    await page.getByLabel(copy.signIn.emailLabel).fill("maya@example.com");
    await expectNoCryptoWord(page, "C4 sign-in");
    await screens.shot("c4-sign-in");
    await page.getByRole("button", { name: copy.common.continue }).tap();
    await expect(page, "the code step keeps the fan's entry").toHaveURL(/from=tickets/);
    await page.getByLabel(copy.signIn.codeDigit(1)).fill("123456");

    await expect(page, "back to the list").toHaveURL(/\/tickets$/);
    await expect(page.getByRole("heading", { name: copy.tickets.title })).toBeVisible();
    // `default`: one ticket before the game, one refunded.
    await expect(group(page, "Live").getByRole("listitem")).toHaveCount(1);
    await expect(group(page, "Won").getByRole("listitem")).toHaveCount(1);
  });

  test("one ticket in each phase: Live, Won, Not this time, and the refunded total", async ({
    page,
    screens,
  }) => {
    await signInAsFan(page, "severalTickets");
    await expect(page.getByRole("heading", { name: copy.tickets.title })).toBeVisible();

    const live = group(page, "Live");
    const won = group(page, "Won");
    const lost = group(page, "Not this time");
    await expect(live.getByRole("listitem")).toHaveCount(2);
    await expect(won.getByRole("listitem")).toHaveCount(1);
    await expect(lost.getByRole("listitem")).toHaveCount(2);
    await expect(
      page.getByRole("heading", { level: 2 }),
      "the groups in SPEC C4's order",
    ).toHaveText(["Live", "Won", "Not this time"]);

    // Each ticket reads as on its own page (copy.ticket.phases), a cancelled game included.
    await expect(live.getByText(copy.ticket.phases.pre_game, { exact: true })).toBeVisible();
    await expect(live.getByText(copy.ticket.phases.in_game, { exact: true })).toBeVisible();
    await expect(live.getByText("14% chance it's free")).toBeVisible();
    await expect(live.getByText("Smash burger × 2")).toBeVisible();
    await expect(live.getByText("$24.00 paid")).toBeVisible();
    await expect(won.getByText(copy.ticket.phases.refunded, { exact: true })).toBeVisible();
    await expect(won.getByText("Refunded $6.00")).toBeVisible();
    await expect(lost.getByText(copy.ticket.phases.not_this_time, { exact: true })).toBeVisible();
    await expect(lost.getByText(copy.ticket.phases.cancelled, { exact: true })).toBeVisible();

    // `refundedTotal` as the API sends it, to the cent.
    await expect(page.getByText("$6.00", { exact: true })).toBeVisible();
    await expect(page.getByText(copy.tickets.refundedSoFar)).toBeVisible();

    expect(await horizontalOverflow(page), "no sideways scroll at 393 px").toBeNull();
    await expectNoCryptoWord(page, "C4 list");
    await screens.shot("c4-tickets");
  });

  test("opening a ticket shows its live page", async ({ page }) => {
    await signInAsFan(page, "severalTickets");
    const first = group(page, "Live").getByRole("link").first();
    await expect(first).toHaveAttribute("href", "/t/tkt_example_joes_texas_two");
    await first.tap();
    await expect(page).toHaveURL(/\/t\/tkt_example_joes_texas_two$/);
    await expect(
      page.getByText(copy.ticket.showAtCounter, { exact: true }),
      "the live ticket opens",
    ).toBeVisible();
  });

  test("no ticket yet: says what to do, and offers another e-mail", async ({ page, screens }) => {
    await signInAsFan(page, "noTickets");
    await expect(page.getByText(copy.tickets.empty)).toBeVisible();
    await expect(page.getByText(copy.tickets.emptyHint)).toBeVisible();
    await expect(page.getByText(copy.tickets.refundedSoFar)).toHaveCount(0);
    expect(await horizontalOverflow(page), "no sideways scroll at 393 px").toBeNull();
    await screens.shot("c4-tickets-empty");

    const other = page.getByRole("button", { name: copy.tickets.otherEmail });
    await expect(other).toHaveCount(2);
    await other.last().tap();
    await expect(page, "signed out, back to the fan's sign-in").toHaveURL(/\/start\?from=tickets$/);
    await expect(page.getByRole("heading", { name: copy.signIn.fanEmailTitle })).toBeVisible();
  });

  test("the list does not load: the message and a retry that works", async ({ page, screens }) => {
    screens.allowStatus(/\/api\/tickets$/, 503);
    await signInAsFan(page, "ticketsUnavailable");
    await expect(page.getByRole("heading", { name: copy.tickets.loadFailedTitle })).toBeVisible();
    await screens.shot("c4-tickets-error");

    await page.evaluate(
      (key) => window.sessionStorage.setItem(key, "severalTickets"),
      SCENARIO_KEY,
    );
    await page.getByRole("button", { name: copy.merchantSpace.retry }).tap();
    await expect(group(page, "Won").getByRole("listitem")).toHaveCount(1);
  });

  test("a demo ticket shows the DEMO MODE band", async ({ page, screens }) => {
    await signInAsFan(page, "demoTicket");
    await expect(group(page, "Live").getByRole("listitem")).toHaveCount(1);
    await expect(page.getByRole("status").filter({ hasText: copy.demo.banner })).toBeVisible();
    await screens.shot("c4-tickets-demo");
  });

  test("an ordinary list shows no DEMO MODE band", async ({ page }) => {
    await signInAsFan(page, "severalTickets");
    await expect(group(page, "Won").getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText(copy.demo.banner)).toHaveCount(0);
  });
});
