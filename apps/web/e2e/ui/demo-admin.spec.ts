import type { Locator, Page, Request } from "@playwright/test";
import { ADMIN_KEY_HEADER, MOCK_SCENARIO_HEADER, apiExamples } from "@winz/shared";

import { copy } from "../../lib/copy";

import { expect, test, type Screens } from "./support/fixtures";
import { signInAsMerchant } from "./support/sign-in";

/**
 * The demo panel at `/admin` (TASKS U-07, SPEC MDB-4) and the DEMO MODE band, on a phone.
 *
 * The simulated API checks no key. To prove the panel against the real routes' answers, this spec
 * plays the server's key check itself: every request to `/api/admin/demo/*` passes through
 * `DemoRoutes`, which records it and, when its `x-admin-key` is not the key the "server" accepts,
 * asks the mock for its `wrongKey` refusal (the real route's `401 unauthenticated`, from
 * `MOCK_REFUSALS` in lib/server/route.ts). The 400, 404 and 409 are the mock's own refusals too,
 * asked for one request at a time. Every answer comes from the app's server, never from the test.
 */

const A = copy.admin;
const SYMBOL = apiExamples.hedgeDeskExample.instruments[0]?.symbol ?? "";
const DEMO_PATH = /\/api\/admin\/demo\//;
const GOOD_KEY = "e2e-panel-key-7Qf2";
const WRONG_KEY = "e2e-wrong-key-x91";

type DemoRoute = "book" | "result" | "sale" | "reset";

interface DemoCall {
  route: DemoRoute;
  body: unknown;
  key: string | null;
}

class DemoRoutes {
  readonly calls: DemoCall[] = [];
  /** The key the simulated server accepts; changing it makes the held key a refused one. */
  accepted = GOOD_KEY;
  private readonly next = new Map<DemoRoute, string>();

  /** The mock scenario the next request to `route` asks for (a refusal of `MOCK_REFUSALS`). */
  answerNext(route: DemoRoute, scenario: string): void {
    this.next.set(route, scenario);
  }

  callsTo(route: DemoRoute): DemoCall[] {
    return this.calls.filter((call) => call.route === route);
  }

  async install(page: Page): Promise<void> {
    await page.route(DEMO_PATH, async (route) => {
      const request = route.request();
      const name = new URL(request.url()).pathname.split("/").pop() as DemoRoute;
      const headers = await request.allHeaders();
      const key = headers[ADMIN_KEY_HEADER] ?? null;
      const raw = request.postData();
      this.calls.push({ route: name, body: raw === null ? null : JSON.parse(raw), key });
      let scenario: string | undefined;
      if (key !== this.accepted) {
        scenario = "wrongKey";
      } else {
        scenario = this.next.get(name);
        this.next.delete(name);
      }
      await route.continue({
        headers:
          scenario === undefined ? headers : { ...headers, [MOCK_SCENARIO_HEADER]: scenario },
      });
    });
  }
}

/** Every request the page sends, to check where the key went. */
function recordRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on("request", (request) => requests.push(request));
  return requests;
}

function band(page: Page): Locator {
  return page.getByText(copy.demo.banner, { exact: true });
}

function panel(page: Page, title: string): Locator {
  return page.getByRole("region", { name: title, exact: true });
}

async function openKeyScreen(page: Page): Promise<void> {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: A.title })).toBeVisible();
  await expect(page.getByLabel(A.keyLabel)).toBeVisible();
}

async function unlock(page: Page, key: string): Promise<void> {
  await page.getByLabel(A.keyLabel).fill(key);
  await page.getByRole("button", { name: A.gate.unlock }).tap();
}

async function unlockedPanel(page: Page, routes: DemoRoutes): Promise<void> {
  await routes.install(page);
  await openKeyScreen(page);
  await unlock(page, GOOD_KEY);
  await expect(page.getByRole("button", { name: A.lock, exact: true })).toBeVisible();
}

async function storedKeys(page: Page): Promise<{ session: string | null; local: string[] }> {
  return page.evaluate(() => {
    const local: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const name = window.localStorage.key(index);
      if (name !== null) local.push(`${name}=${window.localStorage.getItem(name) ?? ""}`);
    }
    return { session: window.sessionStorage.getItem("winz.admin-key"), local };
  });
}

function allowRefusals(screens: Screens, ...statuses: number[]): void {
  for (const status of statuses) screens.allowStatus(DEMO_PATH, status);
}

test.describe("the demo panel on a phone (U-07, MDB-4)", () => {
  // `next dev` compiles a page and a route on their first request: the panel and its four routes
  // are not in the global warm-up, so they are asked for once here, outside every timed wait.
  test.beforeAll(async ({ playwright }, testInfo) => {
    test.setTimeout(240_000);
    const request = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
    try {
      await request.get("/admin", { timeout: 180_000 });
      for (const name of ["book", "result", "sale", "reset"]) {
        await request.post(`/api/admin/demo/${name}`, { data: {}, timeout: 180_000 });
      }
    } finally {
      await request.dispose();
    }
  });

  test("a wrong key is refused and asked again; the right one opens the panel", async ({
    page,
    screens,
  }) => {
    allowRefusals(screens, 401);
    const routes = new DemoRoutes();
    await routes.install(page);
    await openKeyScreen(page);
    await expect(band(page), "the DEMO MODE band is up from the key screen on").toBeVisible();
    await screens.shot("admin-key");

    await unlock(page, WRONG_KEY);
    await expect(page.getByText(A.gate.rejected), "the refusal is said in words").toBeVisible();
    await expect(page.getByLabel(A.keyLabel), "and the key is asked again").toBeVisible();
    await expect(page.getByRole("button", { name: A.lock, exact: true })).toHaveCount(0);
    expect(routes.calls, "the key was checked with the server, in the header").toHaveLength(1);
    expect(routes.calls[0]?.key).toBe(WRONG_KEY);
    expect((await storedKeys(page)).session, "a refused key is never kept").toBeNull();
    await screens.shot("admin-key-refused");

    await unlock(page, GOOD_KEY);
    await expect(
      page.getByRole("button", { name: A.lock, exact: true }),
      "the panel opens",
    ).toBeVisible();
    expect((await storedKeys(page)).session, "the accepted key is kept for the tab").toBe(GOOD_KEY);
  });

  test("a key the server stops accepting sends the panel back to the key screen", async ({
    page,
    screens,
  }) => {
    allowRefusals(screens, 401);
    const routes = new DemoRoutes();
    await unlockedPanel(page, routes);

    routes.accepted = "rotated-on-the-server";
    const reset = panel(page, A.resetPanel.title);
    await reset.getByRole("button", { name: A.resetPanel.button }).tap();
    await reset.getByRole("button", { name: A.resetPanel.confirm, exact: true }).tap();
    await expect(page.getByText(A.gate.sessionEnded), "the key screen says why").toBeVisible();
    await expect(page.getByLabel(A.keyLabel)).toBeVisible();
    expect((await storedKeys(page)).session, "the refused key is forgotten").toBeNull();
  });

  test("the four actions reach their routes with the README's bodies and show the answer", async ({
    page,
    screens,
  }) => {
    const routes = new DemoRoutes();
    const requests = recordRequests(page);
    await unlockedPanel(page, routes);
    await expect(band(page)).toBeVisible();
    await expect(
      page.getByText(apiExamples.hedgeDeskExample.venueLabel),
      "the venue, as the desk's API words it",
    ).toBeVisible();

    // The instrument, from the desk's list.
    await page.getByRole("radio").first().tap();
    await expect(page.getByLabel(A.instrument.symbolLabel)).toHaveValue(SYMBOL);

    // Drive the odds: a preset, then the bounds as a thumb types them.
    const drive = panel(page, A.drive.title);
    await drive.getByRole("button", { name: A.drive.presets.low, exact: true }).tap();
    await drive.getByRole("button", { name: A.drive.submit }).tap();
    await expect(drive.getByText(A.drive.saved("11%", "13%", "500"))).toBeVisible();
    await expect(
      drive.getByText(`${A.drive.onDesk}: ${A.instrument.bidAsk("11%", "13%")}`),
      "what the engine reads, from the desk",
    ).toBeVisible();

    await drive.getByLabel(A.drive.bidLabel).fill("1");
    await drive.getByLabel(A.drive.askLabel).fill("99");
    await drive.getByLabel(A.drive.depthLabel).fill("0.01");
    await drive.getByRole("button", { name: A.drive.submit }).tap();
    await expect(drive.getByText(A.drive.saved("1%", "99%", "0.01"))).toBeVisible();
    expect(routes.callsTo("book").slice(1)).toEqual([
      {
        route: "book",
        key: GOOD_KEY,
        body: { instrumentSymbol: SYMBOL, bidBps: 1100, askBps: 1300, depth: "500000000" },
      },
      {
        route: "book",
        key: GOOD_KEY,
        body: { instrumentSymbol: SYMBOL, bidBps: 100, askBps: 9900, depth: "10000" },
      },
    ]);

    // Off the bounds: told at the field, nothing sent.
    const sentBooks = routes.callsTo("book").length;
    const refusals: { bid: string; ask: string; depth: string; field: string; error: string }[] = [
      { bid: "0", ask: "13", depth: "500", field: A.drive.bidLabel, error: A.drive.errors.price },
      { bid: "11", ask: "100", depth: "500", field: A.drive.askLabel, error: A.drive.errors.price },
      {
        bid: "12.5",
        ask: "13",
        depth: "500",
        field: A.drive.bidLabel,
        error: A.drive.errors.price,
      },
      {
        bid: "13",
        ask: "13",
        depth: "500",
        field: A.drive.askLabel,
        error: A.drive.errors.crossed,
      },
      {
        bid: "14",
        ask: "13",
        depth: "500",
        field: A.drive.askLabel,
        error: A.drive.errors.crossed,
      },
      { bid: "11", ask: "13", depth: "0", field: A.drive.depthLabel, error: A.drive.errors.depth },
      {
        bid: "11",
        ask: "13",
        depth: "0.001",
        field: A.drive.depthLabel,
        error: A.drive.errors.depth,
      },
    ];
    for (const refusal of refusals) {
      await drive.getByLabel(A.drive.bidLabel).fill(refusal.bid);
      await drive.getByLabel(A.drive.askLabel).fill(refusal.ask);
      await drive.getByLabel(A.drive.depthLabel).fill(refusal.depth);
      await drive.getByRole("button", { name: A.drive.submit }).tap();
      await expect(
        drive.getByLabel(refusal.field),
        `${refusal.bid} / ${refusal.ask} / ${refusal.depth} is refused at the field`,
      ).toHaveAttribute("aria-invalid", "true");
      await expect(drive.getByText(refusal.error).first()).toBeVisible();
    }
    expect(routes.callsTo("book"), "nothing off the bounds was sent").toHaveLength(sentBooks);

    // Force the result: nothing leaves before the confirmation, and Cancel sends nothing.
    const result = panel(page, A.result.title);
    await result.getByRole("button", { name: new RegExp(`^${A.result.options.yes}`) }).tap();
    await expect(result.getByText(A.result.confirmTitle(A.result.options.yes))).toBeVisible();
    await expect(result.getByText(SYMBOL), "the confirmation names the instrument").toBeVisible();
    await screens.shot("admin-result-confirm");
    expect(routes.callsTo("result"), "a choice alone sends nothing").toHaveLength(0);
    await result.getByRole("button", { name: A.result.cancel, exact: true }).tap();
    await expect(result.getByText(A.result.confirmTitle(A.result.options.yes))).toHaveCount(0);
    expect(routes.callsTo("result"), "Cancel sends nothing").toHaveLength(0);
    await result.getByRole("button", { name: new RegExp(`^${A.result.options.no}`) }).tap();
    await result
      .getByRole("button", { name: A.result.confirm(A.result.options.no), exact: true })
      .tap();
    await expect(result.getByText(A.result.saved(A.result.options.no))).toBeVisible();
    expect(routes.callsTo("result")).toEqual([
      { route: "result", key: GOOD_KEY, body: { instrumentSymbol: SYMBOL, outcome: "no" } },
    ]);

    // Replay a sale: the ticket comes back at once (default), then after a wait (`processing`).
    const sale = panel(page, A.sale.title);
    await sale.getByLabel(A.sale.slugLabel).fill("joes-texas");
    await sale.getByRole("button", { name: copy.common.increase(A.sale.qtyLabel) }).tap();
    await sale.getByLabel(A.sale.emailLabel).fill("fan@example.com");
    await sale.getByRole("button", { name: A.sale.submit }).tap();
    await expect(sale.getByText(A.sale.ticketed)).toBeVisible();
    await expect(sale.getByRole("link", { name: A.sale.openTicket })).toHaveAttribute(
      "href",
      `/t/${apiExamples.demoExamples.sale.ticketToken ?? ""}`,
    );
    routes.answerNext("sale", "processing");
    const followed = page.waitForResponse(
      `**/api/checkout/${apiExamples.demoExamples.saleStillProcessing.paymentIntentId ?? ""}`,
    );
    await sale.getByRole("button", { name: A.sale.submit }).tap();
    await followed;
    await expect(sale.getByText(A.sale.ticketed), "the ticket followed to its end").toBeVisible();
    expect(routes.callsTo("sale").map((call) => call.body)).toEqual([
      { slug: "joes-texas", qty: 2, email: "fan@example.com" },
      { slug: "joes-texas", qty: 2, email: "fan@example.com" },
    ]);

    // Reset, after its one confirmation.
    const reset = panel(page, A.resetPanel.title);
    await reset.getByRole("button", { name: A.resetPanel.button }).tap();
    expect(routes.callsTo("reset"), "the first tap only asks").toHaveLength(0);
    await reset.getByRole("button", { name: A.resetPanel.confirm, exact: true }).tap();
    await expect(reset.getByText(A.resetPanel.saved)).toBeVisible();
    expect(routes.callsTo("reset")).toEqual([{ route: "reset", key: GOOD_KEY, body: {} }]);

    await expect(page.getByRole("region", { name: A.log.title })).toBeVisible();
    await screens.shot("admin-panel");

    // The key: in sessionStorage, in the header of the demo routes, and nowhere else.
    const kept = await storedKeys(page);
    expect(kept.session).toBe(GOOD_KEY);
    expect(
      kept.local.filter((entry) => entry.includes(GOOD_KEY)),
      "not in localStorage",
    ).toEqual([]);
    expect(page.url(), "not in the URL").not.toContain(GOOD_KEY);
    expect(
      (await page.context().cookies()).filter((cookie) => cookie.value.includes(GOOD_KEY)),
      "not in a cookie",
    ).toEqual([]);
    expect(await page.content(), "not in the page once entered").not.toContain(GOOD_KEY);
    const leaks: string[] = [];
    for (const request of requests) {
      const headers = await request.allHeaders();
      const where = `${request.method()} ${request.url()}`;
      if (request.url().includes(GOOD_KEY)) leaks.push(`URL of ${where}`);
      if ((request.postData() ?? "").includes(GOOD_KEY)) leaks.push(`body of ${where}`);
      for (const [name, value] of Object.entries(headers)) {
        if (!value.includes(GOOD_KEY)) continue;
        const allowed =
          name === ADMIN_KEY_HEADER && DEMO_PATH.test(new URL(request.url()).pathname);
        if (!allowed) leaks.push(`header ${name} of ${where}`);
      }
    }
    expect(leaks, "the key leaves the page in the x-admin-key header only").toEqual([]);
    expect(
      requests.filter((request) => DEMO_PATH.test(request.url())).length,
      "every demo call carried the header",
    ).toBe(routes.calls.filter((call) => call.key === GOOD_KEY).length);
  });

  test("a 400, a 404 and a 409 are told in the API's words, with no code", async ({
    page,
    screens,
  }) => {
    allowRefusals(screens, 400, 404, 409);
    const routes = new DemoRoutes();
    await unlockedPanel(page, routes);
    await page.getByRole("radio").first().tap();

    const drive = panel(page, A.drive.title);
    routes.answerNext("book", "offTick");
    await drive.getByRole("button", { name: A.drive.presets.high, exact: true }).tap();
    await drive.getByRole("button", { name: A.drive.submit }).tap();
    const bookAlert = drive.getByRole("alert");
    await expect(bookAlert).toContainText(
      "Invalid body.bidBps: must be a multiple of 100 between 100 and 9900",
    );

    const result = panel(page, A.result.title);
    routes.answerNext("result", "unknownInstrument");
    await result.getByRole("button", { name: new RegExp(`^${A.result.options.void}`) }).tap();
    await result
      .getByRole("button", { name: A.result.confirm(A.result.options.void), exact: true })
      .tap();
    const resultAlert = result.getByRole("alert");
    await expect(resultAlert).toContainText("Instrument not found");

    const sale = panel(page, A.sale.title);
    routes.answerNext("sale", "salesPaused");
    await sale.getByLabel(A.sale.slugLabel).fill("joes-texas");
    await sale.getByLabel(A.sale.emailLabel).fill("fan@example.com");
    await sale.getByRole("button", { name: A.sale.submit }).tap();
    const saleAlert = sale.getByRole("alert");
    await expect(saleAlert).toContainText("This promo is paused right now, you were not charged");
    await expect(
      saleAlert,
      "a refusal is not an unknown outcome: no « may still have been created »",
    ).not.toContainText(A.sale.mayExist.trim());

    for (const alert of [bookAlert, resultAlert, saleAlert]) {
      await expect(alert).not.toContainText(/\b(400|404|409)\b|invalid_request|not_found|sales_/);
    }
    await screens.shot("admin-refusals");
  });

  test("the panel is linked from no public screen and asks not to be indexed", async ({ page }) => {
    for (const path of ["/", "/c/joes-texas", "/t/tkt_example_joes_texas", "/hedge-desk"]) {
      await page.goto(path);
      await expect(page.locator("body")).not.toBeEmpty();
      await page.waitForLoadState("networkidle");
      await expect(
        page.locator('a[href*="/admin"]'),
        `${path} has no link to the panel`,
      ).toHaveCount(0);
    }
    await page.goto("/admin");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
  });
});

test.describe("the DEMO MODE band wherever an answer says demo (MDB-4)", () => {
  test("C1, the public promo page: shown on `demo`, absent on `live`", async ({ page }) => {
    await page.goto("/c/joes-texas?scenario=live");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/back if/i);
    await expect(band(page), "no band on a promo no demo action touched").toHaveCount(0);

    await page.goto("/c/joes-texas?scenario=demo");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/back if/i);
    await expect(band(page)).toBeVisible();
  });

  test("C3, the ticket: shown on `demo`, absent on `preGame`", async ({ page }) => {
    await page.goto("/t/tkt_example_joes_texas?scenario=preGame");
    await expect(page.getByText(copy.ticket.showAtCounter, { exact: true })).toBeVisible();
    await expect(band(page)).toHaveCount(0);

    await page.goto("/t/tkt_example_joes_texas?scenario=demo");
    await expect(page.getByText(copy.ticket.showAtCounter, { exact: true })).toBeVisible();
    await expect(band(page)).toBeVisible();
  });

  test("the merchant's promo detail: shown on `demo`, absent on `live`", async ({ page }) => {
    await signInAsMerchant(page);
    const detail = "/campaigns/cmp_joes_texas";
    const tabs = page.getByRole("tablist", { name: copy.campaignDetail.tabsLabel });
    await page.goto(`${detail}?scenario=live`);
    await expect(tabs).toBeVisible();
    await expect(band(page)).toHaveCount(0);

    await page.goto(`${detail}?scenario=demo`);
    await expect(tabs).toBeVisible();
    await expect(band(page)).toBeVisible();
  });

  test("the Hedge desk: shown on `demo`, absent on `default`", async ({ page }) => {
    const venue = page.getByRole("region", { name: copy.hedgeDesk.venue.title });
    await page.goto("/hedge-desk");
    await expect(venue.getByRole("heading")).toHaveText(apiExamples.hedgeDeskExample.venueLabel);
    await expect(band(page)).toHaveCount(0);

    await page.goto("/hedge-desk?scenario=demo");
    await expect(venue.getByRole("heading")).toHaveText(apiExamples.hedgeDeskExample.venueLabel);
    await expect(band(page)).toBeVisible();
  });

  test("the panel: shown from the key screen on, and after an action's `demo: true`", async ({
    page,
  }) => {
    const routes = new DemoRoutes();
    await routes.install(page);
    await openKeyScreen(page);
    await expect(band(page)).toBeVisible();
    await unlock(page, GOOD_KEY);
    await expect(page.getByRole("button", { name: A.lock, exact: true })).toBeVisible();
    await expect(
      band(page),
      "the desk read on the panel says demo: false; the band stays",
    ).toBeVisible();
  });
});
