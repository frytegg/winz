// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GATES, coverageProbe, evaluateProbe, run } from '../../coverage.mjs';
import { launch, withPage } from '../../lib/browser.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import { aggregate } from '../../lib/report.mjs';
import { loadRoutes } from '../../lib/routes.mjs';
import { serveStatic } from '../../lib/serve.mjs';

/**
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('../../lib/serve.mjs').StaticServer} StaticServer
 * @typedef {import('../../coverage.mjs').CheckContext} CheckContext
 * @typedef {import('../../lib/report.mjs').GateResult} GateResult
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(HERE, '..', '..');
const FIX = path.resolve(HERE, '..', 'fixtures', 'coverage');
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800, dpr: 1 },
  { name: 'mobile', width: 390, height: 844, dpr: 1, isMobile: true, hasTouch: true },
];
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-coverage-browser-'));

/** @param {Record<string, unknown>} [paths] @param {Record<string, unknown>} [extra] */
function profileWith(paths = {}, extra = {}) {
  return defaultProfile({
    record_mode: true,
    viewports: VIEWPORTS,
    paths: {
      claims_ledger: path.join(FIX, 'ledger.md'),
      never_show: path.join(FIX, 'never-show.json'),
      feature_catalogue: path.join(FIX, 'catalogue.json'),
      ...paths,
    },
    ...extra,
  });
}

/** @type {Browser} */
let browser;
/** @type {StaticServer} */
let passSite;
/** @type {StaticServer} */
let failSite;

/**
 * @param {string} baseUrl
 * @param {Partial<CheckContext>} [over]
 * @returns {CheckContext}
 */
function ctx(baseUrl, over = {}) {
  const profile = over.profile ?? profileWith();
  return {
    root: FIX, profile, state: path.join(FIX, 'state'), design: path.join(FIX, 'design'), routes: loadRoutes(FIX, profile),
    baseUrl, browser, viewports: profile.viewports, args: {}, log: () => {}, ...over,
  };
}

/** @param {GateResult[]} results @param {string} id @returns {GateResult} */
function byId(results, id) {
  const r = results.find((x) => x.id === id);
  assert.ok(r, `${id} reported`);
  return r;
}

describe('coverage gates in Chromium', () => {
  before(async () => {
    browser = await launch();
    passSite = await serveStatic(path.join(FIX, 'pass'));
    failSite = await serveStatic(path.join(FIX, 'fail'));
  });

  after(async () => {
    await browser?.close();
    await passSite?.close();
    await failSite?.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('passing fixture: all five gates ok at desktop and mobile, in record mode', async () => {
    const results = await run(ctx(passSite.url), ['coverage']);
    for (const r of results) assert.equal(r.state, 'ok', `${r.id}: ${r.detail}`);
    assert.match(byId(results, 'coverage.features').detail, /2 features visible with heading, status label and proof at desktop, mobile/);
    assert.match(byId(results, 'coverage.hero').detail, /equal brief\.hero at desktop, mobile/);
    assert.match(byId(results, 'coverage.nevershow').detail, /4 active entries .*1 past their until_utc/);
    assert.equal(aggregate(results, { requested: GATES }).ok, true);
  });

  test('failing fixture: every gate fails and its evidence says why', async () => {
    const results = await run(ctx(failSite.url), ['coverage']);
    for (const r of results) assert.equal(r.state, 'fail', `${r.id} should fail: ${r.detail}`);

    const features = byId(results, 'coverage.features');
    assert.match(features.detail, /^2 of 2 features not covered \(FR-001, FR-002\)/);
    const featureText = features.evidence.map((e) => `${e.feature} ${e.viewport} ${e.value}`).join('\n');
    assert.match(featureText, /FR-001 desktop no data-status label/);
    assert.match(featureText, /FR-002 mobile the data-feature element is not visible/);

    const metrics = byId(results, 'coverage.metrics').evidence.map((e) => String(e.value)).join('\n');
    assert.match(metrics, /data-metric without data-ledger or data-source \(text "12"\)/);
    assert.match(metrics, /data-ledger="C-002" is unverified in the claims ledger/);
    assert.match(metrics, /data-ledger="C-999" is not a row of the claims ledger/);
    assert.match(metrics, /stat-like figure "\$12\.4M"/);

    assert.match(byId(results, 'coverage.hero').detail, /reads "Withdrawals, finally visible" but brief\.hero\.h1 is "See when your withdrawal clears"/);

    const never = byId(results, 'coverage.nevershow');
    const places = [...new Set(never.evidence.map((e) => `${e.entry}: ${String(e.value).replace(/^.* found in /, '')}`))].sort();
    assert.deepEqual(places, ['NS-ACTIVE: visible text', 'NS-META: meta description', 'NS-REGEX: hidden page text', 'NS-TITLE: the document title']);
    assert.doesNotMatch(JSON.stringify(never), /Nightjar|withdrawal race|internal ref 42/i);

    const kinds = [...new Set(byId(results, 'coverage.placeholders').evidence.map((e) => e.kind))].sort();
    assert.deepEqual(kinds, ['TODO', '[YOUR ...]', 'broken value', 'coming soon stub', 'example domain', 'lorem ipsum', 'unrendered template', 'xxx']);
  });

  test('outside record mode the queue feature stays hidden, so coverage.features fails', async () => {
    const profile = profileWith({}, { record_mode: false });
    const [features] = await run(ctx(passSite.url, { profile }), ['coverage.features']);
    assert.equal(features.state, 'fail');
    assert.match(features.detail, /FR-002 .*the data-feature element is not visible/);
  });

  test('--features narrows the check to the ids given', async () => {
    const [onlyOne] = await run(ctx(failSite.url, { args: { features: 'FR-001' } }), ['coverage.features']);
    assert.equal(onlyOne.state, 'fail');
    assert.match(onlyOne.detail, /^1 of 1 feature not covered \(FR-001\)/);
    const [passing] = await run(ctx(passSite.url, { args: { features: 'FR-001' } }), ['coverage.features']);
    assert.equal(passing.state, 'ok', passing.detail);
  });

  test('an owner waiver keeps a row off the page; another kind of waiver does not; an unmapped id fails', async () => {
    const waived = profileWith({ feature_catalogue: path.join(FIX, 'catalogue-waived.json') });
    const [mixed] = await run(ctx(passSite.url, { profile: waived }), ['coverage.features']);
    assert.equal(mixed.state, 'fail');
    assert.match(mixed.detail, /^1 of 3 features not covered \(FR-005\)/);
    assert.match(JSON.stringify(mixed.evidence), /FR-003 kept off the page by owner waiver/);
    const [ok] = await run(ctx(passSite.url, { profile: waived, args: { features: 'FR-001,FR-003' } }), ['coverage.features']);
    assert.equal(ok.state, 'ok', ok.detail);
    assert.match(ok.detail, /1 kept off the page by owner waiver/);
    const unmapped = profileWith({ feature_catalogue: path.join(FIX, 'catalogue-unmapped.json') });
    const [notMapped] = await run(ctx(passSite.url, { profile: unmapped }), ['coverage.features']);
    assert.equal(notMapped.state, 'fail');
    assert.match(JSON.stringify(notMapped.evidence), /FR-004.*not mapped to any route in routes\.json; rendered on \//);
  });

  test('a never-show entry whose embargo has not ended yet is active again', async () => {
    const [never] = await run(ctx(passSite.url, { now: '1999-06-01T00:00:00Z' }), ['coverage.nevershow']);
    assert.equal(never.state, 'fail');
    assert.deepEqual(never.evidence.map((e) => [e.entry, e.viewport]), [['NS-EXPIRED', 'desktop, mobile']]);
    assert.match(String(never.evidence[0].value), /found in hidden page text/);
  });

  test('missing inputs skip their gate, and a skipped gate makes the report not ok', async () => {
    const profile = profileWith({ never_show: null });
    const empty = path.join(tmp, 'no-brief');
    mkdirSync(empty, { recursive: true });
    const results = await run(ctx(passSite.url, { profile, state: empty }), ['coverage.nevershow', 'coverage.hero', 'coverage.placeholders']);
    assert.deepEqual(results.map((r) => [r.id, r.state]), [['coverage.hero', 'skipped'], ['coverage.nevershow', 'skipped'], ['coverage.placeholders', 'ok']]);
    assert.match(byId(results, 'coverage.nevershow').detail, /no never-show list: set paths\.never_show/);
    assert.match(byId(results, 'coverage.hero').detail, /cannot read brief\.hero/);
    assert.equal(aggregate(results, { requested: GATES.filter((g) => g.id !== 'coverage.features' && g.id !== 'coverage.metrics') }).ok, false);
  });

  test('visibility follows what a judge can reach', async () => {
    const site = await serveStatic(path.join(FIX, 'visibility'));
    try {
      const desktop = { ...VIEWPORTS[0], isMobile: false, hasTouch: false };
      const plain = await withPage(browser, desktop, `${site.url}/`, (page) => evaluateProbe(page, coverageProbe, {}));
      const shell = await withPage(browser, desktop, `${site.url}/shell`, (page) => evaluateProbe(page, coverageProbe, {}));
      const visible = Object.fromEntries([...plain.features, ...shell.features].map((f) => [f.ids[0], f.visible]));
      assert.deepEqual(visible, {
        'FR-100': true,
        'FR-101': false,
        'FR-104': false,
        'FR-105': false,
        'FR-106': false,
        'FR-107': true,
        'FR-108': false,
        'FR-103': true,
        'FR-102': true,
      });
    } finally {
      await site.close();
    }
  });

  test('the module CLI: exit 0 on the passing site, 1 on the failing one, 2 without a target', () => {
    const state = path.join(tmp, 'cli-state');
    mkdirSync(state, { recursive: true });
    copyFileSync(path.join(FIX, 'state', 'brief.json'), path.join(state, 'brief.json'));
    const profileFile = path.join(tmp, 'profile.json');
    writeFileSync(profileFile, JSON.stringify({
      judged_surface: 'site', stack: 'static-html', hosting: 'local', record_mode: true, viewports: VIEWPORTS,
      paths: { claims_ledger: path.join(FIX, 'ledger.md'), never_show: path.join(FIX, 'never-show.json'), feature_catalogue: path.join(FIX, 'catalogue.json') },
    }));
    const cli = (/** @type {string[]} */ args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'coverage.mjs'), '--root', FIX, '--profile', profileFile, '--state', state, ...args], { encoding: 'utf8' });
    const ok = cli(['--serve', path.join(FIX, 'pass'), '--json']);
    assert.equal(ok.status, 0, ok.stderr);
    const report = JSON.parse(ok.stdout);
    assert.deepEqual([report.ok, report.tool, report.counts], [true, 'coverage', { ok: 5, fail: 0, skipped: 0 }]);
    const bad = cli(['--serve', path.join(FIX, 'fail'), '--gates', 'coverage.hero,coverage.placeholders', '--out', path.join(tmp, 'out')]);
    assert.equal(bad.status, 1, bad.stderr);
    assert.match(bad.stderr, /coverage\.hero: fail/);
    assert.match(bad.stderr, /report written to .*coverage-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.json/);
    assert.equal(cli([]).status, 2);
    assert.equal(cli(['--serve', path.join(FIX, 'pass'), '--gates', 'render.console']).status, 2);
  });
});
