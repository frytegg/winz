// @ts-check
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { CheckError, EnvError } from './errors.mjs';
import { waitReady } from './ready.mjs';

/**
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('playwright-core').BrowserContext} BrowserContext
 * @typedef {import('playwright-core').Page} Page
 * @typedef {import('playwright-core').Response} Response
 * @typedef {import('./profile.mjs').Viewport} Viewport
 * @typedef {Pick<Viewport, 'width' | 'height'> & Partial<Viewport>} ViewportLike
 */

const SCRIPTS_DIR = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
export const INSTALL_HINT = `pnpm -C "${SCRIPTS_DIR}" exec playwright-core install chromium`;

/**
 * Launches the skill's pinned Chromium (playwright-core). `FRONTEND_CHROMIUM` replaces the executable (a Chrome or
 * Chromium binary). A missing browser is an EnvError (exit 3) that gives the install command.
 * @param {{headless?: boolean}} [options]
 * @returns {Promise<Browser>}
 */
export async function launch({ headless = true } = {}) {
  const override = process.env.FRONTEND_CHROMIUM?.trim() || undefined;
  if (override && !existsSync(override)) {
    throw new EnvError(`FRONTEND_CHROMIUM points to ${override}, which does not exist; fix or unset it (default browser: ${INSTALL_HINT})`);
  }
  try {
    return await chromium.launch({ headless, executablePath: override });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Executable doesn't exist|browserType\.launch: .*(?:not found|ENOENT)/i.test(message)) {
      throw new EnvError(
        `Chromium for playwright-core is not installed; run: ${INSTALL_HINT} (or set FRONTEND_CHROMIUM to a Chromium executable)`,
        { cause: err },
      );
    }
    throw new EnvError(`Chromium failed to launch: ${firstLine(message)}`, { cause: err });
  }
}

/**
 * A browser context emulating one viewport: size, device scale factor, mobile and touch, colour scheme (default
 * light), reduced motion (default no-preference), locale en-US and time zone UTC, so every run renders alike.
 * Offline unless `network` is true (CONTRACTS section 1: only commands given --network may fetch): a request or a
 * WebSocket leaving for another host is aborted (`blockedbyclient`; a WebSocket is closed before it connects), so a
 * page that hotlinks a font, a script or an API renders the way it would with no connection, and a gate never
 * fetches from the internet. Allowed: loopback hosts, non-http schemes (data:, blob:), and the origins the caller
 * named: `origins`, plus every URL loaded through `goto()` or `withPage()` (the target, which may be a deployed https
 * preview). A navigation the page starts itself (location.href, a meta refresh, a link, a popup) to any other host
 * is aborted, and the page never gains that host's origin. A route a caller registers later runs first and may
 * decide otherwise (Playwright runs the last registered route first); this one only falls back to the network.
 * @param {Browser} browser
 * @param {ViewportLike} view
 * @param {{network?: boolean, origins?: string[]}} [options]
 * @returns {Promise<BrowserContext>}
 */
export async function newContext(browser, view, { network = false, origins = [] } = {}) {
  if (!view || !Number.isInteger(view.width) || !Number.isInteger(view.height) || view.width <= 0 || view.height <= 0) {
    throw new TypeError(`newContext: viewport needs positive integer width and height, got ${JSON.stringify(view)}`);
  }
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: view.dpr ?? 1,
    isMobile: view.isMobile ?? false,
    hasTouch: view.hasTouch ?? false,
    colorScheme: view.colorScheme ?? 'light',
    reducedMotion: view.reducedMotion ?? 'no-preference',
    locale: 'en-US',
    timezoneId: 'UTC',
  });
  if (!network) {
    /** @type {Set<string>} */
    const allowed = new Set();
    ALLOWED.set(context, allowed);
    for (const url of origins) allowOrigin(context, url);
    try {
      await context.route((url) => leavesHost(url), (route) => (offlineAllows(route.request(), allowed) ? route.fallback() : route.abort('blockedbyclient')));
      await context.routeWebSocket((url) => leavesHost(url) && !allowed.has(originOf(url.href) ?? ''), (ws) => ws.close({ code: 1008, reason: 'offline: blocked by /frontend (no --network)' }));
    } catch (err) {
      await context.close().catch(() => {});
      throw err;
    }
  }
  return context;
}

/** @type {WeakMap<BrowserContext, Set<string>>} */
const ALLOWED = new WeakMap();

const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/i;

/**
 * True for an http(s) or ws(s) URL whose host is not a loopback address: the only requests the offline route
 * has to look at.
 * @param {URL} url
 * @returns {boolean}
 */
export function leavesHost(url) {
  return ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && !LOOPBACK.test(url.hostname);
}

/**
 * The http(s) origin a URL belongs to, with ws: and wss: read as http: and https: (a WebSocket to the target's
 * host belongs to the target). Null for other schemes and unparseable URLs.
 * @param {string} url
 * @returns {string | null}
 */
export function originOf(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const protocol = { 'http:': 'http:', 'https:': 'https:', 'ws:': 'http:', 'wss:': 'https:' }[parsed.protocol];
  return protocol ? `${protocol}//${parsed.host}` : null;
}

/**
 * Adds the origin of `url` to what an offline context lets through. `goto()` calls it for the URL it loads, so the
 * caller's own target always loads; a caller that navigates with page.goto directly calls it first. No effect on a
 * context opened with network on, or one newContext did not open.
 * @param {BrowserContext} context
 * @param {string} url
 */
export function allowOrigin(context, url) {
  const origin = originOf(url);
  if (origin) ALLOWED.get(context)?.add(origin);
}

/**
 * Whether an offline context lets a non-loopback request through: only a request (navigation or not, in any frame)
 * to an origin the caller allowed (newContext `origins`, `allowOrigin`, `goto`). Where the main frame happens to be is
 * never the test, so a page that navigates itself elsewhere gains nothing.
 * @param {import('playwright-core').Request} request
 * @param {ReadonlySet<string>} allowed
 * @returns {boolean}
 */
export function offlineAllows(request, allowed) {
  const origin = originOf(request.url());
  return origin !== null && allowed.has(origin);
}

/**
 * @typedef {{readyFlag?: boolean, timeoutMs?: number, navigationTimeoutMs?: number, network?: boolean,
 *   beforeGoto?: (page: Page, context: BrowserContext) => unknown}} WithPageOptions
 */

/**
 * Opens a fresh context and page for `view`, loads `url` (waitUntil 'load'), waits for readiness, runs `fn` and
 * always closes the context, which is offline unless `network` is true (newContext). `beforeGoto` runs before
 * navigation, to attach console, request or route handlers that must see the load itself. `fn` also receives the main document's response (null for same-document URLs).
 * A navigation that cannot reach the URL is an EnvError; a page that never becomes ready is a CheckError.
 * @template T
 * @param {Browser} browser
 * @param {ViewportLike} view
 * @param {string} url
 * @param {(page: Page, response: Response | null) => Promise<T> | T} fn
 * @param {WithPageOptions} [options]
 * @returns {Promise<T>}
 */
export async function withPage(browser, view, url, fn, { readyFlag = false, timeoutMs = 15000, navigationTimeoutMs = 30000, network = false, beforeGoto } = {}) {
  const context = await newContext(browser, view, { network });
  /** @type {unknown} */
  let failure;
  try {
    const page = await context.newPage();
    if (beforeGoto) await beforeGoto(page, context);
    const response = await goto(page, url, navigationTimeoutMs);
    await waitReady(page, { timeoutMs, readyFlag });
    return await fn(page, response);
  } catch (err) {
    failure = err;
    throw err;
  } finally {
    try {
      await context.close();
    } catch (closeErr) {
      if (failure === undefined) throw closeErr;
    }
  }
}

/**
 * Loads `url` (waitUntil 'load') after allowing its origin in an offline context (newContext). An unreachable URL is
 * an EnvError, a load that never finishes a CheckError.
 * @param {Page} page
 * @param {string} url
 * @param {number} timeout
 * @returns {Promise<Response | null>}
 */
export async function goto(page, url, timeout = 30000) {
  allowOrigin(page.context(), url);
  try {
    return await page.goto(url, { waitUntil: 'load', timeout });
  } catch (err) {
    const message = err instanceof Error ? firstLine(err.message) : String(err);
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new CheckError(`${url} did not finish loading within ${timeout} ms (${message}); a resource never completes`, { cause: err });
    }
    throw new EnvError(`cannot load ${url}: ${message}; check that the app is running and the URL is right`, { cause: err });
  }
}

/**
 * @param {string} message
 * @returns {string}
 */
function firstLine(message) {
  return message.split('\n').find((line) => line.trim() !== '')?.trim() ?? message;
}
