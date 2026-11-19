import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { test as base, expect, type Page } from "@playwright/test";

import { RECEIPTS_DIR } from "./paths";
import type { ReceiptName } from "./receipts";

/** The width of an iPhone 15 in CSS pixels: nothing may scroll sideways at this width. */
export const PHONE_WIDTH = 393;

/**
 * Console errors that are not the app's: each with the reason it is allowed. Anything else printed
 * as an error fails the test.
 */
export const ALLOWED_CONSOLE_ERRORS: readonly { pattern: RegExp; reason: string }[] = [
  {
    pattern: /^Failed to load resource: the server responded with a status of \d{3}/,
    reason:
      "Chromium's own line for any request answered with an error status, without the URL. It says " +
      "nothing the response check does not: a 404, a 5xx or a 4xx of the API that the scenario did " +
      "not ask for fails there, with its URL (isUnaskedFailure); one the test asked for (409 " +
      "sales_paused, a ticket answered 404 by the test) is expected.",
  },
  {
    pattern: /^Failed to load resource: net::ERR_BLOCKED_BY_CLIENT/,
    reason:
      "Chromium's own line for a request this suite blocked (see FOREIGN_REQUESTS_BLOCKED): the " +
      "block itself is checked, request by request, where it happens.",
  },
];

/**
 * Requests to another origin that are blocked without failing the test, each with its reason. Any
 * other request that leaves this machine fails the test. Nothing is ever let through.
 */
export const FOREIGN_REQUESTS_BLOCKED: readonly { pattern: RegExp; reason: string }[] = [
  {
    pattern: /^https:\/\/js\.stripe\.com\//,
    reason:
      "Stripe.js, which `@stripe/stripe-js` injects as soon as it is imported (lib/stripe/client.ts:1), " +
      "even in the simulated mode where no Stripe element is shown. Blocked: the simulated payment " +
      "does not use it. Reported as a finding (the simulated mode still calls a third party).",
  },
];

/**
 * Hidden on the receipts only (they stay on the page for the flows): the simulated mode's floating
 * scenario picker (`components/dev/mock-scenario-picker.tsx`, a `<label>` holding a `<select>`,
 * rendered straight under `<body>`) and Next.js's development badge. Neither is part of a screen.
 */
const RECEIPT_STYLE = "body > label:has(> select), nextjs-portal { display: none !important; }";

/**
 * A status the response check reports unless the test asked for it: a 404 or a 5xx anywhere, and
 * any other 4xx from this app's own API (a malformed body answered 400, a 401, a 409 refusal the
 * scenario did not ask for). Other 4xx (a page's own) are left to the screens' assertions.
 */
export function isUnaskedFailure(status: number, url: string, origin: string): boolean {
  if (status === 404 || status >= 500) return true;
  if (status < 400) return false;
  const parsed = new URL(url);
  return parsed.origin === origin && parsed.pathname.startsWith("/api/");
}

/**
 * How far the page's content runs past the right edge, or `null` when it does not.
 *
 * Measured against `documentElement.clientWidth`, never `window.innerWidth`: under the iPhone
 * descriptor's mobile emulation (`isMobile`), the layout viewport widens to fit the content, so
 * `innerWidth` grows with `scrollWidth` and a comparison with it can never fail. `clientWidth`
 * stays the device's 393 px; the configured viewport width is checked as well, in case a page
 * changes its own viewport meta.
 */
export async function horizontalOverflow(
  page: Page,
): Promise<{ content: number; viewport: number } | null> {
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  const viewport = Math.min(widths.client, page.viewportSize()?.width ?? PHONE_WIDTH);
  const content = Math.max(widths.document, widths.body);
  return content > viewport ? { content, viewport } : null;
}

interface AllowedStatus {
  url: RegExp;
  status: number;
}

/**
 * Watches one page for everything the brief forbids across all flows: a request answered 404 or
 * 5xx (or a 4xx of the API) that the scenario did not ask for, an uncaught page error, a console error, a request that
 * leaves this machine, sideways scroll at 393 px, and a link to a page that does not exist.
 */
export class Screens {
  private readonly problems: string[] = [];
  private readonly overflows: string[] = [];
  /** Same-origin link targets seen on the screens, with the first screen that showed each. */
  private readonly links = new Map<string, ReceiptName>();
  private readonly allowedStatuses: AllowedStatus[] = [];
  private shooting = 0;

  constructor(
    private readonly page: Page,
    private readonly origin: string,
  ) {}

  /** A failing status the test itself asked for (a refusal scenario, a route the test answers). */
  allowStatus(url: RegExp, status: number): void {
    this.allowedStatuses.push({ url, status });
  }

  async attach(): Promise<void> {
    const { page } = this;
    page.on("pageerror", (error) => {
      this.problems.push(`uncaught page error on ${page.url()}: ${error.message}`);
    });
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (ALLOWED_CONSOLE_ERRORS.some((allowed) => allowed.pattern.test(text))) return;
      this.problems.push(`console error on ${page.url()}: ${text}`);
    });
    page.on("response", (response) => {
      const status = response.status();
      const url = response.url();
      if (!isUnaskedFailure(status, url, this.origin)) return;
      const asked = this.allowedStatuses.some(
        (allowed) => allowed.status === status && allowed.url.test(url),
      );
      if (!asked) {
        this.problems.push(`${status.toString()} ${response.request().method()} ${url}`);
      }
    });
    // Nothing leaves this machine: no real network, no real service.
    await page.context().route(
      (url) => url.origin !== this.origin,
      async (route) => {
        const url = route.request().url();
        if (!FOREIGN_REQUESTS_BLOCKED.some((allowed) => allowed.pattern.test(url))) {
          this.problems.push(`request to another origin, blocked: ${url}`);
        }
        await route.abort("blockedbyclient");
      },
    );
  }

  /**
   * The receipt of one screen: a full-page screenshot under a stable name, after checking that the
   * screen does not scroll sideways, and noting its links for the check at the end of the test.
   */
  async shot(name: ReceiptName): Promise<void> {
    const began = Date.now();
    const { page } = this;
    const overflow = await horizontalOverflow(page);
    if (overflow !== null) {
      this.overflows.push(
        `${name} (${page.url()}): content is ${overflow.content.toString()} px wide in a ${overflow.viewport.toString()} px viewport`,
      );
    }
    const hrefs = await page
      .locator("a[href]")
      .evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href));
    for (const href of hrefs) {
      const url = new URL(href);
      if (url.origin !== this.origin) continue;
      const path = `${url.pathname}${url.search}`;
      if (!this.links.has(path)) this.links.set(path, name);
    }
    mkdirSync(RECEIPTS_DIR, { recursive: true });
    await page.screenshot({
      path: join(RECEIPTS_DIR, `${name}.png`),
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      style: RECEIPT_STYLE,
    });
    this.shooting += Date.now() - began;
  }

  /** What this page did so far that the scenario did not ask for (read by the harness's controls). */
  get problemsSoFar(): readonly string[] {
    return [...this.problems];
  }

  /** Milliseconds spent taking receipts so far: a timed flow takes them out of its own time. */
  get receiptMs(): number {
    return this.shooting;
  }

  /** Every link seen must open a page that exists (not 404, not 5xx). */
  private async deadLinks(): Promise<string[]> {
    const dead: string[] = [];
    for (const [path, screen] of this.links) {
      const response = await this.page.request.get(`${this.origin}${path}`, {
        failOnStatusCode: false,
        timeout: 60_000,
      });
      const status = response.status();
      if (status === 404 || status >= 500) {
        dead.push(`${path} (seen on ${screen}) answers ${status.toString()}`);
      }
    }
    return dead;
  }

  async verify(): Promise<void> {
    expect
      .soft(this.problems, "requests, page errors and console errors the scenario did not ask for")
      .toEqual([]);
    expect.soft(this.overflows, `screens wider than ${PHONE_WIDTH.toString()} px`).toEqual([]);
    expect.soft(await this.deadLinks(), "links to pages that do not exist").toEqual([]);
  }
}

export const test = base.extend<{ screens: Screens }>({
  // Automatic: every test of the flows is watched, also those that never take a receipt (the
  // known-defect tests), so a console error or a failing request is never missed for want of asking.
  screens: [
    async ({ page, baseURL }, use) => {
      if (baseURL === undefined) throw new Error("playwright.config.ts must set use.baseURL");
      const screens = new Screens(page, new URL(baseURL).origin);
      await screens.attach();
      await use(screens);
      await screens.verify();
    },
    { auto: true },
  ],
});

export { expect };
