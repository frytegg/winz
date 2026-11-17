// @ts-check
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { defaultProfile } from '../../lib/profile.mjs';
import { loadAllowlists, loadRegistry, runStatic, staticContext } from '../../rules/load.mjs';
import * as g02 from '../../rules/static/SL-G02.mjs';
import { reachable } from '../../rules/static/SL-G04.mjs';

/**
 * @typedef {import('../../rules/load.mjs').StaticFinding} StaticFinding
 * @typedef {import('../../rules/load.mjs').Rule} Rule
 */

const FIXTURES = fileURLToPath(new URL('../fixtures/rules/', import.meta.url));
const STATIC_DIR = fileURLToPath(new URL('../../rules/static/', import.meta.url));
const FAMILIES = new Set(['missing-tell', 'claude-era', 'generator', 'invented', 'motion']);
const registry = loadRegistry();
const mine = registry.rules.filter((r) => FAMILIES.has(r.family));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-static-other-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

/**
 * Findings of the given rules on a folder, through the loader's own context and runner. Fails on any detector error.
 * @param {string} root
 * @param {Rule[]} rules
 * @param {Record<string, unknown>} [profileOverrides]
 * @returns {Promise<StaticFinding[]>}
 */
async function run(root, rules, profileOverrides = {}) {
  const profile = defaultProfile(profileOverrides);
  const findings = await runStatic(rules, staticContext(root, profile, loadAllowlists(root, profile)));
  const errors = findings.filter((f) => 'error' in f);
  assert.deepEqual(errors, [], `detectors must not throw on ${root}`);
  return /** @type {StaticFinding[]} */ (findings);
}

/**
 * @param {string} id
 * @returns {Rule}
 */
function rule(id) {
  const found = registry.rules.find((r) => r.id === id);
  assert.ok(found, `${id} is in the registry`);
  return found;
}

/**
 * Writes a small repository under the temporary folder and returns its root.
 * @param {string} name
 * @param {Record<string, string | Buffer>} files
 * @returns {string}
 */
function repo(name, files) {
  const root = path.join(tmp, name);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  return root;
}

/** Sorted `file:line` of every finding on each fixture folder (positives pinned, negatives silent). */
const EXPECTED = /** @type {Record<string, Record<string, string[]>>} */ ({
  'SL-M01': { 'static-neg': [], 'static-neg-knob': [], 'static-pos': ['src/theme.css:2'] },
  'SL-M02': { 'static-neg': [], 'static-pos': ['src/Landing.tsx:13', 'src/Landing.tsx:5', 'src/Landing.tsx:9'] },
  'SL-M03': { 'static-neg': [], 'static-pos': ['src/Steps.tsx:12', 'src/Steps.tsx:2', 'src/sections.css:6'] },
  'SL-M04': { 'static-neg': [], 'static-pos': ['src/Stats.tsx:5', 'src/Ticker.tsx:4'] },
  'SL-M05': { 'static-neg': [], 'static-pos': ['src/Social.tsx:1', 'src/Social.tsx:2', 'src/Social.tsx:9'] },
  'SL-M06': { 'static-neg': [], 'static-pos': ['src/Faq.tsx:4'] },
  'SL-M07': { 'static-neg': [], 'static-pos': ['src/Features.tsx:7'] },
  'SL-M08': { 'static-neg': [], 'static-pos': ['app/globals.css:11', 'app/globals.css:6', 'src/App.tsx:3'] },
  'SL-M09': { 'static-neg': [], 'static-pos': ['src/Hero.tsx:4', 'src/Hero.tsx:5', 'src/Hero.tsx:7', 'src/glow.css:2'] },
  'SL-M10': { 'static-neg': [], 'static-pos': ['src/Logos.tsx:5', 'src/ticker.css:1'] },
  'SL-M11': { 'static-neg': [], 'static-pos': ['src/Bento.tsx:3', 'src/Showcase.tsx:1'] },
  'SL-M12': { 'static-neg': [], 'static-pos': ['src/Hero.tsx:4'] },
  'SL-M13': {
    'static-neg': [], 'static-neg-data': [],
    'static-pos': ['src/Chrome.tsx:10', 'src/Chrome.tsx:12', 'src/Chrome.tsx:13', 'src/Chrome.tsx:14', 'src/Chrome.tsx:4',
      'src/Chrome.tsx:5', 'src/Chrome.tsx:6', 'src/Chrome.tsx:7', 'src/Chrome.tsx:8'],
  },
  'SL-M14': { 'static-neg': [], 'static-pos': ['src/Live.tsx:4', 'src/bg.css:3', 'src/bg.css:8'] },
  'SL-M15': { 'static-neg': [], 'static-pos': ['src/Dashboard.tsx:10', 'src/Dashboard.tsx:7'] },
  'SL-M16': { 'static-neg': [], 'static-pos': ['src/Illustration.tsx:20', 'src/Illustration.tsx:25', 'src/Illustration.tsx:4'] },
  'SL-M17': { 'static-neg': [], 'static-pos': ['src/Hero.tsx:1', 'src/Hero.tsx:7', 'src/Hero.tsx:9', 'src/Landing.tsx:26'] },
  'SL-C01': { 'static-neg': [], 'static-pos': ['src/Buttons.tsx:4'], 'static-pos-primitive': ['src/components/ui/button.tsx:3'] },
  'SL-C02': { 'static-neg': [], 'static-pos': ['src/Hero.tsx:3', 'src/hero.css:1'] },
  'SL-G01': { 'static-neg': [], 'static-pos': ['src/components/figma/ImageWithFallback.tsx:1'] },
  'SL-G02': {
    'static-neg': [], 'static-neg-v0': [],
    'static-pos-v0': ['app/layout.tsx:5', 'app/layout.tsx:9', 'public/placeholder-logo.svg:0', 'public/placeholder-user.jpg:0'],
    'static-pos': ['app/globals.css:8', 'app/layout.tsx:1', 'app/layout.tsx:7', 'index.html:6', 'package.json:5',
      'public/favicon.svg:1', 'src/App.tsx:11', 'src/App.tsx:7', 'src/App.tsx:9', 'src/index.css:2'],
  },
  'SL-G03': {
    'static-neg': [],
    'static-pos': ['src/Connect.tsx:10', 'src/Connect.tsx:11', 'src/Connect.tsx:5', 'src/Connect.tsx:8', 'src/Connect.tsx:9',
      'src/Providers.tsx:4', 'src/config.ts:2', 'src/config.ts:3'],
  },
  'SL-G04': { 'static-neg': [], 'static-pos': ['src/Hero.tsx:10', 'src/Hero.tsx:11', 'src/Hero.tsx:9'] },
  'SL-X01': { 'static-neg': [], 'static-pos': ['src/Hero.tsx:4', 'src/Hero.tsx:5', 'src/Hero.tsx:6', 'src/Stats.tsx:3', 'src/Stats.tsx:4', 'src/Stats.tsx:5'] },
  'SL-X02': {
    'static-neg': [],
    'static-pos': ['src/About.tsx:1', 'src/About.tsx:1', 'src/About.tsx:6', 'src/About.tsx:6', 'src/About.tsx:7',
      'src/About.tsx:8', 'src/About.tsx:9'],
  },
  'SL-MO1': { 'static-neg': [], 'static-pos': ['src/Pay.tsx:4', 'src/Pay.tsx:5', 'src/styles.css:2', 'src/styles.css:6'] },
  'SL-MO2': { 'static-neg': [], 'static-pos': ['src/Menu.tsx:6', 'src/Menu.tsx:7', 'src/anim.css:13', 'src/anim.css:17'] },
  'SL-MO3': { 'static-neg': [], 'static-pos': ['src/Panel.tsx:6', 'src/Panel.tsx:7', 'src/styles.css:2', 'src/styles.css:6'] },
  'SL-MO4': { 'static-neg': [], 'static-pos': ['src/Tip.tsx:6', 'src/Tip.tsx:7', 'src/pop.css:1', 'src/pop.css:13'] },
  'SL-MO5': { 'static-neg': [], 'static-pos': ['src/Hero.tsx:6', 'src/anim.css:7'] },
});

test('every static detector of the missing-tell, claude-era, generator, invented and motion families exists, with fixtures', () => {
  const flagged = mine.filter((r) => r.static).map((r) => r.id);
  assert.equal(flagged.length, 30, 'M01-M17, C01-C02, G01-G04, X01-X02, MO1-MO5');
  assert.deepEqual(Object.keys(EXPECTED).sort(), [...flagged].sort(), 'every flagged rule has pinned expectations');
  for (const id of flagged) {
    assert.ok(existsSync(path.join(STATIC_DIR, `${id}.mjs`)), `rules/static/${id}.mjs exists`);
    const dirs = readdirSync(path.join(FIXTURES, id)).filter((d) => d.startsWith('static-'));
    assert.ok(dirs.some((d) => d.startsWith('static-pos')), `${id} has a positive fixture`);
    assert.ok(dirs.includes('static-neg'), `${id} has a negative fixture`);
  }
  for (const r of mine.filter((x) => !x.static)) {
    assert.ok(!existsSync(path.join(STATIC_DIR, `${r.id}.mjs`)), `${r.id} has static: false and no static detector`);
  }
});

for (const [id, dirs] of Object.entries(EXPECTED)) {
  test(`${id} fires on its positive fixtures and stays silent on its negative one`, async () => {
    for (const [dir, expected] of Object.entries(dirs)) {
      const findings = await run(path.join(FIXTURES, id, dir), [rule(id)]);
      assert.deepEqual(findings.map((f) => `${f.file}:${f.line}`).sort(), [...expected].sort(), `${id} ${dir}`);
      for (const f of findings) {
        assert.equal(f.rule, id);
        assert.equal(f.layer, 'static');
        assert.ok(f.excerpt.length > 0 && f.excerpt.length <= 120, `${id} ${f.file}:${f.line} excerpt`);
        assert.ok(f.detail.length > 20, `${id} ${f.file}:${f.line} explains itself`);
        assert.notEqual(f.value, '', `${id} ${f.file}:${f.line} carries a value`);
      }
    }
  });
}

test('findings carry the values a fixer needs', async () => {
  const [m01] = await run(path.join(FIXTURES, 'SL-M01', 'static-pos'), [rule('SL-M01')]);
  assert.deepEqual(m01.value, { ground: '#f4f1ea', accent: '#d97757', serif: 'fraunces' });
  const [c01] = await run(path.join(FIXTURES, 'SL-C01', 'static-pos'), [rule('SL-C01')]);
  assert.deepEqual(c01.value, { pills: 3, buttons: 4, primitive: false });
  const [primitive] = await run(path.join(FIXTURES, 'SL-C01', 'static-pos-primitive'), [rule('SL-C01')]);
  assert.deepEqual(primitive.value, { pills: 2, buttons: 3, primitive: true }, 'an explicit rounded-md override is not a pill');
  const [g01] = await run(path.join(FIXTURES, 'SL-G01', 'static-pos'), [rule('SL-G01')]);
  assert.equal(/** @type {string[]} */ (g01.value).length, 7, 'all seven Figma Make signatures are listed');
  assert.match(g01.detail, /Insurance DApp Frontend Design/);
  const g02 = await run(path.join(FIXTURES, 'SL-G02', 'static-pos'), [rule('SL-G02')]);
  assert.deepEqual(g02.find((f) => f.file === 'public/favicon.svg')?.value, { template: "create-vite's purple logo (fill #863bff)", match: 'fingerprint' });
  const g04 = await run(path.join(FIXTURES, 'SL-G04', 'static-pos'), [rule('SL-G04')]);
  assert.deepEqual(g04.map((f) => /** @type {{component: string}} */ (f.value).component).sort(), ['BlurText', 'MagicCard', 'Spotlight'],
    'the unmounted AnimatedContent import does not count');
  const g03 = await run(path.join(FIXTURES, 'SL-G03', 'static-pos'), [rule('SL-G03')]);
  assert.deepEqual(g03.find((f) => f.line === 8 && f.file === 'src/Connect.tsx')?.value,
    ['onConnectError (defaults to alert())', "dAppName (defaults to 'Awesome DApp')"]);
});

test('tells written only in comments never fire', async () => {
  const root = repo('comments-only', {
    'src/Commented.tsx': [
      '// <Marquee> lorem ipsum John Doe TODO example.com Awesome DApp alert( Create Next App #aa3bff',
      '/* className="transition-all rounded-full animate-pulse size-2 bg-purple-500 blur-3xl absolute duration-700 scale-0" */',
      'export function Commented() {',
      '  return <div>{/* Vite + React · Trusted by · Built for the modern · 01 02 03 → → → */}</div>;',
      '}',
      '',
    ].join('\n'),
    'src/commented.css': [
      '/* .btn { transition: all .3s } @keyframes marquee { to { transform: translateX(-50%) } }',
      '   body { background: #0a0a0a } .x { box-shadow: 0 0 40px rgba(59,130,246,.5) } */',
      '.ok { color: #1b1b1b; }',
      '',
    ].join('\n'),
    'index.html': '<!doctype html>\n<!-- <title>Vite + React</title> lorem ipsum -->\n<title>Orma</title>\n',
  });
  const findings = await run(root, mine.filter((r) => r.static));
  assert.deepEqual(findings.map((f) => `${f.rule} ${f.file}:${f.line}`), []);
});

test('a compiled Tailwind bundle is never read as source, even behind an @import (Figma Make exports)', async () => {
  const bundle = [
    '@charset "utf-8";',
    '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&display=swap");',
    '/*! tailwindcss v4.1.3 | MIT License | https://tailwindcss.com */',
    ':root { --background: oklch(.145 0 0); }',
    'body { background: #0a0a0a; }',
    '.a { transition: all .7s ease-in; transform: scale(0); }',
    '.b { box-shadow: 0 0 40px rgba(124, 58, 237, .6); filter: blur(64px); }',
    '@keyframes marquee { to { transform: translateX(-50%); } }',
    '.c { font-family: ui-monospace, monospace; text-transform: uppercase; font-size: 10px; letter-spacing: .2em; }',
    '',
  ].join('\n');
  const root = repo('compiled-bundle', { 'src/index.css': bundle });
  assert.deepEqual((await run(root, mine.filter((r) => r.static))).map((f) => `${f.rule} ${f.file}:${f.line}`), []);
  const source = repo('same-css-as-source', { 'src/index.css': bundle.split('\n').slice(3).join('\n') });
  assert.ok((await run(source, mine.filter((r) => r.static))).length > 0, 'the same rules fire on the same CSS written as source');
});

test('copy rules skip test and story files but read demo data in mocks/', async () => {
  const root = repo('tests-and-mocks', {
    'src/__tests__/About.test.tsx': "export const u = { name: 'John Doe' };\nexport const T = () => <h1>Built for the modern web</h1>;\n",
    'src/Button.stories.tsx': 'export const S = () => <p>Lorem ipsum</p>;\n',
    'src/mocks/agents.ts': "export const agents = [{ name: 'Jane Doe', role: 'Analyst' }];\n",
  });
  const findings = await run(root, [rule('SL-X02'), rule('SL-M17')]);
  assert.deepEqual(findings.map((f) => `${f.rule} ${f.file}:${f.line} ${String(f.value)}`), ['SL-X02 src/mocks/agents.ts:1 Jane Doe']);
});

test('SL-G02 never reads favicons in dependencies, builds or the private workspace', async () => {
  const fill = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#863bff" d="M0 0h1v1H0z"/></svg>\n';
  const root = repo('favicon-excludes', {
    'node_modules/pkg/favicon.svg': fill,
    'dist/favicon.svg': fill,
    'private/captures/favicon.svg': fill,
    'public/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M0 0h1v1H0z"/></svg>\n',
  });
  assert.deepEqual(await run(root, [rule('SL-G02')], { workspace: { private_dir: path.join(root, 'private') } }), []);
  const without = await run(root, [rule('SL-G02')]);
  assert.deepEqual(without.map((f) => f.file), ['private/captures/favicon.svg'], 'only the profile excludes that folder');
});

test('SL-G02 still reports text leftovers when the context has no root', async () => {
  const root = path.join(FIXTURES, 'SL-G02', 'static-pos');
  const profile = defaultProfile();
  const { root: _root, ...rest } = staticContext(root, profile, loadAllowlists(root, profile));
  const findings = g02.detect(/** @type {import('../../rules/load.mjs').StaticContext} */ (/** @type {unknown} */ (rest)));
  assert.equal(findings.length, 9);
  assert.ok(findings.every((f) => f.file !== 'public/favicon.svg'));
});

test('SL-G02 knows the template hashes FD12-F27 recorded, plus the observed earlier Next favicon', () => {
  const hashes = g02.TEMPLATE_FILES.map((t) => t.sha256);
  assert.ok(hashes.includes('61bc9a161de58248288e6905425d7180f0624c2865007b97d763fdac12043a66'), "create-vite's favicon.svg");
  assert.ok(hashes.includes('ceeac38434be7a3b'), "create-vite's vanilla copy, by prefix");
  assert.ok(hashes.includes('c28fdd2a4f31e2dc64f653962286da5c82a4cdfc518b242d32812c624e9a19a4'), "create-next-app's favicon.ico");
  assert.ok(g02.TEMPLATE_FILES.every((t) => /^[0-9a-f]{16}$|^[0-9a-f]{64}$/.test(t.sha256) && t.template && t.source));
  assert.equal(g02.TEMPLATE_PIXELS.size, 4);
});

test('SL-G02 normalises SVG text before hashing and fingerprints the create-vite logo', () => {
  const clean = '<svg>\n  <path fill="#863BFF"/>\n</svg>';
  assert.equal(g02.normaliseSvg('<svg>  \r\n  <path fill="#863BFF"/>\t\r\n</svg>\r\n\r\n'), clean);
  assert.equal(g02.normaliseSvg(`﻿${clean}\n`), clean);
  const crlf = Buffer.from(clean.replace(/\n/g, '\r\n'));
  assert.deepEqual(g02.templateIcon(crlf, 'favicon.svg'), { template: "create-vite's purple logo (fill #863bff)", match: 'fingerprint', line: 2 });
  assert.equal(g02.templateIcon(Buffer.from('<svg><path fill="#863bfe"/></svg>'), 'favicon.svg'), null);
  assert.equal(g02.templateIcon(Buffer.from('not an image'), 'favicon.ico'), null, 'undecodable rasters are no match, not an error');
});

/** Four RGBA pixels (2x2): opaque red, half-transparent green, a hidden blue pixel, opaque dark slate. */
const PIXELS = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 10, 20, 30, 255]);

/**
 * A one-entry ICO holding a 32-bit or 24-bit BMP of `rgba` (rows bottom-up, BGRA, then the AND mask).
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba
 * @param {32 | 24} bpp
 * @returns {Buffer}
 */
function bmpIco(width, height, rgba, bpp = 32) {
  const stride = Math.ceil((width * bpp) / 32) * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  const dib = Buffer.alloc(40 + stride * height + maskStride * height);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(width, 4);
  dib.writeInt32LE(height * 2, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(bpp, 14);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4;
      const dst = 40 + (height - 1 - y) * stride + x * (bpp / 8);
      dib[dst] = rgba[src + 2];
      dib[dst + 1] = rgba[src + 1];
      dib[dst + 2] = rgba[src];
      if (bpp === 32) dib[dst + 3] = rgba[src + 3];
      if (rgba[src + 3] === 0) dib[40 + stride * height + (height - 1 - y) * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  const head = Buffer.alloc(22);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(1, 4);
  head[6] = width;
  head[7] = height;
  head.writeUInt16LE(bpp, 12);
  head.writeUInt32LE(dib.length, 14);
  head.writeUInt32LE(22, 18);
  return Buffer.concat([head, dib]);
}

/**
 * A PNG of 8-bit RGBA rows, every row encoded with the given filter (0 none, 1 sub, 2 up, 3 average, 4 Paeth).
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba
 * @param {number} filter
 * @returns {Buffer}
 */
function rgbaPng(width, height, rgba, filter) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i += 1) {
      const value = rgba[y * stride + i];
      const a = i >= 4 ? rgba[y * stride + i - 4] : 0;
      const b = y > 0 ? rgba[(y - 1) * stride + i] : 0;
      const c = i >= 4 && y > 0 ? rgba[(y - 1) * stride + i - 4] : 0;
      const pa = Math.abs(b - c);
      const pb = Math.abs(a - c);
      const pc = Math.abs(a + b - 2 * c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const predicted = [0, a, b, (a + b) >> 1, paeth][filter];
      raw[y * (stride + 1) + 1 + i] = (value - predicted) & 0xff;
    }
  }
  return png(width, height, 8, 6, raw);
}

/**
 * @param {number} width
 * @param {number} height
 * @param {number} depth
 * @param {number} type
 * @param {Buffer} rows filtered scanlines
 * @param {Array<[string, Buffer]>} [extra] chunks before IDAT
 * @returns {Buffer}
 */
function png(width, height, depth, type, rows, extra = []) {
  /** @param {string} kind @param {Buffer} body @returns {Buffer} */
  const chunk = (kind, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    return Buffer.concat([length, Buffer.from(kind, 'latin1'), body, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = type;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...extra.map(([kind, body]) => chunk(kind, body)),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('SL-G02 decodes BMP icon entries and PNGs to the same pixels, whatever the encoder', () => {
  const [fromIco] = g02.decodeIcon(bmpIco(2, 2, PIXELS));
  assert.deepEqual({ width: fromIco.width, height: fromIco.height }, { width: 2, height: 2 });
  assert.deepEqual([...fromIco.rgba], [...PIXELS]);
  const reference = g02.pixelHash(fromIco);
  for (const filter of [0, 1, 2, 3, 4]) {
    const [fromPng] = g02.decodeIcon(rgbaPng(2, 2, PIXELS, filter));
    assert.deepEqual([...fromPng.rgba], [...PIXELS], `PNG filter ${filter}`);
    assert.equal(g02.pixelHash(fromPng), reference, `PNG filter ${filter} hashes like the BMP entry`);
  }
  const hiddenColour = Uint8Array.from(PIXELS);
  hiddenColour.set([200, 100, 50], 8);
  assert.equal(g02.pixelHash({ width: 2, height: 2, rgba: hiddenColour }), reference, 'colour under alpha 0 is ignored');
  const [opaque24] = g02.decodeIcon(bmpIco(2, 2, PIXELS, 24));
  assert.deepEqual([...opaque24.rgba.filter((_, i) => i % 4 === 3)], [255, 255, 0, 255], '24-bit alpha comes from the AND mask');
});

test('SL-G02 decodes palette and 16-bit greyscale PNGs', () => {
  const palette = Buffer.from([255, 0, 0, 0, 0, 255]);
  const alpha = Buffer.from([255, 0]);
  const packed = Buffer.from([0, 0x10, 0, 0x01]);
  const [indexed] = g02.decodeIcon(png(2, 2, 4, 3, packed, [['PLTE', palette], ['tRNS', alpha]]));
  assert.deepEqual([...indexed.rgba], [0, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 0], 'rows 0x10 and 0x01 hold indices 1,0 and 0,1');
  const grey = Buffer.from([0, 0x80, 0x01, 0xff, 0xff]);
  const [sixteen] = g02.decodeIcon(png(2, 1, 16, 0, grey));
  assert.deepEqual([...sixteen.rgba], [0x80, 0x80, 0x80, 255, 0xff, 0xff, 0xff, 255]);
  assert.deepEqual(g02.decodeIcon(Buffer.from([0, 0, 1, 0, 1, 0])), [], 'an ICO with a truncated directory yields nothing');
});

test('SL-G04 counts only components a page can reach, including next/dynamic imports', async () => {
  const root = repo('reachability', {
    'src/main.tsx': "import { App } from './App';\nexport const root = <App />;\n",
    'src/App.tsx': "import { Hero } from './Hero';\nexport function App() {\n  return <Hero />;\n}\n",
    'src/Hero.tsx': [
      "import dynamic from 'next/dynamic';",
      "import BlurText from './BlurText';",
      "const DotGrid = dynamic(() => import('@/components/DotGrid'), { ssr: false });",
      'export function Hero() {',
      '  return (<><BlurText text="Hi" /><DotGrid dotSize={4} /></>);',
      '}',
      '',
    ].join('\n'),
    'src/Unused.tsx': "import { MagicCard } from '@/components/magicui/magic-card';\nexport function Unused() {\n  return <MagicCard>never mounted</MagicCard>;\n}\n",
  });
  const profile = defaultProfile();
  const ctx = staticContext(root, profile, loadAllowlists(root, profile));
  assert.deepEqual([...reachable(ctx.files)].sort(), ['src/App.tsx', 'src/Hero.tsx', 'src/main.tsx']);
  const findings = await run(root, [rule('SL-G04')]);
  assert.deepEqual(findings.map((f) => /** @type {{component: string}} */ (f.value).component).sort(), ['BlurText', 'DotGrid']);
});
