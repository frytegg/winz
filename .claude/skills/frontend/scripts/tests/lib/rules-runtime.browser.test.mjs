// @ts-check
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { launch, withPage } from '../../lib/browser.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import { serveStatic } from '../../lib/serve.mjs';
import { loadAllowlists, loadRegistry, runRuntime, runtimeContext } from '../../rules/load.mjs';

/** @typedef {import('playwright-core').Browser} Browser */

const PAGE_DIR = fileURLToPath(new URL('../fixtures/lib/page/', import.meta.url));
const RULES = fileURLToPath(new URL('../fixtures/lib/rules/', import.meta.url));
const VIEWPORT = { name: 'desktop', width: 1280, height: 800, dpr: 1, isMobile: false, hasTouch: false };
const ROUTE = { path: '/', name: 'home', first: true, features: [], states: [] };
let tmp = '';

/** @type {Browser} */
let browser;
/** @type {import('../../lib/serve.mjs').StaticServer} */
let site;

describe('browser: runtime context and runner', () => {
  before(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-runtime-'));
    browser = await launch();
    site = await serveStatic(PAGE_DIR);
  });

  after(async () => {
    await browser?.close();
    await site?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * @template T
   * @param {(ctx: import('../../rules/load.mjs').RuntimeContext) => Promise<T>} fn
   * @returns {Promise<T>}
   */
  function withContext(fn) {
    const profile = defaultProfile();
    const allowlist = loadAllowlists(tmp, profile);
    return withPage(browser, VIEWPORT, `${site.url}/`, async (page) => fn(await runtimeContext(browser, page, ROUTE, VIEWPORT, profile, allowlist)));
  }

  test('runRuntime runs flagged detectors; failures, missing files and timeouts become error findings', async () => {
    const registry = loadRegistry(path.join(RULES, 'registry.json'));
    await withContext(async (ctx) => {
      const baseline = browser.contexts().length;
      // 6 s: long enough for the fresh-page detector under a loaded full-suite run, while SL-T06 never resolves.
      const findings = await runRuntime(registry, ctx, { dir: RULES, timeoutMs: 6000 });
      const byRule = (/** @type {string} */ id) => findings.filter((f) => f.rule === id);

      assert.equal(byRule('SL-T01').length, 1);
      const { detail, ...gradient } = /** @type {import('../../rules/load.mjs').RuntimeFinding} */ (byRule('SL-T01')[0]);
      assert.deepEqual({ ...gradient }, {
        selector: '#gradient', value: 'Gradient ground', rule: 'SL-T01', layer: 'runtime', route: '/', viewport: 'desktop',
      }, 'rule, layer, route and viewport are filled in by the runner');
      assert.match(detail, /^memoised=true texts=\d+ animations=\d+$/, 'the collector cache is shared within a page');

      const fresh = byRule('SL-T05');
      assert.equal(fresh.length, 1);
      assert.ok('detail' in fresh[0] && fresh[0].detail === 'fresh=true');
      assert.ok('value' in fresh[0] && fresh[0].value === `${site.url}/`, 'the fresh page opens at the same URL');
      assert.ok('viewport' in fresh[0] && fresh[0].viewport === 'custom-viewport', 'a viewport the detector sets is kept');
      const freshPage = /** @type {import('playwright-core').Page} */ (Reflect.get(globalThis, '__feFreshPage'));
      assert.ok(freshPage.isClosed(), 'fresh pages are closed after their detector');
      assert.equal(browser.contexts().length, baseline);

      assert.deepEqual(byRule('SL-T06').map((f) => [f.layer, 'error' in f && f.error]), [['runtime', 'Error: SL-T06 runtime detector timed out after 6000 ms']]);
      assert.deepEqual(byRule('SL-T07').map((f) => 'error' in f && f.error), ['RangeError: runtime boom']);
      assert.deepEqual(byRule('SL-T09').map((f) => 'error' in f && f.error), ['Error: detector file missing: rules/runtime/SL-T09.mjs']);
      for (const f of [...byRule('SL-T06'), ...byRule('SL-T07'), ...byRule('SL-T09')]) {
        assert.equal(f.route, '/');
        assert.equal(f.viewport, 'desktop');
      }
      for (const staticOnly of ['SL-T02', 'SL-T03', 'SL-T04', 'SL-T08']) assert.equal(byRule(staticOnly).length, 0, `${staticOnly} is static only`);
      assert.equal(await ctx.page.evaluate(() => document.querySelector('button')?.matches(':hover')), false, 'the shared page was never hovered');
    });
  });

  test('the collector cache memoises per options and returns the collectors\' results', async () => {
    await withContext(async (ctx) => {
      const first = ctx.cache.elements();
      assert.equal(ctx.cache.elements(), first, 'same promise for the same options');
      assert.equal(ctx.cache.elements({}), first, 'no options and {} are the same request');
      const capped = ctx.cache.elements({ max: 3 });
      assert.notEqual(capped, first);
      assert.equal((await capped).length, 3);
      assert.ok((await first).length > 10);
      assert.equal(ctx.cache.text(), ctx.cache.text());
      assert.ok((await ctx.cache.text()).some((t) => t.text === 'Queue clock'));
      assert.ok((await ctx.cache.animations()).some((a) => a.name === 'spin'));
    });
  });

  test('freshPage opens a ready page at the same URL and viewport; closeFresh closes all of them', async () => {
    await withContext(async (ctx) => {
      const a = await ctx.freshPage();
      const b = await ctx.freshPage();
      assert.equal(a.url(), ctx.page.url());
      assert.deepEqual(a.viewportSize(), { width: 1280, height: 800 });
      assert.notEqual(a.context(), ctx.page.context(), 'a fresh page never shares the shared page context');
      await ctx.closeFresh();
      assert.ok(a.isClosed() && b.isClosed());
      await ctx.closeFresh();
    });
  });
});
