// @ts-check
/**
 * Offline contexts (CONTRACTS section 1, "no network by default"): lib/browser newContext and withPage abort every
 * request and close every WebSocket that leaves for another host unless `network` is true. The "other host" in these
 * tests is the IPv4-mapped IPv6 form of the loopback address, which the offline route treats as foreign by name: if
 * the route ever failed, the request would still only reach this machine. The server tells the two names apart by
 * the Host header, so each test first proves, with network on, that the foreign request really happens.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { allowOrigin, goto, launch, leavesHost, newContext, offlineAllows, originOf, withPage } from '../../lib/browser.mjs';

/** @typedef {import('playwright-core').Browser} Browser */
/** @typedef {import('playwright-core').Page} Page */

const VIEW = { name: 'desktop', width: 800, height: 600, dpr: 1, isMobile: false, hasTouch: false };

/** @type {Browser} */
let browser;
/** @type {http.Server} */
let server;
let base = '';
let foreign = '';
let port = 0;
/** Requests that reached the server under the foreign name, as 'http <path>' or 'upgrade <path>'. */
/** @type {string[]} */
let foreignHits = [];

/**
 * A fake Playwright request for offlineAllows.
 * @param {string} url
 * @returns {import('playwright-core').Request}
 */
function fakeRequest(url) {
  return /** @type {any} */ ({ url: () => url });
}

/**
 * Polls until the foreign name saw `hit` or `ms` runs out.
 * @param {string} hit
 * @param {number} ms
 * @returns {Promise<boolean>}
 */
async function sawForeign(hit, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (foreignHits.includes(hit)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return foreignHits.includes(hit);
}

/**
 * @param {http.IncomingMessage} req
 * @returns {boolean}
 */
function viaForeignName(req) {
  return (req.headers.host ?? '').startsWith('[::ffff:');
}

describe('lib/browser: offline by default', () => {
  test('leavesHost: only http(s) and ws(s) URLs to a non-loopback host', () => {
    assert.equal(leavesHost(new URL('https://fonts.googleapis.com/css2?family=Inter')), true);
    assert.equal(leavesHost(new URL('wss://rpc.example.org/socket')), true);
    assert.equal(leavesHost(new URL('http://[::ffff:127.0.0.1]:8080/x.png')), true);
    assert.equal(leavesHost(new URL('http://192.168.56.1:8080/x.png')), true);
    assert.equal(leavesHost(new URL('http://127.0.0.1:4173/app.js')), false);
    assert.equal(leavesHost(new URL('http://127.4.5.6/app.js')), false);
    assert.equal(leavesHost(new URL('http://localhost:3000/')), false);
    assert.equal(leavesHost(new URL('http://[::1]:3000/')), false);
    assert.equal(leavesHost(new URL('data:text/plain,hi')), false);
    assert.equal(leavesHost(new URL('blob:http://127.0.0.1/abc')), false);
  });

  test('originOf: http(s) origins, ws(s) read as http(s), null otherwise', () => {
    assert.equal(originOf('https://preview.example.app/a?b#c'), 'https://preview.example.app');
    assert.equal(originOf('wss://preview.example.app/live'), 'https://preview.example.app');
    assert.equal(originOf('ws://192.168.56.1:8080/ws'), 'http://192.168.56.1:8080');
    assert.equal(originOf('data:text/plain,hi'), null);
    assert.equal(originOf('not a url'), null);
  });

  test('offlineAllows: only the origins the caller allowed, whatever the frame or navigation', () => {
    const allowed = new Set(['https://preview.example.app']);
    assert.equal(offlineAllows(fakeRequest('https://preview.example.app/'), allowed), true);
    assert.equal(offlineAllows(fakeRequest('https://preview.example.app/app.js'), allowed), true);
    assert.equal(offlineAllows(fakeRequest('wss://preview.example.app/live'), allowed), true);
    assert.equal(offlineAllows(fakeRequest('https://cdn.example.net/app.js'), allowed), false);
    assert.equal(offlineAllows(fakeRequest('http://preview.example.app/app.js'), allowed), false);
    assert.equal(offlineAllows(fakeRequest('http://192.168.56.1:8080/nav'), allowed), false);
    assert.equal(offlineAllows(fakeRequest('https://preview.example.app/'), new Set()), false);
  });

  describe('in Chromium', () => {
    before(async () => {
      browser = await launch();
      server = http.createServer((req, res) => {
        if (viaForeignName(req)) foreignHits.push(`http ${req.url}`);
        /** @type {Record<string, string>} */
        const pages = {
          '/ws.html': `<script>window.sock = new WebSocket('ws://' + location.host + '/ws');</script>`,
          '/ws-foreign.html': `<script>window.sock = new WebSocket('${foreign.replace('http:', 'ws:')}/ws');</script>`,
          '/nav.html': `<script>setTimeout(() => { location.href = '${foreign}/nav'; }, 20);</script>`,
          '/meta.html': `<meta http-equiv="refresh" content="0; url=${foreign}/meta-target">`,
          '/link.html': `<a id="go" href="${foreign}/link-target">go</a>`,
          '/popup.html': `<script>window.open('${foreign}/popup-target');</script>`,
        };
        const head = pages[req.url ?? ''];
        if (head !== undefined) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(`<!doctype html><html lang="en"><head><title>t</title>${head}</head><body><img src="/same.svg" alt=""></body></html>`);
          return;
        }
        if (req.url === '/ok.svg' || req.url === '/same.svg') {
          res.setHeader('Content-Type', 'image/svg+xml');
          res.end('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
          return;
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<!doctype html><html lang="en"><body><img src="/ok.svg" alt=""><img src="${foreign}/ok.svg" alt=""></body></html>`);
      });
      server.on('upgrade', (req, socket) => {
        if (viaForeignName(req)) foreignHits.push(`upgrade ${req.url}`);
        socket.destroy();
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
      const address = server.address();
      port = address && typeof address === 'object' ? address.port : 0;
      base = `http://127.0.0.1:${port}`;
      foreign = `http://[::ffff:127.0.0.1]:${port}`;
    });

    after(async () => {
      await browser?.close();
      server?.closeAllConnections();
      await new Promise((resolve) => (server ? server.close(() => resolve(undefined)) : resolve(undefined)));
    });

    test('withPage aborts the foreign request and serves the same-origin one', async () => {
      /** @type {Array<{url: string, error: string}>} */
      const failed = [];
      /** @type {string[]} */
      const finished = [];
      await withPage(browser, VIEW, `${base}/`, async () => {}, {
        beforeGoto: (page) => {
          page.on('requestfailed', (r) => failed.push({ url: r.url(), error: r.failure()?.errorText ?? '' }));
          page.on('requestfinished', (r) => finished.push(new URL(r.url()).host));
        },
      });
      assert.equal(failed.length, 1);
      assert.match(failed[0].error, /^net::ERR_BLOCKED_BY_CLIENT/);
      assert.match(failed[0].url, /^http:\/\/\[::ffff:7f00:1\]:\d+\/ok\.svg$/);
      assert.ok(finished.includes(`127.0.0.1:${port}`), 'the same-origin image loads');
    });

    test('network: true lets the request leave (it is not blocked by the client)', async () => {
      const context = await newContext(browser, VIEW, { network: true });
      try {
        const page = await context.newPage();
        /** @type {string[]} */
        const errors = [];
        page.on('requestfailed', (r) => errors.push(r.failure()?.errorText ?? ''));
        await page.goto(`${base}/`, { waitUntil: 'load' });
        assert.ok(!errors.some((e) => e.startsWith('net::ERR_BLOCKED_BY_CLIENT')), `got ${errors.join(', ')}`);
      } finally {
        await context.close();
      }
    });

    test('a route the caller registers later runs first and may continue', async () => {
      const context = await newContext(browser, VIEW);
      try {
        const page = await context.newPage();
        await page.route('**/*', (r) => r.continue());
        /** @type {string[]} */
        const errors = [];
        page.on('requestfailed', (r) => errors.push(r.failure()?.errorText ?? ''));
        await page.goto(`${base}/`, { waitUntil: 'load' });
        assert.ok(!errors.some((e) => e.startsWith('net::ERR_BLOCKED_BY_CLIENT')), `got ${errors.join(', ')}`);
      } finally {
        await context.close();
      }
    });

    /**
     * Opens `path` on the loopback target in a context with `network`, runs `act`, and says whether the foreign
     * name saw `hit` within `ms`.
     * @param {string} path
     * @param {string} hit
     * @param {boolean} network
     * @param {((page: Page) => Promise<unknown>) | undefined} act
     * @param {number} ms
     * @returns {Promise<boolean>}
     */
    async function leaks(path, hit, network, act, ms) {
      foreignHits = [];
      const context = await newContext(browser, VIEW, { network });
      try {
        const page = await context.newPage();
        await goto(page, `${base}${path}`);
        if (act) await act(page);
        return await sawForeign(hit, ms);
      } finally {
        await context.close();
      }
    }

    /** @type {Array<[string, string, string, ((page: Page) => Promise<unknown>) | undefined]>} */
    const escapes = [
      ['a WebSocket to another host', '/ws-foreign.html', 'upgrade /ws', undefined],
      ['a location.href navigation to another host', '/nav.html', 'http /nav', undefined],
      ['a meta refresh to another host', '/meta.html', 'http /meta-target', undefined],
      ['a clicked link to another host', '/link.html', 'http /link-target', (page) => page.click('#go', { noWaitAfter: true }).catch(() => undefined)],
      ['a popup opened on another host', '/popup.html', 'http /popup-target', undefined],
    ];
    for (const [label, path, hit, act] of escapes) {
      test(`offline: ${label} never leaves; with network on it does (control)`, async () => {
        assert.equal(await leaks(path, hit, true, act, 5000), true, `control: with network on the foreign name must see ${hit}, got ${JSON.stringify(foreignHits)}`);
        assert.equal(await leaks(path, hit, false, act, 1500), false, `offline: the foreign name saw ${JSON.stringify(foreignHits)}`);
        assert.deepEqual(foreignHits, [], 'nothing reaches the foreign name, before or after the escape attempt');
      });
    }

    test("the caller's own non-loopback target loads, with its same-origin image and WebSocket", async () => {
      foreignHits = [];
      const context = await newContext(browser, VIEW);
      try {
        const page = await context.newPage();
        const response = await goto(page, `${foreign}/ws.html`);
        assert.equal(response?.status(), 200);
        assert.equal(await sawForeign('upgrade /ws', 5000), true, `the target's own WebSocket connects, got ${JSON.stringify(foreignHits)}`);
        assert.ok(foreignHits.includes('http /same.svg'), "the target's same-origin image loads");
      } finally {
        await context.close();
      }
    });

    test("newContext origins and allowOrigin admit a caller's page.goto target; nothing else does", async () => {
      const named = await newContext(browser, VIEW, { origins: [`${foreign}/`] });
      try {
        const page = await named.newPage();
        assert.equal((await page.goto(`${foreign}/ok.svg`))?.status(), 200);
      } finally {
        await named.close();
      }
      const unnamed = await newContext(browser, VIEW);
      try {
        const page = await unnamed.newPage();
        await assert.rejects(page.goto(`${foreign}/ok.svg`), /ERR_BLOCKED_BY_CLIENT/);
        allowOrigin(unnamed, `${foreign}/anything`);
        const again = await unnamed.newPage();
        assert.equal((await again.goto(`${foreign}/ok.svg`))?.status(), 200);
      } finally {
        await unnamed.close();
      }
    });
  });
});
