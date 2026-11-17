// @ts-check
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { launch, withPage } from '../../lib/browser.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import { serveStatic } from '../../lib/serve.mjs';
import { loadAllowlists, loadRegistry, runRuntime, runtimeContext } from '../../rules/load.mjs';
import { motionLog } from '../../rules/runtime/SL-MO2.mjs';

/**
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('playwright-core').BrowserContext} BrowserContext
 * @typedef {import('../../rules/load.mjs').Finding} Finding
 * @typedef {import('../../rules/load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../rules/load.mjs').Rule} Rule
 */

const SCRIPTS = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../fixtures/rules/', import.meta.url));
const VIEWPORT = { name: 'desktop', width: 1440, height: 900, dpr: 1, isMobile: false, hasTouch: false };
const ROUTE = { path: '/', name: 'home', first: true, features: [], states: [] };
/** The only request a fixture makes off the fixture server: SL-M05's avatar-generator image, which is blocked. */
const EXPECTED_BLOCKED = ['https://i.pravatar.cc/48?img=3'];

const RULE_IDS = Object.freeze([
  'SL-M01', 'SL-M02', 'SL-M03', 'SL-M04', 'SL-M05', 'SL-M06', 'SL-M07', 'SL-M08', 'SL-M09', 'SL-M10', 'SL-M11', 'SL-M12',
  'SL-M13', 'SL-M14', 'SL-M15', 'SL-M16', 'SL-M17', 'SL-C01', 'SL-C02', 'SL-C03', 'SL-G02', 'SL-G03', 'SL-X01', 'SL-X02',
  'SL-MO1', 'SL-MO2', 'SL-MO3', 'SL-MO4', 'SL-MO5',
]);

/**
 * @param {RuntimeFinding[]} findings
 * @param {string} key
 * @returns {string[]}
 */
const values = (findings, key) => findings.map((f) => String(/** @type {Record<string, unknown>} */ (f.value)[key])).sort();

/**
 * What each positive fixture must produce beyond "at least one finding": the shapes the fixture plants.
 * @type {Record<string, (findings: RuntimeFinding[]) => void>}
 */
const EXPECT = {
  'SL-M01': (f) => {
    assert.equal(f.length, 1);
    const v = /** @type {{ground: string, serif: {family: string} | null, clay: {count: number}}} */ (f[0].value);
    assert.equal(v.ground, '#f4f1ea');
    assert.match(String(v.serif?.family), /georgia/i, 'the display face is read as serif');
    assert.ok(v.clay.count >= 1, 'the clay CTA is found');
  },
  'SL-M02': (f) => assert.deepEqual([f.length, /** @type {{count: number, headings: number}} */ (f[0].value).count], [1, 4]),
  'SL-M03': (f) => assert.deepEqual(/** @type {{markers: string[]}} */ (f[0].value).markers, ['01', '02', '03']),
  'SL-M04': (f) => assert.deepEqual(/** @type {{unsourced: string[]}} */ (f[0].value).unsourced, ['10K+', '99.9%', '$4.2M', '4.9★']),
  'SL-M05': (f) => assert.deepEqual(values(f, 'kind'), ['avatar-generator', 'testimonial-cards', 'trusted-by-unlinked-logos']),
  'SL-M06': (f) => assert.deepEqual([/** @type {{items: number}} */ (f[0].value).items, /** @type {{heading: string}} */ (f[0].value).heading], [4, 'Frequently asked questions']),
  'SL-M07': (f) => assert.equal(/** @type {{count: number}} */ (f[0].value).count, 8),
  'SL-M08': (f) => assert.equal(/** @type {{ground: string}} */ (f[0].value).ground, '#0a0a0a'),
  'SL-M09': (f) => assert.deepEqual(values(f, 'kind'), ['blurred-blob', 'blurred-blob', 'glow']),
  'SL-M10': (f) => assert.deepEqual([f.length, /** @type {{items: number}} */ (f[0].value).items], [1, 6]),
  'SL-M11': (f) => assert.ok(/** @type {{shapes: string[]}} */ (f[0].value).shapes.includes('2x1')),
  'SL-M12': (f) => assert.deepEqual(/** @type {{items: Array<{text: string}>}} */ (f[0].value).items.map((i) => i.text), ['Get started', 'Learn more →']),
  'SL-M13': (f) => {
    const v = /** @type {{arrows: number, middots: number, monoLabels: number}} */ (f[0].value);
    assert.deepEqual([v.arrows, v.middots, v.monoLabels], [2, 2, 2]);
  },
  'SL-M14': (f) => assert.deepEqual(values(f, 'kind'), ['blinking-cursor', 'grid-lines', 'pulsing-dot']),
  'SL-M15': (f) => assert.equal(f.length, 2),
  'SL-M16': (f) => assert.deepEqual(values(f, 'kind'), ['shape-illustration', 'window-mockup']),
  'SL-M17': (f) => assert.deepEqual(values(f, 'formula'), ['built-for', 'trusted-by']),
  'SL-C01': (f) => assert.deepEqual([/** @type {{count: number, buttons: number}} */ (f[0].value).count, /** @type {{buttons: number}} */ (f[0].value).buttons], [4, 4]),
  'SL-C02': (f) => assert.match(f[0].detail, /min-height 900px/),
  'SL-C03': (f) => assert.equal(/** @type {{share: number}} */ (f[0].value).share, 1),
  'SL-G02': (f) => assert.deepEqual(values(f, 'kind'), ['accent', 'geist', 'title']),
  'SL-G03': (f) => {
    assert.deepEqual(values(f, 'kind'), ['alert', 'awesome-dapp', 'mesh-dark', 'powered-by-mesh']);
    const alert = f.find((x) => /** @type {{kind: string}} */ (x.value).kind === 'alert');
    assert.equal(alert?.selector, '#connect', 'the alert is tied to the control that raised it');
  },
  'SL-X01': (f) => assert.deepEqual(values(f, 'text'), ['10x', '12,450', '42 vaults', '99.9%']),
  'SL-X02': (f) => assert.deepEqual(values(f, 'pattern'), ['acme', 'example-domain', 'john-doe', 'lorem-ipsum', 'template-slot', 'todo', 'your-slot']),
  'SL-MO1': (f) => assert.equal(f.length, 2, 'the explicit `all` and the bare shorthand both count'),
  'SL-MO2': (f) => assert.deepEqual(values(f, 'source'), ['at-rest', 'motion-log']),
  'SL-MO3': (f) => assert.deepEqual(values(f, 'durationMs'), ['700', '800']),
  'SL-MO4': (f) => assert.deepEqual(values(f, 'source'), ['at-rest', 'motion-log']),
  'SL-MO5': (f) => assert.deepEqual(values(f, 'name'), ['rise', 'slide']),
};

describe('browser: runtime detectors of the missing-tell, claude-era, generator, invented and motion families', () => {
  /** @type {Browser} */
  let browser;
  /** @type {import('../../lib/serve.mjs').StaticServer} */
  let site;
  /** @type {import('../../rules/load.mjs').Registry} */
  let registry;
  let tmp = '';
  /** @type {string[]} */
  const blocked = [];

  /**
   * Every context any detector opens is limited to the fixture server: other requests are aborted and recorded.
   * lib/browser's offline route, registered after this one, runs first and aborts them itself, so the record comes
   * from the request event, which fires before any route.
   * @param {BrowserContext} context
   */
  const guard = async (context) => {
    context.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith(`${site.url}/`) && !url.startsWith('data:')) blocked.push(url);
    });
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(`${site.url}/`) || url.startsWith('data:')) return route.continue();
      blocked.push(url);
      return route.abort('blockedbyclient');
    });
  };

  before(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-rules-other-'));
    registry = loadRegistry();
    site = await serveStatic(FIXTURES);
    browser = await launch();
    const open = browser.newContext.bind(browser);
    browser.newContext = async (options) => {
      const context = await open(options);
      await guard(context);
      return context;
    };
  });

  after(async () => {
    await browser?.close();
    await site?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * Loads a fixture page, builds the runtime context with the loader's own functions and runs one rule through
   * runRuntime.
   * @param {string} id
   * @param {string} file
   * @param {Record<string, unknown>} [override] extra registry fields for this rule
   * @returns {Promise<Finding[]>}
   */
  async function run(id, file, override = {}) {
    const rule = registry.rules.find((r) => r.id === id);
    assert.ok(rule, `${id} is in the registry`);
    const profile = defaultProfile();
    const allowlist = loadAllowlists(tmp, profile);
    return withPage(browser, VIEWPORT, `${site.url}/${id}/${file}`, async (page) => {
      const ctx = await runtimeContext(browser, page, ROUTE, VIEWPORT, profile, allowlist);
      return runRuntime([{ ...rule, ...override }], ctx, { timeoutMs: 60000 });
    });
  }

  /**
   * @param {Finding[]} findings
   * @returns {RuntimeFinding[]}
   */
  function clean(findings) {
    const errors = findings.filter((f) => 'error' in f);
    assert.deepEqual(errors, [], 'no detector error');
    return /** @type {RuntimeFinding[]} */ (findings);
  }

  test('every rule of these families is a runtime rule with its detector and both fixtures', () => {
    const families = new Set(['missing-tell', 'claude-era', 'generator', 'invented', 'motion']);
    const expected = registry.rules.filter((r) => families.has(r.family) && r.runtime).map((r) => r.id).sort();
    assert.deepEqual([...RULE_IDS].sort(), expected, 'the tested ids are exactly the runtime rules of the five families');
    for (const id of RULE_IDS) {
      assert.ok(existsSync(path.join(SCRIPTS, 'rules', 'runtime', `${id}.mjs`)), `${id} detector exists`);
      for (const side of ['pos', 'neg']) assert.ok(existsSync(path.join(FIXTURES, id, `runtime-${side}.html`)), `${id} runtime-${side}.html exists`);
    }
    for (const id of ['SL-G01', 'SL-G04']) {
      assert.equal(existsSync(path.join(SCRIPTS, 'rules', 'runtime', `${id}.mjs`)), false, `${id} is static only, so it has no runtime file`);
    }
  });

  for (const id of RULE_IDS) {
    test(`${id} fires on its positive fixture`, async () => {
      const findings = clean(await run(id, 'runtime-pos.html'));
      assert.ok(findings.length >= 1, `${id} found nothing on runtime-pos.html`);
      for (const f of findings) {
        assert.equal(f.rule, id);
        assert.equal(f.layer, 'runtime');
        assert.equal(f.route, '/');
        assert.equal(f.viewport, 'desktop');
        assert.equal(typeof f.selector, 'string');
        assert.ok(f.detail.length > 20, 'the detail says what was measured and the fix');
        assert.ok(f.value !== null && typeof f.value === 'object', 'value holds the measured values');
      }
      EXPECT[id](findings);
    });

    test(`${id} stays silent on its negative fixture`, async () => {
      const findings = clean(await run(id, 'runtime-neg.html'));
      assert.deepEqual(findings.map((f) => f.detail), [], `${id} fired on runtime-neg.html`);
    });
  }

  test('SL-G02 matches a template favicon after stripping trailing whitespace, and only a registered one', async () => {
    const bytes = readFileSync(path.join(FIXTURES, 'SL-G02', 'runtime-favicon.svg'));
    const raw = createHash('sha256').update(bytes).digest('hex');
    const normalised = createHash('sha256').update(bytes.toString('utf8').replace(/\s+$/, '')).digest('hex');
    assert.notEqual(raw, normalised, 'the fixture icon ends in whitespace, so only the normalised hash matches');
    const registered = clean(await run('SL-G02', 'runtime-favicon.html', { templateIcons: [{ sha256: normalised, template: 'fixture template' }] }));
    assert.deepEqual(registered.map((f) => /** @type {{kind: string}} */ (f.value).kind), ['favicon']);
    assert.match(registered[0].detail, /fixture template/);
    assert.deepEqual(clean(await run('SL-G02', 'runtime-favicon.html')), [], 'an icon matching no template hash is the project\'s own');
  });

  test('the motion log is recorded once per page state and its contexts are closed', async () => {
    const profile = defaultProfile();
    const allowlist = loadAllowlists(tmp, profile);
    await withPage(browser, VIEWPORT, `${site.url}/SL-MO5/runtime-pos.html`, async (page) => {
      const baseline = browser.contexts().length;
      const ctx = await runtimeContext(browser, page, ROUTE, VIEWPORT, profile, allowlist);
      const first = motionLog(ctx, 'no-preference');
      assert.equal(motionLog(ctx, 'no-preference'), first, 'the same promise for the same page state');
      assert.notEqual(motionLog(ctx, 'reduce'), first, 'one log per reduced-motion setting');
      const [base, reduced] = await Promise.all([first, motionLog(ctx, 'reduce')]);
      assert.deepEqual([base.reducedMotion, reduced.reducedMotion], ['no-preference', 'reduce']);
      assert.ok(base.records.some((r) => r.name === 'rise' && r.selector === 'h1'), 'the entrance that finished before the read is in the log');
      assert.deepEqual(base.errors, []);
      assert.equal(browser.contexts().length, baseline, 'the recording contexts are closed');
      const other = await runtimeContext(browser, page, ROUTE, VIEWPORT, profile, allowlist);
      assert.notEqual(motionLog(other, 'no-preference'), first, 'a new page state records again');
      await motionLog(other, 'no-preference');
    });
  });

  test('no fixture request left the fixture server except the deliberately blocked avatar', () => {
    assert.deepEqual([...new Set(blocked)].sort(), EXPECTED_BLOCKED);
  });
});
