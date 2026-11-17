// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPTS = fileURLToPath(new URL('../../', import.meta.url));
const MARKS = fileURLToPath(new URL('../fixtures/brand/marks/', import.meta.url));
const TEMPLATES = fileURLToPath(new URL('../fixtures/brand/templates/', import.meta.url));
const ALLOWLIST = fileURLToPath(new URL('../fixtures/brand/sponsor-allowlist.json', import.meta.url));
const scratch = mkdtempSync(path.join(os.tmpdir(), 'fe-brand-cli-'));

after(() => rmSync(scratch, { recursive: true, force: true }));

/** @param {string[]} args */
function brand(args) {
  return spawnSync(process.execPath, ['brand.mjs', ...args], { cwd: SCRIPTS, encoding: 'utf8', timeout: 60000 });
}

describe('brand.mjs CLI (no browser)', () => {
  test('a command is required (exit 2); --help prints the commands (exit 0)', () => {
    const none = brand([]);
    assert.equal(none.status, 2);
    assert.match(none.stderr, /a command is required/);
    const help = brand(['--help']);
    assert.equal(help.status, 0);
    for (const cmd of ['wordmark', 'lint', 'render', 'icons', 'og', 'sheet', 'name-check', 'hashes']) assert.match(help.stdout, new RegExp(`\\b${cmd}\\b`));
    const sub = brand(['icons', '--help']);
    assert.equal(sub.status, 0);
    assert.match(sub.stdout, /maskable/);
    assert.equal(brand(['logo']).status, 2);
  });

  test('lint exits 1 on a hard failure, 0 on a clean mark, 0 on a flag with a reason, 1 without', () => {
    assert.equal(brand(['lint', `${MARKS}text.svg`, '--static-only']).status, 1);
    const clean = brand(['lint', `${MARKS}good.svg`, '--static-only', '--json']);
    assert.equal(clean.status, 0, clean.stderr);
    assert.equal(JSON.parse(clean.stdout).ok, true);
    assert.equal(brand(['lint', `${MARKS}triangle.svg`, '--static-only']).status, 1);
    const reasons = path.join(scratch, 'reasons.json');
    writeFileSync(reasons, JSON.stringify({ flag_reasons: { triangle: 'three routes, one triangle' } }));
    assert.equal(brand(['lint', `${MARKS}triangle.svg`, '--static-only', '--reasons', reasons]).status, 0);
    assert.equal(brand(['lint', `${MARKS}good.svg`, '--kind', 'logo']).status, 2);
  });

  test('name-check reports hits and still exits 0: the owner decides', () => {
    const out = path.join(scratch, 'name-checks.json');
    const res = brand(['name-check', 'Cardanex', 'holdover.dev', '@ledgerly', '--allowlist', ALLOWLIST, '--json', '--out', out]);
    assert.equal(res.status, 0, res.stderr);
    const report = JSON.parse(res.stdout);
    assert.deepEqual(report.hits.map((/** @type {any} */ h) => `${h.input}~${h.entry}`), ['Cardanex~CARDANO', '@ledgerly~LEDGER']);
    assert.deepEqual(report.withoutBlocklist, ['chainlink']);
    assert.match(report.verdict, /report only/);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).hits.length, 2);
    assert.match(res.stderr, /for the owner to decide/);
    assert.equal(brand(['name-check']).status, 2);
  });

  test('hashes prints raw and normalised identities', () => {
    const res = brand(['hashes', `${TEMPLATES}vite-favicon.svg`, `${TEMPLATES}next-favicon.ico`, '--json']);
    assert.equal(res.status, 0, res.stderr);
    const [svg, ico] = JSON.parse(res.stdout);
    assert.equal(svg.canonicalSha256, '0303b2d9784aff9e4f7083789ce20d4653093a3232aa0e1eacc4b49900af98b8');
    assert.deepEqual(ico.images.map((/** @type {any} */ i) => i.width), [16, 32, 48, 256]);
  });

  test('missing inputs are usage errors (exit 2)', () => {
    assert.equal(brand(['wordmark', '--font', 'x.ttf', '--out', 'x.svg']).status, 2);
    assert.equal(brand(['lint', path.join(scratch, 'nope.svg'), '--static-only']).status, 2);
    assert.equal(brand(['og', '--mark', 'a.svg']).status, 2);
    assert.equal(brand(['render']).status, 2);
  });
});
