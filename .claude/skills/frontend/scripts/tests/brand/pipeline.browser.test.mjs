// @ts-check
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  Renderer, buildIcons, darkModeReport, decodePng, imageInfo, lintMark, parseIco, renderCandidate, renderOg, renderSheet,
} from '../../brand.mjs';
import { iconInkRadius } from '../../brand-check.mjs';
import { launch } from '../../lib/browser.mjs';

const MARKS = fileURLToPath(new URL('../fixtures/brand/marks/', import.meta.url));
const CONSOLAS = 'C:/Windows/Fonts/consola.ttf';
/** @param {string} name */
const read = (name) => readFileSync(`${MARKS}${name}`, 'utf8');

/** @type {import('playwright-core').Browser} */
let browser;
/** @type {Renderer} */
let renderer;
const scratch = mkdtempSync(path.join(os.tmpdir(), 'fe-brand-pipeline-'));

/** @param {string} name @returns {Promise<Set<string>>} */
async function rasterIds(name) {
  const report = await lintMark(read(name), { renderer });
  return new Set(report.findings.map((f) => f.id));
}

describe('brand pipeline with Chromium', () => {
  before(async () => {
    browser = await launch();
    renderer = await Renderer.open({ browser });
  });

  after(async () => {
    await renderer?.close();
    await browser?.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  describe('raster lint', () => {
    const positives = /** @type {Record<string, string>} */ ({
      'thin-part.svg': 'thin-part',
      'thin-stroke.svg': 'thin-part',
      'narrow-gap.svg': 'narrow-gap',
      'occluded.svg': 'occluded',
      'duplicate.svg': 'occluded',
      'split.svg': 'split-letters',
      'tile-thin.svg': 'thin-part',
    });
    for (const [file, id] of Object.entries(positives)) {
      test(`${file} raises ${id}`, async () => {
        assert.ok((await rasterIds(file)).has(id));
      });
    }

    test('thin features inside a solid tile are found per colour layer', async () => {
      const report = await lintMark(read('tile-thin.svg'), { renderer });
      const details = report.findings.filter((f) => f.id === 'thin-part').map((f) => f.detail);
      assert.ok(details.some((d) => /#eae0ce part/.test(d)), details.join(' | '));
    });

    for (const file of ['good.svg', 'good-attr.svg', 'disc.svg', 'triangle.svg', 'hexagon.svg', 'cube.svg']) {
      test(`${file} raises no raster finding`, async () => {
        const ids = await rasterIds(file);
        for (const id of ['thin-part', 'narrow-gap', 'occluded', 'split-letters', 'empty']) assert.ok(!ids.has(id), `${file} raised ${id}`);
      });
    }
  });

  describe('render', () => {
    test('renders the research mark with the research numbers: solid share 1, 1, 0.934, 1 (FD12-F16)', async () => {
      const out = path.join(scratch, 'render-good');
      const record = await renderCandidate(renderer, read('good.svg'), out, `${MARKS}good.svg`);
      assert.deepEqual(Object.fromEntries(Object.entries(record.metrics).map(([s, m]) => [s, m.solidShare])), { 16: 1, 32: 1, 180: 0.934, 512: 1 });
      assert.equal(record.metrics['16'].inkPx, 88);
      assert.equal(record.metrics['32'].inkPx, 352);
      assert.equal(record.maskable.inside, true);
      assert.deepEqual([record.dark.present, record.dark.light, record.dark.dark], [true, '#14161a', '#f4f1ea']);
      assert.ok(Number(record.contrast.light) > 15 && Number(record.contrast.dark) > 12);
      for (const s of [16, 32, 180, 512]) {
        for (const kind of ['mark', 'silhouette-light', 'silhouette-dark']) {
          assert.deepEqual(imageInfo(readFileSync(path.join(out, `${kind}-${s}.png`))), { format: 'png', width: s, height: s });
        }
      }
      assert.deepEqual(imageInfo(readFileSync(path.join(out, 'zoom-16.png'))), { format: 'png', width: 256, height: 256 });
      const silhouette = decodePng(readFileSync(path.join(out, 'silhouette-dark-32.png')));
      const inBar = (8 * 32 + 8) * 4;
      const inGap = (16 * 32 + 8) * 4;
      assert.deepEqual([...silhouette.data.subarray(inBar, inBar + 4)], [255, 255, 255, 255], 'white ink on the dark ground');
      assert.deepEqual([...silhouette.data.subarray(inGap, inGap + 4)], [32, 33, 36, 255], 'the dark tab grey between the bars');
      assert.ok(existsSync(path.join(out, 'render.json')));
    });

    test('a round mark scores a lower solid share at 16 px without being illegible', async () => {
      const record = await renderCandidate(renderer, read('disc.svg'), path.join(scratch, 'render-disc'), `${MARKS}disc.svg`, { sizes: [16, 32] });
      assert.ok(record.metrics['16'].solidShare < 0.9 && record.metrics['16'].solidShare > 0.5);
      assert.equal(record.dark.present, false);
    });
  });

  describe('icons', () => {
    test('emits the favicon set from a mark with a dark rule (FD12-F21 to F25)', async () => {
      const out = path.join(scratch, 'icons');
      const record = await buildIcons(renderer, read('good.svg'), { outDir: out, publicDir: out, layout: 'static', name: 'Holdover', bg: '#0b0e14', map: null, dark: null, ink: '#000000', base: '/' });
      const ico = parseIco(readFileSync(path.join(out, 'favicon.ico')));
      assert.deepEqual(ico.entries.map((e) => [e.width, e.height, e.bpp]), [[32, 32, 32]]);
      assert.equal(readFileSync(path.join(out, 'favicon.ico')).length, 4286, 'the research ICO size (FD12-F30)');
      const icon = readFileSync(path.join(out, 'icon.svg'), 'utf8');
      assert.deepEqual([darkModeReport(icon).present, darkModeReport(icon).matched], [true, true]);
      const apple = decodePng(readFileSync(path.join(out, 'apple-touch-icon.png')));
      assert.deepEqual([apple.width, apple.height], [180, 180]);
      for (let i = 3; i < apple.data.length; i += 4) assert.equal(apple.data[i], 255);
      assert.deepEqual([...apple.data.subarray(0, 3)], [11, 14, 20], 'the ground is the brand colour');
      const mask = decodePng(readFileSync(path.join(out, 'icon-mask.png')));
      assert.ok(iconInkRadius(mask) <= 204.8);
      const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.webmanifest'), 'utf8'));
      assert.deepEqual(manifest.icons.map((/** @type {any} */ i) => `${i.src} ${i.sizes} ${i.purpose ?? ''}`), ['/icon-192.png 192x192 ', '/icon-mask.png 512x512 maskable', '/icon-512.png 512x512 ']);
      assert.match(readFileSync(path.join(out, 'head.html'), 'utf8'), /<link rel="icon" href="\/favicon.ico" sizes="32x32">/);
      assert.equal(/** @type {any} */ (record.maskable).inner, 409);
    });

    test('shrinks a full-bleed mark until its ink fits the maskable safe zone (FD12-F23)', async () => {
      const square = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>@media (prefers-color-scheme:dark){.m{fill:#eee}}</style><rect class="m" width="32" height="32" rx="6" fill="#14161a"/></svg>';
      const record = await buildIcons(renderer, square, { outDir: path.join(scratch, 'icons-square'), publicDir: path.join(scratch, 'icons-square'), layout: 'static', name: 'Sq', bg: '#ffffff', map: null, dark: null, ink: '#000000', base: '/' });
      const maskable = /** @type {{inner: number, radius: number}} */ (record.maskable);
      assert.ok(maskable.inner < 409 && maskable.inner >= 280, `inner ${maskable.inner}`);
      assert.ok(maskable.radius <= 204.8);
    });

    test('adds a dark rule with --dark, refuses without one, and refuses a mark with hard lint failures', async () => {
      const plain = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="currentColor" d="M4 6h24v8H4zM4 18h14v8H4zM22 18h6v8h-6z"/></svg>';
      const base = { publicDir: path.join(scratch, 'icons-dark'), layout: /** @type {const} */ ('static'), name: 'X', bg: '#ffffff', map: null, ink: '#14161a', base: '/' };
      await assert.rejects(buildIcons(renderer, plain, { ...base, outDir: path.join(scratch, 'icons-dark'), dark: null }), (err) => err instanceof Error && err.name === 'UsageError' && /dark-mode rule/.test(err.message));
      await buildIcons(renderer, plain, { ...base, outDir: path.join(scratch, 'icons-dark'), dark: '#f4f1ea' });
      const icon = readFileSync(path.join(scratch, 'icons-dark', 'icon.svg'), 'utf8');
      assert.deepEqual(darkModeReport(icon).colours, ['#f4f1ea']);
      assert.match(icon, /fill="#14161a"/);
      await assert.rejects(buildIcons(renderer, read('text.svg'), { ...base, outDir: path.join(scratch, 'icons-bad'), dark: '#fff' }), (err) => err instanceof Error && err.name === 'CheckError' && /hard lint failures \(text/.test(err.message));
    });

    test('the Next.js layout puts favicon.ico, icon.svg, apple-icon.png and the manifest in app/', async () => {
      const app = path.join(scratch, 'next', 'app');
      const pub = path.join(scratch, 'next', 'public');
      await buildIcons(renderer, read('good.svg'), { outDir: app, publicDir: pub, layout: 'next', name: 'N', bg: '#ffffff', map: null, dark: null, ink: '#000000', base: '/' });
      for (const f of ['favicon.ico', 'icon.svg', 'apple-icon.png', 'manifest.webmanifest']) assert.ok(existsSync(path.join(app, f)), f);
      for (const f of ['icon-192.png', 'icon-512.png', 'icon-mask.png']) assert.ok(existsSync(path.join(pub, f)), f);
      assert.ok(!existsSync(path.join(app, 'head.html')));
    });
  });

  describe('og', () => {
    test('renders a 1200x630 card from the mark, the wordmark and the line in the given face', { skip: !existsSync(CONSOLAS) && 'no Consolas on this machine' }, async () => {
      const wordmark = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 24"><path fill="currentColor" d="M0 0h120v24H0z"/></svg>';
      const { png, fontSize } = await renderOg({ mark: read('good.svg'), wordmark, line: 'Every downstream consumer of a share ratio, and how many hours it is behind.', fontFile: CONSOLAS, bg: '#ffffff', fg: '#111111', browser });
      assert.deepEqual(imageInfo(png), { format: 'png', width: 1200, height: 630 });
      assert.equal(fontSize, 56);
      const img = decodePng(png);
      assert.deepEqual([...img.data.subarray(0, 4)], [255, 255, 255, 255]);
    });

    test('shrinks a long line to fit, and fails when the face does not load', { skip: !existsSync(CONSOLAS) && 'no Consolas on this machine' }, async () => {
      const long = Array.from({ length: 30 }, () => 'measured').join(' ');
      const { fontSize } = await renderOg({ mark: read('good.svg'), wordmark: read('good.svg'), line: long, fontFile: CONSOLAS, bg: '#ffffff', fg: '#111111', browser });
      assert.ok(fontSize < 56);
      const bogus = path.join(scratch, 'bogus.ttf');
      writeFileSync(bogus, 'not a font');
      await assert.rejects(renderOg({ mark: read('good.svg'), wordmark: read('good.svg'), line: 'x', fontFile: bogus, bg: '#ffffff', fg: '#111111', browser }), /did not load/);
    });
  });

  describe('sheet', () => {
    test('lays out every candidate with its measurements and lint result', async () => {
      const dir = path.join(scratch, 'candidates');
      for (const [n, file] of [['1', 'good.svg'], ['2', 'disc.svg'], ['3', 'triangle.svg']]) {
        mkdirSync(path.join(dir, n), { recursive: true });
        cpSync(`${MARKS}${file}`, path.join(dir, n, 'mark.svg'));
        writeFileSync(path.join(dir, n, 'candidate.json'), JSON.stringify({ intervention: 'one change', one_feature: `feature ${n}`, flag_reasons: {} }));
      }
      const { png, rows } = await renderSheet(renderer, dir);
      const info = imageInfo(png);
      assert.equal(info.format, 'png');
      assert.ok(Number(info.width) >= 1500 && Number(info.height) > 600);
      assert.deepEqual(rows.map((r) => r.name), ['1', '2', '3']);
      assert.deepEqual(rows[2].unexplained, ['triangle']);
      assert.equal(rows[0].solidShare16, 1);
    });
  });
});
