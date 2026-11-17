// @ts-check
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import {
  GROUPS, SMALL_GROUPS, catalogue, checkArgs, groupsNamed, insideGitWorkTree, loadModules, modeBStateOutsideRepo, normaliseFlags,
  descendantsOf, isAlive, killTreeSync, normaliseResults, phaseGroups, runChecks, selectGates, splitList, startServer,
} from '../../frontend-check.mjs';
import { UsageError } from '../../lib/errors.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import { gate } from '../../lib/report.mjs';
import { SchemaRegistry } from '../assets/json-schema.mjs';

/** @typedef {import('../../frontend-check.mjs').ModuleLoad} ModuleLoad */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(HERE, '..', '..');
const FIX = path.resolve(HERE, '..', 'fixtures', 'frontend-check');
const STUBS = path.join(FIX, 'stubs');
const REPO = path.join(FIX, 'repo');
const WRAPPER = path.join(FIX, 'run-with-stubs.mjs');
const NOW = new Date('2026-10-01T10:00:00Z');

/** @type {SchemaRegistry | null} */
let schemas = null;

/**
 * @param {unknown} report
 * @returns {string[]}
 */
function schemaErrors(report) {
  if (!schemas) {
    schemas = new SchemaRegistry();
    schemas.add(JSON.parse(readFileSync(path.resolve(SCRIPTS, '..', 'assets', 'schemas', 'gate-output.schema.json'), 'utf8')));
  }
  return schemas.validate('urn:frontend:schema:gate-output:1', report).map((e) => `${e.path}: ${e.message}`);
}

/** @type {string} */
let tmp = '';
/** @type {string[]} */
let logs = [];
const log = (/** @type {string} */ m) => {
  logs.push(m);
};

/**
 * @param {Record<string, unknown>} plan
 */
function writePlan(plan) {
  writeFileSync(path.join(tmp, 'state', 'stub-plan.json'), JSON.stringify(plan));
}

/**
 * @param {Record<string, unknown>} values
 */
function run(values) {
  return runChecks({ root: REPO, profile: path.join(REPO, 'profile.json'), state: path.join(tmp, 'state'), ...values }, { modulesDir: STUBS, now: NOW, log });
}

/**
 * @param {string} [dir] where the stubs recorded their calls (the state folder, or --out with --out)
 * @returns {Array<Record<string, any>>}
 */
function stubCalls(dir = path.join(tmp, 'state')) {
  const file = path.join(dir, 'stub-calls.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
}

const posix = (/** @type {string} */ p) => p.replace(/\\/g, '/');

/** @param {string} root a folder made into a git work tree git itself accepts (HEAD, objects, refs) */
function gitRepoAt(root) {
  for (const sub of ['objects', 'refs', 'info']) mkdirSync(path.join(root, '.git', sub), { recursive: true });
  writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
}

describe('flag handling', () => {
  test('splitList accepts repeated flags and comma lists, trims and dedupes', () => {
    assert.deepEqual(splitList(['render, coverage', 'render', ' tells ,']), ['render', 'coverage', 'tells']);
    assert.deepEqual(splitList(undefined), []);
    assert.deepEqual(splitList('a'), ['a']);
  });

  test('normaliseFlags rejects bad combinations with usage errors', () => {
    const bad = [
      [{ serve: 'dist', url: 'http://127.0.0.1:1' }, /do not combine/],
      [{ start: 'node x', serve: 'dist' }, /--start needs --url/],
      [{ start: 'node x' }, /--start needs --url/],
      [{ start: '  ', url: 'http://127.0.0.1:1' }, /needs a command/],
      [{ url: 'ftp://x' }, /not an http\(s\) URL/],
      [{ phase: 'deploy' }, /phases are build \(alias full\) and small/],
      [{ features: ['FR 3'] }, /not a requirement id/],
      [{ features: [','] }, /needs requirement ids/],
      [{ 'start-timeout': '5' }, /only applies with --start/],
      [{ start: 'node x', url: 'http://127.0.0.1:1', 'start-timeout': '0' }, /between 1 and 3600/],
      [{ root: '' }, /--root needs a path/],
    ];
    for (const [values, message] of bad) {
      assert.throws(() => normaliseFlags(/** @type {any} */ (values)), (err) => err instanceof UsageError && /** @type {RegExp} */ (message).test(err.message), JSON.stringify(values));
    }
  });

  test('normaliseFlags defaults to --phase build and keeps lists normalised', () => {
    const f = normaliseFlags({ features: ['FR-003,FR-007', 'FR-003'], 'allow-skip': ['tokens.leak'] });
    assert.equal(f.phase, 'build');
    assert.deepEqual(f.gates, []);
    assert.deepEqual(f.features, ['FR-003', 'FR-007']);
    assert.deepEqual(f.allowSkip, ['tokens.leak']);
    assert.equal(normaliseFlags({ gates: ['brief'] }).phase, null);
    assert.equal(normaliseFlags({ start: 'node s.mjs', url: 'http://127.0.0.1:4173', 'start-timeout': '2.5' }).startTimeoutMs, 2500);
  });

  test('checkArgs mirrors the given flags as a module CLI would parse them, plus normalised lists', () => {
    const flags = normaliseFlags({ gates: ['coverage'], features: ['FR-003', 'FR-007'], url: 'http://127.0.0.1:9/' });
    const args = checkArgs(flags, ['coverage.features'], 'C:/out');
    assert.equal(args.features, 'FR-003,FR-007');
    assert.deepEqual(args.featureIds, ['FR-003', 'FR-007']);
    assert.equal(args.gates, 'coverage');
    assert.deepEqual(args.gateIds, ['coverage.features']);
    assert.equal(args.url, 'http://127.0.0.1:9/');
    assert.equal(args.outDir, 'C:/out');
    assert.equal('serve' in args, false);
    assert.equal('network' in args, false, 'offline unless --network');
  });

  test('module inputs pass through: --network, --master, --deck, --workspace', () => {
    const flags = normaliseFlags({ gates: ['recording,brief'], network: true, master: 'master.mp4', deck: 'deck.pptx', workspace: 'ws' });
    const args = checkArgs(flags, [], 'out');
    assert.equal(args.network, true);
    assert.equal(args.master, path.resolve('master.mp4').replace(/\\/g, '/'));
    assert.equal(args.deck, path.resolve('deck.pptx').replace(/\\/g, '/'));
    assert.equal(args.workspace, path.resolve('ws').replace(/\\/g, '/'));
    assert.throws(() => normaliseFlags({ master: '' }), /--master needs a path/);
  });
});

describe('gate selection', () => {
  const profile = defaultProfile();
  /** @type {Map<string, ModuleLoad>} */
  const none = new Map();
  const all = catalogue(GROUPS.map((s) => s.group), none);

  test('the contract catalogue names every group of CONTRACTS section 4', () => {
    assert.deepEqual(GROUPS.map((s) => s.group), ['brief', 'refs', 'directions', 'brand', 'tokens', 'render', 'a11y', 'coverage', 'firstview', 'tells', 'ip', 'motion', 'recording']);
    assert.equal(all.filter((e) => e.group === 'recording').length, 16);
    assert.ok(all.every((e) => e.meta.title && e.meta.ifDropped));
  });

  test('groups, ids, group.* and all select in catalogue order', () => {
    const ids = (/** @type {string[]} */ gates) => selectGates({ gates, phase: null }, all, profile).map((e) => e.meta.id);
    assert.deepEqual(ids(['coverage.hero', 'brief']), ['brief.complete', 'coverage.hero']);
    assert.deepEqual(ids(['firstview.*']), ['firstview.contract', 'firstview.complexity']);
    assert.equal(ids(['all']).length, all.length);
    assert.deepEqual(groupsNamed({ gates: ['render.console', 'tells'], phase: null }, profile), ['render', 'tells']);
  });

  test('unknown names and the colon syntax are usage errors', () => {
    assert.throws(() => selectGates({ gates: ['nope'], phase: null }, all, profile), /unknown gate or group "nope"/);
    assert.throws(() => selectGates({ gates: ['render.nope'], phase: null }, all, profile), /group render has render.console/);
    assert.throws(() => groupsNamed({ gates: ['coverage:FR-003'], phase: null }, profile), /--gates coverage --features FR-003/);
  });

  test('--phase build leaves out refs, directions and brand.candidates; recording only with a video format', () => {
    const phase = selectGates({ gates: [], phase: 'build' }, all, profile).map((e) => e.meta.id);
    assert.ok(phase.includes('brand.favicons') && phase.includes('motion.inventory') && phase.includes('brief.complete'));
    assert.ok(!phase.some((id) => id.startsWith('refs.') || id.startsWith('directions.') || id.startsWith('recording.')));
    assert.ok(!phase.includes('brand.candidates'));
    const video = defaultProfile({ format: { video: { max_s: 120 } } });
    assert.ok(selectGates({ gates: [], phase: 'build' }, all, video).some((e) => e.meta.id === 'recording.g16'));
    assert.ok(groupsNamed({ gates: [], phase: 'build' }, video).includes('recording'));
  });

  test('--phase small selects only the essential groups; --phase full is the build set', () => {
    const small = selectGates({ gates: [], phase: 'small' }, all, profile).map((e) => e.meta.id);
    assert.deepEqual([...new Set(small.map((id) => id.split('.')[0]))], ['render', 'a11y', 'coverage', 'firstview', 'tells', 'ip']);
    assert.deepEqual([...SMALL_GROUPS], ['render', 'a11y', 'coverage', 'firstview', 'tells', 'ip']);
    assert.ok(small.includes('ip.sponsor-marks') && small.includes('coverage.features') && small.includes('a11y.axe'));
    assert.ok(!small.some((id) => /^(brief|refs|directions|brand|tokens|motion|recording)\./.test(id)), 'no brand, tokens or motion in small mode');
    const video = defaultProfile({ format: { video: { max_s: 120 } } });
    assert.ok(!selectGates({ gates: [], phase: 'small' }, all, video).some((e) => e.group === 'recording'), 'small never adds recording');
    assert.deepEqual(groupsNamed({ gates: [], phase: 'small' }, profile), ['render', 'a11y', 'coverage', 'firstview', 'tells', 'ip']);
    assert.deepEqual(phaseGroups('full', profile), phaseGroups('build', profile));
    assert.deepEqual(phaseGroups(null, profile), []);
    assert.equal(normaliseFlags({ phase: 'full' }).phase, 'build', 'full is normalised to build');
    assert.equal(normaliseFlags({ phase: 'small' }).phase, 'small');
    const both = selectGates({ gates: ['brand.og'], phase: 'small' }, all, profile).map((e) => e.meta.id);
    assert.ok(both.includes('brand.og') && both.includes('render.console'), '--gates adds to a phase');
  });

  test('a loaded module adds its own gates; contract ids it does not declare stay selectable', async () => {
    const loads = await loadModules(['tokens', 'refs', 'ip', 'tells'], STUBS);
    assert.equal(loads.get('tokens.mjs')?.state, 'loaded');
    assert.equal(loads.get('extract.mjs')?.state, 'missing');
    assert.equal(loads.get('ip-check.mjs')?.state, 'broken');
    assert.equal(loads.get('slop-check.mjs')?.state, 'broken');
    const tokens = catalogue(['tokens'], loads);
    assert.deepEqual(tokens.map((e) => [e.meta.id, e.declared]), [
      ['tokens.valid', true], ['tokens.contrast', true], ['tokens.extra', true], ['tokens.leak', false],
    ]);
  });
});

describe('normaliseResults', () => {
  const wanted = ['render.console', 'render.cls', 'render.fonts'].map((id) => ({ meta: gate(id, `T ${id}`, 'x').meta, group: 'render', module: 'qa.mjs', declared: true }));

  test('keeps requested results, fails duplicates and bad states, drops the rest and cleans evidence', () => {
    const logged = /** @type {string[]} */ ([]);
    const b = gate('render.console', 'Console', 'a page that throws would pass');
    const raw = [
      b.ok('fine', /** @type {any} */ ([{ value: { a: 1 }, line: -1, selector: 5 }])),
      gate('render.cls', 'CLS', 'x').ok('one'),
      gate('render.cls', 'CLS', 'x').ok('two'),
      { ...gate('render.fonts', 'Fonts', 'x').ok('?'), state: 'maybe' },
      gate('render.images', 'Images', 'x').ok('not asked'),
      42,
    ];
    const out = normaliseResults(raw, wanted, 'qa.mjs', (m) => logged.push(m));
    assert.equal(out.get('render.console')?.state, 'ok');
    assert.deepEqual(out.get('render.console')?.evidence, [{ value: '{"a":1}', selector: '5' }]);
    assert.equal(out.get('render.cls')?.state, 'fail');
    assert.match(out.get('render.cls')?.detail ?? '', /more than once/);
    assert.equal(out.get('render.fonts')?.state, 'fail');
    assert.match(out.get('render.fonts')?.detail ?? '', /invalid state "maybe"/);
    assert.equal(out.has('render.images'), false);
    assert.equal(logged.length, 2);
  });

  test('a non-array result is an error', () => {
    assert.throws(() => normaliseResults({}, wanted, 'qa.mjs', () => {}), /not an array/);
  });
});

describe('runChecks with stub modules (file gates, no browser)', () => {
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-check-'));
    mkdirSync(path.join(tmp, 'state'));
    logs = [];
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('passing: every requested gate ok exits 0; the report is written and matches the schema', async () => {
    const outcome = await run({ gates: ['brief,tokens.valid,tokens.contrast'] });
    assert.equal(outcome.exitCode, 0, JSON.stringify(outcome.report.gates));
    assert.equal(outcome.report.ok, true);
    assert.deepEqual(outcome.report.counts, { ok: 3, fail: 0, skipped: 0 });
    assert.equal(outcome.reportPath, path.join(tmp, 'state', 'gates', '2026-10-01T10-00-00Z.json').replace(/\\/g, '/'));
    assert.deepEqual(JSON.parse(readFileSync(outcome.reportPath, 'utf8')), outcome.report);
    assert.deepEqual(schemaErrors(outcome.report), []);
    assert.deepEqual(outcome.report.target, { root: REPO.replace(/\\/g, '/'), url: null, routes: 2, viewports: ['desktop'] });
    const calls = stubCalls();
    assert.deepEqual(calls.map((c) => c.module), ['brief', 'tokens'], 'each module runs once');
    assert.equal(calls[0].browser, null, 'no browser for file gates');
    assert.equal(calls[0].baseUrl, null);
    assert.deepEqual(calls[0].routes, ['/', '/about.html']);
    assert.equal(calls[0].design, `${REPO.replace(/\\/g, '/')}/design`);
    assert.equal(calls[0].state, path.join(tmp, 'state').replace(/\\/g, '/'));
    assert.deepEqual(calls[1].selected, ['tokens.valid', 'tokens.contrast']);
  });

  test('failing: one failed gate exits 1', async () => {
    writePlan({ gates: { 'tokens.contrast': 'fail' } });
    const outcome = await run({ gates: ['tokens.valid,tokens.contrast'] });
    assert.equal(outcome.exitCode, 1);
    assert.equal(outcome.report.ok, false);
    const failed = outcome.report.gates.find((x) => x.id === 'tokens.contrast');
    assert.equal(failed?.state, 'fail');
    assert.deepEqual(failed?.evidence, [{ route: '/', viewport: 'desktop', selector: 'h1', value: '{"kind":"object value"}' }]);
    assert.deepEqual(schemaErrors(outcome.report), []);
  });

  test('a skipped gate makes ok false and exits 1; --allow-skip accepts it by id or group', async () => {
    const outcome = await run({ gates: ['tokens'] });
    const leak = outcome.report.gates.find((x) => x.id === 'tokens.leak');
    assert.equal(leak?.state, 'skipped');
    assert.match(leak?.detail ?? '', /does not declare this gate/);
    assert.equal(outcome.report.gates.find((x) => x.id === 'tokens.extra')?.state, 'ok', 'a module-only gate runs with its group');
    assert.equal(outcome.report.ok, false);
    assert.equal(outcome.exitCode, 1);
    const allowed = await run({ gates: ['tokens'], 'allow-skip': ['tokens.leak'] });
    assert.equal(allowed.exitCode, 0);
    assert.equal((await run({ gates: ['tokens'], 'allow-skip': ['tokens'] })).exitCode, 0);
    await assert.rejects(run({ gates: ['tokens'], 'allow-skip': ['tokens.nope'] }), /not a gate id or group/);
    await assert.rejects(run({ gates: ['tokens'], 'allow-skip': ['motion'] }), /--allow-skip motion: not a gate id or group of this run/);
    await assert.rejects(run({ gates: ['tokens.valid'], 'allow-skip': ['tokens.leak'] }), /--allow-skip tokens.leak: not a gate id or group of this run/);
  });

  test('a module that does not exist yet reports its gates skipped as "module missing"', async () => {
    const outcome = await run({ gates: ['refs'] });
    assert.deepEqual(outcome.report.gates.map((x) => [x.id, x.state]), [['refs.ledger', 'skipped'], ['refs.receipts', 'skipped']]);
    assert.match(outcome.report.gates[0].detail, /^module missing: scripts\/extract\.mjs/);
    assert.equal(outcome.exitCode, 1);
  });

  test('a gate the module omits or skips is skipped; a module skip keeps its reason', async () => {
    writePlan({ gates: { 'tokens.valid': 'omit', 'tokens.contrast': 'skip' } });
    const outcome = await run({ gates: ['tokens.valid,tokens.contrast'] });
    assert.deepEqual(outcome.report.gates.map((x) => [x.id, x.state, x.detail]), [
      ['tokens.valid', 'skipped', 'tokens.mjs returned no result for this gate'],
      ['tokens.contrast', 'skipped', 'stub tokens: input missing'],
    ]);
    assert.equal(outcome.exitCode, 1);
  });

  test('a module error fails its gates and sets the exit code from the error class', async () => {
    const cases = /** @type {const} */ ([['throw-usage', 2], ['throw-env', 3], ['throw-bug', 3], ['not-array', 3]]);
    for (const [how, code] of cases) {
      writePlan({ modules: { tokens: how } });
      const outcome = await run({ gates: ['brief,tokens.valid'] });
      assert.equal(outcome.exitCode, code, how);
      assert.equal(outcome.report.gates.find((x) => x.id === 'tokens.valid')?.state, 'fail', how);
      assert.equal(outcome.report.gates.find((x) => x.id === 'brief.complete')?.state, 'ok', `${how}: other modules still run`);
      assert.match(outcome.report.gates.find((x) => x.id === 'tokens.valid')?.detail ?? '', /stopped with an error/);
    }
  });

  test('extra, duplicate and malformed results never pass a gate', async () => {
    writePlan({ gates: { 'tokens.valid': 'duplicate', 'tokens.contrast': 'bad-state' }, extra: { tokens: true } });
    const outcome = await run({ gates: ['tokens.valid,tokens.contrast'] });
    assert.deepEqual(outcome.report.gates.map((x) => [x.id, x.state]), [['tokens.valid', 'fail'], ['tokens.contrast', 'fail']]);
    assert.ok(logs.some((l) => /ignored render\.unrequested/.test(l)));
    assert.equal(outcome.exitCode, 1);
  });

  test('reports of the same second do not overwrite each other in <state>/gates', async () => {
    const first = await run({ gates: ['brief'] });
    const second = await run({ gates: ['brief'] });
    assert.notEqual(first.reportPath, second.reportPath);
    assert.match(second.reportPath, /2026-10-01T10-00-00Z-2\.json$/);
    assert.deepEqual(readdirSync(path.join(tmp, 'state', 'gates')).sort(), ['2026-10-01T10-00-00Z-2.json', '2026-10-01T10-00-00Z.json']);
    assert.equal(stubCalls().at(-1)?.args.outDir, posix(path.join(tmp, 'state', 'gates', '2026-10-01T10-00-00Z')));
  });

  test('--out (Q-F14): the report and outputs go only there; the state folder is read, never written', async () => {
    const out = path.join(tmp, 'out');
    writePlan({ gates: { 'tokens.valid': 'ok' } });
    const before = readdirSync(path.join(tmp, 'state')).sort();
    const outcome = await run({ gates: ['brief,tokens.valid'], out });
    assert.equal(outcome.exitCode, 0, JSON.stringify(outcome.report.gates));
    assert.equal(outcome.reportPath, posix(path.join(out, 'frontend-check.json')));
    assert.deepEqual(JSON.parse(readFileSync(outcome.reportPath, 'utf8')), outcome.report);
    assert.deepEqual(readdirSync(path.join(tmp, 'state')).sort(), before, 'nothing new in the state folder, no gates/ report');
    const call = stubCalls(out).at(-1);
    assert.equal(call?.args.outDir, posix(out));
    assert.equal(call?.state, posix(path.join(tmp, 'state')), 'modules still read the state folder');

    // Mode B with no --state inside a real repository: no .frontend folder and no exclude line.
    const app = path.join(tmp, 'repo-b', 'app');
    gitRepoAt(path.join(tmp, 'repo-b'));
    mkdirSync(app);
    const outB = path.join(tmp, 'out-b');
    const b = await runChecks({ gates: ['brief'], root: app, profile: path.join(REPO, 'profile.json'), out: outB }, { modulesDir: STUBS, now: NOW, log });
    assert.equal(b.exitCode, 0);
    assert.equal(existsSync(path.join(app, '.frontend')), false, 'the mode B state folder is not created');
    assert.equal(existsSync(path.join(tmp, 'repo-b', '.git', 'info', 'exclude')), false, 'no exclude line is written');
    assert.equal(stubCalls(outB).at(-1)?.state, posix(path.join(app, '.frontend')), 'ctx.state still names where the state lives');

    // Mode A before /execution's bootstrap: no EnvError and no .execution folder, because nothing is written there.
    const profileA = path.join(tmp, 'profile-a.json');
    writeFileSync(profileA, JSON.stringify({ run_mode: 'A', judged_surface: 'site', stack: 'static-html', hosting: 'local' }));
    const rootA = path.join(tmp, 'repo-a');
    mkdirSync(rootA);
    const a = await runChecks({ gates: ['brief'], root: rootA, profile: profileA, out: path.join(tmp, 'out-a') }, { modulesDir: STUBS, now: NOW, log });
    assert.equal(a.exitCode, 0);
    assert.equal(existsSync(path.join(rootA, '.execution')), false);
    await assert.rejects(runChecks({ gates: ['brief'], root: rootA, profile: profileA }, { modulesDir: STUBS, now: NOW, log }), /run \/execution's bootstrap first/, 'without --out mode A still needs the state repository');
  });

  test('a root that does not exist is a usage error, with or without --out', async () => {
    for (const extra of [{}, { out: path.join(tmp, 'out-x') }]) {
      await assert.rejects(runChecks({ gates: ['brief'], root: path.join(tmp, 'no-such-root'), profile: path.join(REPO, 'profile.json'), ...extra }, { modulesDir: STUBS, now: NOW, log }), (err) => err instanceof UsageError && /is not an existing folder/.test(err.message));
    }
    assert.equal(existsSync(path.join(tmp, 'out-x')), false);
  });

  test('mode B without --state: no exclude line in a stray .git that is not a repository; a real repository still gets it', async () => {
    const stray = path.join(tmp, 'stray');
    mkdirSync(path.join(stray, '.git', 'info'), { recursive: true });
    mkdirSync(path.join(stray, 'app'));
    assert.equal(insideGitWorkTree(path.join(stray, 'app')), false);
    const strayRun = await runChecks({ gates: ['brief'], root: path.join(stray, 'app'), profile: path.join(REPO, 'profile.json') }, { modulesDir: STUBS, now: NOW, log });
    assert.match(strayRun.reportPath, /stray\/app\/\.frontend\/gates\//);
    assert.equal(existsSync(path.join(stray, '.git', 'info', 'exclude')), false, 'nothing written into the stray .git');

    const real = path.join(tmp, 'real');
    gitRepoAt(real);
    mkdirSync(path.join(real, 'app'));
    assert.equal(insideGitWorkTree(path.join(real, 'app')), true);
    assert.equal(modeBStateOutsideRepo(path.join(real, 'app'), { run_mode: 'B' }), null);
    await runChecks({ gates: ['brief'], root: path.join(real, 'app'), profile: path.join(REPO, 'profile.json') }, { modulesDir: STUBS, now: NOW, log });
    assert.match(readFileSync(path.join(real, '.git', 'info', 'exclude'), 'utf8'), /^\.frontend\/$/m);
    assert.equal(modeBStateOutsideRepo(path.join(tmp, 'missing-root'), { run_mode: 'B' }), null, 'a mistyped root is left to stateDir, which refuses it');
    assert.equal(modeBStateOutsideRepo(stray, { run_mode: 'A' }), null);
  });

  test('an unknown gate, an invalid profile and a malformed routes file are usage errors', async () => {
    await assert.rejects(run({ gates: ['nope'] }), UsageError);
    const badProfile = path.join(tmp, 'bad-profile.json');
    writeFileSync(badProfile, '{"judged_surface": "poster"}');
    await assert.rejects(run({ gates: ['brief'], profile: badProfile }), /judged_surface must be one of/);
    const root = path.join(tmp, 'repo');
    mkdirSync(path.join(root, 'design'), { recursive: true });
    writeFileSync(path.join(root, 'design', 'routes.json'), '[{"path": "no-slash", "name": "x"}]');
    await assert.rejects(run({ gates: ['brief'], root }), (err) => err instanceof UsageError && /routes file/.test(err.message));
  });
});

describe('startServer', () => {
  test('descendantsOf: the whole tree through an exited parent, never an older process on a reused pid', () => {
    const procs = [
      { pid: 10, ppid: 1, startedMs: 5000 },
      { pid: 11, ppid: 10, startedMs: 5100 },
      { pid: 12, ppid: 11, startedMs: 5200 },
      { pid: 13, ppid: 99, startedMs: 3000 },
      { pid: 14, ppid: 99, startedMs: 6000 },
      { pid: 15, ppid: 14, startedMs: 6100 },
      { pid: 16, ppid: 10, startedMs: 1000 },
      { pid: 17, ppid: 17, startedMs: 2000 },
      { pid: 18, ppid: 12, startedMs: null },
    ];
    assert.deepEqual(descendantsOf(10, procs), [11, 12, 18]);
    assert.deepEqual(descendantsOf(99, procs, 2500), [13, 14, 15], 'the root is gone; its children are still found');
    assert.deepEqual(descendantsOf(99, procs, 5000), [14, 15], 'a child older than the root is a reused pid');
    assert.deepEqual(descendantsOf(17, procs), []);
  });

  test('killTreeSync kills the grandchild of a parent that already exited, and confirms the tree is gone', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fe-check-kill-'));
    try {
      const pidFile = path.join(dir, 'pids.json');
      const startedMs = Date.now() - 1000;
      const parent = spawn(process.execPath, [path.join(FIX, 'orphaner.mjs'), pidFile], { stdio: 'ignore', detached: process.platform !== 'win32', windowsHide: true });
      await new Promise((resolve) => parent.once('exit', resolve));
      const pids = JSON.parse(readFileSync(pidFile, 'utf8'));
      assert.equal(isAlive(pids.parent), false, 'the parent exited first');
      assert.equal(isAlive(pids.grandchild), true, 'its child kept running');
      const result = killTreeSync(pids.parent, 'KILL', { startedMs });
      assert.deepEqual(result.survivors, [], `survivors: ${result.survivors.join(', ')}; problems: ${result.problems.join(' / ')}`);
      assert.equal(isAlive(pids.grandchild), false, `grandchild ${pids.grandchild} must be gone`);
      if (process.platform === 'win32') assert.ok(result.tree.includes(pids.grandchild), 'the listing found the orphan through its parent pid');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('hands its handle over at spawn time; a URL that never answers times out and the process is killed', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fe-check-start-'));
    try {
      const port = await new Promise((resolve) => {
        const srv = net.createServer();
        srv.listen(0, '127.0.0.1', () => {
          const address = srv.address();
          srv.close(() => resolve(address && typeof address === 'object' ? address.port : 0));
        });
      });
      const pidFile = path.join(dir, 'sleeper.pid');
      /** @type {import('../../frontend-check.mjs').StartedServer | null} */
      let early = null;
      const command = `"${process.execPath}" "${path.join(FIX, 'sleeper.mjs')}" "${pidFile}"`;
      await assert.rejects(
        startServer(command, `http://127.0.0.1:${port}/`, { timeoutMs: 1500, onSpawn: (h) => { early = h; } }),
        /did not answer within 2 s/,
      );
      assert.ok(early !== null, 'onSpawn ran before the wait ended');
      const pid = Number(readFileSync(pidFile, 'utf8'));
      let gone = false;
      for (let i = 0; i < 50 && !gone; i += 1) {
        try {
          process.kill(pid, 0);
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch {
          gone = true;
        }
      }
      assert.ok(gone, `sleeper ${pid} must be gone`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('frontend-check CLI', () => {
  /**
   * @param {string} script
   * @param {string[]} args
   */
  const cli = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 60000 });

  test('--help exits 0; unknown gates, colon syntax and conflicting targets exit 2', () => {
    const script = path.join(SCRIPTS, 'frontend-check.mjs');
    const help = cli(script, ['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--phase build/);
    assert.equal(cli(script, ['--gates', 'nope']).status, 2);
    assert.match(cli(script, ['--gates', 'coverage:FR-003']).stderr, /no colon syntax/);
    assert.equal(cli(script, ['--serve', 'dist', '--url', 'http://127.0.0.1:1']).status, 2);
    assert.equal(cli(script, ['--bogus']).status, 2);
  });

  test('exit 0 with JSON on stdout when every gate is ok, 1 when a requested gate is skipped', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fe-check-cli-'));
    try {
      const ok = cli(WRAPPER, ['--json', '--gates', 'brief', '--root', REPO, '--profile', path.join(REPO, 'profile.json'), '--state', dir]);
      assert.equal(ok.status, 0, ok.stderr);
      const report = JSON.parse(ok.stdout);
      assert.equal(report.ok, true);
      assert.deepEqual(schemaErrors(report), []);
      assert.match(ok.stderr, /frontend-check: ok \(1 ok, 0 fail, 0 skipped\)/);
      const skipped = cli(WRAPPER, ['--json', '--gates', 'refs.ledger', '--root', REPO, '--profile', path.join(REPO, 'profile.json'), '--state', dir]);
      assert.equal(skipped.status, 1);
      assert.equal(JSON.parse(skipped.stdout).counts.skipped, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
