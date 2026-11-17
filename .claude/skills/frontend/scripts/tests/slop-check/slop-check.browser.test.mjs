// @ts-check
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { launch } from '../../lib/browser.mjs';
import { sha256File } from '../../lib/fsutil.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import { aggregate } from '../../lib/report.mjs';
import { serveStatic } from '../../lib/serve.mjs';
import { GATES, run } from '../../slop-check.mjs';

/**
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('../../lib/report.mjs').GateResult} GateResult
 * @typedef {import('../../lib/profile.mjs').Profile} Profile
 */

const SCRIPTS = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../fixtures/slop-check/', import.meta.url));
const REGISTRY = path.join(FIXTURES, 'rules', 'registry.json');
const ERRORS_REGISTRY = path.join(FIXTURES, 'rules', 'registry-errors.json');
const CLI = path.join(SCRIPTS, 'slop-check.mjs');

/** @type {Browser} */
let browser;
let tmp = '';

/**
 * A temporary copy of a fixture repository (outside any git work tree), with a test sponsor allowlist whose TestCo
 * entry holds the SHA-256 of the fixture's official file and whose ClaimCo entry claims its colours as a mark.
 * @param {string} name
 * @param {{waivers?: boolean}} [options]
 * @returns {{root: string, state: string, sponsors: string}}
 */
function repoCopy(name, { waivers = false } = {}) {
  const root = mkdtempSync(path.join(tmp, `${name}-`));
  cpSync(path.join(FIXTURES, name), root, { recursive: true });
  if (waivers) cpSync(path.join(FIXTURES, 'waivers.json'), path.join(root, 'design', 'waivers.json'));
  const official = path.join(FIXTURES, 'sloppy', 'public', 'sponsor.svg');
  const sponsors = path.join(root, 'sponsors.json');
  writeFileSync(sponsors, JSON.stringify({ sponsor_allowlist: [
    { sponsor: 'testco', display_name: 'TestCo', logo_sources: [{ variant: 'mark', format: 'svg', sha256: sha256File(official) }], colours: { claimed_as_mark: false } },
    { sponsor: 'claimco', display_name: 'ClaimCo (Claim Foundation)', logo_sources: [], colours: { claimed_as_mark: true } },
  ] }));
  return { root, state: path.join(root, '.frontend'), sponsors };
}

/**
 * Serves `<root>/dist` and runs the tells gates against it with the shared browser.
 * @param {{root: string, state: string, sponsors: string}} repo
 * @param {Profile} profile
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<{results: Record<string, GateResult>, list: GateResult[], doc: Record<string, any>, log: string[]}>}
 */
async function runServed(repo, profile, args = {}) {
  const site = await serveStatic(path.join(repo.root, 'dist'));
  /** @type {string[]} */
  const log = [];
  try {
    const list = await run({
      root: repo.root, profile, state: repo.state, baseUrl: site.url, browser, viewports: profile.viewports,
      args: { registry: REGISTRY, 'sponsor-allowlist': repo.sponsors, ...args }, log: (m) => log.push(m),
    });
    const dir = path.join(repo.state, 'tells');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    const doc = JSON.parse(readFileSync(path.join(dir, files[files.length - 1]), 'utf8'));
    return { results: Object.fromEntries(list.map((r) => [r.id, r])), list, doc, log };
  } finally {
    await site.close();
  }
}

/**
 * @param {Record<string, any>} doc
 * @param {string} rule
 * @returns {string[]}
 */
function where(doc, rule) {
  return doc.findings
    .filter((/** @type {any} */ f) => f.rule === rule)
    .map((/** @type {any} */ f) => (f.layer === 'runtime' ? `${f.route} ${f.viewport} ${f.selector}` : `${f.file}:${f.line}`));
}

describe('browser: slop-check run() over both layers', () => {
  before(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-slop-browser-'));
    browser = await launch();
  });

  after(async () => {
    await browser?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test('sloppy build: tier 1 and tier 2 fail on rendered findings; the score reports 11 from 4 rules (failing fixture)', async () => {
    const { results, doc, log } = await runServed(repoCopy('sloppy'), defaultProfile());
    assert.equal(results['tells.tier1'].state, 'fail');
    assert.match(results['tells.tier1'].detail, /2 tier-1 rules fire with confirmed findings: SL-T02 \(5 findings\), SL-X02 \(1 finding\)/);
    assert.deepEqual(where(doc, 'SL-T02'), ['/ desktop #title', '/ mobile #title', '/about desktop #about-title', '/about mobile #about-title', 'src/App.jsx:4']);
    assert.equal(results['tells.tier2'].state, 'fail');
    assert.match(results['tells.tier2'].detail, /2 tier-2 rules fire without a valid waiver: SL-T04 \(3 findings\), SL-T09 \(2 findings\)/);
    const score = results['tells.score'];
    assert.equal(score.state, 'ok');
    assert.equal(score.advisory, true, 'report only while score_max is null');
    assert.match(score.detail, /^advisory: score 11 from 4 rules \(2 anchors counted double\): SL-G01 4, SL-M04 4, SL-T01 2, SL-C01 1; report only/);
    assert.deepEqual(doc.score.byRoute, [
      { route: '/', score: 11, rules: ['SL-G01', 'SL-M04', 'SL-T01', 'SL-C01'] },
      { route: '/about', score: 6, rules: ['SL-G01', 'SL-T01'] },
    ]);
    const viewports = new Set(doc.findings.filter((/** @type {any} */ f) => f.layer === 'runtime').map((/** @type {any} */ f) => f.viewport));
    assert.deepEqual([...viewports].sort(), ['desktop', 'mobile'], 'the reflow viewport is not a tells viewport');
    assert.deepEqual(doc.target.viewports, ['desktop', 'mobile']);
    assert.equal(where(doc, 'SL-T08').length, 1);
    assert.equal(doc.findings.find((/** @type {any} */ f) => f.rule === 'SL-T08').confirmed, false, 'a static finding the page never renders stays unconfirmed');
    const remote = doc.findings.find((/** @type {any} */ f) => f.selector === '#remote-mark');
    assert.match(remote.notes[0], /https:\/\/example\.invalid\/logo\.svg is not served by the app under test/);
    assert.ok(log.includes('runtime layer /about at mobile: 2 findings, 0 detector errors'), log.join('\n'));
  });

  test('waived build: route, selector, file, category and sponsor-hash exemptions pass every gate (passing fixture)', async () => {
    const repo = repoCopy('sloppy', { waivers: true });
    const { results, list, doc } = await runServed(repo, defaultProfile({ sponsors: ['testco'], tells: { score_max: 6 } }));
    assert.deepEqual(list.map((r) => [r.id, r.state]), [['tells.tier1', 'ok'], ['tells.tier2', 'ok'], ['tells.score', 'ok']]);
    assert.equal(aggregate(list, { requested: GATES }).ok, true);
    assert.match(results['tells.score'].detail, /^score 6 from 2 rules \(1 anchor counted double\): SL-G01 4, SL-T01 2, within score_max 6/);
    const exemptOf = (/** @type {string} */ id) => doc.findings.filter((/** @type {any} */ f) => f.rule === id).map((/** @type {any} */ f) => f.exempt?.kind ?? null);
    assert.deepEqual(exemptOf('SL-T02'), ['waiver', 'waiver', 'waiver', 'waiver', 'rendered']);
    assert.deepEqual(exemptOf('SL-T04'), ['category', 'category', 'category']);
    assert.deepEqual(exemptOf('SL-T09'), ['waiver', 'waiver']);
    assert.deepEqual(exemptOf('SL-M04'), ['waiver', 'waiver']);
    assert.deepEqual(where(doc, 'SL-T01'), [
      '/ desktop #hero-bg', '/ desktop #sponsor-logo', '/ mobile #hero-bg', '/ mobile #sponsor-logo', '/about desktop #remote-mark',
      '/about mobile #remote-mark', 'index.html:6', 'public/sponsor.svg:1', 'src/App.jsx:6',
    ]);
    assert.deepEqual(exemptOf('SL-T01'), [null, 'sponsor-hash', null, 'sponsor-hash', null, null, 'sponsor-hash', 'sponsor-hash', null],
      'the served logo (fetched), the static asset reference and the official file match by hash; the gradient and the remote mark do not');
    assert.deepEqual(doc.waivers.map((/** @type {any} */ w) => [w.index, w.valid, w.covered]), [
      [0, true, 2], [1, true, 2], [2, true, 1], [3, true, 2], [4, true, 2], [5, false, 0], [6, false, 0], [7, true, 0],
    ]);
    assert.match(doc.waivers[5].problems[0], /cites ClaimCo/);
    assert.deepEqual(doc.waivers[7].notes, ['matched no finding in this run: check the scope']);
    assert.deepEqual(doc.category.map((/** @type {any} */ c) => c.applies), [true, true, false]);
    assert.deepEqual(doc.sponsors, { ids: ['testco'], hashes: 1 });

    const over = await runServed(repoCopy('sloppy', { waivers: true }), defaultProfile({ sponsors: ['testco'], tells: { score_max: 5 } }));
    assert.equal(over.results['tells.score'].state, 'fail');
    assert.match(over.results['tells.score'].detail, /score 6 from 2 rules .* above score_max 5/);
  });

  test('clean build: every gate is ok and the score is 0', async () => {
    const { list, doc } = await runServed(repoCopy('clean'), defaultProfile());
    assert.deepEqual(list.map((r) => r.state), ['ok', 'ok', 'ok']);
    assert.equal(doc.score.total, 0);
    assert.deepEqual(doc.counts, { findings: 0, counted: 0, exempt: 0, unconfirmed: 0, errors: 0, pageErrors: 0 });
  });

  test('the runtime layer alone: rules without a runtime detector cannot be judged, so the score is skipped', async () => {
    const { results } = await runServed(repoCopy('sloppy'), defaultProfile(), { layers: 'runtime' });
    assert.equal(results['tells.tier1'].state, 'fail', 'SL-T02 still fires; SL-X02 is undecidable');
    assert.equal(results['tells.score'].state, 'skipped');
    assert.match(results['tells.score'].detail, /cannot be judged: the static layer did not run \(--layers runtime\) \(SL-G01\); partial score 7/);
  });

  test('a runtime detector that throws fails the gate judging its rule, on every page it ran', async () => {
    const { results, doc } = await runServed(repoCopy('clean'), defaultProfile(), { registry: ERRORS_REGISTRY });
    assert.equal(results['tells.tier1'].state, 'ok');
    assert.equal(results['tells.score'].state, 'fail');
    assert.match(results['tells.score'].detail, /3 detector errors \(a skill defect, not a product finding\)/);
    assert.deepEqual(doc.errors.map((/** @type {any} */ e) => [e.rule, e.layer, e.route ?? '', e.viewport ?? '']), [
      ['SL-T20', 'static', '', ''], ['SL-T13', 'runtime', '/', 'desktop'], ['SL-T13', 'runtime', '/', 'mobile'],
    ]);
    assert.match(doc.errors[1].error, /TypeError: fixture detector failure/);
  });

  test('a page that never becomes ready fails every gate whose rules need rendering', async () => {
    const profile = defaultProfile({ ready_flag: true, viewports: [{ name: 'desktop', width: 800, height: 600 }] });
    const { list, doc } = await runServed(repoCopy('clean'), profile);
    assert.deepEqual(list.map((r) => r.state), ['fail', 'fail', 'fail']);
    for (const r of list) assert.match(r.detail, /runtime layer incomplete on 1 page: \/ at desktop: CheckError: page not ready/);
    assert.equal(doc.pageErrors.length, 1);
  });
});

/**
 * @param {string[]} args
 * @returns {Promise<{status: number | null, stdout: string, stderr: string}>}
 */
function cli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill(), 120000);
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

describe('browser: slop-check CLI with --serve', () => {
  let dir = '';
  before(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'fe-slop-cli-'));
  });
  after(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * @param {string} name
   * @returns {string[]}
   */
  function argsFor(name) {
    const root = mkdtempSync(path.join(dir, `${name}-`));
    cpSync(path.join(FIXTURES, name), root, { recursive: true });
    const profile = path.join(root, 'profile.json');
    writeFileSync(profile, JSON.stringify({ judged_surface: 'site', stack: 'static-html', hosting: 'local' }));
    return ['--root', root, '--profile', profile, '--state', path.join(root, 'state'), '--serve', path.join(root, 'dist'), '--registry', REGISTRY, '--json'];
  }

  test('the sloppy build exits 1 with the failing gates; the clean build exits 0', async () => {
    const sloppy = await cli(argsFor('sloppy'));
    assert.equal(sloppy.status, 1, sloppy.stderr);
    const report = JSON.parse(sloppy.stdout);
    assert.deepEqual(report.gates.map((/** @type {any} */ g) => g.state), ['fail', 'fail', 'ok']);
    assert.match(report.target.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.deepEqual(report.target.viewports, ['desktop', 'mobile']);
    assert.match(sloppy.stderr, /slop-check: serving .* at http:\/\/127\.0\.0\.1:\d+/);
    const clean = await cli(argsFor('clean'));
    assert.equal(clean.status, 0, clean.stderr);
    assert.equal(JSON.parse(clean.stdout).ok, true);
    assert.ok(existsSync(path.join(dir)));
  });
});
