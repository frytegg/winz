// @ts-check
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { launch } from '../../lib/browser.mjs';
import { EnvError } from '../../lib/errors.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import { aggregate } from '../../lib/report.mjs';
import { selectorFor } from '../../lib/dom.mjs';
import { serveStatic } from '../../lib/serve.mjs';
import {
  GATE_IDS, clearContrastMarks, markContrastSubject, mountFontProbes, pickFontSamples, releaseFontTargets, run, unmountFontProbes, writeUniqueReport,
} from '../../qa.mjs';

/**
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('../../lib/report.mjs').GateResult} GateResult
 * @typedef {import('../../lib/profile.mjs').Viewport} Viewport
 * @typedef {import('../../qa.mjs').CheckContext} CheckContext
 */

const FIXTURES = fileURLToPath(new URL('../fixtures/qa/', import.meta.url));
const SITE = path.join(FIXTURES, 'site');
const DESIGN = path.join(FIXTURES, 'design');
const SCRIPT = fileURLToPath(new URL('../../qa.mjs', import.meta.url));
const profile = defaultProfile();
const [DESKTOP, MOBILE, REFLOW] = /** @type {Viewport[]} */ (profile.viewports);

/** @type {Browser} */
let browser;
/** @type {import('../../lib/serve.mjs').StaticServer} */
let site;

/**
 * @param {string} file fixture page
 * @param {{gates?: string[], viewports?: Viewport[], profile?: import('../../lib/profile.mjs').Profile, args?: Record<string, unknown>}} [options]
 * @returns {Promise<GateResult[]>}
 */
function check(file, options = {}) {
  /** @type {CheckContext} */
  const ctx = {
    root: FIXTURES,
    profile: options.profile ?? profile,
    state: null,
    design: DESIGN,
    routes: [{ path: `/${file}`, name: file, first: true, features: [], states: [] }],
    baseUrl: site.url,
    browser,
    viewports: options.viewports ?? [DESKTOP],
    args: options.args ?? {},
    log: () => undefined,
  };
  return run(ctx, options.gates ?? [...GATE_IDS]);
}

/**
 * @param {GateResult[]} results
 * @param {string} id
 * @returns {GateResult}
 */
function result(results, id) {
  const found = results.find((r) => r.id === id);
  assert.ok(found, `${id} reported`);
  return found;
}

/**
 * @param {GateResult[]} results
 * @returns {string[]}
 */
function failing(results) {
  return results.filter((r) => r.state !== 'ok').map((r) => `${r.id}:${r.state}`);
}

/**
 * @param {GateResult} r
 * @returns {string}
 */
function details(r) {
  return r.evidence.map((e) => String(e.detail ?? '')).join('\n');
}

describe('browser: qa gates on fixture pages', () => {
  before(async () => {
    browser = await launch();
    site = await serveStatic(SITE);
  });

  after(async () => {
    await browser?.close();
    await site?.close();
  });

  test('the clean page passes all ten gates at desktop, mobile and reflow', async () => {
    const results = await check('clean.html', { viewports: [DESKTOP, MOBILE, REFLOW] });
    assert.deepEqual(results.map((r) => r.id), [...GATE_IDS]);
    assert.deepEqual(failing(results), [], results.map((r) => `${r.id}: ${r.detail}`).join('\n'));
    assert.match(result(results, 'render.fonts').detail, /render in their declared families: Qa Block \d+/);
    assert.match(result(results, 'render.overflow').detail, /at 320, 375, 390 CSS px/);
    const contrast = result(results, 'a11y.contrast');
    assert.match(contrast.detail, /^0 axe contrast violations, 6 incomplete texts resolved from pixels.*3 text inputs with a 3:1 boundary/);
    assert.ok(contrast.evidence.some((e) => /coverage mode/.test(String(e.detail))), 'gradient text is measured through coverage probes');
    assert.ok(contrast.evidence.some((e) => /css mode/.test(String(e.detail))), 'text on a gradient band is measured against its CSS colour');
    assert.ok(contrast.evidence.every((e) => /APCA Lc -?\d/.test(String(e.detail))), 'APCA is reported as advisory detail');
    assert.equal(aggregate(results).ok, true);
  });

  test('deliberate patterns that look like defects pass all ten gates at desktop, mobile and reflow', async () => {
    const results = await check('clean-tricky.html', { viewports: [DESKTOP, MOBILE, REFLOW] });
    assert.deepEqual(failing(results), [], results.map((r) => `${r.id}: ${r.detail}`).join('\n'));
    assert.match(result(results, 'render.clipping').detail, /\d+ overflowing clip boxes checked, 6 deliberate ellipsis or line-clamp/, 'line-clamp, ellipsis, carousel, accordion, sr-only and a tight heading are not cuts');
    assert.match(result(results, 'render.fonts').detail, /Qa Block \d+, .+ \d+, .+ \d+$/, 'a system stack and a mono stack resolve per platform');
    assert.match(result(results, 'render.images').detail, /^6 rendered images loaded/, 'the lazy image below the fold loads during the scroll pass');
    assert.match(result(results, 'a11y.contrast').detail, /3 incomplete texts resolved from pixels/, 'translucent text on a dark gradient is measured, not guessed');
  });

  /** @type {Array<{file: string, fails: string[], expect: (r: GateResult[]) => void}>} */
  const cases = [
    {
      file: 'fail-console.html',
      fails: ['render.console'],
      expect: (r) => {
        const g = result(r, 'render.console');
        assert.deepEqual(g.evidence.map((e) => e.value).sort(), ['console.error', 'pageerror']);
        assert.match(details(g), /ReferenceError: queueFeed is not defined/);
      },
    },
    {
      file: 'fail-requests.html',
      fails: ['render.requests'],
      expect: (r) => {
        const g = result(r, 'render.requests');
        assert.equal(g.evidence[0].value, 'HTTP 404');
        assert.match(String(g.evidence[0].url), /\/api\/missing\.json$/);
        assert.match(result(r, 'render.console').detail, /1 network error left to render\.requests/);
      },
    },
    {
      file: 'fail-fonts.html',
      fails: ['render.fonts'],
      expect: (r) => {
        const text = details(result(r, 'render.fonts'));
        assert.match(text, /heading "Fonts fixture": "Qa Missing Display" is named first but neither shipped with @font-face nor installed; it renders in/);
        assert.match(text, /button "Check the queue": ".+" comes from the browser's default style, not from tokens\.json or the page CSS; the control does not inherit the page font \(set font: inherit\)/);
      },
    },
    {
      file: 'fail-fonts-face.html',
      fails: ['render.requests', 'render.fonts'],
      expect: (r) => {
        const g = result(r, 'render.fonts');
        assert.ok(g.evidence.some((e) => e.value === 'font-face-error' && /"Broken Face".*failed to load/.test(String(e.detail))));
        assert.match(details(g), /the web font "Broken Face" did not render \(its file failed, or it lacks these glyphs\); it renders in Qa Block/);
      },
    },
    {
      file: 'fail-fonts-tokens.html',
      fails: ['render.fonts'],
      expect: (r) => assert.match(details(result(r, 'render.fonts')), /tokens\.json ships "Qa Tokens Mono" as a file, but the page declares no @font-face for it/),
    },
    {
      file: 'fail-fonts-installed.html',
      fails: ['render.fonts'],
      expect: (r) => assert.match(details(result(r, 'render.fonts')), /"Lucida Handwriting" (renders from a copy installed on this machine|is named first but neither shipped)/),
    },
    {
      file: 'fail-images.html',
      fails: ['render.images'],
      expect: (r) => {
        const g = result(r, 'render.images');
        assert.deepEqual(g.evidence.map((e) => e.value), ['cannot be decoded (EncodingError)', 'no src or srcset']);
        assert.match(String(g.evidence[0].url), /\/img\/corrupt\.png$/);
      },
    },
    {
      file: 'fail-images-missing.html',
      fails: ['render.requests', 'render.images'],
      expect: (r) => {
        const g = result(r, 'render.images');
        assert.deepEqual(g.evidence.map((e) => e.value), ['HTTP 404', 'request failed (net::ERR_UNSAFE_PORT)']);
        assert.match(String(g.evidence[0].url), /\/img\/missing\.png$/);
        assert.deepEqual(result(r, 'render.requests').evidence.map((e) => e.value).sort(), ['HTTP 404', 'net::ERR_UNSAFE_PORT']);
      },
    },
    {
      file: 'fail-overflow.html',
      fails: ['render.overflow'],
      expect: (r) => {
        const g = result(r, 'render.overflow');
        assert.deepEqual(g.evidence.map((e) => e.viewport), ['reflow-320', 'mobile-375'], 'desktop is not narrow; 320 and 375 are added');
        assert.match(String(g.evidence[0].detail), /scrollWidth \d+ px exceeds 320 px \(load\); widest: div/);
      },
    },
    {
      file: 'fail-clipping.html',
      fails: ['render.clipping'],
      expect: (r) => {
        const g = result(r, 'render.clipping');
        assert.deepEqual(g.evidence.map((e) => String(e.value).replace(/\d+px/, 'N')), ['cut y N', 'cut x N']);
        assert.match(details(g), /"The second line of this note is cut off by a box of fixed height\." is cut by div \(vertically/);
        assert.match(details(g), /"A line that will never fit its narrow box" is cut by .* \(horizontally/);
      },
    },
    {
      file: 'fail-overlap.html',
      fails: ['render.clipping', 'a11y.contrast'],
      expect: (r) => {
        assert.match(details(result(r, 'render.clipping')), /"Total value locked across the pools today" .* and "Overlapping label text" .* are drawn over each other/);
        assert.match(details(result(r, 'a11y.contrast')), /axe: bgOverlap/, 'text drawn over text also fails its contrast, from pixels');
      },
    },
    {
      file: 'fail-cls.html',
      fails: ['render.cls'],
      expect: (r) => {
        const g = result(r, 'render.cls');
        assert.ok(Number(g.evidence[0].value) > 0.1, `CLS ${g.evidence[0].value}`);
        assert.equal(g.evidence[0].selector, 'main');
      },
    },
    {
      file: 'fail-axe.html',
      fails: ['a11y.axe'],
      expect: (r) => assert.deepEqual(result(r, 'a11y.axe').evidence.map((e) => e.value).sort(), ['button-name', 'image-alt', 'label']),
    },
    {
      file: 'fail-contrast-solid.html',
      fails: ['a11y.contrast'],
      expect: (r) => assert.match(details(result(r, 'a11y.contrast')), /text #b0b0b0 on #ffffff is 2\.1\d:1, needs 4\.5:1 \(axe\)/),
    },
    {
      file: 'fail-contrast-gradient.html',
      fails: ['a11y.contrast'],
      expect: (r) => {
        const g = result(r, 'a11y.contrast');
        assert.match(details(g), /at worst behind the glyphs, needs 4\.5:1 \(axe: bgGradient; css mode/);
        assert.ok(Number.parseFloat(String(g.evidence[0].value)) < 3);
      },
    },
    {
      file: 'fail-contrast-gradient-text.html',
      fails: ['a11y.contrast'],
      expect: (r) => {
        const g = result(r, 'a11y.contrast');
        assert.match(details(g), /coverage mode/);
        assert.ok(Number.parseFloat(String(g.evidence[0].value)) < 2, 'the light end of the gradient decides');
      },
    },
    {
      file: 'fail-contrast-boundary.html',
      fails: ['a11y.contrast'],
      expect: (r) => assert.match(details(result(r, 'a11y.contrast')), /text input boundary is 1\.2\d:1 against its surroundings \(best: border rgb\(229, 231, 235\)\), needs 3:1 \(WCAG 1\.4\.11\)/),
    },
    {
      file: 'fail-targets.html',
      fails: ['a11y.targets'],
      expect: (r) => {
        const g = result(r, 'a11y.targets');
        assert.equal(g.evidence.length, 3);
        assert.match(details(g), /Target has insufficient size \(12px by 12px/);
      },
    },
  ];

  for (const c of cases) {
    test(`${c.file} fails ${c.fails.join(' and ')}, every other gate passes`, async () => {
      const results = await check(c.file);
      const expected = GATE_IDS.filter((id) => c.fails.includes(id)).map((id) => `${id}:fail`);
      assert.deepEqual(failing(results), expected, results.map((r) => `${r.id}: ${r.state} ${r.detail}`).join('\n'));
      c.expect(results);
      assert.equal(aggregate(results).ok, false);
    });
  }

  test('at the mobile viewport a late banner still fails render.cls (emulation flags it as recent input) and overflow is caught', async () => {
    const cls = await check('fail-cls.html', { gates: ['render.cls'], viewports: [MOBILE] });
    assert.equal(cls[0].state, 'fail', cls[0].detail);
    assert.match(String(cls[0].evidence[0].detail), /flagged hadRecentInput by the viewport emulation, counted: the run sends no input/);
    const overflow = await check('fail-overflow.html', { gates: ['render.overflow'], viewports: [DESKTOP, MOBILE] });
    assert.equal(overflow[0].state, 'fail');
    assert.deepEqual(overflow[0].evidence.map((e) => e.viewport), ['mobile', 'reflow-320', 'mobile-375']);
  });

  test('render.overflow alone loads only the narrow widths', async () => {
    const results = await check('clean.html', { gates: ['render.overflow'], viewports: [DESKTOP, MOBILE] });
    assert.equal(results[0].state, 'ok', results[0].detail);
    assert.match(results[0].detail, /at 320, 375, 390 CSS px/);
  });

  test('a page that never becomes ready fails each requested gate, and console errors seen meanwhile are kept', async () => {
    const waiting = defaultProfile({ ready_flag: true });
    const results = await check('fail-console.html', { gates: ['render.console', 'render.fonts', 'a11y.axe'], profile: waiting, args: { timeoutMs: 800 } });
    assert.deepEqual(results.map((r) => r.state), ['fail', 'fail', 'fail']);
    for (const r of results) assert.match(String(r.evidence[0].detail), /page not ready after 800 ms.*__FRONTEND_READY__ is not true/);
    assert.ok(results[0].evidence.some((e) => e.value === 'pageerror'), 'listeners attached before the load still report');
  });

  test('an unreachable target is an environment error, not a failed gate', async () => {
    const probe = http.createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = probe.address();
    const port = address && typeof address === 'object' ? address.port : 0;
    await new Promise((resolve) => probe.close(() => resolve(undefined)));
    /** @type {CheckContext} */
    const ctx = { root: FIXTURES, profile, state: null, design: DESIGN, routes: [{ path: '/', name: 'home', first: true, features: [], states: [] }], baseUrl: `http://127.0.0.1:${port}`, browser, viewports: [DESKTOP], args: {}, log: () => undefined };
    await assert.rejects(run(ctx, ['render.console']), (err) => err instanceof EnvError && /cannot load/.test(err.message));
  });

  test('the in-page helpers clean up after themselves: marks, probe spans and parked node lists', async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`${site.url}/clean.html`);
      const subject = await page.locator('#queue').evaluate(markContrastSubject, 'n1');
      assert.equal(subject.gradient, true, 'the background-clip: text heading is seen as gradient text');
      assert.equal(await page.evaluate(() => document.querySelectorAll('[data-fe-qa-contrast="n1"], [data-fe-qa-contrast-clip="n1"]').length), 1);
      await page.locator('#queue').evaluate(clearContrastMarks, 'n1');
      assert.equal(await page.evaluate(() => document.querySelectorAll('[data-fe-qa-contrast], [data-fe-qa-contrast-clip]').length), 0);
      const accepted = await page.evaluate(`(${mountFontProbes})(null, ${JSON.stringify(['"Fixture Sans", monospace', 'sans-serif'])})`);
      assert.deepEqual(accepted, [true, true]);
      assert.equal(await page.evaluate(() => document.getElementById('__fe_qa_font_probes')?.children.length), 2);
      await page.evaluate(unmountFontProbes);
      assert.equal(await page.evaluate(() => [document.getElementById('__fe_qa_font_probes'), Reflect.get(window, '__feQaFontProbes')].filter(Boolean).length), 0);
      await page.evaluate(`(${pickFontSamples})(${selectorFor}, ${JSON.stringify({ heading: 5, button: 5, body: 5, perSignature: 3 })})`);
      assert.equal(await page.evaluate(() => Array.isArray(Reflect.get(window, '__feQaFontTargets'))), true);
      await page.evaluate(releaseFontTargets);
      assert.equal(await page.evaluate(() => Reflect.has(window, '__feQaFontTargets')), false);
    } finally {
      await context.close();
    }
  });
});

describe('browser: qa CLI end to end', () => {
  /** @type {string} */
  let tmp = '';

  before(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-qa-cli-'));
  });

  after(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * @param {string[]} args
   * @returns {Promise<{code: number | null, stdout: string, stderr: string}>}
   */
  function cli(args) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
  }

  test('a clean page exits 0 with the JSON report on stdout and a copy under --out; --state is then only read (Q-F14)', async () => {
    const out = path.join(tmp, 'out');
    const state = path.join(tmp, 'state');
    const r = await cli(['--serve', SITE, '--root', FIXTURES, '--routes', '/clean.html', '--viewports', 'desktop', '--gates', 'render.console,render.requests,a11y.axe', '--json', '--out', out, '--state', state]);
    assert.equal(r.code, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.tool, 'qa');
    assert.deepEqual(report.gates.map((/** @type {GateResult} */ g) => `${g.id}:${g.state}`), ['render.console:ok', 'render.requests:ok', 'a11y.axe:ok']);
    assert.deepEqual(report.target.viewports, ['desktop']);
    assert.ok(existsSync(path.join(out, 'qa.json')));
    assert.deepEqual(JSON.parse(readFileSync(path.join(out, 'qa.json'), 'utf8')).gates, report.gates);
    assert.equal(existsSync(state), false, 'with --out the state folder is neither created nor written');
    assert.match(r.stderr, /^ok {6}render\.console: /m, 'a human summary goes to stderr');
    const own = await cli(['--serve', SITE, '--root', FIXTURES, '--routes', '/clean.html', '--viewports', 'desktop', '--gates', 'render.console', '--state', state]);
    assert.equal(own.code, 0, own.stderr);
    assert.match(readdirSync(path.join(state, 'gates')).join(','), /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ-qa\.json$/, 'without --out the report goes to the state folder');
  });

  test('writeUniqueReport never overwrites a report of the same second', () => {
    const dir = path.join(tmp, 'unique');
    const report = { ok: true, counts: { ok: 0, fail: 0, skipped: 0 }, gates: [] };
    const names = [1, 2, 3].map(() => path.basename(writeUniqueReport(report, dir, '2026-10-01T10-00-00Z-qa')));
    assert.deepEqual(names, ['2026-10-01T10-00-00Z-qa.json', '2026-10-01T10-00-00Z-qa-2.json', '2026-10-01T10-00-00Z-qa-3.json']);
  });

  test('a failing gate exits 1 and the report says why', async () => {
    const r = await cli(['--serve', SITE, '--root', FIXTURES, '--routes', '/fail-console.html', '--viewports', 'desktop', '--gates', 'render.console', '--json']);
    assert.equal(r.code, 1, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.gates[0].state, 'fail');
    assert.match(report.gates[0].detail, /queueFeed is not defined/);
  });

  test('an unreachable --url exits 3', async () => {
    const probe = http.createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = probe.address();
    const port = address && typeof address === 'object' ? address.port : 0;
    await new Promise((resolve) => probe.close(() => resolve(undefined)));
    const r = await cli(['--url', `http://127.0.0.1:${port}`, '--root', FIXTURES, '--viewports', 'desktop', '--gates', 'render.console']);
    assert.equal(r.code, 3, r.stderr);
    assert.match(r.stderr, /cannot load http:\/\/127\.0\.0\.1:\d+\/: .*check that the app is running/);
  });
});
