// @ts-check
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { goto, launch, newContext, withPage } from '../../lib/browser.mjs';
import { NAMED_COLORS, parseColor } from '../../lib/color.mjs';
import { STYLE_WHITELIST, collectAnimations, collectElements, collectText, selectorFor } from '../../lib/dom.mjs';
import { CheckError, EnvError } from '../../lib/errors.mjs';
import { waitReady } from '../../lib/ready.mjs';
import { serveStatic } from '../../lib/serve.mjs';

/**
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 * @typedef {import('../../lib/dom.mjs').TextInfo} TextInfo
 */

const PAGE_DIR = fileURLToPath(new URL('../fixtures/lib/page/', import.meta.url));
const DESKTOP = { name: 'desktop', width: 1280, height: 800, dpr: 1, isMobile: false, hasTouch: false };
const ARROW = String.fromCharCode(0x2192);

/** @type {Browser} */
let browser;
/** @type {import('../../lib/serve.mjs').StaticServer} */
let site;
/** @type {http.Server} */
let slow;
let slowUrl = '';

describe('browser: launch, contexts, readiness, collectors', () => {
  before(async () => {
    browser = await launch();
    site = await serveStatic(PAGE_DIR);
    slow = http.createServer((req, res) => {
      if (req.url === '/hang.png') return;
      const lazy = req.url === '/lazy';
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html><body><p>slow</p><script>
        window.addEventListener('load', function () {
          if (${lazy}) { var spacer = document.createElement('div'); spacer.style.height = '5000px'; document.body.append(spacer); }
          var img = document.createElement('img');
          img.src = '/hang.png';
          if (${lazy}) img.loading = 'lazy';
          document.body.append(img);
        });
      </script></body></html>`);
    });
    await new Promise((resolve) => slow.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = slow.address();
    slowUrl = `http://127.0.0.1:${address && typeof address === 'object' ? address.port : 0}`;
  });

  after(async () => {
    await browser?.close();
    await site?.close();
    slow?.closeAllConnections();
    await new Promise((resolve) => (slow ? slow.close(() => resolve(undefined)) : resolve(undefined)));
  });

  test('launch refuses a FRONTEND_CHROMIUM that points nowhere, with an EnvError', async () => {
    const saved = process.env.FRONTEND_CHROMIUM;
    process.env.FRONTEND_CHROMIUM = fileURLToPath(new URL('../fixtures/lib/no-such-chrome.exe', import.meta.url));
    try {
      await assert.rejects(launch(), (err) => err instanceof EnvError && /FRONTEND_CHROMIUM points to/.test(err.message) && /playwright-core install chromium/.test(err.message));
    } finally {
      if (saved === undefined) delete process.env.FRONTEND_CHROMIUM;
      else process.env.FRONTEND_CHROMIUM = saved;
    }
  });

  test('newContext emulates size, scale, touch, colour scheme, reduced motion, locale and UTC', async () => {
    const phone = { name: 'phone', width: 390, height: 844, dpr: 2, isMobile: true, hasTouch: true, colorScheme: /** @type {const} */ ('dark'), reducedMotion: /** @type {const} */ ('reduce') };
    const seen = await withPage(browser, phone, `${site.url}/`, (page) => page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
      touch: navigator.maxTouchPoints > 0,
      dark: matchMedia('(prefers-color-scheme: dark)').matches,
      reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
    })));
    assert.deepEqual(seen, { width: 390, height: 844, dpr: 2, touch: true, dark: true, reduce: true, zone: 'UTC', language: 'en-US' });
    const plain = await newContext(browser, { width: 800, height: 600 });
    try {
      const page = await plain.newPage();
      assert.deepEqual(await page.evaluate(() => [matchMedia('(prefers-color-scheme: light)').matches, devicePixelRatio]), [true, 1]);
    } finally {
      await plain.close();
    }
    await assert.rejects(newContext(browser, { width: 0, height: 10 }), TypeError);
  });

  test('withPage waits for the ready flag, passes the response and always closes its context', async () => {
    const baseline = browser.contexts().length;
    const started = Date.now();
    const result = await withPage(browser, DESKTOP, `${site.url}/`, async (page, response) => ({
      flag: await page.evaluate(() => Reflect.get(window, '__FRONTEND_READY__')),
      status: response?.status(),
    }), { readyFlag: true });
    assert.deepEqual(result, { flag: true, status: 200 });
    assert.ok(Date.now() - started >= 250, 'the flag is set 300 ms after load');
    assert.equal(browser.contexts().length, baseline);
    await assert.rejects(withPage(browser, DESKTOP, `${site.url}/`, () => {
      throw new Error('inner failure');
    }), /inner failure/);
    assert.equal(browser.contexts().length, baseline, 'closed after a failure too');
  });

  test('withPage runs beforeGoto before navigation, so load-time console messages are seen', async () => {
    /** @type {string[]} */
    const messages = [];
    await withPage(browser, DESKTOP, `${slowUrl}/lazy`, () => undefined, {
      beforeGoto: (page) => {
        page.on('request', (r) => messages.push(r.url()));
      },
    });
    assert.ok(messages.some((u) => u.endsWith('/lazy')), 'the document request itself was observed');
  });

  test('a page whose ready flag never comes fails with a CheckError that says what to do', async () => {
    await assert.rejects(
      withPage(browser, DESKTOP, `${site.url}/never-ready.html`, () => undefined, { readyFlag: true, timeoutMs: 700 }),
      (err) => err instanceof CheckError && /page not ready after 700 ms/.test(err.message) && /__FRONTEND_READY__ is not true/.test(err.message),
    );
    const ok = await withPage(browser, DESKTOP, `${site.url}/never-ready.html`, (page) => page.title(), { timeoutMs: 2000 });
    assert.equal(ok, 'Never ready', 'without readyFlag the same page is ready');
  });

  test('an image still loading blocks readiness; a lazy image below the fold does not', async () => {
    const context = await newContext(browser, DESKTOP);
    try {
      const page = await context.newPage();
      await goto(page, `${slowUrl}/`);
      await assert.rejects(waitReady(page, { timeoutMs: 700 }), (err) => err instanceof CheckError && /1 image\(s\) still loading \(http:\/\/127\.0\.0\.1:\d+\/hang\.png\)/.test(err.message));
      const lazyPage = await context.newPage();
      await goto(lazyPage, `${slowUrl}/lazy`);
      const result = await waitReady(lazyPage, { timeoutMs: 3000 });
      assert.equal(result.lazySkipped, 1);
    } finally {
      await context.close();
    }
  });

  test('an unreachable URL is an EnvError', async () => {
    const probe = http.createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = probe.address();
    const port = address && typeof address === 'object' ? address.port : 0;
    await new Promise((resolve) => probe.close(() => resolve(undefined)));
    await assert.rejects(withPage(browser, DESKTOP, `http://127.0.0.1:${port}/`, () => undefined), (err) => err instanceof EnvError && /cannot load/.test(err.message));
  });

  /**
   * @param {ElementInfo[]} elements
   * @param {(e: ElementInfo) => boolean} predicate
   * @returns {ElementInfo}
   */
  function one(elements, predicate) {
    const found = elements.filter(predicate);
    assert.equal(found.length, 1, 'exactly one element matches');
    return found[0];
  }

  test('collectElements: selectors, roles, boxes, visibility, styles, data attributes and tree links', async () => {
    await withPage(browser, DESKTOP, `${site.url}/`, async (page) => {
      const elements = await page.evaluate(collectElements, {});
      const main = one(elements, (e) => e.tag === 'main');
      assert.equal(main.sel, '[data-feature="FR-001"]');
      assert.deepEqual(main.attrs, { 'data-feature': 'FR-001', 'data-status': 'live' });
      assert.equal(main.role, 'main');
      assert.equal(main.visible, true);
      const h1 = one(elements, (e) => e.tag === 'h1');
      assert.equal(h1.role, 'heading');
      assert.equal(h1.text, 'Queue clock');
      assert.equal(h1.styles.fontSize, '40px');
      assert.equal(h1.styles.fontWeight, '700');
      assert.equal(elements[h1.parent], main, 'parent points at the nearest collected ancestor');
      assert.equal(h1.depth, main.depth + 1);
      assert.ok(h1.box.w > 0 && h1.box.h > 0 && h1.box.y >= 0);
      assert.deepEqual(Object.keys(h1.styles), [...STYLE_WHITELIST]);
      const button = one(elements, (e) => e.tag === 'button');
      assert.equal(button.role, 'button');
      assert.equal(button.styles.borderRadius, '999px');
      assert.equal(button.styles.transitionProperty, 'all', 'read `transition: all` from transitionProperty');
      assert.equal(button.styles.transition, '0.6s ease-in', 'Chromium drops the initial value "all" from the shorthand');
      assert.equal(one(elements, (e) => e.tag === 'input' && e.meta.type === 'text').role, 'textbox');
      assert.equal(one(elements, (e) => e.tag === 'input' && e.meta.type === 'submit').role, 'button');
      assert.equal(one(elements, (e) => e.tag === 'img' && e.meta.alt === 'dot').role, 'img');
      assert.equal(one(elements, (e) => e.tag === 'ul').role, 'list');
      for (const text of ['Display none text', 'Opacity zero text', 'Visibility hidden text', 'Screen reader only']) {
        assert.equal(one(elements, (e) => e.text === text).visible, false, text);
      }
      assert.equal(one(elements, (e) => e.meta.id === 'composite').visible, true);
      assert.equal(one(elements, (e) => e.meta.class === 'gradient').styles.backgroundImage.startsWith('linear-gradient'), true);
      assert.equal(one(elements, (e) => e.meta.class === 'stat').attrs['data-ledger'], 'C-001');
      assert.ok(elements.some((e) => e.tag === 'svg') && !elements.some((e) => e.tag === 'path'), 'SVG descendants are skipped by default');
      const withSvg = await page.evaluate(collectElements, { svgChildren: true });
      assert.ok(withSvg.some((e) => e.tag === 'path'));
      const capped = await page.evaluate(collectElements, { max: 5, styles: false });
      assert.equal(capped.length, 5);
      assert.deepEqual(capped[0].styles, {});
      const sels = elements.map((e) => e.sel);
      const counts = await page.evaluate((list) => list.map((s) => document.querySelectorAll(s).length), sels);
      assert.ok(counts.every((n) => n === 1), 'every selector matches exactly one element');
      const dups = elements.filter((e) => e.meta.id === 'dup');
      assert.equal(dups.length, 2);
      assert.ok(dups.every((e) => e.sel !== '#dup'), 'a duplicated id is never used as an anchor');
      const dupTexts = await page.evaluate((list) => list.map((s) => document.querySelector(s)?.textContent), dups.map((e) => e.sel));
      assert.deepEqual(dupTexts, ['first dup', 'second dup']);
    });
  });

  /**
   * @param {TextInfo[]} texts
   * @param {string} text
   * @returns {TextInfo}
   */
  function textEntry(texts, text) {
    const found = texts.filter((t) => t.text === text);
    assert.equal(found.length, 1, `one text entry "${text}"`);
    return found[0];
  }

  test('collectText: owners, fonts, colours, composited backgrounds, viewport, roles and sources', async () => {
    await withPage(browser, DESKTOP, `${site.url}/`, async (page) => {
      const texts = await page.evaluate(collectText, {});
      const h1 = textEntry(texts, 'Queue clock');
      assert.equal(h1.fontSize, 40);
      assert.equal(h1.fontWeight, 700);
      assert.equal(h1.color, 'rgb(0, 0, 0)');
      assert.equal(h1.bg, 'rgb(240, 240, 240)');
      assert.equal(h1.bgImage, null);
      assert.equal(h1.inViewport, true);
      assert.equal(h1.visible, true);
      assert.equal(h1.recRole, null);
      assert.equal(h1.source, 'text');
      assert.equal(h1.sel, 'h1');
      assert.equal(textEntry(texts, 'Lenders see the withdrawal queue before they sign.').recRole, 'key');
      assert.equal(textEntry(texts, 'Composited text').bg, 'rgb(128, 0, 128)', 'half red over blue');
      const teal = textEntry(texts, 'Teal text in oklch');
      assert.ok(parseColor(teal.color), `computed colour ${teal.color} parses`);
      assert.match(textEntry(texts, 'Gradient ground').bgImage ?? '', /^linear-gradient/);
      const arrow = textEntry(texts, ARROW);
      assert.equal(arrow.source, 'after');
      assert.equal(arrow.tag, 'button');
      assert.equal(textEntry(texts, 'John Doe').source, 'placeholder');
      assert.equal(textEntry(texts, 'Send').source, 'value');
      assert.equal(textEntry(texts, 'Display none text').visible, false);
      const transparent = textEntry(texts, 'Opacity zero text');
      assert.equal(transparent.visible, false);
      assert.equal(transparent.opacity, 0);
      assert.equal(textEntry(texts, 'Visibility hidden text').visible, false);
      assert.equal(textEntry(texts, 'Screen reader only').visible, false);
      assert.equal(textEntry(texts, 'Far below the fold').inViewport, false);
      const order = ['Queue clock', 'Lenders see the withdrawal queue before they sign.', 'Composited text', 'Open the queue', ARROW, 'John Doe', 'Send', 'Far below the fold'];
      const positions = order.map((t) => texts.findIndex((x) => x.text === t));
      assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'document order, ::after after its element text');
      assert.ok(!texts.some((t) => /setTimeout/.test(t.text)), 'script text is never collected');
    });
  });

  test('collectAnimations: CSS animations, CSS transitions, timing, easing, iterations and keyframes', async () => {
    await withPage(browser, DESKTOP, `${site.url}/`, async (page) => {
      await page.evaluate(() => document.querySelector('.pill')?.classList.add('go'));
      const animations = await page.evaluate(collectAnimations, {});
      const spin = animations.find((a) => a.name === 'spin');
      assert.ok(spin);
      assert.equal(spin.type, 'css-animation');
      assert.equal(spin.sel, '#spin');
      assert.equal(spin.duration, 1200);
      assert.equal(spin.iterations, 'infinite');
      assert.equal(spin.easing, 'linear');
      assert.deepEqual(spin.properties, ['transform']);
      const fade = animations.find((a) => a.name === 'fadein');
      assert.ok(fade);
      assert.equal(fade.duration, 500);
      assert.equal(fade.easing, 'ease-out');
      assert.equal(fade.iterations, 1);
      assert.equal(fade.fill, 'both');
      assert.deepEqual([...fade.properties].sort(), ['opacity', 'transform']);
      assert.equal(fade.keyframes[0].transform, 'scale(0)');
      const transition = animations.find((a) => a.type === 'css-transition');
      assert.ok(transition, 'the triggered transition is reported');
      assert.equal(transition.name, 'background-color');
      assert.equal(transition.duration, 600);
      assert.equal(transition.easing, 'ease-in');
      assert.equal(transition.sel, 'button');
      const capped = await page.evaluate(collectAnimations, { maxKeyframes: 1 });
      assert.ok(capped.every((a) => a.keyframes.length <= 1));
    });
  });

  test('selectorFor works on its own through locator.evaluate', async () => {
    await withPage(browser, DESKTOP, `${site.url}/`, async (page) => {
      assert.equal(await page.locator('#composite').evaluate(selectorFor), '#composite');
      const second = await page.locator('p#dup').nth(1).evaluate(selectorFor);
      assert.notEqual(second, '#dup');
      assert.equal(await page.evaluate((s) => document.querySelector(s)?.textContent, second), 'second dup');
      const card = await page.locator('section article').nth(1).locator('h2').evaluate(selectorFor);
      assert.equal(await page.evaluate((s) => document.querySelectorAll(s).length, card), 1);
      assert.equal(await page.evaluate((s) => document.querySelector(s)?.textContent, card), 'Card two');
    });
  });

  test('parseColor agrees with Chromium on every named colour and the modern colour syntaxes', async () => {
    const modern = [
      '#7c3aed', '#2563eb80', 'rgb(10 20 30)', 'rgba(200, 100, 50, 0.4)', 'hsl(200 50% 40%)', 'hsl(330, 60%, 70%)',
      'hwb(120 20% 30%)', 'oklch(0.7 0.1 200)', 'oklch(0.55 0.15 30)', 'oklch(40% 0.08 280 / 0.6)', 'oklab(0.6 -0.1 0.05)',
      'lab(50 20 -30)', 'lch(60 40 120)', 'color(srgb 0.2 0.4 0.6)', 'color(srgb-linear 0.2 0.3 0.4)',
      'color(display-p3 0.5 0.6 0.2)', 'color(rec2020 0.4 0.5 0.6)', 'color(a98-rgb 0.3 0.6 0.4)',
      'color(prophoto-rgb 0.4 0.5 0.3)', 'color(xyz-d65 0.3 0.3 0.3)', 'color(xyz-d50 0.3 0.3 0.25)',
    ];
    const all = [...Object.keys(NAMED_COLORS), ...modern];
    const chromium = await withPage(browser, DESKTOP, `${site.url}/never-ready.html`, (page) => page.evaluate((list) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { willReadFrequently: true }));
      return list.map((css) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = 'rgba(0, 0, 0, 0)';
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data);
      });
    }, all));
    /** @type {string[]} */
    const mismatches = [];
    all.forEach((css, i) => {
      const mine = parseColor(css);
      assert.ok(mine, `${css} parses`);
      const [r, g, b, a] = chromium[i];
      const alpha = a / 255;
      const tolerance = alpha < 1 ? 3 : 1.01;
      const diffs = [mine.r * 255 - r, mine.g * 255 - g, mine.b * 255 - b].map(Math.abs);
      if (diffs.some((d) => d > tolerance) || Math.abs(mine.a - alpha) > 1 / 255 + 1e-9) {
        mismatches.push(`${css}: mine ${[mine.r, mine.g, mine.b].map((x) => (x * 255).toFixed(1)).join(',')} a=${mine.a.toFixed(3)} vs chromium ${r},${g},${b} a=${alpha.toFixed(3)}`);
      }
    });
    assert.deepEqual(mismatches, []);
  });
});
