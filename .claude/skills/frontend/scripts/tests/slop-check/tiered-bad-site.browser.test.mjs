// @ts-check
/**
 * The tells gates on the e2e bad-site, through slop-check's own CLI, offline. With the shipped registry every rule is
 * still a candidate, so tells.tier1, tells.tier2 and tells.score judge nothing binding: they are ok with
 * `advisory: true` and the report counts them apart. With the same registry tiered (the planted tells promoted to
 * tier 1, as calibration would), tells.tier1 fails on the same site: the gates can fail once tiers exist.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {{id: string, state: string, detail: string, advisory?: true}} Gate
 * @typedef {{ok: boolean, counts: {ok: number, fail: number, skipped: number, advisory?: number}, gates: Gate[]}} Report
 */

const SCRIPTS = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const BAD_SITE = path.join(SCRIPTS, 'tests', 'fixtures', 'e2e', 'bad-site');
const REGISTRY = path.join(SCRIPTS, 'rules', 'registry.json');
/** Planted tells the e2e test confirms on bad-site (tests/e2e.browser.test.mjs PLANTED), promoted for this run. */
const PROMOTED = Object.freeze(['SL-T01', 'SL-T02', 'SL-T03', 'SL-X02', 'SL-M04', 'SL-T16']);

/** @type {string} */
let tmp;

before(() => {
  tmp = mkdtempSync(path.join(process.env.FRONTEND_TEST_TMP ?? os.tmpdir(), 'fe-tiered-bad-site-'));
  cpSync(BAD_SITE, path.join(tmp, 'site-root'), { recursive: true });
});
after(() => rmSync(tmp, { recursive: true, force: true }));

/**
 * Runs slop-check on the copied bad-site with a registry and returns its report.
 * @param {string} registry
 * @param {string} name
 * @returns {{status: number | null, report: Report, stderr: string}}
 */
function check(registry, name) {
  const root = path.join(tmp, 'site-root');
  const res = spawnSync(process.execPath, [
    path.join(SCRIPTS, 'slop-check.mjs'), '--root', root, '--profile', path.join(root, 'dot-frontend', 'profile.json'),
    '--serve', path.join(root, 'site'), '--registry', registry, '--out', path.join(tmp, `out-${name}`), '--json',
  ], { cwd: SCRIPTS, encoding: 'utf8', timeout: 480000, maxBuffer: 64 * 1024 * 1024 });
  if (res.error) throw res.error;
  return { status: res.status, report: JSON.parse(res.stdout), stderr: res.stderr };
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

test('with every rule a candidate, the three tells gates are advisory oks that judged nothing binding', () => {
  const { report, status, stderr } = check(REGISTRY, 'candidates');
  assert.equal(status, 0, stderr.slice(-2000));
  for (const id of ['tells.tier1', 'tells.tier2', 'tells.score']) {
    const g = gateOf(report, id);
    assert.equal(g.state, 'ok', `${id}: ${g.detail}`);
    assert.equal(g.advisory, true, `${id} is advisory, never a passed check`);
    assert.match(g.detail, /^advisory: /);
  }
  assert.equal(report.counts.advisory, 3, 'the report counts the advisory gates apart');
  assert.match(gateOf(report, 'tells.tier1').detail, /\d+ confirmed findings? from \d+ candidate rules? are scored by tells\.score only/);
});

test('once calibration tiers the planted tells, tells.tier1 fails on the same site', () => {
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  for (const rule of registry.rules) if (PROMOTED.includes(rule.id)) rule.tier = 'tier1';
  const tiered = path.join(tmp, 'registry-tiered.json');
  writeFileSync(tiered, `${JSON.stringify(registry, null, 2)}\n`);
  const { report, status } = check(tiered, 'tiered');
  assert.equal(status, 1, 'a failing gate exits 1');
  const tier1 = gateOf(report, 'tells.tier1');
  assert.equal(tier1.state, 'fail', tier1.detail);
  assert.equal(tier1.advisory, undefined);
  assert.match(tier1.detail, /tier-1 rules? fires? with confirmed findings/);
});
