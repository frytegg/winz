// @ts-check
import { CheckError } from './errors.mjs';

/**
 * @typedef {{ready: boolean, readyState: string, fonts: string, pendingImages: string[], pendingCount: number,
 *   lazySkipped: number, flag: boolean}} ReadyProbe
 * @typedef {{elapsedMs: number, lazySkipped: number}} ReadyResult
 */

/**
 * In-page readiness probe (self-contained: it runs inside the page). Lazy images outside the viewport are not
 * waited for, because the browser does not load them until they are scrolled near.
 * @param {boolean} readyFlag
 * @returns {ReadyProbe}
 */
export const readyProbe = function readyProbe(readyFlag) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  /** @type {string[]} */
  const pending = [];
  let lazySkipped = 0;
  for (const img of Array.from(document.images)) {
    if (img.complete) continue;
    if (img.loading === 'lazy') {
      const r = img.getBoundingClientRect();
      const inView = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
      if (!inView) {
        lazySkipped += 1;
        continue;
      }
    }
    pending.push(img.currentSrc || img.src || '(no src)');
  }
  const fonts = document.fonts ? document.fonts.status : 'loaded';
  const flag = Reflect.get(window, '__FRONTEND_READY__') === true;
  return {
    ready: document.readyState === 'complete' && fonts === 'loaded' && pending.length === 0 && (!readyFlag || flag),
    readyState: document.readyState,
    fonts,
    pendingImages: pending.slice(0, 10),
    pendingCount: pending.length,
    lazySkipped,
    flag,
  };
};

/**
 * Waits until the page is ready to be measured: `document.readyState === 'complete'`, `document.fonts.ready`, every
 * `<img>` complete (lazy ones outside the viewport excepted), `window.__FRONTEND_READY__ === true` when `readyFlag`,
 * then two animation frames so layout and paint have settled. Never waits for network idle, which a page that
 * streams data never reaches. On timeout throws a CheckError naming each condition still unmet.
 * @param {import('playwright-core').Page} page
 * @param {{timeoutMs?: number, readyFlag?: boolean}} [options]
 * @returns {Promise<ReadyResult>}
 */
export async function waitReady(page, { timeoutMs = 15000, readyFlag = false } = {}) {
  const started = Date.now();
  const remaining = () => Math.max(1, timeoutMs - (Date.now() - started));
  try {
    await page.waitForFunction(`(${readyProbe.toString()})(${JSON.stringify(Boolean(readyFlag))}).ready`, undefined, {
      timeout: remaining(),
      polling: 50,
    });
    const settle = page.evaluate(async () => {
      if (document.fonts) await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))));
    });
    await withDeadline(settle, remaining(), 'fonts.ready and two animation frames');
  } catch (err) {
    if (!isTimeout(err)) throw err;
    throw await notReadyError(page, timeoutMs, readyFlag, err);
  }
  const probe = await page.evaluate(readyProbe, readyFlag);
  return { elapsedMs: Date.now() - started, lazySkipped: probe.lazySkipped };
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} what
 * @returns {Promise<T>}
 */
function withDeadline(promise, ms, what) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`timed out waiting for ${what}`);
      err.name = 'TimeoutError';
      reject(err);
    }, ms);
  });
  return /** @type {Promise<T>} */ (Promise.race([promise, deadline])).finally(() => clearTimeout(timer));
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isTimeout(err) {
  return err instanceof Error && err.name === 'TimeoutError';
}

/**
 * @param {import('playwright-core').Page} page
 * @param {number} timeoutMs
 * @param {boolean} readyFlag
 * @param {unknown} cause
 * @returns {Promise<CheckError>}
 */
async function notReadyError(page, timeoutMs, readyFlag, cause) {
  /** @type {string[]} */
  const unmet = [];
  try {
    const probe = await page.evaluate(readyProbe, readyFlag);
    if (probe.readyState !== 'complete') unmet.push(`document.readyState is "${probe.readyState}"`);
    if (probe.fonts !== 'loaded') unmet.push(`document.fonts is "${probe.fonts}"`);
    if (probe.pendingCount > 0) {
      unmet.push(`${probe.pendingCount} image(s) still loading (${probe.pendingImages.join(', ')})`);
    }
    if (readyFlag && !probe.flag) {
      unmet.push('window.__FRONTEND_READY__ is not true (the app must set it once its data is loaded, or set profile ready_flag to false)');
    }
    if (unmet.length === 0) unmet.push('fonts.ready or the two animation frames did not resolve');
  } catch (probeErr) {
    unmet.push(`the page could not be probed (${probeErr instanceof Error ? probeErr.message : String(probeErr)})`);
  }
  return new CheckError(`page not ready after ${timeoutMs} ms at ${page.url()}: ${unmet.join('; ')}`, { cause });
}
