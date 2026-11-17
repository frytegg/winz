// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { UsageError } from '../../lib/errors.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import { aggregate } from '../../lib/report.mjs';
import {
  AXE_TAGS, GATES, GATE_IDS, LIMITS, SYSTEM_FAMILIES, boundaryContrast, buildDeclarations, cliContext, counts,
  coverageContrast, decodePng, dominantFont, entryKind, familyCss, familyKey, intendedFont, isLargeText,
  isNarrowViewport, judgeAxe, judgeCls, judgeClipping, judgeConsole, judgeContrast, judgeFonts, judgeGate,
  judgeImages, judgeOverflow, judgeRequests, judgeTargets, judgeTextFont, layoutShiftScore, mustRender,
  overflowViewports, parseBoxShadows, parseFontFamilyList, partyOf, percentile, pixelContrast, planPages,
  requiredRatio, run, selectGates, summariseRatios, surroundingColor, tokenFonts, unknownGates,
} from '../../qa.mjs';
import { FIXTURE_FONT_PATH, buildFixtureFont } from './fixture-font.mjs';

/**
 * @typedef {import('../../qa.mjs').PageRecord} PageRecord
 * @typedef {import('../../qa.mjs').FontDeclarations} FontDeclarations
 * @typedef {import('../../qa.mjs').RgbaImage} RgbaImage
 * @typedef {import('../../qa.mjs').ResolvedFont} ResolvedFont
 */

const FIXTURES = fileURLToPath(new URL('../fixtures/qa/', import.meta.url));
const BASE = 'http://127.0.0.1:4000';
const profile = defaultProfile();
const externalAllowed = defaultProfile({ external_requests: true });

/**
 * A page record as measurePage leaves it, every measurement empty and clean.
 * @param {Partial<PageRecord>} [over]
 * @returns {PageRecord}
 */
function page(over = {}) {
  return {
    route: '/', viewport: 'desktop', url: `${BASE}/`, kind: 'full', screenWidth: 1440, narrow: false, loadError: null, errors: {},
    consoleErrors: [], networkConsole: 0, pageErrors: [], failedRequests: [], badResponses: [], aborted: 0, imageRequests: new Map(),
    overflow: null,
    clipping: { cuts: [], overlaps: [], clippers: 0, ellipsis: 0, clamped: 0 },
    fonts: { faces: [], nodes: [], note: null },
    images: { checked: 0, broken: [], deferred: 0 },
    cls: { cls: 0, sum: 0, windows: 0, flagged: 0, worst: { value: 0, start: 0, end: 0, entries: [] }, error: null },
    axe: { violations: [], incomplete: [] },
    contrast: { resolved: [], unresolved: [], boundaries: [] },
    ...over,
  };
}

/**
 * @param {number} width @param {number} height @param {(x: number, y: number) => [number, number, number]} fn
 * @returns {RgbaImage}
 */
function image(width, height, fn) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = fn(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** @param {Buffer} buf @returns {number} */
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {string} type @param {Buffer} data @returns {Buffer} */
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * A PNG from raw scanlines (each already prefixed with its filter byte), for the decoder tests.
 * @param {{width: number, height: number, depth: number, colorType: number, rows: Buffer[], palette?: Buffer, trns?: Buffer}} spec
 * @returns {Buffer}
 */
function png({ width, height, depth, colorType, rows, palette, trns }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = colorType;
  const chunks = [chunk('IHDR', ihdr)];
  if (palette) chunks.push(chunk('PLTE', palette));
  if (trns) chunks.push(chunk('tRNS', trns));
  const idat = deflateSync(Buffer.concat(rows));
  chunks.push(chunk('IDAT', idat.subarray(0, 5)), chunk('IDAT', idat.subarray(5)), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
}

/** @param {RgbaImage} img @param {number} x @param {number} y @returns {number[]} */
function px(img, x, y) {
  const o = (y * img.width + x) * 4;
  return [...img.data.subarray(o, o + 4)];
}

describe('qa: gate catalogue and selection', () => {
  test('GATES lists the ten contract ids of render and a11y, each with a title and an if-dropped sentence', () => {
    assert.deepEqual(GATES.map((g) => g.id), [
      'render.console', 'render.requests', 'render.fonts', 'render.images', 'render.overflow', 'render.clipping', 'render.cls',
      'a11y.axe', 'a11y.contrast', 'a11y.targets',
    ]);
    for (const g of GATES) {
      assert.ok(g.title.trim().length > 0, g.id);
      assert.ok(g.ifDropped.trim().length > 0, g.id);
    }
    assert.deepEqual(GATE_IDS, GATES.map((g) => g.id));
    assert.deepEqual(AXE_TAGS, ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
  });

  test('selectGates expands groups, keeps report order and ignores other modules\' ids', () => {
    assert.deepEqual(selectGates(undefined), [...GATE_IDS]);
    assert.deepEqual(selectGates(['a11y']), ['a11y.axe', 'a11y.contrast', 'a11y.targets']);
    assert.deepEqual(selectGates('render.cls,render.console,tokens.valid'), ['render.console', 'render.cls']);
    assert.deepEqual(selectGates(['all']), [...GATE_IDS]);
    assert.deepEqual(selectGates(['coverage.features']), []);
    assert.deepEqual(unknownGates(['render', 'a11y.axe', 'render.nope', 'tokens.valid', '']), ['render.nope', 'tokens.valid']);
  });
});

describe('qa: parties', () => {
  test('partyOf treats the origin, loopback ports and data URLs as first party', () => {
    assert.equal(partyOf(`${BASE}/app.js`, BASE), 'first');
    assert.equal(partyOf('http://localhost:8787/api', BASE), 'first');
    assert.equal(partyOf('http://127.0.0.2:9000/api', BASE), 'first');
    assert.equal(partyOf('http://[::1]:9000/api', BASE), 'first');
    assert.equal(partyOf('http://127.0.0.1.example.com/x', BASE), 'third');
    assert.equal(partyOf('data:image/png;base64,AAAA', BASE), 'first');
    assert.equal(partyOf('blob:http://127.0.0.1:4000/abc', BASE), 'first');
    assert.equal(partyOf('https://fonts.gstatic.com/x.woff2', BASE), 'third');
    assert.equal(partyOf('https://cdn.example.org/a.js', 'https://app.example.org/'), 'third');
    assert.equal(partyOf('not a url', BASE), 'first');
  });

  test('third-party issues count only when the profile forbids external requests', () => {
    assert.equal(counts('first', externalAllowed), true);
    assert.equal(counts('third', externalAllowed), false);
    assert.equal(counts('third', profile), true);
  });
});

describe('qa: font stacks and the intended family', () => {
  test('parseFontFamilyList splits on commas outside quotes, unquotes and drops var() leftovers', () => {
    assert.deepEqual(parseFontFamilyList('"Brand Sans", \'Other, Inc\', Segoe   UI, sans-serif'), ['Brand Sans', 'Other, Inc', 'Segoe UI', 'sans-serif']);
    assert.deepEqual(parseFontFamilyList('"A \\"quoted\\" face", serif'), ['A "quoted" face', 'serif']);
    assert.deepEqual(parseFontFamilyList('var(--font-sans), Inter'), ['Inter']);
    assert.deepEqual(parseFontFamilyList(''), []);
    assert.equal(familyKey(' "Segoe  UI" '), 'segoe ui');
    assert.equal(familyCss('Sans-Serif'), 'sans-serif');
    assert.equal(familyCss('Brand "X"'), '"Brand \\"X\\""');
  });

  /** @type {FontDeclarations} */
  const decl = {
    webfonts: new Set(['brand sans']),
    shipped: new Set(['brand sans', 'tokens mono']),
    names: new Set(['brand sans', 'georgia', 'serif', 'inter', 'tokens mono', 'monospace', 'segoe ui', 'system-ui']),
    checkDeclared: true,
  };
  /** @param {string} familyName @param {boolean} [custom] @returns {ResolvedFont} */
  const font = (familyName, custom = false) => ({ familyName, postScriptName: familyName.replace(/\s/g, ''), isCustomFont: custom });

  test('entryKind and mustRender: generics and system faces may be skipped; web fonts, tokens files and design faces may not', () => {
    assert.equal(entryKind('sans-serif', decl), 'generic');
    assert.equal(entryKind('brand sans', decl), 'webfont');
    assert.equal(entryKind('tokens mono', decl), 'shipped');
    assert.equal(entryKind('segoe ui', decl), 'system');
    assert.equal(entryKind('satoshi', decl), 'named');
    assert.ok(SYSTEM_FAMILIES.has('-apple-system') && !SYSTEM_FAMILIES.has('inter'));
    assert.deepEqual(['generic', 'system', 'webfont', 'shipped', 'named'].map((k) => mustRender(/** @type {any} */ (k))), [false, false, true, true, true]);
  });

  test('intendedFont walks a system stack past unavailable platform faces to the first one that renders', () => {
    const resolutions = new Map([['-apple-system', null], ['blinkmacsystemfont', null], ['segoe ui', font('Segoe UI')]]);
    const got = intendedFont(['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'], resolutions, decl);
    assert.equal(got.entry, 'Segoe UI');
    assert.equal(got.font?.familyName, 'Segoe UI');
  });

  test('intendedFont stops at a web font, a tokens file or a design face that does not render: a silent fallback', () => {
    assert.match(intendedFont(['Brand Sans', 'Georgia'], new Map([['brand sans', null]]), decl).why, /web font "Brand Sans" did not render/);
    assert.match(intendedFont(['Satoshi', 'sans-serif'], new Map([['satoshi', null]]), decl).why, /named first but neither shipped/);
    const shipped = intendedFont(['Tokens Mono', 'monospace'], new Map([['tokens mono', font('Tokens Mono')]]), { ...decl, webfonts: new Set() });
    assert.equal(shipped.font, null);
    assert.match(shipped.why, /tokens\.json ships "Tokens Mono" as a file, but the page declares no @font-face for it; here it renders from a copy installed/);
    const installed = intendedFont(['Inter', 'sans-serif'], new Map([['inter', font('Inter')]]), decl);
    assert.equal(installed.font, null);
    assert.match(installed.why, /renders from a copy installed on this machine \(Inter\), but the page does not ship it/);
    const none = intendedFont(['-apple-system'], new Map([['-apple-system', null]]), decl);
    assert.equal(none.kind, 'default');
    assert.match(intendedFont(['Unprobed'], new Map(), decl).why, /could not be resolved/);
  });

  test('judgeTextFont: the dominant rendered font must be the intended face, declared by the tokens or the page', () => {
    const resolutions = new Map([['brand sans', font('Qa Block', true)], ['arial', font('Arial')], ['georgia', font('Georgia')]]);
    const glyphs = (/** @type {Array<[string, boolean, number]>} */ list) => list.map(([familyName, isCustomFont, glyphCount]) => ({ familyName, postScriptName: '', isCustomFont, glyphCount }));
    const sample = { stack: ['Brand Sans', 'Georgia', 'serif'], tag: 'p', category: 'body' };
    const ok = judgeTextFont(sample, glyphs([['Qa Block', true, 40], ['Segoe UI Symbol', false, 1]]), resolutions, decl);
    assert.deepEqual([ok.ok, ok.measured], [true, true], 'a per-glyph fallback for one symbol does not change the dominant font');
    const lacking = judgeTextFont(sample, glyphs([['Qa Block', true, 3], ['Georgia', false, 30]]), resolutions, decl);
    assert.equal(lacking.ok, false);
    assert.match(lacking.reason, /most glyphs render in Georgia \(system\): the face lacks them/);
    const button = judgeTextFont({ stack: ['Arial'], tag: 'button', category: 'button' }, glyphs([['Arial', false, 12]]), resolutions, decl);
    assert.equal(button.ok, false);
    assert.match(button.reason, /"Arial" comes from the browser's default style.*set font: inherit/);
    const opaque = judgeTextFont({ stack: ['Arial'], tag: 'button', category: 'button' }, glyphs([['Arial', false, 12]]), resolutions, { ...decl, checkDeclared: false });
    assert.equal(opaque.ok, true, 'with unreadable cross-origin stylesheets the declaration check is not applied');
    const nothing = judgeTextFont(sample, [], resolutions, decl);
    assert.deepEqual([nothing.ok, nothing.measured], [true, false]);
    assert.equal(dominantFont(null), null);
  });

  test('buildDeclarations and tokenFonts read the page inventory and tokens.json', () => {
    const tokens = tokenFonts(path.join(FIXTURES, 'design'));
    assert.deepEqual(tokens.families.sort(), ['Fixture Sans', 'Fixture Sans', 'Fixture Sans', 'Qa Tokens Mono', 'Qa Tokens Mono'].sort());
    assert.deepEqual(tokens.shipped, ['Fixture Sans', 'Qa Tokens Mono']);
    assert.equal(tokens.note, null);
    assert.deepEqual(tokenFonts(path.join(FIXTURES, 'no-such-design')), { families: [], shipped: [], note: null });
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-qa-tokens-'));
    try {
      writeFileSync(path.join(tmp, 'tokens.json'), '{ not json');
      assert.match(String(tokenFonts(tmp).note), /tokens\.json unreadable/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    const built = buildDeclarations({ names: ['Georgia', 'serif'], faces: [{ family: 'Brand Sans' }], opaque: 0 }, tokens);
    assert.ok(built.webfonts.has('brand sans') && built.names.has('georgia') && built.names.has('qa tokens mono'));
    assert.ok(built.shipped.has('qa tokens mono'));
    assert.equal(built.checkDeclared, true);
    assert.equal(buildDeclarations({ names: [], faces: [], opaque: 1 }, tokens).checkDeclared, false);
  });

  test('the committed fixture font is exactly what the generator builds', () => {
    assert.ok(readFileSync(FIXTURE_FONT_PATH).equals(buildFixtureFont()), 'run node tests/qa/fixture-font.mjs to regenerate it');
  });
});

describe('qa: layout shift', () => {
  test('layoutShiftScore keeps the largest session window: gaps of 1 s or a window of 5 s start a new one', () => {
    const shifts = [
      { value: 0.04, startTime: 100, hadRecentInput: false },
      { value: 0.05, startTime: 900, hadRecentInput: false },
      { value: 0.2, startTime: 2500, hadRecentInput: true },
      { value: 0.03, startTime: 3000, hadRecentInput: false },
    ];
    const score = layoutShiftScore(shifts);
    assert.equal(Number(score.cls.toFixed(3)), 0.09);
    assert.equal(Number(score.sum.toFixed(3)), 0.12);
    assert.equal(score.windows, 2);
    assert.equal(score.flagged, 1);
    const kept = layoutShiftScore(shifts, { keepFlagged: true });
    assert.equal(Number(kept.cls.toFixed(3)), 0.23, 'flagged shifts count when the run sent no input');
    const long = Array.from({ length: 12 }, (_, i) => ({ value: 0.01, startTime: i * 900, hadRecentInput: false }));
    const capped = layoutShiftScore(long);
    assert.equal(capped.windows, 2, 'shifts 900 ms apart: 0 to 4.5 s, then 5.4 s to 9.9 s, since a window never spans 5 s');
    assert.equal(Number(capped.cls.toFixed(3)), 0.06);
    assert.deepEqual(layoutShiftScore([]).cls, 0);
  });
});

describe('qa: contrast arithmetic', () => {
  test('isLargeText and requiredRatio mirror axe-core: 18 pt, or 14 pt at weight 700', () => {
    assert.equal(isLargeText(24, '400'), true);
    assert.equal(isLargeText(23.9, '400'), false);
    assert.equal(isLargeText(18.67, '700'), true);
    assert.equal(isLargeText(18.5, '700'), false);
    assert.equal(isLargeText(19, 'bold'), true);
    assert.equal(requiredRatio({ fontSizePx: 16, fontWeight: '400' }), LIMITS.contrastNormal);
    assert.equal(requiredRatio({ fontSizePx: 32, fontWeight: '400' }), LIMITS.contrastLarge);
    assert.equal(requiredRatio({ fontSizePx: 12, fontWeight: '400', graphic: true }), 3);
    assert.equal(percentile([1, 2, 3, 4], 0.5), 2);
    assert.equal(percentile([1, 2, 3, 4], 1), 4);
    assert.ok(Number.isNaN(percentile([], 0.5)));
  });

  test('summariseRatios takes the 1st percentile from 100 samples on, the minimum below', () => {
    const fg = { r: 0, g: 0, b: 0, a: 1 };
    const bg = { r: 1, g: 1, b: 1, a: 1 };
    const many = Array.from({ length: 200 }, (_, i) => ({ ratio: i === 0 ? 1.2 : 5 + i / 100, fg, bg }));
    const s = summariseRatios(many);
    assert.equal(s?.min, 1.2);
    assert.equal(s?.worst, 5.01, 'one noisy pixel out of 200 does not decide alone: rank ceil(0.01 x 200) = 2');
    assert.equal(summariseRatios(many.slice(0, 50))?.worst, 1.2);
    assert.equal(summariseRatios([]), null);
  });

  test('pixelContrast (css mode) composites the text colour over the sampled background behind each glyph', () => {
    const background = (/** @type {number} */ x) => /** @type {[number, number, number]} */ ([255 - x * 10, 255 - x * 10, 255 - x * 10]);
    const glyph = (/** @type {number} */ x, /** @type {number} */ y) => y >= 2 && y < 6;
    const hidden = image(10, 8, (x) => background(x));
    const shown = image(10, 8, (x, y) => (glyph(x, y) ? [40, 40, 40] : background(x)));
    const solid = pixelContrast(shown, hidden, { mode: 'css', fg: { r: 40 / 255, g: 40 / 255, b: 40 / 255, a: 1 } });
    assert.ok(solid);
    assert.equal(solid.samples, 40);
    const darkest = 255 - 9 * 10;
    assert.equal(solid.bg.r * 255, darkest, 'the worst pixel sits on the darkest part of the gradient');
    assert.ok(Math.abs(solid.worst - 5.99) < 0.01, `got ${solid.worst}`);
    const translucent = pixelContrast(shown, hidden, { mode: 'css', fg: { r: 0, g: 0, b: 0, a: 0.5 } });
    assert.ok(translucent && translucent.worst < solid.worst, 'alpha lowers the contrast');
    assert.equal(pixelContrast(hidden, hidden, { mode: 'css', fg: { r: 0, g: 0, b: 0, a: 1 } }), null, 'nothing painted');
    assert.throws(() => pixelContrast(shown, image(2, 2, () => [0, 0, 0]), { mode: 'css' }), /differ in size/);
  });

  test('pixelContrast (core mode) reads the colour from glyph pixels, leaving anti-aliased edges out', () => {
    const hidden = image(8, 4, () => [255, 255, 255]);
    const shown = image(8, 4, (x) => (x < 4 ? [20, 20, 20] : x === 4 ? [200, 200, 200] : [255, 255, 255]));
    const core = pixelContrast(shown, hidden, { mode: 'core' });
    assert.ok(core);
    assert.equal(core.samples, 16, 'only the 16 solid pixels, not the light edge column');
    assert.ok(core.worst > 15);
  });

  test('coverageContrast recovers the fill of gradient text from black and white probes, edges excluded', () => {
    const W = 20;
    const fill = (/** @type {number} */ x) => 17 + Math.round((x / (W - 1)) * (221 - 17));
    const cover = (/** @type {number} */ x, /** @type {number} */ y) => (y === 0 ? 0.3 : y < 4 ? 1 : 0);
    const bg = 255;
    const blend = (/** @type {number} */ f, /** @type {number} */ a) => Math.round(a * f + (1 - a) * bg);
    const shown = image(W, 5, (x, y) => { const v = blend(fill(x), cover(x, y)); return [v, v, v]; });
    const hidden = image(W, 5, () => [bg, bg, bg]);
    const black = image(W, 5, (x, y) => { const v = blend(0, cover(x, y)); return [v, v, v]; });
    const white = image(W, 5, (x, y) => { const v = blend(255, cover(x, y)); return [v, v, v]; });
    const stats = coverageContrast(shown, hidden, black, white);
    assert.ok(stats);
    assert.equal(stats.samples, W * 3, 'rows at 30% coverage are left out');
    assert.ok(Math.abs(stats.fg.r * 255 - 221) <= 1, `the light end of the gradient is recovered (got ${stats.fg.r * 255})`);
    assert.ok(stats.worst < 1.5, 'the light end decides the worst case');
    assert.ok(stats.median > 3);
    assert.equal(coverageContrast(hidden, hidden, hidden, hidden), null);
  });

  test('parseBoxShadows reads computed shadow lists, insets and colour functions', () => {
    assert.deepEqual(parseBoxShadows('rgba(0, 0, 0, 0.5) 0px 0px 0px 1px, rgb(0, 0, 0) 0px 1px 2px 0px inset'), [
      { color: 'rgba(0, 0, 0, 0.5)', x: 0, y: 0, blur: 0, spread: 1, inset: false },
      { color: 'rgb(0, 0, 0)', x: 0, y: 1, blur: 2, spread: 0, inset: true },
    ]);
    assert.deepEqual(parseBoxShadows('none'), []);
    assert.deepEqual(parseBoxShadows('red 2px 3px'), [{ color: 'red', x: 2, y: 3, blur: 0, spread: 0, inset: false }]);
  });

  test('boundaryContrast takes the best indicator against the background: fill, borders, outline, hard rings', () => {
    const white = { r: 1, g: 1, b: 1, a: 1 };
    const sides = (/** @type {string} */ color, width = 1) => ['top', 'right', 'bottom', 'left'].map(() => ({ width, style: 'solid', color }));
    const faint = boundaryContrast({ fill: 'rgb(255, 255, 255)', borders: sides('rgb(229, 231, 235)'), shadows: 'none', outline: null }, white);
    assert.ok(faint.best < 1.3);
    const grey = boundaryContrast({ fill: 'rgb(255, 255, 255)', borders: sides('rgb(118, 118, 118)'), shadows: 'none', outline: null }, white);
    assert.ok(grey.best >= 4.5);
    assert.match(grey.by, /^border/);
    const ring = boundaryContrast({ fill: 'rgba(0, 0, 0, 0)', borders: sides('rgb(229, 231, 235)', 0), shadows: 'rgb(118, 118, 118) 0px 0px 0px 1px', outline: null }, white);
    assert.match(ring.by, /^shadow/);
    assert.ok(ring.best >= 4.5);
    const soft = boundaryContrast({ fill: 'rgba(0, 0, 0, 0)', borders: [], shadows: 'rgb(0, 0, 0) 0px 4px 12px 0px', outline: null }, white);
    assert.equal(soft.best, 0, 'a blurred drop shadow is not a boundary');
    const filled = boundaryContrast({ fill: 'rgb(30, 30, 30)', borders: [], shadows: 'none', outline: null }, white);
    assert.match(filled.by, /^fill/);
    assert.equal(boundaryContrast({ fill: '', borders: [], shadows: 'none', outline: null }, null).best, 0);
  });

  test('surroundingColor takes the most common colour 1 to 3 CSS px around the box, so a touching neighbour does not count', () => {
    const clip = { x: 0, y: 0, width: 20, height: 20 };
    const box = { x: 4, y: 4, width: 12, height: 8 };
    const img = image(20, 20, (x, y) => (y >= 13 && y < 16 ? [11, 61, 145] : x >= 4 && x < 16 && y >= 4 && y < 12 ? [118, 118, 118] : [255, 255, 255]));
    assert.deepEqual(surroundingColor(img, clip, box, 1), { r: 1, g: 1, b: 1, a: 1 });
    const hiDpi = image(40, 40, () => [10, 20, 30]);
    assert.deepEqual(surroundingColor(hiDpi, clip, box, 2), { r: 10 / 255, g: 20 / 255, b: 30 / 255, a: 1 });
    assert.equal(surroundingColor(image(4, 4, () => [0, 0, 0]), { x: 0, y: 0, width: 4, height: 4 }, { x: 0, y: 0, width: 4, height: 4 }, 1), null);
  });
});

describe('qa: PNG decoding', () => {
  test('decodes 8-bit RGB and RGBA with every scanline filter', () => {
    const rgbRows = [0, 1, 2, 3, 4].map((filter) => Buffer.from([filter, 10, 20, 30, 40, 50, 60]));
    const rgb = decodePng(png({ width: 2, height: 5, depth: 8, colorType: 2, rows: rgbRows }));
    assert.deepEqual([rgb.width, rgb.height], [2, 5]);
    assert.deepEqual(px(rgb, 0, 0), [10, 20, 30, 255]);
    assert.deepEqual(px(rgb, 1, 0), [40, 50, 60, 255]);
    assert.deepEqual(px(rgb, 1, 1), [50, 70, 90, 255], 'Sub adds the left pixel');
    assert.deepEqual(px(rgb, 0, 2), [20, 40, 60, 255], 'Up adds the pixel above');
    assert.deepEqual(px(rgb, 0, 3), [20, 40, 60, 255], 'Average adds half the pixel above');
    assert.deepEqual(px(rgb, 0, 4), [30, 60, 90, 255], 'Paeth predicts from the pixel above');
    const rgba = decodePng(png({ width: 1, height: 1, depth: 8, colorType: 6, rows: [Buffer.from([0, 1, 2, 3, 128])] }));
    assert.deepEqual(px(rgba, 0, 0), [1, 2, 3, 128]);
  });

  test('decodes grayscale, grey with alpha, 16-bit, low bit depths and palettes', () => {
    assert.deepEqual(px(decodePng(png({ width: 1, height: 1, depth: 8, colorType: 0, rows: [Buffer.from([0, 77])] })), 0, 0), [77, 77, 77, 255]);
    assert.deepEqual(px(decodePng(png({ width: 1, height: 1, depth: 8, colorType: 4, rows: [Buffer.from([0, 77, 9])] })), 0, 0), [77, 77, 77, 9]);
    assert.deepEqual(px(decodePng(png({ width: 1, height: 1, depth: 16, colorType: 2, rows: [Buffer.from([0, 0xab, 0xcd, 0x12, 0x34, 0x56, 0x78])] })), 0, 0), [0xab, 0x12, 0x56, 255]);
    const twoBit = decodePng(png({ width: 4, height: 1, depth: 2, colorType: 0, rows: [Buffer.from([0, 0b00011011])] }));
    assert.deepEqual([0, 1, 2, 3].map((x) => px(twoBit, x, 0)[0]), [0, 85, 170, 255]);
    const palette = Buffer.from([255, 0, 0, 0, 0, 255]);
    const pal = decodePng(png({ width: 2, height: 1, depth: 1, colorType: 3, rows: [Buffer.from([0, 0b01000000])], palette, trns: Buffer.from([100]) }));
    assert.deepEqual(px(pal, 0, 0), [255, 0, 0, 100]);
    assert.deepEqual(px(pal, 1, 0), [0, 0, 255, 255]);
  });

  test('rejects what is not a decodable PNG', () => {
    assert.throws(() => decodePng(Buffer.from('this file is not a png image')), /not a PNG/);
    const interlaced = png({ width: 1, height: 1, depth: 8, colorType: 0, rows: [Buffer.from([0, 1])] });
    interlaced[8 + 8 + 12] = 1;
    assert.throws(() => decodePng(interlaced), /interlaced/);
    assert.throws(() => decodePng(png({ width: 1, height: 1, depth: 8, colorType: 2, rows: [Buffer.from([7, 1, 2, 3])] })), /invalid PNG filter type 7/);
    assert.throws(() => decodePng(png({ width: 1, height: 1, depth: 8, colorType: 3, rows: [Buffer.from([0, 0])] })), /palette PNG without PLTE/);
  });
});

describe('qa: viewports and plan', () => {
  const desktop = { name: 'desktop', width: 1440, height: 900, dpr: 1, isMobile: false, hasTouch: false };
  const mobile = { name: 'mobile', width: 390, height: 844, dpr: 2, isMobile: true, hasTouch: true };
  const reflow = { name: 'reflow', width: 320, height: 640, dpr: 1, isMobile: false, hasTouch: false };
  const route = { path: '/', name: 'home', first: true, features: [], states: [] };

  test('overflow runs at the narrow viewports and adds 320 and 375 CSS px when the matrix lacks them', () => {
    assert.deepEqual([desktop, mobile, reflow].map(isNarrowViewport), [false, true, true]);
    const defaults = overflowViewports([desktop, mobile, reflow]);
    assert.deepEqual(defaults.matrix.map((v) => v.name), ['mobile', 'reflow']);
    assert.deepEqual(defaults.extra.map((v) => [v.name, v.width, v.isMobile, v.dpr]), [['mobile-375', 375, true, 2]]);
    const desktopOnly = overflowViewports([desktop]);
    assert.deepEqual(desktopOnly.extra.map((v) => v.width), [320, 375]);
  });

  test('planPages loads every route at every viewport, plus overflow-only loads where needed', () => {
    const all = planPages([route], [desktop, mobile, reflow], [...GATE_IDS]);
    assert.deepEqual(all.map((p) => `${p.kind}:${p.view.name}`), ['full:desktop', 'full:mobile', 'full:reflow', 'overflow:mobile-375']);
    const onlyOverflow = planPages([route], [desktop, mobile, reflow], ['render.overflow']);
    assert.deepEqual(onlyOverflow.map((p) => `${p.kind}:${p.view.name}`), ['overflow:mobile', 'overflow:reflow', 'overflow:mobile-375']);
    assert.deepEqual(planPages([route], [desktop], ['a11y.axe']).map((p) => p.view.name), ['desktop']);
  });
});

describe('qa: gate verdicts from page records', () => {
  test('a clean record passes every gate, and an empty plan skips', () => {
    const clean = page({ narrow: true, overflow: [{ phase: 'load', scrollWidth: 390, clientWidth: 390, screenWidth: 390, rootOverflowX: 'visible', offenders: [] }] });
    for (const id of GATE_IDS) assert.equal(judgeGate(id, [clean], profile).state, 'ok', id);
    assert.equal(judgeConsole([], profile).state, 'skipped');
    assert.throws(() => judgeGate('tokens.valid', [clean], profile), TypeError);
  });

  test('render.console fails on uncaught errors and first-party console errors, not on network messages', () => {
    const r = judgeConsole([page({
      networkConsole: 2,
      pageErrors: [{ message: 'ReferenceError: x is not defined', url: `${BASE}/app.js`, party: 'first' }],
      consoleErrors: [{ type: 'error', text: 'boom', url: `${BASE}/app.js`, line: 3, party: 'first' }, { type: 'error', text: 'widget', url: 'https://w.example/x.js', line: 1, party: 'third' }],
    })], externalAllowed);
    assert.equal(r.state, 'fail');
    assert.equal(r.evidence.length, 2, 'the third-party message does not count when external requests are allowed');
    assert.equal(r.evidence[0].value, 'pageerror');
    assert.match(r.detail, /^2 console errors or uncaught exceptions on 1 of 1 page load; first: ReferenceError/);
    const ok = judgeConsole([page({ networkConsole: 2 })], profile);
    assert.equal(ok.state, 'ok');
    assert.match(ok.detail, /2 network errors left to render\.requests/);
  });

  test('render.requests fails on failed requests and HTTP 400+, deduplicated, honouring the external-requests rule', () => {
    const rec = page({
      failedRequests: [{ url: 'https://cdn.example/f.woff2', method: 'GET', resourceType: 'font', errorText: 'net::ERR_NAME_NOT_RESOLVED', party: 'third' }],
      badResponses: [
        { url: `${BASE}/api/x.json`, method: 'GET', resourceType: 'fetch', status: 404, party: 'first' },
        { url: `${BASE}/api/x.json`, method: 'GET', resourceType: 'fetch', status: 404, party: 'first' },
      ],
      aborted: 1,
    });
    const strict = judgeRequests([rec], profile);
    assert.equal(strict.state, 'fail');
    assert.deepEqual(strict.evidence.map((e) => e.value), ['net::ERR_NAME_NOT_RESOLVED', 'HTTP 404']);
    assert.deepEqual(judgeRequests([rec], externalAllowed).evidence.map((e) => e.value), ['HTTP 404']);
    assert.match(judgeRequests([page({ aborted: 3 })], profile).detail, /3 cancelled requests \(net::ERR_ABORTED\) ignored/);
  });

  test('render.fonts fails on a FontFace error and on texts that fall back; repeated causes are listed once', () => {
    const node = { sel: 'h1', category: 'heading', tag: 'h1', text: 'Queue', family: '"X", serif', ok: false, measured: true, reason: 'fallback', rendered: 'Times New Roman', custom: false, intended: 'X' };
    const r = judgeFonts([page({ fonts: { faces: [{ family: 'X', status: 'error', weight: '400', style: 'normal' }, { family: 'Y', status: 'unloaded', weight: '400', style: 'normal' }], nodes: [node, { ...node, sel: 'h2' }], note: null } })]);
    assert.equal(r.state, 'fail');
    assert.deepEqual(r.evidence.map((e) => e.value), ['font-face-error', 'Times New Roman']);
    const ok = judgeFonts([page({ fonts: { faces: [], nodes: [{ ...node, ok: true, rendered: 'Qa Block' }, { ...node, ok: true, rendered: 'Qa Block' }], note: 'tokens.json unreadable (x)' } })]);
    assert.equal(ok.state, 'ok');
    assert.match(ok.detail, /^2 texts \(headings, body, buttons\) render in their declared families: Qa Block 2; tokens\.json unreadable/);
  });

  test('render.images, render.overflow, render.clipping and render.cls fail on their findings', () => {
    assert.equal(judgeImages([page({ images: { checked: 2, broken: [{ sel: 'img', src: `${BASE}/a.png`, problem: 'HTTP 404' }], deferred: 0 } })]).state, 'fail');
    const wide = { phase: /** @type {const} */ ('load'), scrollWidth: 560, clientWidth: 320, screenWidth: 320, rootOverflowX: 'hidden', offenders: [{ sel: '.wide', right: 560, width: 560 }] };
    const overflow = judgeOverflow([page({ narrow: true, screenWidth: 320, overflow: [wide] }), page({ narrow: false })]);
    assert.equal(overflow.state, 'fail');
    assert.equal(overflow.evidence.length, 1, 'only narrow loads are judged');
    assert.match(String(overflow.evidence[0].detail), /body overflow-x: hidden hides the scrollbar, the content is still cut\); widest: \.wide to 560px/);
    const noMeta = judgeOverflow([page({ narrow: true, screenWidth: 390, overflow: [{ ...wide, scrollWidth: 980, clientWidth: 980, screenWidth: 390 }] })]);
    assert.match(String(noMeta.evidence[0].detail), /lays out 980 px wide on a 390 px screen.*meta name="viewport"/);
    const clipping = judgeClipping([page({ clipping: { cuts: [{ sel: '.note', axis: 'y', text: 'cut', cutPx: 11 }], overlaps: [{ a: 'p', b: 'span', textA: 'A', textB: 'B', px: 9 }], clippers: 1, ellipsis: 0, clamped: 0 } })]);
    assert.deepEqual(clipping.evidence.map((e) => e.value), ['cut y 11px', 'overlap 9px']);
    const shift = { value: 0.2, startTime: 100, hadRecentInput: false, sources: ['main'] };
    const cls = judgeCls([page({ cls: { cls: 0.2, sum: 0.2, windows: 1, flagged: 0, worst: { value: 0.2, start: 100, end: 100, entries: [shift] }, error: null } })]);
    assert.equal(cls.state, 'fail');
    assert.equal(cls.evidence[0].selector, 'main');
    const atLimit = judgeCls([page({ cls: { cls: 0.1, sum: 0.1, windows: 1, flagged: 0, worst: { value: 0.1, start: 0, end: 0, entries: [shift] }, error: null } })]);
    assert.equal(atLimit.state, 'ok', 'a CLS of exactly 0.1 is good');
  });

  /** @param {string} rule @param {Partial<import('../../qa.mjs').AxeItem>} [over] @returns {import('../../qa.mjs').AxeItem} */
  const axeItem = (rule, over = {}) => ({ rule, impact: 'serious', help: `${rule} help`, selector: '#x', target: ['#x'], html: '<x>', summary: 'fix it', message: 'msg', data: null, party: 'first', ...over });

  test('a11y.axe judges every violation except contrast and target size, which have their own gates', () => {
    const r = judgeAxe([page({ axe: { violations: [axeItem('image-alt'), axeItem('color-contrast'), axeItem('target-size'), axeItem('label', { party: 'third' })], incomplete: [axeItem('aria-valid-attr-value')] } })], externalAllowed);
    assert.equal(r.state, 'fail');
    assert.deepEqual(r.evidence.map((e) => e.value), ['image-alt']);
    const ok = judgeAxe([page({ axe: { violations: [axeItem('color-contrast')], incomplete: [axeItem('aria-valid-attr-value'), axeItem('color-contrast')] } })], profile);
    assert.equal(ok.state, 'ok');
    assert.deepEqual(ok.evidence.map((e) => e.value), ['incomplete aria-valid-attr-value'], 'incomplete items are listed for review');
  });

  test('a11y.contrast fails on axe violations, resolved texts under the minimum, unmeasurable items and weak input boundaries', () => {
    const resolved = { selector: '.a', ratio: 3.1, required: 4.5, mode: 'css', why: 'bgGradient', min: 3, median: 6, samples: 300, apca: 40, fg: '#777777', bg: '#ffffff', reason: '3.1:1 at worst', party: /** @type {const} */ ('first') };
    const r = judgeContrast([page({
      axe: { violations: [axeItem('color-contrast', { data: { fgColor: '#b0b0b0', bgColor: '#ffffff', contrastRatio: 2.16, expectedContrastRatio: '4.5:1' } })], incomplete: [] },
      contrast: { resolved: [resolved, { ...resolved, selector: '.b', ratio: 7, reason: '' }], unresolved: [{ selector: '.c', why: 'covered', party: 'first' }], boundaries: [{ selector: '#in', ratio: 1.24, by: 'border #e5e7eb', via: null }, { selector: '#ok', ratio: 4.5, by: 'border', via: null }] },
    })], profile);
    assert.equal(r.state, 'fail');
    assert.deepEqual(r.evidence.map((e) => e.selector), ['#x', '.a', '.c', '#in']);
    assert.match(String(r.evidence[0].detail), /#b0b0b0 on #ffffff is 2\.16:1, needs 4\.5:1 \(axe\)/);
    assert.match(String(r.evidence[1].detail), /APCA Lc 40, advisory/);
    const ok = judgeContrast([page({ contrast: { resolved: [{ ...resolved, ratio: 9, reason: '' }], unresolved: [], boundaries: [{ selector: '#ok', ratio: 4.5, by: 'border', via: null }] } })], profile);
    assert.equal(ok.state, 'ok');
    assert.match(ok.detail, /1 incomplete text resolved from pixels.*1 text input with a 3:1 boundary/);
  });

  test('a11y.contrast counts third-party texts (an embedded frame) only when the profile forbids external requests', () => {
    const third = { selector: 'iframe | .x', ratio: 2, required: 4.5, mode: 'css', why: 'bgImage', min: 2, median: 2, samples: 50, apca: 20, fg: '#999999', bg: '#ffffff', reason: '2:1 at worst', party: /** @type {const} */ ('third') };
    const rec = page({ contrast: { resolved: [third], unresolved: [{ selector: 'iframe | .y', why: 'covered', party: 'third' }], boundaries: [] } });
    const strict = judgeContrast([rec], defaultProfile({ external_requests: false }));
    assert.equal(strict.state, 'fail');
    assert.deepEqual(strict.evidence.map((e) => e.selector), ['iframe | .x', 'iframe | .y']);
    const allowed = judgeContrast([rec], defaultProfile({ external_requests: true }));
    assert.equal(allowed.state, 'ok', allowed.detail);
    assert.match(allowed.detail, /0 incomplete texts resolved/);
  });

  test('a11y.targets fails on target-size violations and lists incomplete ones for review', () => {
    const r = judgeTargets([page({ axe: { violations: [axeItem('target-size', { message: 'Target has insufficient size (12px by 12px)' })], incomplete: [] } })], profile);
    assert.equal(r.state, 'fail');
    assert.match(String(r.evidence[0].detail), /12px by 12px/);
    const review = judgeTargets([page({ axe: { violations: [], incomplete: [axeItem('target-size')] } })], profile);
    assert.equal(review.state, 'ok');
    assert.equal(review.evidence.length, 1);
  });

  test('a page that never became ready fails every gate; console and requests still report what they saw', () => {
    const stuck = page({ loadError: 'page not ready after 700 ms at /: window.__FRONTEND_READY__ is not true', consoleErrors: [{ type: 'error', text: 'boom', url: BASE, line: 1, party: 'first' }] });
    for (const id of GATE_IDS) {
      const r = judgeGate(id, [{ ...stuck, narrow: true }], profile);
      assert.equal(r.state, 'fail', id);
      assert.equal(r.evidence[0].value, 'not-ready', id);
    }
    assert.equal(judgeConsole([stuck], profile).evidence.length, 2);
  });

  test('a measurement error never passes: skipped alone, noted beside real failures', () => {
    const broken = page({ errors: { 'render.fonts': 'font check failed: Protocol error' } });
    const skipped = judgeFonts([broken]);
    assert.equal(skipped.state, 'skipped');
    assert.match(skipped.detail, /could not measure 1 of 1 page load: font check failed: Protocol error \(\/ at desktop\)/);
    const failing = page({ fonts: { faces: [{ family: 'X', status: 'error', weight: '400', style: 'normal' }], nodes: [], note: null } });
    const mixed = judgeFonts([failing, { ...broken, viewport: 'mobile' }]);
    assert.equal(mixed.state, 'fail');
    assert.match(mixed.detail, /1 page load could not be measured$/);
  });

  test('evidence is capped, with a line saying how many were left out', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ type: 'error', text: `e${i}`, url: BASE, line: 1, party: /** @type {const} */ ('first') }));
    const r = judgeConsole([page({ consoleErrors: many })], profile);
    assert.equal(r.evidence.length, 41);
    assert.equal(r.evidence[40].detail, '10 more not listed');
  });
});

describe('qa: run() without a target, and the report', () => {
  test('without a target URL or a browser every requested gate is skipped, and a skipped gate makes the report not ok', async () => {
    /** @type {import('../../qa.mjs').CheckContext} */
    const ctx = { root: FIXTURES, profile, state: null, design: path.join(FIXTURES, 'design'), routes: [{ path: '/', name: 'home', first: true, features: [], states: [] }], baseUrl: null, browser: null, viewports: profile.viewports, args: {}, log: () => undefined };
    const noTarget = await run(ctx, ['render', 'a11y.axe']);
    assert.deepEqual(noTarget.map((r) => [r.id, r.state]), [...GATE_IDS.filter((id) => id.startsWith('render.')), 'a11y.axe'].map((id) => [id, 'skipped']));
    assert.match(noTarget[0].detail, /no target: pass --url <url> or --serve <dir>/);
    const noBrowser = await run({ ...ctx, baseUrl: BASE }, ['render.console']);
    assert.match(noBrowser[0].detail, /no browser/);
    assert.deepEqual(await run(ctx, ['tokens.valid']), []);
    const report = aggregate([...noBrowser], { requested: ['render.console'] });
    assert.equal(report.ok, false);
    assert.equal(report.counts.skipped, 1);
    assert.equal(aggregate(noBrowser, { allowSkip: ['render'] }).ok, true, '--allow-skip render lets it through');
  });
});

describe('qa: CLI context', () => {
  const root = FIXTURES;
  const noLog = () => undefined;

  test('needs exactly one target, known gates, known viewports and a sane timeout', () => {
    assert.throws(() => cliContext({ root }, noLog), (e) => e instanceof UsageError && /--url <running app> or --serve/.test(e.message));
    assert.throws(() => cliContext({ root, url: BASE, serve: 'x' }, noLog), (e) => e instanceof UsageError && /not both/.test(e.message));
    assert.throws(() => cliContext({ root, url: 'ftp://x' }, noLog), (e) => e instanceof UsageError && /http:\/\/ or https:\/\//.test(e.message));
    assert.throws(() => cliContext({ root, url: 'nope' }, noLog), (e) => e instanceof UsageError && /not a valid URL/.test(e.message));
    assert.throws(() => cliContext({ root, url: BASE, gates: 'render.nope' }, noLog), (e) => e instanceof UsageError && /unknown gate render\.nope/.test(e.message));
    assert.throws(() => cliContext({ root, url: BASE, viewports: 'tablet' }, noLog), (e) => e instanceof UsageError && /unknown viewport tablet; the profile has desktop, mobile, reflow/.test(e.message));
    assert.throws(() => cliContext({ root, url: BASE, timeout: '5' }, noLog), (e) => e instanceof UsageError && /--timeout/.test(e.message));
    assert.throws(() => cliContext({ root, url: BASE, routes: 'clean.html' }, noLog), (e) => e instanceof UsageError && /must start with "\/"/.test(e.message));
  });

  test('builds the same context frontend-check would, with route and viewport filters', () => {
    const { ctx, ids, allowSkip, out, serve } = cliContext({ root, url: BASE, gates: 'a11y,render.cls', routes: '/clean.html,/fail-cls.html', viewports: 'mobile', timeout: '9000', 'allow-skip': ['a11y.targets'], out: 'reports' }, noLog);
    assert.deepEqual(ids, ['render.cls', 'a11y.axe', 'a11y.contrast', 'a11y.targets']);
    assert.deepEqual(ctx.routes.map((r) => [r.path, r.first]), [['/clean.html', true], ['/fail-cls.html', false]]);
    assert.deepEqual(ctx.viewports.map((v) => v.name), ['mobile']);
    assert.equal(ctx.args.timeoutMs, 9000);
    assert.equal(ctx.baseUrl, BASE);
    assert.equal(ctx.design, path.join(root, 'design').replace(/\\/g, '/'));
    assert.deepEqual(allowSkip, ['a11y.targets']);
    assert.equal(out, path.resolve('reports'));
    assert.equal(serve, null);
    assert.equal(ctx.state, null);
  });
});

describe('qa: CLI usage (no browser starts)', () => {
  const script = fileURLToPath(new URL('../../qa.mjs', import.meta.url));
  /** @param {string[]} args */
  const cli = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 60000 });

  test('--help prints the usage, every gate and the exit codes, and exits 0', () => {
    const r = cli(['--help']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^Usage: node qa\.mjs \(--url <url> \| --serve <dir>\)/);
    for (const id of GATE_IDS) assert.ok(r.stdout.includes(id), id);
    assert.match(r.stdout, /Exit codes: 0 every requested gate ok; 1 a gate failed or was skipped; 2 usage error; 3 environment error/);
  });

  test('usage errors exit 2 with a message that says what to do', () => {
    const missingTarget = cli(['--root', FIXTURES]);
    assert.equal(missingTarget.status, 2);
    assert.match(missingTarget.stderr, /pass the target: --url <running app> or --serve <static build folder>/);
    const badGate = cli(['--root', FIXTURES, '--url', BASE, '--gates', 'render.nope']);
    assert.equal(badGate.status, 2);
    assert.match(badGate.stderr, /unknown gate render\.nope/);
    const missingFolder = cli(['--root', FIXTURES, '--serve', path.join(FIXTURES, 'no-such-build')]);
    assert.equal(missingFolder.status, 2);
    assert.match(missingFolder.stderr, /folder to serve not found/);
    const unknownFlag = cli(['--bogus']);
    assert.equal(unknownFlag.status, 2);
    assert.match(unknownFlag.stderr, /run with --help for usage/);
  });
});
