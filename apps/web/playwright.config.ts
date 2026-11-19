import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

/**
 * The browser suite of the screens (TASKS Q-02, first half): the app in simulated mode, driven at
 * the iPhone 15's size. Run it with `pnpm e2e:ui` from the root. See `e2e/ui/README` in
 * `apps/web/README.md` and the receipts in `docs/receipts/ui/`.
 *
 * WebKit is not installed here: the iPhone 15 descriptor (viewport, user agent, touch, mobile) runs
 * on Chromium. That proves the layout and the flows at that size, not Safari's rendering.
 */

/** A port of its own, so a `pnpm dev` on 3000 (maybe on the real API) is never reused by mistake. */
const PORT = Number.parseInt(process.env.E2E_UI_PORT ?? "3460", 10);
const BASE_URL = `http://localhost:${PORT.toString()}`;

/** What `next/font/google` reads instead of Google Fonts: the dev server downloads nothing. */
const FONT_FIXTURE = fileURLToPath(
  new URL("./e2e/ui/support/google-fonts-mock.cjs", import.meta.url),
);

/**
 * A proxy that answers nothing (the discard port of this machine): any request the dev server would
 * still send to another host fails at once instead of reaching a real network. The app's own
 * server-side requests to itself (C1 reads its promo from `/api/c/:slug`) go to localhost and skip it.
 */
const NO_NETWORK = "http://127.0.0.1:9";

export default defineConfig({
  testDir: "./e2e/ui",
  testMatch: "**/*.spec.ts",
  outputDir: "./test-results/ui",
  globalSetup: "./e2e/ui/global-setup.ts",
  globalTeardown: "./e2e/ui/global-teardown.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  // Four CPUs, and `next dev` compiles on demand: two browsers at a time keep it responsive.
  workers: 2,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "off",
    video: "off",
    screenshot: "off",
    // A previous run's service worker must not serve this run (the app's worker is off in
    // development anyway: `next.config.ts` disables it outside a production build).
    serviceWorkers: "block",
    locale: "en-US",
    timezoneId: "America/Chicago",
    navigationTimeout: 60_000,
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "iphone-15",
      use: {
        ...devices["iPhone 15"],
        browserName: "chromium",
        // Receipts stay small: scale 2 instead of the phone's 3.
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: {
    // Turbopack, not webpack: with webpack, `next dev` grows by about 250 MB per route it compiles
    // (6 GB after sixteen routes here) and restarts itself once its heap passes 80% of the limit,
    // dropping every compiled page in the middle of a run. Turbopack stays under 4 GB for all of them.
    command: `pnpm exec next dev --turbopack --port ${PORT.toString()}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: true,
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      APP_API_MOCK: "true",
      NEXT_PUBLIC_APP_API_MOCK: "true",
      NEXT_TELEMETRY_DISABLED: "1",
      // Nothing may touch a real network (brief): Sora comes from a local fixture, not Google Fonts
      // (`next/font/google` honours this variable; checked by harness.spec.ts), and every other
      // outgoing request of the server dies on a dead proxy.
      NEXT_FONT_GOOGLE_MOCKED_RESPONSES: FONT_FIXTURE,
      HTTPS_PROXY: NO_NETWORK,
      HTTP_PROXY: NO_NETWORK,
      https_proxy: NO_NETWORK,
      http_proxy: NO_NETWORK,
      NO_PROXY: "localhost,127.0.0.1,::1",
      no_proxy: "localhost,127.0.0.1,::1",
      // Headroom before `next dev`'s own restart at 80% of the heap (see `command`).
      NODE_OPTIONS: "--max-old-space-size=4096",
    },
  },
});
