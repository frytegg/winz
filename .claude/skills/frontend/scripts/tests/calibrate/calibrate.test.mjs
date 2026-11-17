// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  VIEWPORTS, applyProposal, dropFailedHarEntries, entryRule, gitWorkTree, isLoopback, loadCorpus, loadLabels, optionsFrom, parseWayback,
  planEntry, policyFor, proposeTier, requestAllowed, routeTargetUrl, ruleFingerprint, summariseRules,
} from '../../calibrate.mjs';
import { UsageError } from '../../lib/errors.mjs';
import { loadRegistry } from '../../rules/load.mjs';

/**
 * @typedef {import('../../calibrate.mjs').CorpusEntry} CorpusEntry
 * @typedef {import('../../calibrate.mjs').CalibrateOptions} CalibrateOptions
 * @typedef {import('../../calibrate.mjs').EntryResult} EntryResult
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '..', '..', 'calibrate.mjs');
const FIX = path.resolve(HERE, '..', 'fixtures', 'calibrate');
const RULES = path.join(FIX, 'rules');

/** @type {string} */
let tmp = '';

/**
 * @param {Partial<CalibrateOptions>} [over]
 * @returns {CalibrateOptions}
 */
function options(over = {}) {
  return { ...optionsFrom({ base: FIX, corpus: path.join(FIX, 'corpus.template.json'), registry: path.join(RULES, 'registry.json') }), labels: null, ...over };
}

/**
 * @param {Partial<CorpusEntry> & {render?: any}} over
 * @returns {CorpusEntry}
 */
function entry(over) {
  return /** @type {CorpusEntry} */ ({
    id: 'e', set: 'positive', status: 'ready', render: { type: 'serve', dir: 'sites/pos-a', routes: [{ path: '/', name: 'home' }] }, ...over,
  });
}

describe('corpus manifest', () => {
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-cal-unit-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('the fixture template loads; its SHA-256 is recorded', () => {
    const corpus = loadCorpus(path.join(FIX, 'corpus.template.json'));
    assert.equal(corpus.entries.length, 9);
    assert.match(corpus.sha256, /^[0-9a-f]{64}$/);
  });

  test('every problem is listed in one usage error', () => {
    const file = path.join(tmp, 'corpus.json');
    writeFileSync(file, JSON.stringify({
      version: 1,
      entries: [
        { id: 'a b', set: 'positive', status: 'ready', render: { type: 'serve', routes: [{ path: '/', name: 'x' }] } },
        { id: 'dup', set: 'nope', status: 'later', render: { type: 'ftp', routes: [] } },
        { id: 'dup', set: 'control', status: 'ready', render: { type: 'url', routes: [{ path: 'no-slash', name: 'x' }] }, source_paths: [3] },
      ],
    }));
    assert.throws(() => loadCorpus(file), (err) => {
      assert.ok(err instanceof UsageError);
      for (const bit of ['id must be letters', 'set must be one of', 'status must be one of', 'render.type must be one of', 'id used twice', 'render.routes[0] must be', 'source_paths must be']) {
        assert.ok(err.message.includes(bit), `${bit} in ${err.message}`);
      }
      return true;
    });
    writeFileSync(file, '{not json');
    assert.throws(() => loadCorpus(file), /not valid JSON/);
    assert.throws(() => loadCorpus(path.join(tmp, 'none.json')), UsageError);
  });
});

describe('targets and network rules', () => {
  test('isLoopback', () => {
    assert.equal(isLoopback('http://127.0.0.1:8080/x'), true);
    assert.equal(isLoopback('http://localhost/'), true);
    assert.equal(isLoopback('http://[::1]:3000/'), true);
    assert.equal(isLoopback('https://web.archive.org/'), false);
    assert.equal(isLoopback('not a url'), false);
  });

  test('parseWayback always replays with the if_ modifier and repairs a single-slash original', () => {
    assert.deepEqual(parseWayback('https://web.archive.org/web/20221114154205/https://brianlovin.com/'), {
      prefix: 'https://web.archive.org/web/20221114154205if_/',
      original: 'https://brianlovin.com/',
      replay: 'https://web.archive.org/web/20221114154205if_/https://brianlovin.com/',
    });
    assert.equal(parseWayback('https://web.archive.org/web/20221115235644if_/http://www.theguardian.com/uk')?.original, 'http://www.theguardian.com/uk');
    assert.equal(parseWayback('https://web.archive.org/web/20221115im_/https:/x.org/a')?.original, 'https://x.org/a');
    assert.equal(parseWayback('https://example.org/page'), null);
  });

  test('routeTargetUrl joins routes to served folders, sites and snapshots', () => {
    const route = (/** @type {string} */ p) => ({ path: p, name: 'r' });
    assert.equal(routeTargetUrl({ kind: 'serve', dir: '/x' }, 'http://127.0.0.1:9', route('/telephone/a.html')), 'http://127.0.0.1:9/telephone/a.html');
    assert.equal(routeTargetUrl({ kind: 'url', base: 'https://stripe.com/en-fr' }, '', route('/en-fr')), 'https://stripe.com/en-fr');
    assert.equal(routeTargetUrl({ kind: 'url', base: 'https://orma.app/' }, '', route('/facility')), 'https://orma.app/facility');
    const wb = /** @type {any} */ ({ kind: 'wayback', ...parseWayback('https://web.archive.org/web/20221115235644if_/http://www.theguardian.com/uk') });
    assert.equal(routeTargetUrl(wb, '', route('/uk')), wb.replay, 'the snapshot route is the replay URL itself');
    assert.equal(routeTargetUrl(wb, '', route('/world')), 'https://web.archive.org/web/20221115235644if_/http://www.theguardian.com/world');
  });

  test('requestAllowed: loopback only, the replay host plus archive hosts, or open', () => {
    assert.equal(requestAllowed('http://127.0.0.1:5/a.js', 'loopback', null), true);
    assert.equal(requestAllowed('https://fonts.googleapis.com/css', 'loopback', null), false);
    assert.equal(requestAllowed('data:image/png;base64,AA', 'loopback', null), true);
    assert.equal(requestAllowed('https://web.archive.org/web/2022/https://x.org/a.css', 'archive', 'web.archive.org'), true);
    assert.equal(requestAllowed('https://web-static.archive.org/_static/js/wombat.js', 'archive', 'web.archive.org'), true);
    assert.equal(requestAllowed('https://x.org/live.js', 'archive', 'web.archive.org'), false);
    assert.equal(requestAllowed('http://127.0.0.1:7/leak.js', 'archive', '127.0.0.1:6'), false, 'same machine, other port');
    assert.equal(requestAllowed('https://anything.example/', 'open', null), true);
  });

  test('policyFor: a HAR replay is the whole network; Wayback reaches the archive only; otherwise --network decides', () => {
    assert.equal(policyFor('url', false, 'replay'), null, 'a remote site replayed offline is not blocked by a loopback rule');
    assert.equal(policyFor('wayback', false, 'replay'), null);
    assert.equal(policyFor('wayback', true, 'live'), 'archive', '--network never opens a Wayback replay to live sites');
    assert.equal(policyFor('wayback', false, 'record'), 'archive');
    assert.equal(policyFor('serve', false, 'live'), 'loopback');
    assert.equal(policyFor('serve', true, 'record'), 'open');
    assert.equal(policyFor('url', true, 'live'), 'open');
  });

  test('gitWorkTree needs a real repository: a .git folder with HEAD, or a .git file naming one', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fe-cal-git-'));
    try {
      mkdirSync(path.join(dir, 'stray', '.git', 'info'), { recursive: true });
      mkdirSync(path.join(dir, 'stray', 'har'), { recursive: true });
      assert.equal(gitWorkTree(path.join(dir, 'stray', 'har')), gitWorkTree(dir), 'a .git folder without HEAD is not a repository');
      mkdirSync(path.join(dir, 'repo', '.git'), { recursive: true });
      writeFileSync(path.join(dir, 'repo', '.git', 'HEAD'), 'ref: refs/heads/main\n');
      assert.equal(gitWorkTree(path.join(dir, 'repo', 'deep', 'har')), path.join(dir, 'repo').replace(/\\/g, '/'));
      mkdirSync(path.join(dir, 'worktree'), { recursive: true });
      writeFileSync(path.join(dir, 'worktree', '.git'), 'gitdir: ../repo/.git/worktrees/w\n');
      assert.equal(gitWorkTree(path.join(dir, 'worktree')), path.join(dir, 'worktree').replace(/\\/g, '/'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('planEntry', () => {
  test('entries that are not ready are skipped with their status and the first sentence of the notes', () => {
    const plan = planEntry(entry({ status: 'needs-build', hold_until: '2026-10-08T11:00:00Z', notes: 'Not built yet. Then more.' }), options());
    assert.equal(plan.skip, 'status needs-build, held until 2026-10-08T11:00:00Z: Not built yet.');
  });

  test('corpus problems are data problems; option skips are not', () => {
    const cases = [
      [{ render: { type: 'build', dir: 'x', routes: [{ path: '/', name: 'h' }] } }, /never built here/, true],
      [{ render: { type: 'serve', dir: 'sites/none', routes: [{ path: '/', name: 'h' }] } }, /serve folder not found/, true],
      [{ render: { type: 'serve', dir: '<scratch>/x', routes: [{ path: '/', name: 'h' }] } }, /<scratch> placeholder/, true],
      [{ render: { type: 'url', url: 'ftp://x', routes: [{ path: '/', name: 'h' }] } }, /not an http\(s\) URL/, true],
      [{ render: { type: 'wayback', url: null, replay_url: null, routes: [{ path: '/', name: 'h' }] } }, /no Wayback snapshot/, true],
      [{ render: { type: 'url', url: 'https://orma.example/', routes: [{ path: '/', name: 'h' }] } }, /needs the network/, false],
      [{ render: { type: 'wayback', replay_url: 'https://web.archive.org/web/2022if_/https://x.org/', routes: [{ path: '/', name: 'h' }] } }, /needs the network/, false],
    ];
    for (const [over, reason, data] of cases) {
      const plan = planEntry(entry(/** @type {any} */ (over)), options());
      assert.equal(plan.target, null, String(reason));
      assert.match(String(plan.targetSkip), /** @type {RegExp} */ (reason));
      assert.equal(plan.targetSkipIsData, data, String(reason));
    }
  });

  test('--network opens remote entries; exemplars also need a recorded robots verdict', () => {
    const url = { render: { type: 'url', url: 'https://orma.example/', routes: [{ path: '/', name: 'h' }] } };
    assert.deepEqual(planEntry(entry(/** @type {any} */ (url)), options({ network: true })).target, { kind: 'url', base: 'https://orma.example/' });
    const ex = planEntry(entry(/** @type {any} */ ({ ...url, set: 'exemplar' })), options({ network: true }));
    assert.match(String(ex.targetSkip), /robots\.txt verdict/);
    const allowed = planEntry(entry(/** @type {any} */ ({ ...url, set: 'exemplar', check: { skill_tokens: { 'frontend-capture': { allowed: true } } } })), options({ network: true }));
    assert.equal(allowed.target?.kind, 'url');
    const local = { render: { type: 'url', url: 'http://127.0.0.1:4173/', routes: [{ path: '/', name: 'h' }] } };
    assert.equal(planEntry(entry(/** @type {any} */ (local)), options()).target?.kind, 'url', 'a loopback URL needs no --network');
  });

  test('a HAR recorded for every viewport replaces the network', () => {
    const har = mkdtempSync(path.join(os.tmpdir(), 'fe-cal-har-'));
    try {
      mkdirSync(path.join(har, 'e'));
      writeFileSync(path.join(har, 'e', 'desktop.har'), '{}');
      const url = entry(/** @type {any} */ ({ render: { type: 'url', url: 'https://orma.example/', routes: [{ path: '/', name: 'h' }] } }));
      assert.equal(planEntry(url, options({ har })).target, null, 'mobile has no HAR yet');
      writeFileSync(path.join(har, 'e', 'mobile.har'), '{}');
      assert.equal(planEntry(url, options({ har })).target?.kind, 'url');
    } finally {
      rmSync(har, { recursive: true, force: true });
    }
  });

  test('the static layer needs a local folder', () => {
    assert.match(String(planEntry(entry({}), options()).staticSkip), /no source_root/);
    assert.match(String(planEntry(entry({ source_root: 'https://github.com/x/y/tree/abc' }), options()).staticSkip), /remote/);
    assert.match(String(planEntry(entry({ source_root: 'corpus.template.json' }), options()).staticSkip), /is a file/);
    const missing = planEntry(entry({ source_root: 'src/none' }), options());
    assert.match(String(missing.staticSkip), /not found/);
    assert.equal(missing.staticSkipIsData, true);
    const ok = planEntry(entry({ source_root: 'src/pos-a', source_paths: ['ui'] }), options());
    assert.deepEqual(ok.staticSource, { root: path.join(FIX, 'src', 'pos-a'), paths: ['ui'] });
  });
});

describe('proposeTier', () => {
  const opts = { tier1Share: 0.3, minPositives: 1, minControls: 1 };
  const c = (/** @type {number} */ fired, /** @type {number} */ total) => ({ fired, total });

  test('tier 1: at least the share of positives and no control', () => {
    assert.equal(proposeTier({ positives: c(3, 10), controls: c(0, 9), controlErrors: 0 }, opts).tier, 'tier1');
    assert.equal(proposeTier({ positives: c(2, 10), controls: c(0, 9), controlErrors: 0 }, opts).tier, 'advisory', 'below the share');
    assert.equal(proposeTier({ positives: c(2, 10), controls: c(0, 9), controlErrors: 0 }, { ...opts, tier1Share: 0.2 }).tier, 'tier1', 'the share is configurable');
  });

  test('tier 2: fires on a control, more often on positives', () => {
    assert.equal(proposeTier({ positives: c(5, 10), controls: c(1, 9), controlErrors: 0 }, opts).tier, 'tier2');
    const same = proposeTier({ positives: c(5, 18), controls: c(4, 9), controlErrors: 0 }, opts);
    assert.equal(same.tier, 'advisory', 'more positive hits but a lower rate (5/18 < 4/9) is not tier 2');
    assert.match(same.reason, /as often as or more often/);
  });

  test('no proposal without enough measured entries or when a detector failed on a control', () => {
    assert.equal(proposeTier({ positives: c(0, 0), controls: c(0, 9), controlErrors: 0 }, opts).tier, null);
    assert.equal(proposeTier({ positives: c(3, 3), controls: c(0, 0), controlErrors: 0 }, opts).tier, null);
    assert.equal(proposeTier({ positives: c(3, 3), controls: c(0, 2), controlErrors: 0 }, { ...opts, minControls: 3 }).tier, null);
    const blocked = proposeTier({ positives: c(3, 3), controls: c(0, 2), controlErrors: 1 }, opts);
    assert.equal(blocked.tier, null);
    assert.match(blocked.reason, /failed on 1 control/);
  });
});

describe('entryRule and summariseRules', () => {
  const registry = loadRegistry(path.join(RULES, 'registry.json'));
  const rule = (/** @type {string} */ id) => /** @type {import('../../rules/load.mjs').Rule} */ (registry.rules.find((r) => r.id === id));
  /** @param {string} route @param {boolean} ok */
  const page = (route, ok) => ({ route, viewport: 'desktop', url: `http://x${route}`, mode: /** @type {const} */ ('live'), status: ok ? 200 : 500, ok, error: ok ? null : 'HTTP 500', ms: 1 });

  test('the runtime layer decides for runtime rules, the static layer for static-only rules', () => {
    const staticHit = [{ rule: 'SL-T01', layer: /** @type {const} */ ('static'), file: 'a.js', line: 1, excerpt: '', value: 'x', detail: '' }];
    const silentPage = [{ page: page('/', true), findings: [] }];
    const t01 = entryRule(rule('SL-T01'), true, staticHit, silentPage);
    assert.deepEqual([t01.state, t01.static, t01.runtime], ['silent', 'fired', 'silent'], 'an unconfirmed static hit does not count');
    const g01 = entryRule(rule('SL-G01'), true, [{ ...staticHit[0], rule: 'SL-G01' }], []);
    assert.deepEqual([g01.state, g01.static, g01.runtime], ['fired', 'fired', null]);
    assert.equal(entryRule(rule('SL-G01'), false, [], []).state, 'not-run');
    assert.equal(entryRule(rule('SL-T02'), false, [], [{ page: page('/', false), findings: [] }]).state, 'not-run', 'no measured page');
    const errored = entryRule(rule('SL-T02'), false, [], [{ page: page('/', true), findings: [{ rule: 'SL-T02', layer: 'runtime', error: 'RangeError: x' }] }]);
    assert.equal(errored.state, 'error');
    assert.match(errored.errors[0], /RangeError: x/);
    const fired = entryRule(rule('SL-T02'), false, [], [
      { page: page('/', true), findings: [{ rule: 'SL-T02', layer: 'runtime', error: 'RangeError: x' }] },
      { page: page('/b', true), findings: [{ rule: 'SL-T02', layer: 'runtime', route: '/b', viewport: 'desktop', selector: '.b', value: 1, detail: '' }] },
    ]);
    assert.equal(fired.state, 'fired', 'a hit on any page wins over an error on another');
    assert.equal(fired.examples[0].selector, '.b');
  });

  test('summariseRules counts measured entries per set, synthetic with positives, and joins owner labels', () => {
    /**
     * @param {string} id @param {any} set @param {Record<string, string>} states
     * @returns {EntryResult}
     */
    const result = (id, set, states) => /** @type {EntryResult} */ ({
      id, set, name: id, made_by: null, category: null, status: 'measured', reason: null, target: { type: 'serve', location: null },
      static: { ran: true, reason: null, root: null, files: 1, findings: 0 }, runtime: { ran: true, reason: null, pages: [] },
      rules: Object.fromEntries(registry.rules.map((r) => [r.id, {
        state: /** @type {any} */ (states[r.id] ?? 'silent'), static: null, runtime: null, findings: { static: 0, runtime: 0 }, examples: [], errors: [],
      }])),
    });
    const entries = [
      result('pos-a', 'positive', { 'SL-T01': 'fired' }),
      result('pos-b', 'positive', { 'SL-T01': 'fired', 'SL-T02': 'not-run' }),
      result('syn-a', 'synthetic', { 'SL-T02': 'fired' }),
      result('ctl-a', 'control', { 'SL-T02': 'fired', 'SL-T01': 'error' }),
      { ...result('ctl-x', 'control', { 'SL-T01': 'fired' }), status: /** @type {const} */ ('skipped') },
    ];
    const labels = loadLabels(path.join(FIX, 'labels.json'));
    const rules = summariseRules(registry, entries, labels, options());
    const t01 = /** @type {import('../../calibrate.mjs').RuleResult} */ (rules.find((r) => r.id === 'SL-T01'));
    assert.deepEqual([t01.positives.fired, t01.positives.total, t01.controls.fired, t01.controls.total], [2, 3, 0, 0]);
    assert.deepEqual(t01.states.controls.error, ['ctl-a']);
    assert.equal(t01.proposal.tier, null, 'no measured control');
    assert.deepEqual(t01.labels, { entries: 2, both: 1, ownerOnly: 0, detectorOnly: 1, neither: 0 });
    const t02 = /** @type {import('../../calibrate.mjs').RuleResult} */ (rules.find((r) => r.id === 'SL-T02'));
    assert.deepEqual([t02.positives.fired, t02.positives.total, t02.synthetic.fired, t02.controls.fired, t02.controls.total], [1, 2, 1, 1, 1]);
    assert.deepEqual(t02.states.positives.notRun, ['pos-b']);
    assert.equal(t02.proposal.tier, 'advisory', '50% of positives against 100% of controls');
    assert.deepEqual(t02.labels, { entries: 2, both: 1, ownerOnly: 0, detectorOnly: 0, neither: 1 }, 'pos-b was not measured for SL-T02');
    assert.equal(rules.find((r) => r.id === 'SL-T03')?.labels, null, 'not offered in the session');
  });
});

describe('applyProposal', () => {
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-cal-apply-'));
    cpSync(RULES, path.join(tmp, 'rules'), { recursive: true });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * @param {Array<Record<string, unknown>>} rules
   * @returns {string}
   */
  function proposal(rules) {
    const file = path.join(tmp, 'proposal.json');
    writeFileSync(file, JSON.stringify({ version: 1, made_at: '2026-10-02T08:00:00Z', results: 'calibration/results/x', rules }));
    return file;
  }

  /**
   * @param {string} id
   * @param {Record<string, unknown>} [over]
   */
  function item(id, over = {}) {
    const registry = loadRegistry(path.join(tmp, 'rules', 'registry.json'));
    const rule = /** @type {import('../../rules/load.mjs').Rule} */ (registry.rules.find((r) => r.id === id));
    return {
      rule: id, proposed_tier: 'tier1', apply: true, reason: 'fires on 2/3 positives', fingerprint: ruleFingerprint(rule, registry.dir),
      counts: { positives: { fired: 2, total: 3 }, controls: { fired: 0, total: 2 }, exemplars: { fired: 0, total: 0 } }, ...over,
    };
  }

  test('writes tiers, counts, the run date and a note; skips rules marked apply false; the result is a valid registry', () => {
    const file = path.join(tmp, 'rules', 'registry.json');
    const before = JSON.parse(readFileSync(file, 'utf8'));
    const result = applyProposal(proposal([item('SL-T01'), item('SL-T02', { proposed_tier: 'tier2' }), item('SL-T03', { apply: false }), item('SL-G01', { proposed_tier: null })]), file);
    assert.deepEqual(result.applied, [{ rule: 'SL-T01', from: 'candidate', to: 'tier1' }, { rule: 'SL-T02', from: 'candidate', to: 'tier2' }]);
    assert.deepEqual(result.skipped.map((s) => s.rule), ['SL-T03', 'SL-G01']);
    const after = JSON.parse(readFileSync(file, 'utf8'));
    const t01 = after.rules.find((/** @type {any} */ r) => r.id === 'SL-T01');
    assert.equal(t01.tier, 'tier1');
    assert.deepEqual(t01.calibration.positives, { fired: 2, total: 3 });
    assert.equal(t01.calibration.date, '2026-10-02T08:00:00Z');
    assert.match(t01.calibration.notes, /fires on 2\/3 positives/);
    assert.deepEqual(after.rules.find((/** @type {any} */ r) => r.id === 'SL-T03'), before.rules.find((/** @type {any} */ r) => r.id === 'SL-T03'));
    assert.equal(readFileSync(file, 'utf8').includes('\r'), false);
    loadRegistry(file, { strict: false });
  });

  test('refuses the whole proposal on an unknown rule, a bad tier, bad counts or a changed detector', () => {
    const file = path.join(tmp, 'rules', 'registry.json');
    const original = readFileSync(file, 'utf8');
    const bad = [
      [[item('SL-T01'), { ...item('SL-T01'), rule: 'SL-Z99' }], /SL-Z99 is not in/],
      [[item('SL-T01', { proposed_tier: 'gold' })], /not one of candidate\|tier1\|tier2\|advisory/],
      [[item('SL-T01', { counts: { positives: { fired: 4, total: 3 }, controls: { fired: 0, total: 1 }, exemplars: { fired: 0, total: 0 } } })], /counts must hold/],
    ];
    for (const [rules, message] of bad) {
      assert.throws(() => applyProposal(proposal(/** @type {any} */ (rules)), file), (err) => err instanceof UsageError && /** @type {RegExp} */ (message).test(err.message));
      assert.equal(readFileSync(file, 'utf8'), original, 'nothing written');
    }
    const stale = proposal([item('SL-T01'), item('SL-T02')]);
    appendFileSync(path.join(tmp, 'rules', 'runtime', 'SL-T02.mjs'), '// edited after the run\n');
    assert.throws(() => applyProposal(stale, file), /SL-T02: its registry entry or detector changed/);
    assert.equal(readFileSync(file, 'utf8'), original, 'SL-T01 was not written either');
  });

  test('a proposal that is not one is a usage error', () => {
    const file = path.join(tmp, 'p.json');
    writeFileSync(file, '{"version": 2}');
    assert.throws(() => applyProposal(file, path.join(tmp, 'rules', 'registry.json')), /must be the proposal\.json/);
  });
});

describe('dropFailedHarEntries', () => {
  test('removes entries without a response and leaves a clean HAR untouched', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fe-cal-harfix-'));
    try {
      const file = path.join(dir, 'desktop.har');
      const entryOf = (/** @type {string} */ url, /** @type {number} */ status) => ({ request: { method: 'GET', url }, response: { status } });
      writeFileSync(file, JSON.stringify({ log: { version: '1.2', entries: [entryOf('http://a/', 200), entryOf('http://b/leak.js', -1), entryOf('http://a/x.css', 404)] } }));
      assert.equal(dropFailedHarEntries(file), 1);
      assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).log.entries.map((/** @type {any} */ e) => e.response.status), [200, 404]);
      const before = readFileSync(file, 'utf8');
      assert.equal(dropFailedHarEntries(file), 0);
      assert.equal(readFileSync(file, 'utf8'), before, 'nothing rewritten when every entry has a response');
      assert.equal(dropFailedHarEntries(path.join(dir, 'none.har')), 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('calibrate CLI options', () => {
  test('optionsFrom validates sets, viewports, layers and numbers', () => {
    assert.throws(() => optionsFrom({ sets: 'positive,friends' }), /--sets friends/);
    assert.throws(() => optionsFrom({ viewports: 'desktop,watch' }), /--viewports watch/);
    assert.throws(() => optionsFrom({ layers: 'pixels' }), /--layers pixels/);
    assert.throws(() => optionsFrom({ 'tier1-share': '1.5' }), /--tier1-share 1\.5/);
    assert.throws(() => optionsFrom({ 'min-controls': '0' }), /--min-controls 0/);
    assert.throws(() => optionsFrom({ labels: 'nowhere.json' }), /--labels nowhere\.json: file not found/);
    const o = optionsFrom({ viewports: 'desktop,projector', layers: 'static' });
    assert.deepEqual(o.viewports.map((v) => [v.name, v.width]), [['desktop', 1440], ['projector', 1600]]);
    assert.deepEqual(o.layers, { static: true, runtime: false });
    assert.deepEqual(o.sets, ['positive', 'control', 'synthetic']);
    assert.equal(o.tier1Share, 0.3);
    assert.equal(VIEWPORTS.mobile.width, 390);
  });

  test('--help exits 0; bad flags and --apply with run flags exit 2', () => {
    const cli = (/** @type {string[]} */ args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    const help = cli(['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /tier1 {5}fires on at least --tier1-share/);
    assert.equal(cli(['--sets', 'nope']).status, 2);
    assert.match(cli(['--apply', 'p.json', '--network']).stderr, /--apply takes only --registry and --json/);
    assert.equal(cli(['--apply', 'missing-proposal.json']).status, 2);
  });
});
