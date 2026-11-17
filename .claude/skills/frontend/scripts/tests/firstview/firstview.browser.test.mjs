// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run } from '../../firstview.mjs';
import { launch } from '../../lib/browser.mjs';
import { loadProfile } from '../../lib/profile.mjs';
import { loadRoutes } from '../../lib/routes.mjs';
import { serveStatic } from '../../lib/serve.mjs';

/**
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('../../lib/serve.mjs').StaticServer} StaticServer
 * @typedef {import('../../coverage.mjs').CheckContext} CheckContext
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(HERE, '..', '..');
const FIX = path.resolve(HERE, '..', 'fixtures', 'firstview');
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, dpr: 1 },
  { name: 'mobile', width: 390, height: 844, dpr: 2, isMobile: true, hasTouch: true },
  { name: 'reflow', width: 320, height: 640, dpr: 1 },
];
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-firstview-browser-'));

/**
 * A bare frontend block on disk (the complexity band is read from the file).
 * @param {string} name
 * @param {Record<string, unknown>} [extra]
 * @returns {string}
 */
function profileFile(name, extra = {}) {
  const file = path.join(tmp, `${name}.json`);
  writeFileSync(file, JSON.stringify({ judged_surface: 'site', stack: 'static-html', hosting: 'local', sponsors: ['cardano'], viewports: VIEWPORTS, ...extra }));
  return file;
}

/** @type {Browser} */
let browser;
/** @type {Record<string, StaticServer>} */
const sites = {};

/**
 * @param {string} site
 * @param {string} [profilePath]
 * @returns {CheckContext}
 */
function ctx(site, profilePath = profileFile('plain')) {
  const profile = loadProfile(profilePath);
  const state = path.join(tmp, `state-${site}`);
  mkdirSync(state, { recursive: true });
  return { root: FIX, profile, state, routes: loadRoutes(FIX, profile), baseUrl: sites[site].url, browser, viewports: profile.viewports, args: {}, log: () => {} };
}

describe('first-view gates in Chromium', () => {
  before(async () => {
    browser = await launch();
    for (const site of ['pass', 'fail', 'busy']) sites[site] = await serveStatic(path.join(FIX, site));
  });

  after(async () => {
    await browser?.close();
    for (const s of Object.values(sites)) await s.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('passing fixture: the contract holds at desktop and mobile; the complexity gate reports and passes', async () => {
    const c = ctx('pass');
    const [contract, complexity] = await run(c, ['firstview']);
    assert.equal(contract.state, 'ok', contract.detail);
    assert.match(contract.detail, /first viewport complete at desktop 1440x900 and mobile 390x844/);
    assert.deepEqual(contract.evidence.map((e) => e.viewport), ['desktop', 'mobile'], 'the reflow viewport is not a first view');
    assert.match(String(contract.evidence[0].value), /h1 "See when your withdrawal clears" \(5 words\); sentence \(14 words\); sponsor Cardano/);
    assert.equal(complexity.state, 'ok', complexity.detail);
    assert.equal(complexity.advisory, true, 'an uncalibrated band is advisory, counted apart from passed checks');
    assert.match(complexity.detail, /^advisory until calibrated: \d+\.\d KiB as JPEG q70 at 1440x900, below the provisional band 38\.1-119\.7 KiB/);
    const file = String(complexity.evidence[0].file);
    assert.ok(existsSync(file), `the measured JPEG is kept at ${file}`);
    assert.equal(readFileSync(file).subarray(0, 2).toString('hex'), 'ffd8');
  });

  test('failing fixture: every clause of the contract fails at both viewports', async () => {
    const [contract] = await run(ctx('fail'), ['firstview.contract']);
    assert.equal(contract.state, 'fail');
    for (const viewport of ['desktop', 'mobile']) {
      const problems = contract.evidence.filter((e) => e.viewport === viewport && e.selector !== undefined).map((e) => String(e.value)).join('\n');
      assert.match(problems, /the h1 has 14 words/, viewport);
      assert.match(problems, /no visible \[data-hero="sentence"\] in the first viewport/, viewport);
      assert.match(problems, /no sponsor name in the first viewport's text \(looked for Cardano\)/, viewport);
      assert.match(problems, /the figure "12" has no data-ledger, nor data-source with data-as-of/, viewport);
      assert.match(problems, /the \[data-surface="product"\] starts below the fold/, viewport);
    }
  });

  test('a calibrated band from the profile passes a simple page and fails a cluttered one', async () => {
    const banded = profileFile('banded', { firstview: { complexity: { min_kib: 1, max_kib: 60, calibrated: true, source: 'test band' } } });
    const [simple] = await run(ctx('pass', banded), ['firstview.complexity']);
    assert.equal(simple.state, 'ok', simple.detail);
    assert.match(simple.detail, /within the calibrated band 1-60 KiB/);
    const [busy] = await run(ctx('busy', banded), ['firstview.complexity']);
    assert.equal(busy.state, 'fail');
    assert.match(busy.detail, /above the calibrated band 1-60 KiB .*remove texture, photographs and competing elements/);
    assert.ok(Number(busy.evidence[0].value) > 60);
  });

  test('the same cluttered page only reports while the band is provisional', async () => {
    const [busy] = await run(ctx('busy'), ['firstview.complexity']);
    assert.equal(busy.state, 'ok');
    assert.match(busy.detail, /^advisory until calibrated: .* above the provisional band/);
  });

  test('the module CLI: exit 0 on the passing page, 1 on the failing one', () => {
    const plain = profileFile('cli');
    const cli = (/** @type {string} */ site) => spawnSync(process.execPath, [
      path.join(SCRIPTS, 'firstview.mjs'), '--serve', path.join(FIX, site), '--root', FIX, '--profile', plain, '--state', path.join(tmp, `cli-${site}`), '--json',
    ], { encoding: 'utf8' });
    const ok = cli('pass');
    assert.equal(ok.status, 0, ok.stderr);
    assert.deepEqual(JSON.parse(ok.stdout).counts, { ok: 2, fail: 0, skipped: 0, advisory: 1 }, 'the uncalibrated complexity gate is counted as advisory');
    const bad = cli('fail');
    assert.equal(bad.status, 1, bad.stderr);
    assert.match(bad.stderr, /firstview\.contract: fail/);
  });
});
