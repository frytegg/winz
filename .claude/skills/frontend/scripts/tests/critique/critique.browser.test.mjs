// @ts-check
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { capture, drawMarks, loadBrief, markRects, MAX_TILES, SKILL_DIR, SQUINT_RADII } from '../../critique.mjs';
import { launch, newContext } from '../../lib/browser.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import { serveStatic } from '../../lib/serve.mjs';
import { formatErrors, SchemaRegistry } from '../assets/json-schema.mjs';
import { FIXTURES, gitRepoWithSite, pngSize, runCli, stateWithBrief, tempDir } from './helpers.mjs';

/** @typedef {import('playwright-core').Browser} Browser */

/** @returns {Promise<number>} */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const address = s.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      s.close(() => resolve(port));
    });
  });
}

/**
 * @param {number} port
 * @returns {Promise<boolean>}
 */
async function portIsFree(port) {
  for (let i = 0; i < 40; i += 1) {
    const free = await new Promise((resolve) => {
      const s = net.createServer();
      s.once('error', () => resolve(false));
      s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
    });
    if (free) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

const ROUTES = [{ path: '/', name: 'home', first: true, features: ['FR-001', 'FR-002'], states: [] }];

/** @type {Browser} */
let browser;
/** @type {Array<import('../../lib/serve.mjs').StaticServer>} */
const servers = [];
/** @type {string[]} */
const cleanup = [];

/**
 * @param {string} site
 * @param {number} [maxTiles]
 */
async function captureSite(site, maxTiles) {
  const server = await serveStatic(path.join(FIXTURES, site));
  servers.push(server);
  const state = stateWithBrief();
  cleanup.push(state);
  const dir = path.join(state, 'critique', 'round-0', 'baseline');
  return capture({ browser, baseUrl: server.url, routes: ROUTES, profile: defaultProfile(), brief: loadBrief(state), dir, maxTiles });
}

describe('browser: critique capture', () => {
  before(async () => {
    browser = await launch();
  });

  after(async () => {
    await browser?.close();
    await Promise.all(servers.map((s) => s.close()));
    for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
  });

  test('a well-built page: viewport tiles at both sizes, marks on the markers, squint tiles, no problem, every score 100', async () => {
    const c = await captureSite('good');
    assert.ok(c.tiles.length >= 2 && c.tiles.length <= MAX_TILES);
    for (const t of c.tiles) {
      const expected = t.viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 780, height: 1688 };
      assert.deepEqual(pngSize(t.path), expected, t.path);
      assert.deepEqual(pngSize(t.marked), expected, t.marked);
      assert.ok(t.marks.length > 0 && t.marks.length <= 40);
    }
    assert.deepEqual(c.tiles.filter((t) => t.index === 0).map((t) => t.viewport), ['desktop', 'mobile'], 'every first view comes before any second tile');
    assert.deepEqual(Object.keys(c.first_view).sort(), ['desktop', 'mobile']);
    assert.equal(c.squint.length, 2 * SQUINT_RADII.length);
    for (const s of c.squint) assert.deepEqual(pngSize(s.path), s.viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 780, height: 1688 });
    assert.notDeepEqual(readFileSync(c.squint[0].path), readFileSync(c.first_view.desktop), 'the squint tile is blurred');

    const hero = c.marks.find((m) => m.attrs['data-hero'] === 'h1');
    assert.ok(hero, 'the H1 has a mark');
    assert.equal(hero.kind, 'heading');
    assert.ok(hero.views.desktop && hero.views.mobile, 'one mark id per element across viewports');
    assert.ok(hero.tiles.some((t) => t.includes('desktop-0')));
    assert.ok(c.marks.some((m) => m.attrs['data-surface'] === 'product'));
    assert.ok(c.marks.every((m) => Object.keys(m.attrs).every((k) => !k.startsWith('data-fe-'))), 'measurement attributes stay out of the marks');
    const ids = c.marks.map((m) => Number(m.id));
    assert.deepEqual(ids, ids.map((_, i) => i + 1));

    assert.deepEqual(c.problems, []);
    assert.deepEqual(c.scores, { typography: 100, contrast: 100, targets: 100, first_view: 100, layout: 100, features: 100 });
    const fv1 = c.checklist.find((i) => i.id === 'FV1');
    assert.deepEqual(fv1?.marks, [hero.id]);
    assert.equal(c.checklist.find((i) => i.id === 'F-FR-001.c')?.marks.length, 1);
  });

  test('a page with defects: each deterministic check fires on the element that has it', async () => {
    const c = await captureSite('bad');
    const desktop = c.problems.filter((p) => p.viewport === 'desktop');
    /** @param {string} check */
    const on = (check) => desktop.filter((p) => p.check === check).map((p) => p.selector);
    assert.deepEqual(on('typography.orphan'), ['h2']);
    assert.ok(on('typography.measure').includes('section:nth-of-type(1) > p:nth-of-type(1)'));
    assert.ok(on('typography.body-size').length >= 4);
    assert.ok(on('typography.line-height').length >= 1);
    assert.deepEqual(on('contrast.text'), ['section:nth-of-type(1) > p:nth-of-type(2)']);
    assert.equal(on('targets.size').length, 3);
    assert.equal(on('layout.near-miss').length, 2);
    assert.equal(on('layout.gap-variance').length, 4);
    assert.equal(on('layout.section-padding').length, 2);
    assert.deepEqual(on('layout.clipped'), ['section:nth-of-type(3) > div']);
    assert.deepEqual(on('first-view.h1'), ['h1']);
    assert.equal(on('first-view.figure').length, 1);
    for (const p of c.problems) {
      const mark = c.marks[Number(p.mark) - 1];
      assert.equal(mark.selector, p.selector, 'every problem names the mark of its element');
    }
    assert.ok(c.notes.some((n) => /no element marked data-surface="product"/.test(n)));
    assert.ok(c.notes.some((n) => /feature FR-001: no visible data-feature/.test(n)));
    assert.ok(c.scores.typography < 50 && c.scores.layout < 100 && c.scores.first_view === 0 && c.scores.features === 0);
    const t1 = c.checklist.find((i) => i.id === 'T1');
    assert.ok(t1 && t1.evidence.length > 0, 'measured problems reach their checklist item');
  });

  test('the tile budget caps clean and marked tiles together', async () => {
    const c = await captureSite('good', 1);
    assert.equal(c.tiles.length, 1);
    assert.equal(c.tiles[0].viewport, 'desktop');
    assert.ok(c.skipped.some((s) => /mobile: analysed, no tile/.test(s)));
    assert.deepEqual(Object.keys(c.first_view), ['desktop']);
  });

  test('drawMarks lays numbered badges over the boxes markRects reports, inside the viewport', async () => {
    const context = await newContext(browser, { width: 400, height: 300 });
    try {
      const page = await context.newPage();
      await page.setContent('<div id="a" style="position:absolute;left:10px;top:40px;width:100px;height:30px">A</div><div id="b" style="position:absolute;left:10px;top:500px;width:50px;height:20px">B</div>');
      const rects = await page.evaluate(markRects, [{ id: '1', sel: '#a' }, { id: '2', sel: '#b' }, { id: '3', sel: '#missing' }]);
      assert.deepEqual(rects.map((r) => r.id), ['1'], 'off-screen and missing elements are left out');
      assert.equal(await page.evaluate(drawMarks, rects), 1);
      const badge = await page.evaluate(() => {
        const layer = document.getElementById('__fe_critique_marks__');
        const label = layer ? Array.from(layer.children).find((c) => c.textContent === '1') : null;
        return label ? label.getBoundingClientRect().toJSON() : null;
      });
      assert.ok(badge && badge.top >= 0 && badge.left >= 0 && badge.bottom <= 300, JSON.stringify(badge));
    } finally {
      await context.close();
    }
  });
});

describe('browser: critique CLI', () => {
  after(() => {
    for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
  });

  test('measure prints the fragment\'s measure object, with the gates of the build and the git state', () => {
    const repo = gitRepoWithSite(path.join(FIXTURES, 'bad'));
    const state = stateWithBrief();
    cleanup.push(repo.root, state);
    const res = runCli([
      'measure', '--round', '0', '--label', 'baseline', '--root', repo.root, '--serve', repo.dist, '--state', state,
      '--checker', path.join(FIXTURES, 'fake-check.mjs'), '--json',
    ], { FAKE_GATE_REPORT: path.join(FIXTURES, 'gates-fail.json') });
    assert.equal(res.status, 0, res.stderr);
    const m = res.json;
    const registry = new SchemaRegistry();
    registry.add(JSON.parse(readFileSync(path.join(SKILL_DIR, 'assets', 'schemas', 'fragment-commands.schema.json'), 'utf8')));
    assert.equal(formatErrors(registry.validate('urn:frontend:schema:fragment-commands:1#/$defs/measure', m)), '');
    assert.equal(m.sha, repo.sha);
    assert.equal(m.ui_tree, repo.appTree, 'the UI folder is the tracked parent of the served build');
    assert.equal(m.ui_root, 'app');
    assert.deepEqual(m.gates, { ok: false, counts: { ok: 2, fail: 1, skipped: 1 }, failing: ['render.clipping', 'motion.reduced'] });
    assert.ok(m.deterministic.some((/** @type {any} */ d) => d.check === 'render.clipping' && d.selector === 'h1'), 'a failing gate confirms the mark of its evidence');
    assert.ok(m.images.critique <= 20 && m.images.pairwise <= 20);
    const gates = JSON.parse(readFileSync(m.gates_report, 'utf8'));
    assert.deepEqual(gates.target.args.slice(0, 3), ['--json', '--phase', 'build'], 'the build-phase gates run by default');
    assert.ok(gates.target.args.includes('--serve'));
    const task = readFileSync(m.task_file, 'utf8');
    assert.match(task, /failing or skipped: render\.clipping, motion\.reduced/);
    assert.match(task, /## Checklist/);
    const best = JSON.parse(readFileSync(path.join(state, 'critique', 'best.json'), 'utf8'));
    assert.equal(best.sha, repo.sha, 'the baseline becomes the best-so-far');
  });

  test('measure fails with exit 3 when the checker crashes or is missing, and with exit 3 outside git', () => {
    const repo = gitRepoWithSite(path.join(FIXTURES, 'good'));
    const state = stateWithBrief();
    const plain = tempDir('fe-critique-nogit-');
    cleanup.push(repo.root, state, plain);
    const base = ['measure', '--round', '1', '--label', 'candidate', '--root', repo.root, '--serve', repo.dist, '--state', state];
    let res = runCli([...base, '--checker', path.join(FIXTURES, 'fake-check.mjs')], { FAKE_GATE_REPORT: path.join(FIXTURES, 'gates-ok.json'), FAKE_GATE_EXIT: '3' });
    assert.equal(res.status, 3, res.stderr);
    assert.match(res.stderr, /frontend-check exited with 3/);
    res = runCli([...base, '--checker', path.join(plain, 'nope.mjs')]);
    assert.equal(res.status, 3);
    assert.match(res.stderr, /frontend-check not found/);
    res = runCli(['measure', '--round', '1', '--label', 'candidate', '--root', plain, '--serve', repo.dist, '--state', state, '--gates-report', path.join(FIXTURES, 'gates-ok.json')]);
    assert.equal(res.status, 3);
    assert.match(res.stderr, /git /);
  });

  test('--start launches the app, waits for its URL, and stops the whole process tree afterwards', async () => {
    const state = stateWithBrief();
    cleanup.push(state);
    const port = await freePort();
    const site = path.join(FIXTURES, 'good');
    const command = `"${process.execPath}" "${path.join(FIXTURES, 'serve-site.mjs')}" "${site}" ${port}`;
    const res = runCli(['prepare', '--root', site, '--start', command, '--url', `http://127.0.0.1:${port}`, '--state', state, '--max-tiles', '2', '--json']);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.json.tiles.length, 2);
    assert.equal(await portIsFree(port), true, 'the started server is gone');
    const dead = runCli(['prepare', '--root', site, '--start', `"${process.execPath}" -e "process.exit(4)"`, '--url', `http://127.0.0.1:${port}`, '--state', state]);
    assert.equal(dead.status, 3);
    assert.match(dead.stderr, /--start .* exited \(code 4\) before/);
  });

  test('prepare writes the critic files without gates or git, and ui-copy exports the rendered text by route', () => {
    const state = stateWithBrief();
    cleanup.push(state);
    const site = path.join(FIXTURES, 'good');
    const prep = runCli(['prepare', '--root', site, '--serve', site, '--state', state, '--json']);
    assert.equal(prep.status, 0, prep.stderr);
    for (const key of ['task_file', 'marks_file', 'checklist_file']) assert.ok(existsSync(prep.json[key]), key);
    assert.equal(prep.json.sha, undefined);

    const copy = runCli(['ui-copy', '--root', site, '--serve', site, '--state', state, '--json']);
    assert.equal(copy.status, 0, copy.stderr);
    const md = readFileSync(copy.json.path, 'utf8');
    assert.match(md, /^# UI copy: Queue Clock/);
    assert.match(md, /## \/ \(home\)/);
    assert.match(md, /### Headings\n\nSettle withdrawals on time\n/);
    assert.match(md, /### Controls\n\n[\s\S]*Queue a withdrawal/);
    assert.doesNotMatch(md, /\r/);
    const json = JSON.parse(readFileSync(copy.json.path.replace(/\.md$/, '.json'), 'utf8'));
    assert.ok(json.entries.some((/** @type {any} */ e) => e.kind === 'Headings' && e.selector));
  });
});
