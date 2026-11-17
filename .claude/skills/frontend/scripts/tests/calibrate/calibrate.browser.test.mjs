// @ts-check
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { calibrate, optionsFrom, stripWaybackChrome } from '../../calibrate.mjs';
import { launch } from '../../lib/browser.mjs';
import { serveStatic } from '../../lib/serve.mjs';

/**
 * @typedef {import('../../calibrate.mjs').CalibrateOptions} CalibrateOptions
 * @typedef {import('../../calibrate.mjs').RuleResult} RuleResult
 * @typedef {import('../../calibrate.mjs').EntryResult} EntryResult
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '..', '..', 'calibrate.mjs');
const FIX = path.resolve(HERE, '..', 'fixtures', 'calibrate');
const RULES = path.join(FIX, 'rules');
const NOW = new Date('2026-10-02T08:00:00Z');

/** @type {string} */
let tmp = '';
/** @type {string} */
let corpus = '';
/** @type {{origin: string, close: () => Promise<void>, hits: () => number} | null} */
let wayback = null;
/** @type {import('../../lib/serve.mjs').StaticServer | null} */
let leak = null;
const log = () => {};

/**
 * A stand-in for web.archive.org on 127.0.0.1: the snapshot page (toolbar included) and the playback stylesheet.
 * @param {string} leakOrigin
 * @returns {Promise<{origin: string, close: () => Promise<void>, hits: () => number}>}
 */
async function fakeWayback(leakOrigin) {
  const page = readFileSync(path.join(FIX, 'wayback', 'page.html'), 'utf8').replace('{OTHER}', leakOrigin);
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    const url = req.url ?? '/';
    if (url.startsWith('/web/20221114154205if_/')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(page);
    } else if (url === '/web-static.archive.org/_static/css/banner-styles.css') {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      res.end('#wm-ipp-base { outline: 4px solid red; }');
    } else {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  return {
    origin: `http://127.0.0.1:${port}`,
    hits: () => hits,
    close: () => new Promise((resolve) => {
      server.close(() => resolve(undefined));
      server.closeAllConnections();
    }),
  };
}

/**
 * @param {Partial<CalibrateOptions>} over
 * @returns {CalibrateOptions}
 */
function options(over) {
  return { ...optionsFrom({ corpus, registry: path.join(RULES, 'registry.json'), base: FIX }), labels: null, waybackDelayMs: 0, ...over };
}

/**
 * @param {{rules: RuleResult[]}} run
 * @param {string} id
 * @returns {RuleResult}
 */
function rule(run, id) {
  return /** @type {RuleResult} */ (run.rules.find((r) => r.id === id));
}

/**
 * @param {{entries: EntryResult[]}} run
 * @param {string} id
 * @returns {EntryResult}
 */
function entry(run, id) {
  return /** @type {EntryResult} */ (run.entries.find((e) => e.id === id));
}

/**
 * @param {string[]} args
 * @returns {Promise<{status: number | null, stdout: string, stderr: string}>}
 */
function cli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

describe('browser: calibrate on the fixture corpus', () => {
  before(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-cal-br-'));
    leak = await serveStatic(path.join(FIX, 'leak'));
    wayback = await fakeWayback(leak.url);
    corpus = path.join(tmp, 'corpus.json');
    writeFileSync(corpus, readFileSync(path.join(FIX, 'corpus.template.json'), 'utf8').replaceAll('{WAYBACK}', wayback.origin));
  });
  after(async () => {
    await wayback?.close();
    await leak?.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('full run: per-rule counts, tier proposals, skip reasons and the four result files', async () => {
    const out = path.join(tmp, 'full');
    const run = await calibrate(options({ out }), { now: NOW, log });
    assert.equal(run.exitCode, 1, 'a ready entry without its folder and a failing detector make the run incomplete');
    assert.deepEqual(run.entries.map((e) => [e.id, e.status]), [
      ['pos-a', 'measured'], ['pos-b', 'measured'], ['syn-a', 'measured'], ['ctl-a', 'measured'], ['ctl-wb', 'measured'],
      ['ctl-live', 'skipped'], ['pos-built', 'skipped'], ['pos-missing', 'failed'],
    ], 'exemplars are not selected by default');
    assert.match(String(entry(run, 'ctl-live').reason), /needs the network/);
    assert.match(String(entry(run, 'pos-built').reason), /^status needs-build: Not built yet\.$/);
    assert.match(String(entry(run, 'pos-missing').reason), /serve folder not found/);
    assert.match(String(entry(run, 'ctl-a').reason), /static layer not run: source_root is remote/);
    assert.equal(entry(run, 'pos-a').runtime.pages.length, 4, 'two routes at desktop and mobile');
    assert.deepEqual(entry(run, 'pos-a').static.files, 2, 'ui/App.jsx and the package.json above it, not other/');

    const t01 = rule(run, 'SL-T01');
    assert.deepEqual([t01.positives.fired, t01.positives.total, t01.controls.fired, t01.controls.total], [2, 3, 0, 2]);
    assert.deepEqual(t01.staticLayer.positives, { fired: 2, total: 3 });
    assert.equal(t01.proposal.tier, 'tier1');
    const t02 = rule(run, 'SL-T02');
    assert.deepEqual([t02.positives.fired, t02.positives.total, t02.controls.fired, t02.controls.total, t02.synthetic.fired], [2, 3, 1, 2, 1]);
    assert.equal(t02.proposal.tier, 'tier2');
    assert.equal(rule(run, 'SL-T03').proposal.tier, 'advisory');
    const t05 = rule(run, 'SL-T05');
    assert.deepEqual(t05.states.controls.error, ['ctl-a']);
    assert.equal(t05.proposal.tier, null);
    assert.match(t05.proposal.reason, /detector failed on 1 control/);
    const g01 = rule(run, 'SL-G01');
    assert.deepEqual([g01.positives.fired, g01.positives.total, g01.controls.total], [1, 3, 0], 'other/tool.js is outside source_paths');
    assert.equal(g01.proposal.tier, null);

    for (const f of ['per-entry.json', 'per-rule.json', 'summary.md', 'proposal.json']) assert.ok(existsSync(path.join(out, f)), f);
    const proposal = JSON.parse(readFileSync(path.join(out, 'proposal.json'), 'utf8'));
    assert.equal(proposal.made_at, '2026-10-02T08:00:00Z');
    assert.deepEqual(proposal.rules.map((/** @type {any} */ r) => [r.rule, r.proposed_tier, r.apply]), [
      ['SL-T01', 'tier1', true], ['SL-T02', 'tier2', true], ['SL-T03', 'advisory', true], ['SL-T05', null, false],
      ['SL-T06', 'advisory', true], ['SL-T07', 'tier1', true], ['SL-G01', null, false],
    ]);
    const summary = readFileSync(path.join(out, 'summary.md'), 'utf8');
    assert.match(summary, /\| SL-T01 \| Fixture gradient \(static and runtime\) \| candidate \| 2\/3 \(67%\) \| 0\/2 \(0%\) \| - \| tier1 \|/);
    assert.match(summary, /## Problems/);
    assert.match(summary, /SL-T05: detector errors on ctl-a/);
    const perEntry = JSON.parse(readFileSync(path.join(out, 'per-entry.json'), 'utf8'));
    assert.equal(perEntry.corpus.sha256.length, 64);
    assert.equal(perEntry.entries.find((/** @type {any} */ e) => e.id === 'pos-a').rules['SL-T01'].examples[0].file, 'ui/App.jsx');
  });

  test('Wayback replay: toolbar removed and other origins blocked, on the shared page and on fresh pages', async () => {
    const run = await calibrate(options({ out: path.join(tmp, 'wb'), entries: ['ctl-wb', 'pos-a'], registry: path.join(RULES, 'registry-clean.json') }), { now: NOW, log });
    const wb = entry(run, 'ctl-wb');
    assert.deepEqual(wb.runtime.pages.map((p) => [p.viewport, p.ok, p.status]), [['desktop', true, 200], ['mobile', true, 200]]);
    assert.equal(wb.rules['SL-T06'].state, 'silent', JSON.stringify(wb.rules['SL-T06'].examples));
    assert.equal(wb.rules['SL-T07'].state, 'silent', JSON.stringify(wb.rules['SL-T07'].examples));
    assert.equal(entry(run, 'pos-a').rules['SL-T07'].state, 'fired', 'fresh pages load the same URL');
    assert.equal(run.exitCode, 0);
  });

  test('a clean selection exits 0; --layers static measures static-only rules and leaves runtime rules unmeasured', async () => {
    const clean = await calibrate(options({ out: path.join(tmp, 'clean'), registry: path.join(RULES, 'registry-clean.json'), entries: ['pos-a', 'pos-b', 'syn-a', 'ctl-a', 'ctl-wb'] }), { now: NOW, log });
    assert.equal(clean.exitCode, 0, JSON.stringify(clean.entries.map((e) => [e.id, e.status, e.reason])));
    const staticOnly = await calibrate(options({ out: path.join(tmp, 'static'), layers: { static: true, runtime: false }, entries: ['pos-a', 'pos-b'] }), { now: NOW, log });
    assert.equal(rule(staticOnly, 'SL-G01').positives.total, 2);
    assert.equal(rule(staticOnly, 'SL-T01').positives.total, 0, 'runtime is authoritative: no runtime, no count');
    assert.deepEqual(rule(staticOnly, 'SL-T01').staticLayer.positives, { fired: 2, total: 2 });
    assert.equal(entry(staticOnly, 'pos-a').runtime.reason, 'runtime layer not selected (--layers)');
  });

  test('--har records each viewport, then replays it offline with the same results', async () => {
    const har = path.join(tmp, 'har');
    const reg = path.join(RULES, 'registry-clean.json');
    const first = await calibrate(options({ out: path.join(tmp, 'har-1'), har, entries: ['ctl-wb'], registry: reg }), { now: NOW, log });
    assert.deepEqual(entry(first, 'ctl-wb').runtime.pages.map((p) => p.mode), ['record', 'record']);
    assert.ok(existsSync(path.join(har, 'ctl-wb', 'desktop.har')) && existsSync(path.join(har, 'ctl-wb', 'mobile.har')));
    const hitsBefore = /** @type {NonNullable<typeof wayback>} */ (wayback).hits();
    const second = await calibrate(options({ out: path.join(tmp, 'har-2'), har, entries: ['ctl-wb'], registry: reg }), { now: NOW, log });
    assert.equal(/** @type {NonNullable<typeof wayback>} */ (wayback).hits(), hitsBefore, 'nothing reached the server on replay');
    const pages = entry(second, 'ctl-wb').runtime.pages;
    assert.deepEqual(pages.map((p) => [p.mode, p.ok]), [['replay', true], ['replay', true]]);
    const states = (/** @type {typeof first} */ r) => Object.fromEntries(Object.entries(entry(r, 'ctl-wb').rules).map(([id, x]) => [id, x.state]));
    assert.deepEqual(states(second), states(first));
  });

  test('stripWaybackChrome removes the toolbar, the inserted block and the playback stylesheet, and nothing else', async () => {
    const browser = await launch();
    try {
      const page = await browser.newPage();
      await page.route(`${/** @type {NonNullable<typeof leak>} */ (leak).url}/**`, (route) => route.abort());
      await page.goto(`${/** @type {NonNullable<typeof wayback>} */ (wayback).origin}/web/20221114154205if_/https://ctl.example/`);
      const probe = () => page.evaluate(() => ({
        toolbar: document.querySelectorAll('[id^="wm-"], #donato').length,
        inserted: document.querySelectorAll('.inserted').length,
        stylesheet: document.querySelectorAll('link[href*="archive.org/_static/"]').length,
        text: (document.body.innerText || '').includes('Wayback'),
        content: document.querySelector('main h1')?.textContent ?? null,
      }));
      assert.deepEqual(await probe(), { toolbar: 3, inserted: 1, stylesheet: 1, text: true, content: 'Control page from 2022' });
      assert.ok((await page.evaluate(stripWaybackChrome)) >= 5, 'at least the 3 toolbar elements, the inserted block and the stylesheet');
      assert.deepEqual(await probe(), { toolbar: 0, inserted: 0, stylesheet: 0, text: false, content: 'Control page from 2022' });
    } finally {
      await browser.close();
    }
  });

  test('a remote URL entry replays offline from its HAR, without --network and without a loopback block', async () => {
    const har = path.join(tmp, 'har-remote');
    const html = '<!doctype html><html lang="en"><head><title>Remote</title></head><body><h1 class="tell-gradient">Remote</h1><p class="tell-fresh">fresh</p></body></html>';
    const harFile = {
      log: {
        version: '1.2',
        creator: { name: 'calibrate test', version: '1' },
        pages: [],
        entries: [{
          startedDateTime: '2026-10-01T00:00:00.000Z',
          time: 1,
          request: { method: 'GET', url: 'https://remote.example/', httpVersion: 'HTTP/1.1', cookies: [], headers: [], queryString: [], headersSize: -1, bodySize: 0 },
          response: {
            status: 200, statusText: 'OK', httpVersion: 'HTTP/1.1', cookies: [], headers: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
            content: { size: html.length, mimeType: 'text/html; charset=utf-8', text: html }, redirectURL: '', headersSize: -1, bodySize: html.length,
          },
          cache: {},
          timings: { send: 0, wait: 0, receive: 0 },
        }],
      },
    };
    for (const v of ['desktop', 'mobile']) {
      const file = path.join(har, 'pos-remote', `${v}.har`);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(harFile));
    }
    const remoteCorpus = path.join(tmp, 'remote-corpus.json');
    writeFileSync(remoteCorpus, JSON.stringify({
      version: 1,
      entries: [{ id: 'pos-remote', set: 'positive', status: 'ready', render: { type: 'url', url: 'https://remote.example/', routes: [{ path: '/', name: 'home', first: true }] } }],
    }));
    const run = await calibrate(options({ corpus: remoteCorpus, out: path.join(tmp, 'remote'), har, registry: path.join(RULES, 'registry-clean.json') }), { now: NOW, log });
    const remote = entry(run, 'pos-remote');
    assert.deepEqual(remote.runtime.pages.map((p) => [p.mode, p.ok, p.status]), [['replay', true, 200], ['replay', true, 200]], JSON.stringify(remote.runtime.pages));
    assert.equal(remote.rules['SL-T01'].state, 'fired', 'the replayed page rendered');
    assert.equal(remote.rules['SL-T07'].state, 'fired', 'fresh pages replay from the HAR too');
  });

  test('--har inside a git work tree is refused', async () => {
    await assert.rejects(calibrate(options({ out: path.join(tmp, 'x'), har: path.join(FIX, 'har') }), { now: NOW, log }), /inside the git work tree/);
  });

  test('CLI: a run writes the results and exits 0; --apply writes the reviewed proposal into a registry copy', async () => {
    const rules = path.join(tmp, 'rules-copy');
    cpSync(RULES, rules, { recursive: true });
    const registry = path.join(rules, 'registry-clean.json');
    const out = path.join(tmp, 'cli');
    const r = await cli(['--corpus', corpus, '--registry', registry, '--base', FIX, '--out', out, '--entries', 'pos-a,pos-b,syn-a,ctl-a,ctl-wb', '--json', '--wayback-delay', '0']);
    assert.equal(r.status, 0, r.stderr);
    const summary = JSON.parse(r.stdout);
    assert.equal(summary.ok, true);
    assert.deepEqual(summary.entries, { measured: 5, partial: 0, failed: 0, skipped: 0 });
    const proposal = path.join(out, 'proposal.json');
    const applied = await cli(['--apply', proposal, '--registry', registry, '--json']);
    assert.equal(applied.status, 0, applied.stderr);
    const t01 = JSON.parse(readFileSync(registry, 'utf8')).rules.find((/** @type {any} */ x) => x.id === 'SL-T01');
    assert.equal(t01.tier, 'tier1');
    assert.deepEqual(t01.calibration.controls, { fired: 0, total: 2 });
    assert.equal(readFileSync(path.join(RULES, 'registry-clean.json'), 'utf8').includes('"tier1"'), false, 'the fixture registry itself is untouched');
    appendFileSync(path.join(rules, 'runtime', 'SL-T02.mjs'), '// changed after the run\n');
    const before = readFileSync(registry, 'utf8');
    const stale = await cli(['--apply', proposal, '--registry', registry]);
    assert.equal(stale.status, 2);
    assert.match(stale.stderr, /SL-T02: its registry entry or detector changed/);
    assert.equal(readFileSync(registry, 'utf8'), before);
  });
});
