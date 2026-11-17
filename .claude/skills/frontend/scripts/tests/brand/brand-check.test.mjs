// @ts-check
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GATES, expandSelection, fetchResource, iconInkRadius, iou, onTarget, robotsDisallows, run, staticDataUris } from '../../brand-check.mjs';
import { DEFAULT_VIEWPORTS, defaultProfile } from '../../lib/profile.mjs';
import { aggregate } from '../../lib/report.mjs';

const TEMPLATES = fileURLToPath(new URL('../fixtures/brand/templates/', import.meta.url));
const MARKS = fileURLToPath(new URL('../fixtures/brand/marks/', import.meta.url));
const scratch = mkdtempSync(path.join(os.tmpdir(), 'fe-brand-check-'));

after(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * A check context without a browser or a served build.
 * @param {string} root
 * @returns {import('../../brand-check.mjs').CheckContext}
 */
function bareContext(root) {
  return {
    root,
    profile: defaultProfile({ judged_surface: 'site', stack: 'static-html', hosting: 'local' }),
    state: path.join(root, '.frontend'),
    design: path.join(root, 'design'),
    routes: [{ path: '/', name: 'home', first: true, features: [], states: [] }],
    baseUrl: null,
    browser: null,
    viewports: DEFAULT_VIEWPORTS.map((v) => ({ ...v })),
  };
}

describe('brand-check helpers', () => {
  test('exports the six gates of the brand group, each with a title and an if-dropped sentence', () => {
    assert.deepEqual(GATES.map((g) => g.id), ['brand.candidates', 'brand.favicons', 'brand.templates', 'brand.icon-dark', 'brand.og', 'brand.drift']);
    for (const g of GATES) assert.ok(g.title.length > 10 && g.ifDropped.length > 10, g.id);
  });

  test('selection takes ids or the group name and refuses unknown gates', () => {
    assert.deepEqual(expandSelection(['brand']), GATES.map((g) => g.id));
    assert.deepEqual(expandSelection(['brand.og', ' brand.og ']), ['brand.og']);
    assert.throws(() => expandSelection(['brand.logo']), (err) => err instanceof Error && err.name === 'UsageError');
  });

  test('run ignores the ids of other groups that frontend-check may pass along', async () => {
    const root = mkdtempSync(path.join(scratch, 'mixed-'));
    const results = await run(bareContext(root), ['render.console', 'brand.og', 'tells']);
    assert.deepEqual(results.map((r) => r.id), ['brand.og']);
    await assert.rejects(run(bareContext(root), ['brand.logo']), (err) => err instanceof Error && err.name === 'UsageError');
  });

  test('robots.txt: longest match wins, Allow wins a tie, specific agents replace the * group, wildcards work', () => {
    const disallows = robotsDisallows('User-agent: *\nDisallow: /icons/\nAllow: /icons/favicon.ico\nDisallow: /*.svg$\n\nUser-agent: Googlebot-Image\nDisallow: /\n');
    assert.equal(disallows('Googlebot', '/icons/favicon.ico'), false);
    assert.equal(disallows('Googlebot', '/icons/apple.png'), true);
    assert.equal(disallows('Googlebot', '/icon.svg'), true);
    assert.equal(disallows('Googlebot', '/icon.svg?v=2'), false);
    assert.equal(disallows('Googlebot-Image', '/favicon.ico'), true);
    assert.equal(robotsDisallows('')('Googlebot', '/favicon.ico'), false);
  });

  test('ink radius of a full-bleed icon measures the mark, not its ground', () => {
    const size = 64;
    const data = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i += 1) data.set([10, 20, 30, 255], i * 4);
    for (let y = 22; y < 42; y += 1) for (let x = 22; x < 42; x += 1) data.set([250, 250, 250, 255], (y * size + x) * 4);
    const radius = iconInkRadius({ width: size, height: size, data });
    assert.ok(radius > 13 && radius < 15, String(radius));
    const transparent = Buffer.alloc(size * size * 4);
    transparent.set([0, 0, 0, 255], ((size - 1) * size + (size - 1)) * 4);
    assert.ok(iconInkRadius({ width: size, height: size, data: transparent }) > 44);
  });

  test('maps a resource on another origin onto the target, so checks stay offline', () => {
    assert.deepEqual(onTarget('https://holdover.example/og.abcd1234.png?v=1', 'http://127.0.0.1:5000'), { url: 'http://127.0.0.1:5000/og.abcd1234.png?v=1', mapped: true });
    assert.deepEqual(onTarget('/favicon.ico', 'http://127.0.0.1:5000/'), { url: 'http://127.0.0.1:5000/favicon.ico', mapped: false });
    assert.equal(onTarget('https://x.example/a.png', 'https://user.github.io/repo/').url, 'https://user.github.io/repo/a.png');
  });

  test('silhouette overlap is 1 for identical masks and falls with drift', () => {
    const a = Uint8Array.from([1, 1, 0, 0]);
    assert.equal(iou(a, a), 1);
    assert.equal(iou(a, Uint8Array.from([0, 1, 1, 0])), 1 / 3);
  });

  test('finds SVG data URIs written in source files, with file and line', () => {
    const root = mkdtempSync(path.join(scratch, 'src-'));
    mkdirSync(path.join(root, 'src'));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M4 4h24v24H4z"/></svg>';
    writeFileSync(path.join(root, 'src', 'head.ts'), `// head\nexport const icon = "data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}";\nexport const css = \`url(data:image/svg+xml,${encodeURIComponent(svg)})\`;\n`);
    const found = staticDataUris(root);
    assert.deepEqual(found.map((f) => f.where), ['src/head.ts:2', 'src/head.ts:3']);
    assert.equal(found[0].svg, svg);
    assert.equal(found[0].viewBox, '0 0 32 32');
  });
});

describe('brand-check gates without a browser', () => {
  test('brand.templates fails on the create-vite favicon, even re-saved with one more newline, and on the Next ICO', async () => {
    const root = mkdtempSync(path.join(scratch, 'tpl-'));
    mkdirSync(path.join(root, 'public'));
    mkdirSync(path.join(root, 'app'));
    cpSync(`${TEMPLATES}vite-favicon-vanilla.svg`, path.join(root, 'public', 'favicon.svg'));
    cpSync(`${TEMPLATES}next-favicon.ico`, path.join(root, 'app', 'favicon.ico'));
    const [result] = await run(bareContext(root), ['brand.templates']);
    assert.equal(result.state, 'fail');
    assert.deepEqual(result.evidence.map((e) => [e.file, e.value]), [['app/favicon.ico', 'create-next-app-favicon'], ['public/favicon.svg', 'create-vite-favicon']]);
  });

  test('brand.templates passes a repository whose favicons are the project\'s own', async () => {
    const root = mkdtempSync(path.join(scratch, 'own-'));
    mkdirSync(path.join(root, 'public'));
    cpSync(`${MARKS}good.svg`, path.join(root, 'public', 'icon.svg'));
    const [result] = await run(bareContext(root), ['brand.templates']);
    assert.equal(result.state, 'ok');
    assert.match(result.detail, /among 1 icon file/);
  });

  test('brand.drift fails when brand/mark.svg is missing', async () => {
    const root = mkdtempSync(path.join(scratch, 'nobrand-'));
    const [result] = await run(bareContext(root), ['brand.drift']);
    assert.equal(result.state, 'fail');
    assert.match(result.detail, /brand\/mark.svg is missing/);
  });

  test('gates that need the browser or the built site are skipped, and a skipped gate makes the report fail', async () => {
    const root = mkdtempSync(path.join(scratch, 'skip-'));
    const results = await run(bareContext(root), ['brand.candidates', 'brand.favicons', 'brand.icon-dark', 'brand.og']);
    assert.deepEqual(results.map((r) => r.state), ['skipped', 'skipped', 'skipped', 'skipped']);
    assert.equal(aggregate(results).ok, false);
    assert.equal(aggregate(results, { allowSkip: ['brand'] }).ok, true);
  });
});

describe('fetchResource: offline redirects', () => {
  test('follows a redirect on the target, never one to another host, and stops a loop', async () => {
    /** @type {string[]} */
    const foreignHits = [];
    let port = 0;
    const server = http.createServer((req, res) => {
      if ((req.headers.host ?? '').startsWith('[::ffff:')) foreignHits.push(req.url ?? '');
      if (req.url === '/same') res.writeHead(302, { Location: '/target.png' }).end();
      else if (req.url === '/away') res.writeHead(301, { Location: `http://[::ffff:127.0.0.1]:${port}/cdn.png` }).end();
      else if (req.url === '/loop') res.writeHead(302, { Location: '/loop' }).end();
      else res.writeHead(200, { 'Content-Type': 'image/png' }).end('png');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = server.address();
    port = address && typeof address === 'object' ? address.port : 0;
    try {
      const same = await fetchResource(`http://127.0.0.1:${port}/same`);
      assert.deepEqual([same.status, same.contentType, same.body.toString(), same.error], [200, 'image/png', 'png', null]);
      const away = await fetchResource(`http://127.0.0.1:${port}/away`);
      assert.equal(away.status, 301);
      assert.match(String(away.error), /redirects to http:\/\/\[::ffff:7f00:1\]:\d+\/cdn\.png, outside the target; not followed/);
      assert.deepEqual(foreignHits, [], 'the other host was never contacted');
      const loop = await fetchResource(`http://127.0.0.1:${port}/loop`);
      assert.equal(loop.status, 302);
      assert.match(String(loop.error), /more than 5 redirects/);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
  });
});
