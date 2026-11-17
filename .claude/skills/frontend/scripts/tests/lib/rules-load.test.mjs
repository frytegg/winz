// @ts-check
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { EnvError, UsageError } from '../../lib/errors.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import {
  EXCERPT_MAX, RULE_ID, loadAllowlists, loadRegistry, runStatic, sourceFiles, staticContext,
} from '../../rules/load.mjs';

const FIXTURES = fileURLToPath(new URL('../fixtures/lib/', import.meta.url));
const RULES = path.join(FIXTURES, 'rules');
const SPONSORS = path.join(FIXTURES, 'sponsor-allowlist.json');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-rules-'));
const REPO = path.join(tmp, 'repo');
const PRIVATE = path.join(REPO, 'private-captures');

before(() => {
  cpSync(path.join(FIXTURES, 'repo'), REPO, { recursive: true });
  for (const rel of ['node_modules/pkg/index.js', 'dist/assets/app.js', 'build/x.js', 'out/x.js', '.next/x.js', 'coverage/x.js',
    '.frontend/x.js', '.execution/frontend/x.js', 'vendor/v.js', 'private-captures/capture.js']) {
    mkdirSync(path.dirname(path.join(REPO, rel)), { recursive: true });
    writeFileSync(path.join(REPO, rel), 'const g = "linear-gradient";\n');
  }
});
after(() => rmSync(tmp, { recursive: true, force: true }));

const calibration = () => ({ positives: { fired: 0, total: 0 }, controls: { fired: 0, total: 0 }, exemplars: { fired: 0, total: 0 }, date: null, notes: '' });
/** @param {Record<string, unknown>} overrides */
const rule = (overrides) => ({
  id: 'SL-X01', family: 'invented', title: 't', tell: null, static: true, runtime: false, tier: 'candidate', anchor: false,
  weight: 1, scope: 's', falsePositives: 'f', fix: 'x', sources: ['FD10'], allowlist: 'none', calibration: calibration(), ...overrides,
});

/**
 * @param {string} name
 * @param {unknown} registry
 * @param {string[]} [detectors] layer/ID.mjs files to create next to the registry
 * @returns {string} the registry path
 */
function registryAt(name, registry, detectors = []) {
  const dir = path.join(tmp, name);
  mkdirSync(dir, { recursive: true });
  for (const rel of detectors) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), 'export function detect() { return []; }\n');
  }
  const file = path.join(dir, 'registry.json');
  writeFileSync(file, typeof registry === 'string' ? registry : JSON.stringify(registry));
  return file;
}

test("the skill's own registry loads and is well formed", () => {
  const registry = loadRegistry();
  assert.equal(registry.version, 1);
  assert.ok(registry.rules.length > 0);
  assert.ok(registry.rules.every((r) => RULE_ID.test(r.id)));
  assert.ok(registry.path.endsWith('/rules/registry.json'));
  assert.ok(!registry.dir.includes('\\'));
});

test('the fixture registry loads leniently even though detectors are missing', () => {
  const registry = loadRegistry(path.join(RULES, 'registry.json'));
  assert.equal(registry.rules.length, 9);
  assert.equal(registry.dir, path.resolve(RULES).replace(/\\/g, '/'));
});

test('strict mode reports every flagged layer without its detector file', () => {
  assert.throws(() => loadRegistry(path.join(RULES, 'registry.json'), { strict: true }), (err) => {
    assert.ok(err instanceof UsageError);
    assert.match(err.message, /2 problems/);
    assert.match(err.message, /SL-T03: static detector missing \(rules\/static\/SL-T03\.mjs\)/);
    assert.match(err.message, /SL-T09: runtime detector missing \(rules\/runtime\/SL-T09\.mjs\)/);
    return true;
  });
});

test('strict mode also refuses detector files for an unflagged layer and orphan files', () => {
  const file = registryAt('strict-extra', { version: 1, rules: [rule({})] }, ['static/SL-X01.mjs', 'runtime/SL-X01.mjs', 'static/SL-Z99.mjs']);
  assert.throws(() => loadRegistry(file, { strict: true }), (err) => {
    assert.ok(err instanceof UsageError);
    assert.match(err.message, /SL-X01: rules\/runtime\/SL-X01\.mjs exists but runtime is false/);
    assert.match(err.message, /rules\/static\/SL-Z99\.mjs has no entry in the registry/);
    return true;
  });
  const ok = registryAt('strict-ok', { version: 1, rules: [rule({ runtime: true })] }, ['static/SL-X01.mjs', 'runtime/SL-X01.mjs']);
  assert.equal(loadRegistry(ok, { strict: true }).rules.length, 1);
});

test('validation lists every malformed field of every rule', () => {
  const file = registryAt('invalid', {
    version: 2,
    rules: [
      rule({ id: 'SL-X01' }),
      rule({ id: 'SL-X01', family: 'vibes', tier: 'tier9', static: false, runtime: false }),
      rule({ id: 'sl-x2', title: '', weight: -1, anchor: 'no', sources: [], allowlist: 'colour', tell: 0 }),
      rule({ id: 'SL-X03', calibration: { positives: { fired: 3, total: 1 }, controls: {}, exemplars: { fired: 0, total: 0 }, date: 5, notes: null } }),
      'not a rule',
    ],
  });
  assert.throws(() => loadRegistry(file), (err) => {
    assert.ok(err instanceof UsageError);
    for (const p of [/version must be 1/, /SL-X01: id is used twice/, /SL-X01: family must be one of/, /tier must be one of/,
      /at least one of static and runtime must be true/, /sl-x2: id must look like SL-T01/, /title must be a non-empty string/,
      /weight must be a number >= 0/, /anchor must be a boolean/, /sources must be a non-empty array/, /allowlist must be one of/,
      /tell must be null or a positive integer/, /SL-X03: calibration\.positives must be \{fired, total\}/,
      /SL-X03: calibration\.controls/, /calibration\.date must be null or a date string/, /calibration\.notes must be a string/,
      /rules\[4\] must be an object/]) {
      assert.match(err.message, p);
    }
    return true;
  });
});

test('an unreadable registry: UsageError for a given path', () => {
  assert.throws(() => loadRegistry(path.join(tmp, 'missing', 'registry.json')), UsageError);
  assert.throws(() => loadRegistry(registryAt('broken', '{"version": 1, "rules": [')), (e) => e instanceof UsageError && /cannot be read/.test(e.message));
  assert.throws(() => loadRegistry(registryAt('not-object', '[]')), (e) => e instanceof UsageError && /must be a JSON object/.test(e.message));
});

test('sourceFiles: kinds, raw text and comment-stripped code, default and profile excludes', () => {
  const profile = defaultProfile({ workspace: { private_dir: PRIVATE } });
  const files = sourceFiles(REPO, profile);
  assert.deepEqual(files.map((f) => [f.path, f.kind]), [
    ['index.html', 'html'], ['package.json', 'json'], ['src/App.tsx', 'tsx'], ['src/Card.svelte', 'svelte'],
    ['src/Widget.vue', 'vue'], ['src/base.css', 'css'], ['src/lib.mjs', 'js'], ['src/style.scss', 'css'],
    ['src/types.ts', 'ts'], ['src/util.js', 'js'],
  ]);
  for (const f of files) {
    assert.equal(f.code.length, f.text.length, `${f.path} keeps its length`);
    assert.equal(f.code.split('\n').length, f.text.split('\n').length, `${f.path} keeps its lines`);
  }
  const app = /** @type {import('../../rules/load.mjs').SourceFile} */ (files.find((f) => f.path === 'src/App.tsx'));
  assert.ok(app.text.includes('in a line comment') && !app.code.includes('in a line comment'));
  assert.ok(app.code.includes("Don't visit https://example.com // not a comment"));
  const scss = /** @type {import('../../rules/load.mjs').SourceFile} */ (files.find((f) => f.path === 'src/style.scss'));
  assert.ok(!scss.code.includes('SCSS line comment') && scss.code.includes('url(//cdn.example.com/a.png)'), 'scss gets SCSS comment rules');
  const pkg = /** @type {import('../../rules/load.mjs').SourceFile} */ (files.find((f) => f.path === 'package.json'));
  assert.equal(pkg.code, pkg.text);
});

test('loadAllowlists: sponsor entries and their hashes, waivers and the category allowlist', () => {
  const allowlist = loadAllowlists(REPO, defaultProfile({ sponsors: ['Cardano'] }), { sponsorFile: SPONSORS });
  assert.deepEqual(allowlist.sponsors.map((s) => s.sponsor), ['cardano']);
  assert.deepEqual([...allowlist.sponsorHashes].sort(), [
    '79910a3c0a0e53a9044c357f7de88339d3fa47bcd204491daa2ed66a21a403a2',
    '94fb110ebb3475a0f3de620fbeaad91ae59a182a0d971eae865c556e1b6aa6e7',
  ], 'hashes are lower-cased and null hashes skipped');
  assert.equal(allowlist.waivers.length, 2);
  assert.deepEqual(allowlist.waivers[1], { rule: 'SL-T04', scope: 'body', reason: '', evidence: '', approved_by: 'research', date: null });
  assert.deepEqual(allowlist.category, [{ rule: 'SL-C01', category: 'defi-lending', reason: 'Lending dashboards use pill buttons for actions', source: 'FD11-F19' }]);
});

test('loadAllowlists: no sponsors means no allowlist file is needed; no design folder means no waivers', () => {
  const empty = loadAllowlists(path.join(tmp, 'nowhere'), defaultProfile(), { sponsorFile: path.join(tmp, 'absent.json') });
  assert.deepEqual(empty, { sponsorHashes: new Set(), sponsors: [], waivers: [], category: [], unknownSponsors: [] });
});

test('loadAllowlists: an unknown sponsor id has no marks to exempt and is never an error (Q-FX-5)', () => {
  const only = loadAllowlists(REPO, defaultProfile({ sponsors: ['bnb'] }), { sponsorFile: SPONSORS });
  assert.deepEqual(only.sponsors, []);
  assert.equal(only.sponsorHashes.size, 0, 'nothing is exempted for a sponsor the allowlist does not know');
  assert.deepEqual(only.unknownSponsors, ['bnb']);
  const mixed = loadAllowlists(REPO, defaultProfile({ sponsors: ['bnb', 'Cardano', 'BNB'] }), { sponsorFile: SPONSORS });
  assert.deepEqual(mixed.sponsors.map((s) => s.sponsor), ['cardano'], 'known sponsors keep their entries');
  assert.equal(mixed.sponsorHashes.size, 2);
  assert.deepEqual(mixed.unknownSponsors, ['bnb'], 'listed once, lower-cased');
});

test('loadAllowlists: a missing allowlist file while sponsors are named is an EnvError', () => {
  assert.throws(() => loadAllowlists(REPO, defaultProfile({ sponsors: ['cardano'] }), { sponsorFile: path.join(tmp, 'absent.json') }), EnvError);
  assert.throws(() => loadAllowlists(REPO, defaultProfile({ sponsors: ['bnb'] }), { sponsorFile: path.join(tmp, 'absent.json') }), EnvError);
});

test('loadAllowlists: malformed waivers are listed in one UsageError', () => {
  const root = path.join(tmp, 'bad-waivers');
  mkdirSync(path.join(root, 'design'), { recursive: true });
  writeFileSync(path.join(root, 'design', 'waivers.json'), JSON.stringify({
    waivers: [{ scope: 'x', reason: 'r', evidence: 3, approved_by: 'intern' }, 'nope'],
    category: [{ rule: 'SL-C01', reason: '' }],
  }));
  assert.throws(() => loadAllowlists(root, defaultProfile()), (err) => {
    assert.ok(err instanceof UsageError);
    for (const p of [/waivers\[0\]\.rule must name a rule id/, /waivers\[0\]\.evidence must be a string or an array of strings/,
      /waivers\[0\]\.approved_by must be owner or research/, /waivers\[1\] must be an object/,
      /category\[0\]\.reason must record why/]) {
      assert.match(err.message, p);
    }
    return true;
  });
  writeFileSync(path.join(root, 'design', 'waivers.json'), '{');
  assert.throws(() => loadAllowlists(root, defaultProfile()), (e) => e instanceof UsageError && /not valid JSON/.test(e.message));
});

test('staticContext bundles the root, the files, the profile and the allowlist', () => {
  const profile = defaultProfile({ workspace: { private_dir: PRIVATE } });
  const allowlist = loadAllowlists(REPO, profile);
  const ctx = staticContext(REPO, profile, allowlist);
  assert.equal(ctx.root, path.resolve(REPO).replace(/\\/g, '/'));
  assert.equal(ctx.files.length, 10);
  assert.equal(ctx.profile, profile);
  assert.equal(ctx.allowlist, allowlist);
});

test('runStatic runs flagged detectors in order; failures become error findings and never stop the run', async () => {
  const profile = defaultProfile({ workspace: { private_dir: PRIVATE } });
  const ctx = staticContext(REPO, profile, loadAllowlists(REPO, profile));
  const registry = loadRegistry(path.join(RULES, 'registry.json'));
  const findings = await runStatic(registry, ctx, { dir: RULES });
  const hits = findings.filter((f) => !('error' in f));
  assert.deepEqual(hits.map((f) => [f.rule, f.layer, 'file' in f && f.file, 'line' in f && f.line, 'detail' in f && f.detail]), [
    ['SL-T01', 'static', 'src/App.tsx', 7, 'tsx via SL-T01'],
    ['SL-T01', 'static', 'src/base.css', 2, 'css via SL-T01'],
    ['SL-T01', 'static', 'src/util.js', 2, 'js via SL-T01'],
  ], 'only rendered-code usages: every comment mention is stripped');
  for (const f of hits) assert.equal(/** @type {import('../../rules/load.mjs').StaticFinding} */ (f).excerpt.length, EXCERPT_MAX, 'excerpts are cut at 120 characters');
  const errors = findings.filter((f) => 'error' in f).map((f) => [f.rule, f.layer, 'error' in f ? f.error : '']);
  assert.deepEqual(errors, [
    ['SL-T02', 'static', 'Error: static boom'],
    ['SL-T03', 'static', 'Error: detector file missing: rules/static/SL-T03.mjs'],
    ['SL-T04', 'static', 'TypeError: detect() must return an array of findings, got string'],
    ['SL-T08', 'static', 'Error: rules/static/SL-T08.mjs exports no detect() function'],
  ]);
  assert.equal(findings.filter((f) => f.rule === 'SL-T05').length, 0, 'runtime-only rules are not run statically');
});

test('runStatic accepts a plain rule array and refuses anything else', async () => {
  const registry = loadRegistry(path.join(RULES, 'registry.json'));
  const ctx = staticContext(REPO, defaultProfile(), loadAllowlists(REPO, defaultProfile()));
  const onlyFirst = await runStatic(registry.rules.slice(0, 1), ctx, { dir: RULES });
  assert.ok(onlyFirst.every((f) => f.rule === 'SL-T01'));
  await assert.rejects(runStatic(/** @type {import('../../rules/load.mjs').Rule[]} */ (/** @type {unknown} */ ({})), ctx, { dir: RULES }), TypeError);
});
