// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { optimize } from 'svgo';
import { Renderer, buildIcons, encodePng, outlineWordmark, renderCandidate, sha256 } from '../../brand.mjs';
import { run } from '../../brand-check.mjs';
import { launch } from '../../lib/browser.mjs';
import { DEFAULT_VIEWPORTS, defaultProfile } from '../../lib/profile.mjs';
import { aggregate } from '../../lib/report.mjs';
import { serveStatic } from '../../lib/serve.mjs';

const SCRIPTS = fileURLToPath(new URL('../../', import.meta.url));
const MARKS = fileURLToPath(new URL('../fixtures/brand/marks/', import.meta.url));
const TEMPLATES = fileURLToPath(new URL('../fixtures/brand/templates/', import.meta.url));
/** @param {string} name */
const mark = (name) => readFileSync(`${MARKS}${name}`, 'utf8');
/** A system face for the wordmark mechanics only; nothing ships. Consolas Regular's r once failed the lint after SVGO. */
const WORDMARK_FONT = 'C:/Windows/Fonts/consola.ttf';
const MOVED_BAR = mark('good.svg').replace('M22 18h6v8h-6z', 'M20 18h6v8h-6z');

/** @type {import('playwright-core').Browser} */
let browser;
/** @type {Renderer} */
let renderer;
const scratch = mkdtempSync(path.join(os.tmpdir(), 'fe-brand-gates-'));
/** @type {string} */
let good;

/**
 * The page head and body of the fixture site.
 * @param {{ogImage: string | null, ogAlt?: string | null, inline?: string, favicon?: string}} parts
 * @returns {string}
 */
function page({ ogImage, ogAlt = 'Holdover: every downstream consumer of a share ratio, and how many hours it is behind', inline = mark('good.svg'), favicon = '' }) {
  const meta = [
    ogImage === null ? '' : `<meta property="og:image" content="${ogImage}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    ogAlt === null ? '' : `<meta property="og:image:alt" content="${ogAlt}">`,
    '<meta name="twitter:card" content="summary_large_image">',
  ].join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Holdover</title>
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
${favicon}
${meta}
</head><body><header><span data-brand="mark" style="display:inline-block;width:48px">${inline.replace(/<title>[\s\S]*?<\/title>/, '')}</span><h1>Holdover</h1></header>
<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg></body></html>
`;
}

/** @param {number} w @param {number} h @returns {Buffer} */
function card(w, h) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i += 1) data.set([240, 240, 236, 255], i * 4);
  return encodePng({ width: w, height: h, data });
}

/**
 * Builds the passing fixture project: repo (brand/), state (final brief, three rendered candidates) and site.
 * @param {string} dir
 */
async function buildProject(dir) {
  const repo = path.join(dir, 'repo');
  mkdirSync(path.join(repo, 'brand'), { recursive: true });
  writeFileSync(path.join(repo, 'brand', 'mark.svg'), mark('good.svg'));
  const state = path.join(dir, 'state');
  mkdirSync(state, { recursive: true });
  writeFileSync(path.join(state, 'brief.json'), JSON.stringify({ project: { name: 'Holdover', name_status: 'final', source: 'spec.md:1' } }));
  const candidates = path.join(state, 'brand', 'candidates');
  for (const [n, file] of [['1', 'good.svg'], ['2', 'disc.svg'], ['3', 'good-attr.svg']]) {
    const folder = path.join(candidates, n);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'mark.svg'), mark(file));
    writeFileSync(path.join(folder, 'candidate.json'), JSON.stringify({ text: 'holdover', font: 'IBM Plex Mono', license: 'OFL-1.1', intervention: 'the bars are cut where the ratio lags', one_feature: 'the gap is the delay', flag_reasons: {}, ai: 'assisted', tool: 'claude' }));
    await renderCandidate(renderer, mark(file), path.join(folder, 'render'), path.join(folder, 'mark.svg'), { sizes: [16, 32, 180, 512] });
  }
  if (existsSync(WORDMARK_FONT)) writeFileSync(path.join(candidates, '1', 'wordmark.svg'), outlineWordmark({ text: 'holdover', fontFile: WORDMARK_FONT }).svg);
  const site = path.join(dir, 'site');
  await buildIcons(renderer, mark('good.svg'), { outDir: site, publicDir: site, layout: 'static', name: 'Holdover', bg: '#0b0e14', map: null, dark: null, ink: '#000000', base: '/' });
  const png = card(1200, 630);
  const name = `opengraph-image.${sha256(png).slice(0, 8)}.png`;
  writeFileSync(path.join(site, name), png);
  writeFileSync(path.join(site, 'index.html'), page({ ogImage: `https://holdover.example/${name}` }));
  return { repo, state, site, ogName: name };
}

/**
 * Copies the passing project and applies a change.
 * @param {string} label @param {(p: {repo: string, state: string, site: string, ogName: string}) => void | Promise<void>} change
 */
async function variant(label, change) {
  const dir = mkdtempSync(path.join(scratch, `${label}-`));
  cpSync(good, dir, { recursive: true });
  const ogName = readFileSync(path.join(dir, 'site', 'index.html'), 'utf8').match(/opengraph-image\.[0-9a-f]{8}\.png/)?.[0] ?? '';
  const p = { repo: path.join(dir, 'repo'), state: path.join(dir, 'state'), site: path.join(dir, 'site'), ogName };
  await change(p);
  return p;
}

/**
 * Runs gates on a project served on 127.0.0.1.
 * @param {{repo: string, state: string, site: string}} p @param {string[]} gates @param {{serve?: boolean}} [options]
 */
async function check(p, gates, { serve = true } = {}) {
  const server = serve ? await serveStatic(p.site) : null;
  try {
    return await run({
      root: p.repo,
      profile: defaultProfile({ judged_surface: 'site', stack: 'static-html', hosting: 'local' }),
      state: p.state,
      design: path.join(p.repo, 'design'),
      routes: [{ path: '/', name: 'home', first: true, features: [], states: [] }],
      baseUrl: server ? server.url : null,
      browser,
      viewports: DEFAULT_VIEWPORTS.map((v) => ({ ...v })),
    }, gates);
  } finally {
    await server?.close();
  }
}

/** @param {import('../../lib/report.mjs').GateResult} r @param {RegExp} pattern */
function assertFail(r, pattern) {
  assert.equal(r.state, 'fail', `${r.id} should fail: ${r.detail}`);
  const text = `${r.detail} ${r.evidence.map((e) => String(e.detail ?? '')).join(' ')}`;
  assert.match(text, pattern);
}

describe('brand gates on a served project', () => {
  before(async () => {
    browser = await launch();
    renderer = await Renderer.open({ browser });
    good = path.join(scratch, 'good');
    await buildProject(good);
  });

  after(async () => {
    await renderer?.close();
    await browser?.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  test('every brand gate passes on the project the pipeline emits', async () => {
    const results = await check({ repo: path.join(good, 'repo'), state: path.join(good, 'state'), site: path.join(good, 'site') }, ['brand']);
    for (const r of results) assert.equal(r.state, 'ok', `${r.id}: ${r.detail}`);
    assert.equal(aggregate(results).ok, true);
    assert.equal(results.length, 6);
  });

  describe('brand.candidates', () => {
    test('fails while the name is not final (BR-02)', async () => {
      const p = await variant('name', ({ state }) => writeFileSync(path.join(state, 'brief.json'), JSON.stringify({ project: { name: 'Holdover', name_status: 'working' } })));
      assertFail((await check(p, ['brand.candidates'], { serve: false }))[0], /name_status is "working"/);
    });

    test('fails with two candidates', async () => {
      const p = await variant('two', ({ state }) => rmSync(path.join(state, 'brand', 'candidates', '3'), { recursive: true }));
      assertFail((await check(p, ['brand.candidates'], { serve: false }))[0], /2 candidate folder/);
    });

    test('fails when the renders are of an older mark', async () => {
      const p = await variant('stale', ({ state }) => writeFileSync(path.join(state, 'brand', 'candidates', '1', 'mark.svg'), MOVED_BAR));
      assertFail((await check(p, ['brand.candidates'], { serve: false }))[0], /older mark.svg/);
    });

    test('fails on a look-twice flag without a written reason, and on a hard lint failure', async () => {
      const p = await variant('flag', async ({ state }) => {
        const folder = path.join(state, 'brand', 'candidates', '2');
        writeFileSync(path.join(folder, 'mark.svg'), mark('triangle.svg'));
        await renderCandidate(renderer, mark('triangle.svg'), path.join(folder, 'render'), path.join(folder, 'mark.svg'));
        const third = path.join(state, 'brand', 'candidates', '3');
        writeFileSync(path.join(third, 'mark.svg'), mark('gradient-hexagon.svg'));
        await renderCandidate(renderer, mark('gradient-hexagon.svg'), path.join(third, 'render'), path.join(third, 'mark.svg'));
      });
      const [r] = await check(p, ['brand.candidates'], { serve: false });
      assertFail(r, /look-twice flag triangle has no written reason/);
      assertFail(r, /3: gradient/);
    });

    test('fails when candidate.json lacks the intervention or the one feature', async () => {
      const p = await variant('fields', ({ state }) => writeFileSync(path.join(state, 'brand', 'candidates', '1', 'candidate.json'), JSON.stringify({ intervention: '', flag_reasons: {} })));
      const [r] = await check(p, ['brand.candidates'], { serve: false });
      assertFail(r, /intervention is empty/);
      assertFail(r, /one_feature is empty/);
    });
  });

  describe('brand.favicons', () => {
    test('fails on an ICO with several entries (the Next template)', async () => {
      const p = await variant('ico', ({ site }) => cpSync(`${TEMPLATES}next-favicon.ico`, path.join(site, 'favicon.ico')));
      assertFail((await check(p, ['brand.favicons']))[0], /favicon.ico holds 16x16, 32x32, 48x48, 256x256/);
    });

    test('fails when the apple-touch-icon link is missing or the icon is transparent', async () => {
      const p = await variant('apple', ({ site }) => {
        const html = readFileSync(path.join(site, 'index.html'), 'utf8').replace('<link rel="apple-touch-icon" href="/apple-touch-icon.png">', '');
        writeFileSync(path.join(site, 'index.html'), html);
      });
      assertFail((await check(p, ['brand.favicons']))[0], /no <link rel="apple-touch-icon">/);
      const q = await variant('apple-alpha', ({ site }) => cpSync(path.join(good, 'state', 'brand', 'candidates', '1', 'render', 'mark-180.png'), path.join(site, 'apple-touch-icon.png')));
      assertFail((await check(q, ['brand.favicons']))[0], /transparent pixel/);
    });

    test('fails when the maskable icon reaches outside the safe zone', async () => {
      const p = await variant('mask', ({ site }) => cpSync(path.join(site, 'icon-512.png'), path.join(site, 'icon-mask.png')));
      assertFail((await check(p, ['brand.favicons']))[0], /beyond the safe zone of 204.8 px/);
    });

    test('fails when robots.txt blocks an icon', async () => {
      const p = await variant('robots', ({ site }) => writeFileSync(path.join(site, 'robots.txt'), 'User-agent: *\nDisallow: /icon.svg\n'));
      assertFail((await check(p, ['brand.favicons']))[0], /robots.txt blocks \/icon.svg/);
    });
  });

  describe('brand.templates', () => {
    test('fails when the built head links the create-vite favicon', async () => {
      const p = await variant('vite', ({ site }) => {
        cpSync(`${TEMPLATES}vite-favicon.svg`, path.join(site, 'icon.svg'));
      });
      assertFail((await check(p, ['brand.templates']))[0], /\/icon.svg in the built head is the create-vite/);
    });
  });

  describe('brand.icon-dark', () => {
    test('fails when icon.svg went through the default SVGO preset (the class is gone)', async () => {
      const p = await variant('svgo', ({ site }) => writeFileSync(path.join(site, 'icon.svg'), optimize(mark('good.svg'), { multipass: true }).data));
      assertFail((await check(p, ['brand.icon-dark']))[0], /no prefers-color-scheme|matches no element/);
    });

    test('fails when the dark rule does not take effect', async () => {
      const p = await variant('inert', ({ site }) => writeFileSync(path.join(site, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>@media (prefers-color-scheme:dark){.m{stroke-width:2}}</style><path class="m" fill="#14161a" d="M4 6h24v8H4z"/></svg>'));
      assertFail((await check(p, ['brand.icon-dark']))[0], /same colours under emulated dark mode/);
    });

    test('checks the repository file when no site is served', async () => {
      const p = await variant('repo-icon', ({ repo }) => {
        mkdirSync(path.join(repo, 'public'), { recursive: true });
        writeFileSync(path.join(repo, 'public', 'icon.svg'), optimize(mark('good.svg'), { multipass: false, plugins: [{ name: 'preset-default', params: { overrides: { inlineStyles: false } } }] }).data);
      });
      const [r] = await check(p, ['brand.icon-dark'], { serve: false });
      assert.equal(r.state, 'ok', r.detail);
      assert.match(r.detail, /public\/icon.svg switches from #14161a to #f4f1ea/);
    });
  });

  describe('brand.og', () => {
    test('fails without og:image:alt, with a relative URL, without a content hash, or with the wrong size', async () => {
      const noAlt = await variant('alt', ({ site, ogName }) => writeFileSync(path.join(site, 'index.html'), page({ ogImage: `https://holdover.example/${ogName}`, ogAlt: null })));
      assertFail((await check(noAlt, ['brand.og']))[0], /og:image:alt is missing/);
      const relative = await variant('rel', ({ site, ogName }) => writeFileSync(path.join(site, 'index.html'), page({ ogImage: `/${ogName}` })));
      assertFail((await check(relative, ['brand.og']))[0], /absolute https URL/);
      const unhashed = await variant('hash', ({ site, ogName }) => {
        cpSync(path.join(site, ogName), path.join(site, 'og.png'));
        writeFileSync(path.join(site, 'index.html'), page({ ogImage: 'https://holdover.example/og.png' }));
      });
      assertFail((await check(unhashed, ['brand.og']))[0], /carries no content hash/);
      const small = await variant('size', ({ site, ogName }) => writeFileSync(path.join(site, ogName), card(1200, 600)));
      assertFail((await check(small, ['brand.og']))[0], /is 1200x600, not 1200x630/);
    });
  });

  describe('brand.drift', () => {
    test('fails when the inline data-brand copy has drifted from brand/mark.svg', async () => {
      const p = await variant('drift', ({ site, ogName }) => writeFileSync(path.join(site, 'index.html'), page({ ogImage: `https://holdover.example/${ogName}`, inline: MOVED_BAR })));
      assertFail((await check(p, ['brand.drift']))[0], /data-brand="mark" differs from brand\/mark.svg/);
    });

    test('fails when a data-URI favicon is not the mark', async () => {
      const uri = `data:image/svg+xml;base64,${Buffer.from(mark('triangle.svg')).toString('base64')}`;
      const p = await variant('datauri', ({ site, ogName }) => writeFileSync(path.join(site, 'index.html'), page({ ogImage: `https://holdover.example/${ogName}`, favicon: `<link rel="icon" href="${uri}">` })));
      assertFail((await check(p, ['brand.drift']))[0], /data-URI favicon differs from every file in brand/);
    });
  });

  describe('a wrong target', () => {
    test('a served folder without index.html fails the rendered gates with the 404, not with "no favicon"', async () => {
      const p = await variant('no-index', ({ site }) => rmSync(path.join(site, 'index.html')));
      const results = await check(p, ['brand.favicons', 'brand.og', 'brand.drift']);
      assert.equal(results.length, 3);
      for (const r of results) assertFail(r, /answers 404: --serve needs the built site folder/);
    });
  });

  describe('brand-check CLI', () => {
    test('exits 0 when every gate passes, 1 when one fails, 2 on a usage error', async () => {
      const okRun = spawnSync(process.execPath, ['brand-check.mjs', '--root', path.join(good, 'repo'), '--state', path.join(good, 'state'), '--serve', path.join(good, 'site'), '--json'], { cwd: SCRIPTS, encoding: 'utf8', timeout: 120000 });
      assert.equal(okRun.status, 0, okRun.stderr);
      const report = JSON.parse(okRun.stdout);
      assert.deepEqual([report.ok, report.tool, report.counts], [true, 'brand-check', { ok: 6, fail: 0, skipped: 0 }]);
      const p = await variant('cli', ({ site }) => writeFileSync(path.join(site, 'robots.txt'), 'User-agent: *\nDisallow: /\n'));
      const failRun = spawnSync(process.execPath, ['brand-check.mjs', '--root', p.repo, '--state', p.state, '--serve', p.site, '--gates', 'brand.favicons'], { cwd: SCRIPTS, encoding: 'utf8', timeout: 120000 });
      assert.equal(failRun.status, 1, failRun.stderr);
      assert.match(failRun.stderr, /fail\s+brand\.favicons/);
      const skipRun = spawnSync(process.execPath, ['brand-check.mjs', '--root', p.repo, '--state', p.state, '--gates', 'brand.og'], { cwd: SCRIPTS, encoding: 'utf8', timeout: 120000 });
      assert.equal(skipRun.status, 1, 'a skipped gate exits 1');
      const usage = spawnSync(process.execPath, ['brand-check.mjs', '--gates', 'brand.logo'], { cwd: SCRIPTS, encoding: 'utf8', timeout: 60000 });
      assert.equal(usage.status, 2);
      assert.match(usage.stderr, /unknown brand gate/);
    });
  });
});
