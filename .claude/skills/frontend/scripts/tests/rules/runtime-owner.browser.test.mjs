// @ts-check
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
// @ts-expect-error opentype.js 2.0.0 ships no type declarations; the test only writes synthetic fixture fonts with it
import opentype from 'opentype.js';
import { launch, withPage } from '../../lib/browser.mjs';
import { DEFAULT_VIEWPORTS, defaultProfile } from '../../lib/profile.mjs';
import { serveStatic } from '../../lib/serve.mjs';
import { loadAllowlists, loadRegistry, runRuntime, runtimeContext } from '../../rules/load.mjs';
import { gradientStops, purpleToBlue, toHsl } from '../../rules/runtime/SL-T01.mjs';
import { hueSpan, stopSpread } from '../../rules/runtime/SL-T02.mjs';
import { emojiIn, startsWithEmoji } from '../../rules/runtime/SL-T03.mjs';
import { INTER } from '../../rules/runtime/SL-T04.mjs';
import { blurRadius } from '../../rules/runtime/SL-T06.mjs';
import { pageGround } from '../../rules/runtime/SL-T07.mjs';
import { labelShape } from '../../rules/runtime/SL-T09.mjs';
import { lucideNames } from '../../rules/runtime/SL-T10.mjs';
import { greyToken, tokenColor, tokenPx } from '../../rules/runtime/SL-T11.mjs';
import { probePoints } from '../../rules/runtime/SL-T13.mjs';
import { changeKind, onlyFades } from '../../rules/runtime/SL-T14.mjs';
import { clusters, cv } from '../../rules/runtime/SL-T15.mjs';
import { MAX_LABELS, countDashes, isDashLabel } from '../../rules/runtime/SL-T16.mjs';
import { specific } from '../../rules/runtime/SL-T17.mjs';
import { reflexFamily } from '../../rules/runtime/SL-T19.mjs';
import { chromaticGradient } from '../../rules/runtime/SL-T20.mjs';

/**
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('../../lib/profile.mjs').Viewport} Viewport
 * @typedef {import('../../rules/load.mjs').Finding} Finding
 * @typedef {import('../../rules/load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../rules/load.mjs').Registry} Registry
 */

const FIXTURES = fileURLToPath(new URL('../fixtures/rules/', import.meta.url));
const RULE_IDS = Array.from({ length: 20 }, (_, i) => `SL-T${String(i + 1).padStart(2, '0')}`);
const DESKTOP = /** @type {Viewport} */ ({ ...DEFAULT_VIEWPORTS[0] });
const MOBILE = /** @type {Viewport} */ ({ ...DEFAULT_VIEWPORTS[1] });
const ROUTE = { path: '/', name: 'home', first: true, features: [], states: [] };
const EM_DASH = String.fromCharCode(0x2014);
/** @param {number[]} points @returns {string} */
const cp = (...points) => String.fromCodePoint(...points);

/** Fixture fonts the HTML references: synthetic box glyphs whose name table carries the family CDP reports. */
const FONTS = Object.freeze([
  ['SL-T04/runtime-inter.otf', 'Inter'],
  ['SL-T04/runtime-display.otf', 'Fixture Display'],
  ['SL-T19/runtime-space-grotesk.otf', 'Space Grotesk'],
  ['SL-T19/runtime-instrument-serif.otf', 'Instrument Serif'],
  ['SL-T19/runtime-grotesk.otf', 'Fixture Grotesk'],
  ['SL-T19/runtime-fraunces.otf', 'Fraunces'],
]);

/**
 * A synthetic OpenType font: printable ASCII as box glyphs, `family` in the name table. No outline is copied from a
 * real typeface.
 * @param {string} family
 * @returns {Buffer}
 */
function syntheticFont(family) {
  const glyphs = [new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 500, path: new opentype.Path() })];
  for (let code = 32; code <= 126; code += 1) {
    const outline = new opentype.Path();
    if (code !== 32) {
      outline.moveTo(60, 0);
      outline.lineTo(440, 0);
      outline.lineTo(440, 680);
      outline.lineTo(60, 680);
      outline.close();
    }
    glyphs.push(new opentype.Glyph({ name: `g${code}`, unicode: code, advanceWidth: code === 32 ? 280 : 520, path: outline }));
  }
  const font = new opentype.Font({ familyName: family, styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs });
  return Buffer.from(font.toArrayBuffer());
}

let tmp = '';
/** @type {Browser} */
let browser;
/** @type {import('../../lib/serve.mjs').StaticServer} */
let server;
/** @type {Registry} */
let registry;

/**
 * Runs rule detectors through the registry runner on one fixture page, with contexts built by rules/load.mjs.
 * @param {string[]} ids
 * @param {string} page path under the served fixtures, e.g. 'SL-T01/runtime-pos.html'
 * @param {{viewport?: Viewport, profile?: Record<string, unknown>}} [options]
 * @returns {Promise<Finding[]>}
 */
async function run(ids, page, { viewport = DESKTOP, profile: overrides = {} } = {}) {
  const profile = defaultProfile(overrides);
  const allowlist = loadAllowlists(tmp, profile);
  const rules = ids.map((id) => {
    const rule = registry.rules.find((r) => r.id === id);
    assert.ok(rule, `${id} is in the registry`);
    return rule;
  });
  return withPage(browser, viewport, `${server.url}/${page}`, async (p) => {
    const ctx = await runtimeContext(browser, p, ROUTE, viewport, profile, allowlist);
    return runRuntime(rules, ctx);
  });
}

/**
 * Asserts the findings carry no detector error and the runtime shape of CONTRACTS section 5; returns them typed.
 * @param {Finding[]} findings
 * @param {string} id
 * @param {Viewport} [viewport]
 * @returns {RuntimeFinding[]}
 */
function checked(findings, id, viewport = DESKTOP) {
  const errors = findings.filter((f) => 'error' in f);
  assert.deepEqual(errors, [], `${id} ran without a detector error`);
  const runtime = /** @type {RuntimeFinding[]} */ (findings);
  for (const f of runtime) {
    assert.equal(f.rule, id);
    assert.equal(f.layer, 'runtime');
    assert.equal(f.route, '/');
    assert.equal(f.viewport, viewport.name);
    assert.equal(typeof f.selector, 'string');
    assert.ok(f.selector.length > 0, `${id} names a selector`);
    assert.equal(typeof f.detail, 'string');
    assert.doesNotThrow(() => JSON.stringify(f.value), 'the value is plain JSON');
  }
  return runtime;
}

/**
 * A field of a plain JSON value by dotted path ('reducedMotion.hiddenAtRest'), undefined when absent.
 * @param {unknown} value
 * @param {string} dotted
 * @returns {unknown}
 */
function pick(value, dotted) {
  let v = value;
  for (const key of dotted.split('.')) v = v !== null && typeof v === 'object' ? Reflect.get(v, key) : undefined;
  return v;
}

/**
 * @param {RuntimeFinding | undefined} f
 * @param {string} dotted
 * @returns {unknown}
 */
function field(f, dotted) {
  return pick(f?.value, dotted);
}

/**
 * @param {unknown} v
 * @returns {unknown[]}
 */
function list(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * @param {unknown} v
 * @returns {number}
 */
function num(v) {
  return typeof v === 'number' ? v : Number.NaN;
}

/**
 * @param {RuntimeFinding[]} findings
 * @param {string} selector
 * @returns {RuntimeFinding}
 */
function bySelector(findings, selector) {
  const f = findings.find((x) => x.selector === selector);
  assert.ok(f, `a finding on ${selector} (got ${findings.map((x) => x.selector).join(', ') || 'none'})`);
  return f;
}

/** What each positive fixture must produce, beyond "at least one finding". */
const POSITIVE = /** @type {Record<string, (findings: RuntimeFinding[]) => void>} */ ({
  'SL-T01': (f) => {
    assert.equal(field(f[0], 'prominence'), 'cta', 'filled CTAs rank first');
    assert.ok(f.some((x) => field(x, 'prominence') === 'hero'), 'the hero gradient is reported');
    bySelector(f, '#glow::before');
  },
  'SL-T02': (f) => {
    const headline = bySelector(f, '#headline');
    assert.equal(field(headline, 'display'), true);
    assert.equal(field(headline, 'sweep'), true);
    const tagline = bySelector(f, '#tagline');
    assert.equal(field(tagline, 'sweep'), false, 'a lightness gradient is measured as such (FD11-F19)');
    assert.equal(field(tagline, 'display'), false);
  },
  'SL-T03': (f) => {
    assert.equal(field(bySelector(f, '#launch'), 'kind'), 'heading');
    assert.ok(f.some((x) => field(x, 'kind') === 'navigation'), 'the emoji-led navigation is reported');
  },
  'SL-T04': (f) => {
    assert.equal(f.length, 1);
    assert.ok(num(field(f[0], 'share')) >= 0.9);
    assert.equal(field(f[0], 'centredHero'), true);
  },
  'SL-T05': (f) => {
    assert.equal(field(bySelector(f, '#border-card'), 'source'), 'border');
    assert.equal(field(bySelector(f, '#pseudo-card::before'), 'side'), 'left');
  },
  'SL-T06': (f) => {
    const glass = bySelector(f, '#glass-card');
    assert.equal(field(glass, 'lightBorder'), true);
    assert.equal(field(glass, 'gradientGround'), true);
    assert.equal(field(glass, 'cooccurrence'), 2);
  },
  'SL-T07': (f) => {
    assert.equal(f.length, 1);
    assert.ok(num(field(f[0], 'share')) >= 0.12);
  },
  'SL-T08': (f) => {
    const row = bySelector(f, '#features');
    assert.equal(field(row, 'cards'), 3);
    assert.equal(field(row, 'row'), true);
  },
  'SL-T09': (f) => {
    assert.equal(field(bySelector(f, '#badge'), 'shape'), 'pill');
  },
  'SL-T10': (f) => {
    assert.equal(field(f[0], 'decorative'), 4);
    assert.equal(field(f[0], 'onActions'), 1);
    assert.deepEqual(list(field(f[0], 'reflex')).map(String).sort(), ['bar-chart-3', 'shield-check', 'sparkles', 'zap']);
  },
  'SL-T11': (f) => {
    assert.equal(field(f[0], 'radiusDefault'), true);
    assert.equal(field(f[0], 'fadingHover'), 1);
  },
  'SL-T12': (f) => {
    assert.deepEqual(f.map((x) => x.selector).sort(), ['#flag', '#match', '#settle']);
    for (const x of f) {
      assert.equal(field(x, 'observedByIntersectionObserver'), true);
      assert.ok(num(field(x, 'reducedMotion.hiddenAtRest')) >= 1, 'the fixture ignores prefers-reduced-motion');
    }
  },
  'SL-T13': (f) => {
    assert.ok(list(field(bySelector(f, '#dot'), 'props')).includes('transform'));
    const spot = list(field(bySelector(f, '#spot'), 'props'));
    assert.ok(spot.includes('custom-properties') || spot.includes('background-image'));
  },
  'SL-T14': (f) => {
    assert.deepEqual(list(field(bySelector(f, '#fade'), 'changes')).map((c) => pick(c, 'prop')), ['opacity']);
    assert.equal(field(bySelector(f, '#alpha'), 'gated'), false);
    assert.equal(field(bySelector(f, '#gated'), 'gated'), true);
  },
  'SL-T15': (f) => {
    assert.deepEqual(f.map((x) => String(field(x, 'check'))).sort(), ['gap-variance', 'heading-rhythm', 'near-miss', 'section-paddings']);
  },
  'SL-T16': (f) => {
    const rate = f.find((x) => field(x, 'kind') === 'rate');
    assert.ok(rate, 'the rate finding');
    assert.ok(num(field(rate, 'count')) >= 6);
    assert.equal(field(rate, 'trigger'), 'pr-01');
    assert.equal(field(bySelector(f, '#label'), 'kind'), 'label');
  },
  'SL-T17': (f) => {
    assert.deepEqual(f.map((x) => x.selector).sort(), ['#infra', '#pitch']);
  },
  'SL-T18': (f) => {
    const headline = bySelector(f, '#headline');
    assert.equal(list(field(headline, 'families')).length, 2);
    assert.ok(list(field(headline, 'styles')).includes('italic'));
  },
  'SL-T19': (f) => {
    const grotesk = f.find((x) => field(x, 'family') === 'Space Grotesk');
    const serif = f.find((x) => field(x, 'family') === 'Instrument Serif');
    assert.ok(grotesk && serif, 'both reflex faces are reported');
    assert.equal(field(grotesk, 'headingFont'), true);
    assert.ok(num(field(serif, 'share')) >= 0.25);
    assert.equal(field(serif, 'pair'), true);
  },
  'SL-T20': (f) => {
    bySelector(f, '#grain');
    bySelector(f, '#hero::before');
  },
});

describe('browser: owner-tell runtime detectors SL-T01 to SL-T20', () => {
  before(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-runtime-owner-'));
    const site = path.join(tmp, 'site');
    for (const id of RULE_IDS) {
      cpSync(path.join(FIXTURES, id), path.join(site, id), {
        recursive: true,
        filter: (src) => path.basename(src) === id || path.basename(src).startsWith('runtime-'),
      });
    }
    for (const [rel, family] of FONTS) writeFileSync(path.join(site, rel), syntheticFont(family));
    registry = loadRegistry();
    browser = await launch();
    server = await serveStatic(site);
  });

  after(async () => {
    await browser?.close();
    await server?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test('every owner tell flagged runtime has its detector file exporting detect()', async () => {
    for (const id of RULE_IDS) {
      const rule = registry.rules.find((r) => r.id === id);
      assert.ok(rule?.runtime, `${id} is a runtime rule`);
      const file = fileURLToPath(new URL(`../../rules/runtime/${id}.mjs`, import.meta.url));
      assert.ok(existsSync(file), `rules/runtime/${id}.mjs exists`);
      const mod = await import(new URL(`../../rules/runtime/${id}.mjs`, import.meta.url).href);
      assert.equal(typeof mod.detect, 'function');
    }
  });

  for (const id of RULE_IDS) {
    test(`${id} fires on its positive fixture`, async () => {
      const findings = checked(await run([id], `${id}/runtime-pos.html`), id);
      assert.ok(findings.length >= 1, `${id} fires on runtime-pos.html`);
      POSITIVE[id](findings);
    });

    test(`${id} stays silent on its negative fixture`, async () => {
      const profile = id === 'SL-T17' ? { sponsors: ['cardano'] } : {};
      const findings = checked(await run([id], `${id}/runtime-neg.html`, { profile }), id);
      assert.deepEqual(findings.map((f) => `${f.selector}: ${f.detail}`), [], `${id} is silent on runtime-neg.html`);
    });
  }

  test('SL-T11 needs the kit rendered: default greys without data-slot stay silent', async () => {
    const findings = checked(await run(['SL-T11'], 'SL-T11/runtime-neg-noslot.html'), 'SL-T11');
    assert.deepEqual(findings, []);
  });

  test('SL-T16 caps the label findings at MAX_LABELS, whether or not the rate finding is present', async () => {
    const expected = Array.from({ length: MAX_LABELS }, (_, i) => `#l${String(i + 1).padStart(2, '0')}`);
    for (const [page, rates] of /** @type {const} */ ([['SL-T16/runtime-pos-labels.html', 1], ['SL-T16/runtime-pos-labels-long.html', 0]])) {
      const findings = checked(await run(['SL-T16'], page), 'SL-T16');
      assert.equal(findings.filter((f) => field(f, 'kind') === 'rate').length, rates, `${page}: ${rates} rate finding(s)`);
      const labels = findings.filter((f) => field(f, 'kind') === 'label');
      assert.deepEqual(labels.map((f) => f.selector), expected, `${page}: 14 labels on the page, the first ${MAX_LABELS} reported`);
    }
  });

  test('SL-T16 leaves non-English copy alone', async () => {
    const findings = checked(await run(['SL-T16'], 'SL-T16/runtime-neg-fr.html'), 'SL-T16');
    assert.deepEqual(findings, []);
  });

  test('SL-T17 fires on the sponsor sentence when the profile names no sponsor', async () => {
    const findings = checked(await run(['SL-T17'], 'SL-T17/runtime-neg.html'), 'SL-T17');
    assert.equal(findings.length, 1, 'only the sponsor-naming block, now unspecific, is reported');
    assert.match(String(field(findings[0], 'block')), /^Cardano users/);
  });

  test('SL-T13 and SL-T14 skip a device without a hover-capable pointer', async () => {
    for (const id of ['SL-T13', 'SL-T14']) {
      const findings = checked(await run([id], `${id}/runtime-pos.html`, { viewport: MOBILE }), id, MOBILE);
      assert.deepEqual(findings, [], `${id} is silent on a touch-only viewport`);
    }
  });

  test('all twenty run together on one page without errors, sharing the collector cache and the font scan', async () => {
    const findings = await run(RULE_IDS, 'SL-T19/runtime-pos.html');
    assert.deepEqual(findings.filter((f) => 'error' in f), []);
    const rules = new Set(findings.map((f) => f.rule));
    assert.ok(rules.has('SL-T19'), 'SL-T19 still fires when SL-T04 measured the fonts first');
  });
});

describe('owner-tell runtime helpers', () => {
  test('gradient stops parse computed gradients, oklch included, and skip geometry', () => {
    const stops = gradientStops('linear-gradient(to right, oklch(0.606 0.25 292.717) 0%, oklch(0.623 0.214 259.815) 100%), url("a.png")');
    assert.equal(stops.length, 1);
    assert.equal(stops[0].length, 2);
    assert.deepEqual(gradientStops('radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 0) 48%, rgba(0, 0, 0, 0.42) 100%)')[0].map((c) => c.a), [0, 0.42]);
    assert.deepEqual(gradientStops('none'), []);
    assert.ok(purpleToBlue('linear-gradient(135deg, rgb(139, 92, 246), rgb(59, 130, 246))'));
    assert.equal(purpleToBlue('linear-gradient(90deg, rgb(168, 85, 247), rgb(236, 72, 153))'), null, 'purple into pink');
    assert.equal(purpleToBlue('linear-gradient(90deg, rgb(122, 158, 110), rgb(91, 155, 213), rgb(167, 139, 250), rgb(201, 168, 76))'), null, 'a data ramp');
    assert.equal(Math.round(toHsl({ r: 79 / 255, g: 70 / 255, b: 229 / 255 }).h), 243, 'indigo-600 sits in the blue band');
  });

  test('gradient text measures stop spread and hue sweep', () => {
    const sweep = gradientStops('linear-gradient(90deg, rgb(168, 85, 247), rgb(236, 72, 153))')[0];
    assert.ok(hueSpan(sweep) >= 30);
    const ethena = gradientStops('linear-gradient(90deg, rgb(164, 175, 194) -1.49%, rgb(231, 239, 252) 19.18%, rgb(191, 212, 250) 60.52%)')[0];
    assert.ok(hueSpan(ethena) < 30, 'Ethena H1: a lightness gradient (FD11-F19)');
    assert.ok(stopSpread(ethena).distance > 0.04);
  });

  test('emoji counting leaves typography and flags out', () => {
    assert.deepEqual(emojiIn(`Pricing ${cp(0xa9)} 2026 ${cp(0x2192)} plans ${cp(0x2122)}`), []);
    assert.equal(emojiIn(`${cp(0x1f680)} Launch ${cp(0x1f468, 0x200d, 0x1f4bb)}`).length, 2, 'a ZWJ sequence counts once');
    assert.deepEqual(emojiIn(`${cp(0x1f1eb, 0x1f1f7)} France`), [], 'regional-indicator flags are not pictographs');
    assert.equal(startsWithEmoji(`  ${cp(0x2699, 0xfe0f)} Settings`), true);
    assert.equal(startsWithEmoji(`Docs ${cp(0x1f4d8)}`), false);
  });

  test('Inter matching takes its cuts and refuses look-alike names', () => {
    for (const name of ['Inter', 'Inter Variable', 'InterVariable', 'Inter Display', 'Inter Tight', 'Inter Medium', 'Inter SemiBold']) assert.ok(INTER.test(name), name);
    for (const name of ['Interstate', 'International', 'Instrument Sans', 'Inter Bold Display Pro X']) assert.ok(!INTER.test(name), name);
  });

  test('reflex families match their cuts, not their prefixes', () => {
    assert.equal(reflexFamily('Space Grotesk Medium'), 'Space Grotesk');
    assert.equal(reflexFamily('Fraunces 72pt Soft'), 'Fraunces');
    assert.equal(reflexFamily('Sora'), 'Sora');
    assert.equal(reflexFamily('Soraya'), null);
    assert.equal(reflexFamily('Instrument Sans'), null);
  });

  test('backdrop blur, ground luminance and label shapes', () => {
    assert.equal(blurRadius('blur(12px) saturate(1.8)'), 12);
    assert.equal(blurRadius('none'), 0);
    assert.ok(pageGround({ body: 'rgb(10, 10, 10)', root: 'rgba(0, 0, 0, 0)', darkCanvas: false }).luminance < 0.2);
    assert.equal(pageGround({ body: 'rgba(0, 0, 0, 0)', root: 'rgba(0, 0, 0, 0)', darkCanvas: false }).painted, false);
    const base = { sel: 'span', tag: 'span', role: '', visible: true, attrs: {}, meta: {}, parent: -1, depth: 0 };
    const pill = labelShape({ ...base, box: { x: 0, y: 0, w: 160, h: 24 }, text: 'New release',
      styles: { backgroundColor: 'rgba(124, 58, 237, 0.1)', backgroundImage: 'none', borderRadius: '9999px', textTransform: 'none', letterSpacing: 'normal' } });
    assert.equal(pill, 'pill');
    const caps = labelShape({ ...base, box: { x: 0, y: 0, w: 120, h: 18 }, text: 'PROTOCOL',
      styles: { backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', borderRadius: '0px', textTransform: 'none', letterSpacing: '1.2px' } });
    assert.equal(caps, 'caps');
  });

  test('lucide class names, shadcn tokens', () => {
    assert.deepEqual(lucideNames('lucide lucide-arrow-right size-4'), ['arrow-right']);
    assert.equal(lucideNames('icon icon-arrow'), null);
    assert.ok(greyToken('oklch(0.205 0 0)'));
    assert.ok(greyToken('0 0% 9%'), 'the HSL-era triplet');
    assert.ok(!greyToken('oklch(0.55 0.2 150)'));
    assert.equal(tokenColor(''), null);
    assert.equal(tokenPx('0.625rem'), 10);
    assert.equal(tokenPx('calc(1rem)'), null);
  });

  test('probe points stay inside the viewport', () => {
    const points = probePoints({ width: 1440, height: 900 });
    assert.equal(points.length, 21);
    assert.ok(points.every((p) => p.x > 0 && p.x + 14 < 1440 && p.y > 0 && p.y + 9 < 900));
  });

  test('hover changes are classified: fades and alpha steps against everything else', () => {
    assert.equal(changeKind('opacity', '1', '0.8'), 'fade');
    assert.equal(changeKind('background-color', 'rgb(23, 23, 23)', 'oklab(0.204625 0.00000931323 0.00000409782 / 0.9)'), 'alpha');
    assert.equal(changeKind('background-color', 'rgb(37, 99, 235)', 'rgb(29, 78, 216)'), 'colour');
    assert.equal(changeKind('background-color', 'rgba(0, 0, 0, 0)', 'rgba(255, 255, 255, 0)'), 'same');
    assert.equal(changeKind('box-shadow', 'none', 'rgba(0, 0, 0, 0.2) 0px 4px 12px 0px'), 'other');
    assert.equal(onlyFades([{ prop: 'opacity', kind: 'fade', from: '1', to: '0.8' }]), true);
    assert.equal(onlyFades([{ prop: 'opacity', kind: 'fade', from: '1', to: '0.9' }, { prop: 'transform', kind: 'other', from: 'none', to: 'matrix(1, 0, 0, 1, 0, -1)' }]), false);
    assert.equal(onlyFades([]), false);
  });

  test('spacing statistics', () => {
    assert.deepEqual(clusters([64, 65, 96, 40, 41], 2), [40, 64, 96]);
    assert.equal(cv([24, 24, 24]), 0);
    assert.ok(cv([24, 24, 8]) > 0.15);
  });

  test('em dashes: placeholders are left out, labels need capitals', () => {
    assert.deepEqual(countDashes(`late ${EM_DASH} most of them`), { prose: 1, placeholders: 0 });
    assert.deepEqual(countDashes(EM_DASH), { prose: 0, placeholders: 1 });
    assert.deepEqual(countDashes(`Score ${EM_DASH}`), { prose: 0, placeholders: 1 });
    assert.deepEqual(countDashes(`Lending ${cp(0xb7)} ${EM_DASH} ${cp(0xb7)} internal`), { prose: 0, placeholders: 1 });
    assert.deepEqual(countDashes(`ROUND ${EM_DASH}/2`), { prose: 0, placeholders: 1 });
    assert.deepEqual(countDashes(`2020${cp(0x2013)}2024`), { prose: 0, placeholders: 0 }, 'en dashes are not counted');
    assert.equal(isDashLabel(`SPEED ${EM_DASH} settles in one block`, 'none'), true);
    assert.equal(isDashLabel(`Speed ${EM_DASH} settles in one block`, 'uppercase'), true, 'capitals set by text-transform');
    assert.equal(isDashLabel(`Speed ${EM_DASH} settles in one block`, 'none'), false);
  });

  test('copy specificity: a figure or a sponsor name', () => {
    assert.equal(specific('drops from 3 days to 20 seconds', []), true);
    assert.equal(specific('Cardano users get a seamless experience', ['cardano']), true);
    assert.equal(specific('a seamless experience for your team', ['cardano']), false);
    assert.equal(specific('Cardanoverse partners', ['cardano']), false, 'whole words only');
  });

  test('a grain counts only over a chromatic gradient', () => {
    assert.ok(chromaticGradient('linear-gradient(135deg, rgb(124, 58, 237), rgb(37, 99, 235))'));
    assert.equal(chromaticGradient('radial-gradient(118% 85% at 50% 40%, rgba(0, 0, 0, 0) 48%, rgba(0, 0, 0, 0.42) 100%)'), null);
  });
});
