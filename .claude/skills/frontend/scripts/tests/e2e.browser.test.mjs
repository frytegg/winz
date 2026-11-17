// @ts-check
/**
 * End to end: the whole scripts/ tree on two static sites with the same project content (tests/fixtures/e2e/).
 *
 * - good-site follows the skill: tokens and their generated views, the DOM markers of CONTRACTS 6.6, the brand
 *   folder, favicon set and OG image, provenance, routes, waivers, a profile, a never-show list, features FR-001 to
 *   FR-003. Its build-phase run passes every gate, and the tells layer confirms no finding at all.
 * - bad-site is built the way the owner's past hackathon sites were (purple-to-blue gradient, gradient hero text,
 *   emoji headings, Inter only, glass cards, a badge above the h1, three icon boxes, fade-in on scroll, hover fades,
 *   em dashes, an invented stats banner, Acme testimonials, "Get started" and "Learn more", no markers). Its run
 *   fails the coverage, first-view and placeholder gates, and the tells layer confirms most of the planted tells.
 *
 * Each site is copied to a temporary folder (its committed dot-frontend/ becoming the mode-B state folder .frontend/,
 * which git would ignore), its brief compiled with brief.mjs (FE-00), then checked with
 * `frontend-check --phase build --serve <copy>/site --out <dir>`, exactly as a task proof runs it. Everything is
 * offline: the bad site's Google Fonts link is aborted by the browser contexts (lib/browser.mjs newContext).
 * Regenerate the derived fixture files with: node tests/e2e/build-fixtures.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { STATE_FOLDER } from './e2e/build-fixtures.mjs';

/**
 * @typedef {{id: string, state: 'ok' | 'fail' | 'skipped', detail: string, evidence?: Array<Record<string, unknown>>, advisory?: true}} Gate
 * @typedef {{ok: boolean, counts: {ok: number, fail: number, skipped: number, advisory?: number}, gates: Gate[]}} Report
 * @typedef {{rule: string, layer: string, confirmed: boolean, counts: boolean, exempt: string | null, tier: string,
 *   route?: string, file?: string, detail: string}} JudgedFinding
 * @typedef {{counts: {findings: number, counted: number, exempt: number, unconfirmed: number, errors: number,
 *   pageErrors: number}, findings: JudgedFinding[], errors: unknown[], pageErrors: unknown[],
 *   waivers: Array<{rule: string, valid: boolean, problems: string[]}>}} Findings
 * @typedef {{exitCode: number | null, stderr: string, report: Report, findings: Findings, briefExit: number | null,
 *   briefStderr: string}} SiteRun
 */

const SCRIPTS = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FIXTURES = path.join(SCRIPTS, 'tests', 'fixtures', 'e2e');
const RUN_TIMEOUT_MS = 480000;

/**
 * The tells planted in bad-site and the registry rule that names each one. The first thirteen are the owner's
 * past-hackathon habits the fixture was asked to carry; the rest come with them.
 * @type {ReadonlyArray<{tell: string, rule: string}>}
 */
export const PLANTED = Object.freeze([
  { tell: 'purple-to-blue gradient on the hero', rule: 'SL-T01' },
  { tell: 'gradient hero text', rule: 'SL-T02' },
  { tell: 'emoji headings', rule: 'SL-T03' },
  { tell: 'Inter as the only face', rule: 'SL-T04' },
  { tell: 'glass cards', rule: 'SL-T06' },
  { tell: 'a badge above the h1', rule: 'SL-T09' },
  { tell: 'three icon boxes in a row', rule: 'SL-T08' },
  { tell: 'fade-in on scroll', rule: 'SL-T12' },
  { tell: 'buttons that fade on hover', rule: 'SL-T14' },
  { tell: 'em dashes in the copy', rule: 'SL-T16' },
  { tell: 'an invented stats banner', rule: 'SL-M04' },
  { tell: 'Acme testimonial cards', rule: 'SL-M05' },
  { tell: '"Get started" and "Learn more" in a centred hero', rule: 'SL-M12' },
  { tell: 'unsourced figures (10K+, $50M, 99.9%)', rule: 'SL-X01' },
  { tell: 'placeholder names (John Doe, Acme Corp, lorem, TODO)', rule: 'SL-X02' },
  { tell: 'buzzword copy (seamless, revolutionary, unlock)', rule: 'SL-T17' },
  { tell: 'blurred colour blobs and glows', rule: 'SL-M09' },
  { tell: '"Trusted by" headline', rule: 'SL-M17' },
  { tell: 'pill buttons', rule: 'SL-C01' },
  { tell: '100vh hero', rule: 'SL-C02' },
  { tell: 'everything centred', rule: 'SL-C03' },
  { tell: 'near-black default ground', rule: 'SL-M08' },
  { tell: 'low-contrast grey text on the dark ground', rule: 'SL-T07' },
  { tell: 'transition: all', rule: 'SL-MO1' },
  { tell: 'ease-in entrances', rule: 'SL-MO2' },
  { tell: '800 ms reveals', rule: 'SL-MO3' },
  { tell: 'no prefers-reduced-motion handling', rule: 'SL-MO5' },
]);

/** The task asks for at least this many planted tells confirmed on bad-site. */
const MIN_PLANTED_CONFIRMED = 12;

/** @type {string} */
let tmp;
/** @type {Map<string, SiteRun>} */
const runs = new Map();

/**
 * @param {string[]} args
 * @returns {{status: number | null, stdout: string, stderr: string}}
 */
function node(args) {
  const r = spawnSync(process.execPath, args, { cwd: SCRIPTS, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/**
 * Copies a fixture site, compiles its brief and runs the build phase on it.
 * @param {string} name
 * @returns {SiteRun}
 */
function checkSite(name) {
  const root = path.join(tmp, name);
  cpSync(path.join(FIXTURES, name), root, { recursive: true });
  renameSync(path.join(root, STATE_FOLDER), path.join(root, '.frontend'));
  const profile = path.join(root, '.frontend', 'profile.json');
  const state = path.join(root, '.frontend');
  const out = path.join(tmp, `out-${name}`);
  const brief = node([path.join(SCRIPTS, 'brief.mjs'), '--root', root, '--profile', profile, '--state', state]);
  const check = node([
    path.join(SCRIPTS, 'frontend-check.mjs'), '--phase', 'build', '--root', root, '--profile', profile, '--state', state,
    '--serve', path.join(root, 'site'), '--out', out, '--json',
  ]);
  /** @type {Report} */
  const report = JSON.parse(check.stdout);
  const tellsDir = path.join(out, 'tells');
  const files = readdirSync(tellsDir).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 1, `one findings file in ${tellsDir}`);
  /** @type {Findings} */
  const findings = JSON.parse(readFileSync(path.join(tellsDir, files[0]), 'utf8'));
  return { exitCode: check.status, stderr: check.stderr, report, findings, briefExit: brief.status, briefStderr: brief.stderr };
}

/**
 * @param {string} name
 * @returns {SiteRun}
 */
function run(name) {
  const r = runs.get(name);
  if (!r) throw new Error(`${name} did not run; see the before() hook`);
  return r;
}

/**
 * @param {Report} report
 * @param {string} id
 * @returns {Gate}
 */
function gateOf(report, id) {
  const g = report.gates.find((x) => x.id === id);
  assert.ok(g, `${id} is in the report`);
  return g;
}

/**
 * @param {Report} report
 * @returns {string}
 */
function summary(report) {
  return report.gates.filter((g) => g.state !== 'ok').map((g) => `${g.state} ${g.id}: ${g.detail}`).join('\n');
}

describe('end to end: frontend-check --phase build on the good and the bad site', () => {
  before(() => {
    tmp = mkdtempSync(path.join(process.env.FRONTEND_TEST_TMP ?? os.tmpdir(), 'fe-e2e-'));
    for (const name of ['good-site', 'bad-site']) runs.set(name, checkSite(name));
  });

  after(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  describe('good-site', () => {
    test('the brief compiles from research/ (FE-00)', () => {
      const r = run('good-site');
      assert.equal(r.briefExit, 0, r.briefStderr);
    });

    test('every gate of the build phase passes and the run exits 0', () => {
      const { report, exitCode, stderr } = run('good-site');
      assert.equal(exitCode, 0, `${summary(report)}\n${stderr.slice(-2000)}`);
      assert.equal(report.ok, true);
      const { advisory = 0, ...states } = report.counts;
      assert.deepEqual(states, { ok: report.gates.length, fail: 0, skipped: 0 });
      assert.equal(advisory, report.gates.filter((g) => g.advisory === true).length, 'advisory oks are counted apart');
      const groups = new Set(report.gates.map((g) => g.id.split('.')[0]));
      assert.deepEqual([...groups].sort(), ['a11y', 'brand', 'brief', 'coverage', 'firstview', 'ip', 'motion', 'render', 'tells', 'tokens']);
      assert.ok(!report.gates.some((g) => g.id === 'brand.candidates'), 'the build phase leaves brand.candidates out');
    });

    test('every non-tells gate is ok, one by one', () => {
      const { report } = run('good-site');
      for (const g of report.gates.filter((x) => !x.id.startsWith('tells.'))) assert.equal(g.state, 'ok', `${g.id}: ${g.detail}`);
    });

    test('the tells layer confirms no finding: no candidate rule fires on the site that follows the skill', () => {
      const { findings, report } = run('good-site');
      for (const id of ['tells.tier1', 'tells.tier2', 'tells.score']) assert.equal(gateOf(report, id).state, 'ok');
      const confirmed = findings.findings.filter((f) => f.confirmed || f.counts);
      assert.deepEqual(confirmed.map((f) => `${f.rule} ${f.layer} ${f.route ?? f.file ?? ''}: ${f.detail}`), []);
      assert.equal(findings.counts.counted, 0);
      assert.deepEqual([findings.counts.errors, findings.counts.pageErrors], [0, 0], 'no detector error and every page became ready');
    });

    test('the waiver file is read and its waiver is valid', () => {
      const { findings } = run('good-site');
      assert.equal(findings.waivers.length, 1);
      assert.deepEqual([findings.waivers[0].rule, findings.waivers[0].valid, findings.waivers[0].problems], ['SL-M13', true, []]);
    });

    test('the gates read the skill-shaped inputs: features, metrics, hero, never-show, brand copies, provenance', () => {
      const { report } = run('good-site');
      assert.match(gateOf(report, 'brief.complete').detail, /15 of 15 required fields/);
      assert.match(gateOf(report, 'coverage.metrics').detail, /^3 data-metric elements sourced/);
      assert.match(gateOf(report, 'coverage.nevershow').detail, /clean of 3 active entries/);
      assert.match(gateOf(report, 'brand.drift').detail, /^2 copy\(ies\) equal to brand\//);
      assert.match(gateOf(report, 'ip.provenance').detail, /^11 asset file\(s\), each with a complete entry/);
      assert.match(gateOf(report, 'ip.concept-label').detail, /none unlabelled/);
      assert.match(gateOf(report, 'firstview.contract').detail, /h1, sentence, sponsor, sourced figure, product/);
    });
  });

  describe('bad-site', () => {
    test('the same brief compiles (the content is the same project)', () => {
      const r = run('bad-site');
      assert.equal(r.briefExit, 0, r.briefStderr);
    });

    test('the run fails with exit 1, never a usage or environment error', () => {
      const { exitCode, report, stderr } = run('bad-site');
      assert.equal(exitCode, 1, stderr.slice(-2000));
      assert.equal(report.ok, false);
      assert.equal(report.counts.skipped, 0, summary(report));
    });

    test('coverage, first-view and placeholder gates fail', () => {
      const { report } = run('bad-site');
      for (const id of ['coverage.features', 'coverage.metrics', 'coverage.hero', 'coverage.placeholders', 'firstview.contract']) {
        assert.equal(gateOf(report, id).state, 'fail', `${id}: ${gateOf(report, id).detail}`);
      }
      assert.match(gateOf(report, 'coverage.features').detail, /^3 of 3 features not covered \(FR-001, FR-002, FR-003\)/);
      assert.match(gateOf(report, 'coverage.hero').detail, /no visible \[data-hero="h1"\]/);
    });

    test('the Google Fonts hotlink is caught and never leaves the machine', () => {
      const { report } = run('bad-site');
      assert.equal(gateOf(report, 'ip.hotlinks').state, 'fail');
      const requests = gateOf(report, 'render.requests');
      assert.equal(requests.state, 'fail');
      const blocked = (requests.evidence ?? []).filter((e) => /^https:\/\/fonts\.googleapis\.com\//.test(String(e.url ?? '')));
      assert.ok(blocked.length > 0, 'the hotlink is reported as a failed request');
      for (const e of blocked) assert.match(String(e.value), /^net::ERR_BLOCKED_BY_CLIENT/, 'aborted by the offline context');
    });

    test(`the tells layer confirms at least ${MIN_PLANTED_CONFIRMED} of the planted tells`, (t) => {
      const { findings } = run('bad-site');
      assert.deepEqual([findings.counts.errors, findings.counts.pageErrors], [0, 0], 'no detector error and every page became ready');
      const confirmedRules = new Set(findings.findings.filter((f) => f.confirmed && f.counts).map((f) => f.rule));
      const fired = PLANTED.filter((p) => confirmedRules.has(p.rule));
      const missed = PLANTED.filter((p) => !confirmedRules.has(p.rule));
      t.diagnostic(`planted tells confirmed (${fired.length} of ${PLANTED.length}): ${fired.map((p) => `${p.rule} ${p.tell}`).join('; ')}`);
      t.diagnostic(`planted tells missed (${missed.length}): ${missed.map((p) => `${p.rule} ${p.tell}`).join('; ') || 'none'}`);
      const extra = [...confirmedRules].filter((rule) => !PLANTED.some((p) => p.rule === rule));
      if (extra.length > 0) t.diagnostic(`also confirmed, not planted: ${extra.join(', ')}`);
      assert.ok(fired.length >= MIN_PLANTED_CONFIRMED, `only ${fired.length} planted tells confirmed; missed: ${missed.map((p) => p.rule).join(', ')}`);
    });
  });
});
