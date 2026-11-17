// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { launch } from '../../lib/browser.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import { aggregate } from '../../lib/report.mjs';
import { serveStatic } from '../../lib/serve.mjs';
import { run } from '../../motion-check.mjs';

/** @typedef {import('playwright-core').Browser} Browser */
/** @typedef {import('../../lib/report.mjs').GateResult} GateResult */

const FIXTURES = fileURLToPath(new URL('../fixtures/motion/', import.meta.url));
const CLI = fileURLToPath(new URL('../../motion-check.mjs', import.meta.url));
const DESKTOP = { name: 'desktop', width: 1280, height: 800, dpr: 1, isMobile: false, hasTouch: false };
const PHONE = { name: 'mobile', width: 390, height: 844, dpr: 2, isMobile: true, hasTouch: true };
const ROUTES = [{ path: '/', name: 'home', first: true, features: [], states: [] }];

/** @type {Browser} */
let browser;
/** @type {string} */
let tmp;

/**
 * @param {string} site
 * @param {{design?: string, viewports?: Array<typeof DESKTOP>, gates?: string[]}} [options]
 * @returns {Promise<Record<string, GateResult>>}
 */
async function check(site, { design, viewports = [DESKTOP], gates } = {}) {
  const server = await serveStatic(site);
  try {
    const ctx = { root: tmp, profile: defaultProfile(), state: null, design: design ?? path.join(tmp, 'no-design'), routes: ROUTES, baseUrl: server.url, browser, viewports, args: {}, log: () => undefined };
    const results = await run(ctx, gates);
    return Object.fromEntries(results.map((r) => [r.id, r]));
  } finally {
    await server.close();
  }
}

/**
 * @param {GateResult} g
 * @param {RegExp} pattern
 */
function hasEvidence(g, pattern) {
  return g.evidence.some((e) => pattern.test(JSON.stringify(e)));
}

describe('browser: motion-check gates', () => {
  /** @type {Record<string, GateResult>} */
  let pass;
  /** @type {Record<string, GateResult>} */
  let fail;

  before(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-motion-'));
    browser = await launch();
    pass = await check(path.join(FIXTURES, 'pass'), { viewports: [DESKTOP, PHONE] });
    fail = await check(path.join(FIXTURES, 'fail'));
  });

  after(async () => {
    await browser?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test('the passing page passes every gate on desktop and a touch phone', () => {
    for (const id of ['motion.reduced', 'motion.hidden-at-rest', 'motion.inventory']) assert.equal(pass[id].state, 'ok', `${id}: ${pass[id].detail}`);
    assert.equal(aggregate(Object.values(pass)).ok, true);
    assert.ok(hasEvidence(pass['motion.inventory'], /data-live/), 'the live pulse is listed as a note, not a failure');
    assert.match(pass['motion.inventory'].detail, /press/, 'the press pass recorded the button scale');
  });

  test('motion.reduced fails on a transform that still runs under reduce and on text that disappears', () => {
    const g = fail['motion.reduced'];
    assert.equal(g.state, 'fail');
    assert.ok(hasEvidence(g, /transform/), 'the hero rise still moves');
    assert.ok(hasEvidence(g, /Disclosure.*missing under reduce/), 'display:none under reduce');
  });

  test('motion.hidden-at-rest fails on a scroll reveal and on a hero entering from invisible', () => {
    const g = fail['motion.hidden-at-rest'];
    assert.equal(g.state, 'fail');
    assert.ok(hasEvidence(g, /Proof of settlement.*until scrolled into view/), 'the reveal probe catches the IntersectionObserver section');
    assert.ok(hasEvidence(g, /hero or a figure enters from invisible/), 'the hero fades in from opacity 0');
  });

  test('motion.inventory fails on over-budget entrances and hovers and on a loop without data-live', () => {
    const g = fail['motion.inventory'];
    assert.equal(g.state, 'fail');
    assert.ok(hasEvidence(g, /800 ms/), 'the 800 ms hero entrance');
    assert.ok(hasEvidence(g, /hover budget of 200 ms/), 'the 600 ms hover colour');
    assert.ok(hasEvidence(g, /not marked data-live/), 'the spinner');
    assert.ok(hasEvidence(g, /SL-MO1/) && hasEvidence(g, /SL-MO2/), 'transition: all and ease-in are noted');
  });

  test('a long animation fails the budget unless design/motion.json marks it as an explanation', async () => {
    const site = path.join(FIXTURES, 'budget', 'site');
    const bare = await check(site, { gates: ['motion.inventory'] });
    assert.equal(bare['motion.inventory'].state, 'fail');
    assert.ok(hasEvidence(bare['motion.inventory'], /900 ms/));
    const exempt = await check(site, { design: path.join(FIXTURES, 'budget', 'design'), gates: ['motion.inventory', 'motion.reduced'] });
    assert.equal(exempt['motion.inventory'].state, 'ok', exempt['motion.inventory'].detail);
    assert.match(exempt['motion.inventory'].detail, /manifest/);
    assert.equal(exempt['motion.reduced'].state, 'ok', 'animation: none under reduce');
  });

  test('CLI with --serve: exit 0 on the passing page, exit 1 on the failing one', () => {
    const args = (/** @type {string} */ dir) => [CLI, '--root', tmp, '--state', path.join(tmp, 'state'), '--serve', dir, '--json'];
    const good = spawnSync(process.execPath, args(path.join(FIXTURES, 'pass')), { encoding: 'utf8' });
    assert.equal(good.status, 0, good.stdout + good.stderr);
    const bad = spawnSync(process.execPath, args(path.join(FIXTURES, 'fail')), { encoding: 'utf8' });
    assert.equal(bad.status, 1, bad.stderr);
    assert.equal(JSON.parse(bad.stdout).counts.fail, 3);
  });
});
