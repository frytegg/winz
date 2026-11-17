// @ts-check
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { SchemaRegistry, formatErrors } from './json-schema.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..', '..', '..');
const FRAGMENTS = path.join(SKILL, 'assets', 'wave-fragments');
const SCHEMAS = path.join(SKILL, 'assets', 'schemas');

/**
 * @param {string} file
 * @returns {any}
 */
function loadJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

const registry = new SchemaRegistry();
for (const file of readdirSync(SCHEMAS)) if (file.endsWith('.schema.json')) registry.add(loadJson(path.join(SCHEMAS, file)));

/**
 * @param {string} ref
 * @param {unknown} data
 */
function assertValid(ref, data) {
  const errors = registry.validate(ref, data);
  assert.deepEqual(errors, [], formatErrors(errors));
}

/**
 * Evaluates a fragment the way a Workflow script would hold it: as plain script text, in a context where the clock
 * and the random source throw, so a fragment that uses them fails here.
 * @param {string} file
 * @param {string} name
 * @returns {(api: any, input: any) => Promise<any>}
 */
function loadFragment(file, name) {
  const context = vm.createContext({});
  vm.runInContext(
    [
      'Date.now = function () { throw new Error("Date.now is not available in a workflow script"); };',
      'Math.random = function () { throw new Error("Math.random is not available in a workflow script"); };',
      'globalThis.Date = new Proxy(Date, {construct(target, args) { if (args.length === 0) throw new Error("new Date() is not available in a workflow script"); return Reflect.construct(target, args); }});',
    ].join('\n'),
    context,
  );
  return vm.runInContext(`${readFileSync(file, 'utf8')}\n;${name}`, context);
}

/**
 * @param {unknown} value
 * @returns {any}
 */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * The 32-bit FNV-1a hash the receipt schema documents, written independently of the fragment.
 * @param {string} s
 * @returns {string}
 */
function fnv1a32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * A Workflow api double: agent() answers through `answer`, parallel() and pipeline() follow the documented
 * semantics (a failed thunk or stage yields null).
 * @param {(prompt: string, opts: any) => any} answer
 */
function mockApi(answer) {
  /** @type {Array<{prompt: string, opts: any}>} */
  const calls = [];
  /** @type {string[]} */
  const logs = [];
  const api = {
    /** @param {string} prompt @param {any} opts */
    agent: async (prompt, opts) => {
      calls.push({ prompt, opts: plain(opts) });
      return answer(prompt, opts);
    },
    /** @param {Array<() => Promise<any>>} thunks */
    parallel: async (thunks) => Promise.all(thunks.map(async (t) => {
      try {
        return await t();
      } catch {
        return null;
      }
    })),
    /** @param {any[]} items @param {...Function} stages */
    pipeline: async (items, ...stages) => Promise.all(items.map(async (item, i) => {
      let prev = item;
      try {
        for (const stage of stages) prev = await stage(prev, item, i);
        return prev;
      } catch {
        return null;
      }
    })),
    /** @param {string} message */
    log: (message) => logs.push(message),
  };
  return { api, calls, logs };
}

const feCritique = loadFragment(path.join(FRAGMENTS, 'critique.js'), 'feCritique');
const feDirections = loadFragment(path.join(FRAGMENTS, 'directions.js'), 'feDirections');

const CRITIQUE_INPUT = Object.freeze({
  task: 'T042',
  cwd: 'C:/work/repo',
  skill: 'C:/Users/Utilisateur/.claude/skills/frontend',
  profile: 'C:/work/repo/.execution/profile.json',
  state: 'C:/work/repo/.execution/frontend',
  ui_root: 'app',
  mode: 'full',
  critique: { rounds_max: 3, critics: 3, probes: 5 },
  agents: { implementer: { agentType: 'execution-implementer', model: 'opus', effort: 'high' } },
});

/**
 * @param {number} round
 * @param {string} label
 * @param {{sha?: string, tree?: string, failing?: string[], scores?: Record<string, number>, deterministic?: any[]}} [over]
 */
function measure(round, label, over = {}) {
  const failing = over.failing || [];
  const dir = `C:/work/repo/.execution/frontend/critique/round-${round}/${label}`;
  return {
    round,
    label,
    sha: over.sha || 'aaaa000',
    ui_tree: over.tree || 'cccc000',
    dir,
    gates: { ok: failing.length === 0, counts: { ok: 30 - failing.length, fail: failing.length, skipped: 0 }, failing },
    scores: over.scores || { layout: 10, typography: 8 },
    deterministic: over.deterministic || [{ mark: 'm9', check: 'B5.measure', problem: '104 characters per line', fix: 'max-width: 68ch' }],
    task_file: `${dir}/critic-task.md`,
    tiles: [{ viewport: 'desktop', path: `${dir}/desktop-0.png` }, { viewport: 'mobile', path: `${dir}/mobile-0.png` }],
    first_view: { desktop: `${dir}/first-desktop.png`, mobile: `${dir}/first-mobile.png` },
    proposition: 'Know when you can withdraw. Queue Clock shows stakers when a withdrawal becomes claimable.',
  };
}

/**
 * @param {string} mark
 * @param {string} category
 */
function issue(mark, category) {
  return { mark, category, problem: `measured problem at ${mark}`, fix: `concrete fix at ${mark}` };
}

/**
 * A scripted critique run.
 * @param {{
 *   measures: Record<string, any>,
 *   critics: Record<number, any[][]>,
 *   fixes?: Record<number, any>,
 *   pairwise?: Record<number, [string, string]>,
 *   probeRestates?: (viewport: string, probe: string) => boolean,
 *   restoreExit?: number,
 *   throwOn?: RegExp,
 * }} s
 */
function critiqueScenario(s) {
  /** @type {string | null} */
  let written = null;
  const restores = /** @type {string[]} */ ([]);
  const mock = mockApi((prompt, opts) => {
    if (s.throwOn && s.throwOn.test(prompt)) throw new Error('agent budget exhausted');
    const kind = /^kind: (.+)$/m.exec(prompt)?.[1];
    const pass = /^pass-id: (.+)$/m.exec(prompt)?.[1] || '';
    if (prompt.startsWith('Write one file')) {
      written = prompt.slice(prompt.indexOf('----- BEGIN RECEIPT -----\n') + 26, prompt.indexOf('\n----- END RECEIPT -----'));
      return { written: true, path: /^Path: (.+)$/m.exec(prompt)?.[1] };
    }
    if (opts.schema && opts.schema.properties && opts.schema.properties.exit_code) {
      const command = /^cd ".+?" && (.+)$/m.exec(prompt)?.[1] || '';
      const m = / measure --round (\d+) --label (\w+)/.exec(command);
      if (m) {
        const result = s.measures[`${m[1]}:${m[2]}`];
        return result === undefined ? null : result.exit_code !== undefined ? result : { exit_code: 0, json: result, stderr_tail: '' };
      }
      if (command.startsWith('git revert')) {
        restores.push(command);
        return { exit_code: s.restoreExit ?? 0, json: null, stderr_tail: '' };
      }
      if (command.includes(' ui-copy ')) return { exit_code: 0, json: { ok: true, path: 'C:/work/repo/.execution/frontend/ui-copy.md' }, stderr_tail: '' };
      return { exit_code: 2, json: null, stderr_tail: `unexpected command ${command}` };
    }
    if (opts.agentType === 'frontend-probe') {
      return { pass_id: pass, answer: 'It is a withdrawal queue dashboard. It tells stakers when they can withdraw.', what: 'a queue dashboard', does: 'tells when a withdrawal is claimable', for_whom: 'stakers', unclear: false };
    }
    if (kind === 'critique') {
      const round = Number(/-r(\d+)-c/.exec(pass)?.[1]);
      const critic = Number(/-c(\d+)$/.exec(pass)?.[1]);
      const issues = (s.critics[round] || [])[critic - 1];
      return issues === null || issues === undefined ? null : { pass_id: pass, kind: 'critique', checklist: [{ id: 'FV1', answer: 'yes' }], issues };
    }
    if (kind === 'pairwise') {
      const round = Number(/-r(\d+)-p/.exec(pass)?.[1]);
      const [ab, ba] = (s.pairwise || {})[round] || ['tie', 'tie'];
      return { pass_id: pass, kind: 'pairwise', checklist: [], preferred: pass.endsWith('pAB') ? ab : ba, reason: 'scripted' };
    }
    if (kind === 'probe-match') {
      const viewport = /-r\d+-(\w+)-match$/.exec(pass)?.[1] || '';
      const probes = [...prompt.matchAll(/^(p\d+): /gm)].map((x) => x[1]);
      const restates = s.probeRestates || (() => true);
      return { pass_id: pass, kind: 'probe-match', matches: probes.map((p) => ({ probe: p, restates: restates(viewport, p), reason: 'scripted' })) };
    }
    const round = Number(/critique round (\d+) of task/.exec(prompt)?.[1]);
    return (s.fixes || {})[round] ?? { sha: 'bbbb111', files: ['app/src/sections/G1/Queue.tsx'], summary: 'scripted fix', unresolved: [] };
  });
  return { ...mock, restores, receiptText: () => written };
}

describe('assets/wave-fragments: plain script text for a Workflow', () => {
  for (const [file, name] of [['critique.js', 'feCritique'], ['directions.js', 'feDirections']]) {
    test(`${file} has no import, clock, randomness or Node API, and defines only ${name}`, () => {
      const source = readFileSync(path.join(FRAGMENTS, file), 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const banned of [/^\s*(import|export)\b/m, /\bimport\s*\(/, /\brequire\s*\(/, /Date\.now/, /Math\.random/, /new\s+Date\b/, /\bprocess\./, /\bsetTimeout\b/, /\bfetch\s*\(/, /\beval\s*\(/, /\bnew\s+Function\b/, /\bglobalThis\b/]) {
        assert.ok(!banned.test(code), `${file} uses ${banned}`);
      }
      assert.ok(!source.includes('\r'), `${file} has CR line endings`);
      assert.match(source, new RegExp(`^async function ${name}\\(api, input\\) \\{$`, 'm'));
      const topLevel = code.split('\n').filter((line) => /^(async )?function |^(const|let|var|class) /.test(line));
      assert.deepEqual(topLevel, [`async function ${name}(api, input) {`], `${file}: one top-level declaration`);
      assert.ok(source.startsWith('/*\n'), `${file}: starts with the header comment`);
      assert.ok(/input = \{/.test(source) && /Returns /.test(source), `${file}: header documents the input and the receipt`);
      new vm.Script(`${source}\n;${name}`);
    });
  }

  test('the agent schemas inside critique.js equal the schema files', async () => {
    const run = critiqueScenario({
      measures: { '0:baseline': measure(0, 'baseline'), '1:candidate': measure(1, 'candidate', { sha: 'bbbb111', tree: 'dddd111', scores: { layout: 12, typography: 8 } }) },
      critics: { 1: [[issue('m3', 'layout')], [issue('m3', 'layout')], []] },
      pairwise: { 1: ['B', 'A'] },
    });
    await feCritique(run.api, { ...CRITIQUE_INPUT, critique: { rounds_max: 1, critics: 3, probes: 5 } });
    const critic = loadJson(path.join(SCHEMAS, 'critic-output.schema.json')).$defs;
    const probe = loadJson(path.join(SCHEMAS, 'probe-output.schema.json'));
    const commands = loadJson(path.join(SCHEMAS, 'fragment-commands.schema.json')).$defs;
    const schemaOf = (/** @type {(c: {prompt: string, opts: any}) => boolean} */ pick) => run.calls.find(pick)?.opts.schema;
    assert.deepEqual(schemaOf((c) => /^kind: critique$/m.test(c.prompt)), critic.critique);
    assert.deepEqual(schemaOf((c) => /^kind: pairwise$/m.test(c.prompt)), critic.pairwise);
    assert.deepEqual(schemaOf((c) => /^kind: probe-match$/m.test(c.prompt)), critic.probeMatch);
    const { $schema, $id, title, description, ...probeSchema } = probe;
    assert.deepEqual(schemaOf((c) => c.opts.agentType === 'frontend-probe'), probeSchema);
    assert.deepEqual(schemaOf((c) => /^cd "/m.test(c.prompt)), commands.runResult);
  });
});

describe('assets/wave-fragments/critique.js (feCritique)', () => {
  test('an accepted candidate becomes the best-so-far; the run stops when no issue is kept', async () => {
    const run = critiqueScenario({
      measures: {
        '0:baseline': measure(0, 'baseline'),
        '1:candidate': measure(1, 'candidate', { sha: 'bbbb111', tree: 'dddd111', scores: { layout: 12, typography: 8 } }),
      },
      critics: {
        1: [[issue('m3', 'layout'), issue('m5', 'copy')], [issue('m3', 'layout')], [issue('m9', 'typography')]],
        2: [[], [], []],
      },
      pairwise: { 1: ['B', 'A'] },
    });
    const receipt = plain(await feCritique(run.api, CRITIQUE_INPUT));
    assertValid('urn:frontend:schema:critique-receipt:1', receipt);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.stop_reason, 'no-issue-kept');
    assert.equal(receipt.rounds_run, 2);
    assert.equal(receipt.best.round, 1);
    assert.equal(receipt.best.sha, 'bbbb111');
    assert.equal(receipt.baseline.sha, 'aaaa000');
    const first = receipt.rounds[0];
    assert.equal(first.verdict, 'accepted');
    assert.deepEqual(first.issues.map((/** @type {any} */ i) => [i.key, i.votes, i.confirmed]), [['m9|typography', 1, true], ['m3|layout', 2, false]]);
    assert.equal(first.dropped, 1, 'the single-critic copy issue is dropped');
    assert.deepEqual(first.pairwise, { ab: 'B', ba: 'A', consistent: true });
    assert.equal(receipt.rounds[1].verdict, 'no-issue');
    assert.equal(receipt.probes.pass, true);
    assert.equal(receipt.probes.measured_on, 1, 'probes re-read the accepted candidate');
    assert.deepEqual(receipt.ui_copy, { ok: true, path: 'C:/work/repo/.execution/frontend/ui-copy.md' });
    assert.equal(run.restores.length, 0);
    const { checksum, ...rest } = receipt;
    assert.equal(checksum, `fnv1a32:${fnv1a32(JSON.stringify(rest))}`);
    assert.deepEqual(JSON.parse(String(run.receiptText())), receipt, 'the written receipt is the returned one');
    const fix = run.calls.find((c) => c.opts.agentType === 'execution-implementer');
    assert.ok(fix && /\[m9, typography\] problem: measured problem at m9 fix: concrete fix at m9/.test(fix.prompt));
    assert.deepEqual(fix?.opts.model, 'opus');
    const critic = run.calls.find((c) => c.opts.agentType === 'frontend-critic' && /^kind: critique$/m.test(c.prompt));
    assert.ok(critic && critic.prompt.startsWith('pass-id: T042-r1-c1\nkind: critique\ntask-file: C:/work/repo/.execution/frontend/critique/round-0/baseline/critic-task.md'));
    assert.equal(critic?.opts.model, undefined, 'the agent definition pins the critic model');
    const probe = run.calls.find((c) => c.opts.agentType === 'frontend-probe');
    assert.equal(probe?.prompt, 'pass-id: T042-r0-desktop-p1\nimage: C:/work/repo/.execution/frontend/critique/round-0/baseline/first-desktop.png');
    const runner = run.calls.find((c) => /^cd "C:\/work\/repo" && pnpm -C "app" build && node "C:\/Users\/Utilisateur\/\.claude\/skills\/frontend\/scripts\/critique\.mjs" measure --round 0 --label baseline /m.test(c.prompt));
    assert.ok(runner, 'the baseline measure chains the build');
    assert.deepEqual([runner?.opts.model, runner?.opts.effort], ['sonnet', 'low']);
    assert.equal(run.calls.filter((c) => c.opts.agentType === 'frontend-probe').length, 20, 'five probes per viewport, twice');
  });

  test('two rejected candidates stop the run and the tree goes back to the best-so-far each time', async () => {
    const run = critiqueScenario({
      measures: {
        '0:baseline': measure(0, 'baseline'),
        '1:candidate': measure(1, 'candidate', { sha: 'bbbb111' }),
        '2:candidate': measure(2, 'candidate', { sha: 'eeee222', scores: { layout: 10, typography: 7 } }),
      },
      critics: { 1: [[issue('m3', 'layout')], [issue('m3', 'layout')], []], 2: [[issue('m3', 'layout')], [issue('m3', 'layout')], []] },
      pairwise: { 1: ['B', 'B'] },
      fixes: { 2: { sha: 'eeee222', files: ['app/a.css'], summary: 'second try', unresolved: [] } },
    });
    const receipt = plain(await feCritique(run.api, CRITIQUE_INPUT));
    assertValid('urn:frontend:schema:critique-receipt:1', receipt);
    assert.equal(receipt.stop_reason, 'rejected-limit');
    assert.equal(receipt.rounds_run, 2);
    assert.equal(receipt.best.round, 0);
    assert.equal(receipt.ok, true, 'the baseline still passes its gates and probes');
    assert.deepEqual(receipt.rounds[0].pairwise, { ab: 'B', ba: 'B', consistent: false });
    assert.match(receipt.rounds[0].reasons[0], /not preferred in both orders/);
    assert.equal(receipt.rounds[1].pairwise, null, 'a score drop rejects before any pairwise call');
    assert.match(receipt.rounds[1].reasons.join(' '), /score typography dropped from 8 to 7/);
    assert.deepEqual(run.restores, ['git revert --no-edit aaaa000..HEAD', 'git revert --no-edit aaaa000..HEAD']);
    assert.ok(run.logs.some((l) => /pairwise verdicts disagree/.test(l)), 'position bias is logged');
    const secondFix = run.calls.filter((c) => c.opts.agentType === 'execution-implementer')[1];
    assert.match(secondFix.prompt, /A previous fix for m3\|layout was rejected/);
    assert.equal(run.calls.filter((c) => /^kind: pairwise$/m.test(c.prompt)).length, 2);
  });

  test('a gate regression rejects the candidate without asking the pairwise judges', async () => {
    const run = critiqueScenario({
      measures: { '0:baseline': measure(0, 'baseline'), '1:candidate': measure(1, 'candidate', { sha: 'bbbb111', failing: ['a11y.contrast'] }) },
      critics: { 1: [[issue('m3', 'layout')], [issue('m3', 'layout')], []] },
    });
    const receipt = plain(await feCritique(run.api, { ...CRITIQUE_INPUT, critique: { rounds_max: 1, critics: 3, probes: 5 } }));
    assert.equal(receipt.rounds[0].verdict, 'rejected');
    assert.deepEqual(receipt.rounds[0].reasons, ['gate regression: a11y.contrast']);
    assert.equal(run.calls.filter((c) => /^kind: pairwise$/m.test(c.prompt)).length, 0);
    assert.equal(receipt.best.sha, 'aaaa000');
    assert.equal(receipt.stop_reason, 'round-cap');
  });

  test('small mode runs one round whatever the profile says', async () => {
    const run = critiqueScenario({
      measures: { '0:baseline': measure(0, 'baseline'), '1:candidate': measure(1, 'candidate', { sha: 'bbbb111', scores: { layout: 11, typography: 8 } }) },
      critics: { 1: [[issue('m3', 'layout')], [issue('m3', 'layout')], []], 2: [[issue('m4', 'copy')], [issue('m4', 'copy')], []] },
      pairwise: { 1: ['B', 'A'] },
    });
    const receipt = plain(await feCritique(run.api, { ...CRITIQUE_INPUT, mode: 'small' }));
    assert.equal(receipt.rounds_max, 1);
    assert.equal(receipt.rounds_run, 1);
    assert.equal(receipt.stop_reason, 'round-cap');
    assert.equal(receipt.best.round, 1);
    const measures = run.calls.filter((c) => / measure --round \d+ --label /.test(c.prompt));
    assert.ok(measures.length >= 2);
    for (const m of measures) assert.match(m.prompt, / --gates render,a11y,coverage,firstview,tells,ip --json/, 'small mode measures the --phase small set');
  });

  test('full mode measures the build set: no --gates narrows the measure', async () => {
    const run = critiqueScenario({ measures: { '0:baseline': measure(0, 'baseline') }, critics: { 1: [[], [], []] } });
    await feCritique(run.api, CRITIQUE_INPUT);
    const m = run.calls.find((c) => / measure --round 0 --label baseline /.test(c.prompt));
    assert.ok(m && !/ --gates /.test(m.prompt));
  });

  test('Q-F15: no fragment prompt dictates a commit message; the fixer commits under its own rules', async () => {
    const run = critiqueScenario({
      measures: { '0:baseline': measure(0, 'baseline'), '1:candidate': measure(1, 'candidate', { sha: 'bbbb111', scores: { layout: 11, typography: 8 } }) },
      critics: { 1: [[issue('m3', 'layout')], [issue('m3', 'layout')], []] },
      pairwise: { 1: ['B', 'A'] },
    });
    await feCritique(run.api, { ...CRITIQUE_INPUT, mode: 'small' });
    const fix = run.calls.find((c) => c.opts.agentType === 'execution-implementer');
    assert.ok(fix, 'a fix round ran');
    assert.match(String(fix?.prompt), /Commit your changes under your own commit rules\./);
    for (const c of run.calls) {
      assert.doesNotMatch(c.prompt, /conventional message|git commit -[mF]|fix\(ui\)|attribution trailer|Co-Authored-By/i, 'no commit message is dictated');
    }
    for (const file of ['critique.js', 'directions.js']) {
      const source = readFileSync(path.join(FRAGMENTS, file), 'utf8');
      assert.doesNotMatch(source, /conventional message|git commit -[mF]|fix\(ui\):/i, `${file} dictates no commit message`);
    }
  });

  test('blind probes that do not restate the proposition fail the receipt and reach the critics', async () => {
    const run = critiqueScenario({
      measures: { '0:baseline': measure(0, 'baseline') },
      critics: { 1: [[], [], []] },
      probeRestates: (viewport, probe) => viewport === 'mobile' || ['p1', 'p2', 'p3'].includes(probe),
    });
    const receipt = plain(await feCritique(run.api, CRITIQUE_INPUT));
    assertValid('urn:frontend:schema:critique-receipt:1', receipt);
    assert.equal(receipt.probes.pass, false);
    assert.deepEqual(receipt.probes.viewports.map((/** @type {any} */ v) => [v.viewport, v.matched, v.total]), [['desktop', 3, 5], ['mobile', 5, 5]]);
    assert.equal(receipt.ok, false);
    assert.equal(receipt.error, null);
    const critic = run.calls.find((c) => /^kind: critique$/m.test(c.prompt));
    assert.match(String(critic?.prompt), /Blind readers of the first view did not restate the proposition/);
  });

  test('rejections count only while consecutive: an accepted candidate resets the count', async () => {
    const run = critiqueScenario({
      measures: {
        '0:baseline': measure(0, 'baseline'),
        '1:candidate': measure(1, 'candidate', { sha: 'bbbb111' }),
        '2:candidate': measure(2, 'candidate', { sha: 'cccc222', scores: { layout: 12, typography: 8 } }),
        '3:candidate': measure(3, 'candidate', { sha: 'dddd333' }),
      },
      critics: {
        1: [[issue('m3', 'layout')], [issue('m3', 'layout')], []],
        2: [[issue('m4', 'layout')], [issue('m4', 'layout')], []],
        3: [[issue('m5', 'copy')], [issue('m5', 'copy')], []],
        4: [[], [], []],
      },
      pairwise: { 1: ['A', 'B'], 2: ['B', 'A'], 3: ['A', 'B'] },
      fixes: {
        2: { sha: 'cccc222', files: ['app/b.css'], summary: 'second', unresolved: [] },
        3: { sha: 'dddd333', files: ['app/c.css'], summary: 'third', unresolved: [] },
      },
    });
    const receipt = plain(await feCritique(run.api, { ...CRITIQUE_INPUT, critique: { rounds_max: 4, critics: 3, probes: 5 } }));
    assert.deepEqual(receipt.rounds.map((/** @type {any} */ r) => r.verdict), ['rejected', 'accepted', 'rejected', 'no-issue']);
    assert.equal(receipt.stop_reason, 'no-issue-kept');
    assert.equal(receipt.best.sha, 'cccc222');
    assert.deepEqual(run.restores, ['git revert --no-edit aaaa000..HEAD', 'git revert --no-edit cccc222..HEAD']);
  });

  test('an issue gets a first fix and at most max_attempts_per_issue - 1 retries', async () => {
    const run = critiqueScenario({
      measures: {
        '0:baseline': measure(0, 'baseline'),
        '1:candidate': measure(1, 'candidate', { sha: 'bbbb111' }),
        '2:candidate': measure(2, 'candidate', { sha: 'eeee222' }),
      },
      critics: {
        1: [[issue('m3', 'layout')], [issue('m3', 'layout')], []],
        2: [[issue('m3', 'layout')], [issue('m3', 'layout')], []],
        3: [[issue('m3', 'layout')], [issue('m3', 'layout')], []],
      },
      pairwise: { 1: ['A', 'B'], 2: ['A', 'B'] },
      fixes: { 2: { sha: 'eeee222', files: ['app/a.css'], summary: 'second try', unresolved: [] } },
    });
    const receipt = plain(await feCritique(run.api, { ...CRITIQUE_INPUT, max_rejected: 3, max_attempts_per_issue: 2 }));
    assert.equal(receipt.rounds_run, 3);
    assert.equal(receipt.stop_reason, 'no-issue-kept');
    assert.equal(receipt.rounds[2].dropped, 1);
    assert.equal(run.calls.filter((c) => c.opts.agentType === 'execution-implementer').length, 2);
  });

  test('at most five issues are kept, deterministic confirmations first', async () => {
    const seven = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'].map((m) => issue(m, 'layout'));
    const run = critiqueScenario({
      measures: {
        '0:baseline': measure(0, 'baseline', { deterministic: [{ mark: 'm7', check: 'B4.gap', problem: 'gap CV 0.4' }] }),
        '1:candidate': measure(1, 'candidate', { sha: 'bbbb111' }),
      },
      critics: { 1: [seven.slice(0, 5), seven.slice(2, 7), seven.slice(0, 5)] },
      pairwise: { 1: ['B', 'A'] },
    });
    const receipt = plain(await feCritique(run.api, { ...CRITIQUE_INPUT, critique: { rounds_max: 1, critics: 3, probes: 5 } }));
    const kept = receipt.rounds[0].issues.map((/** @type {any} */ i) => i.mark);
    assert.equal(kept.length, 5);
    assert.equal(kept[0], 'm7', 'the confirmed issue comes first');
    assert.deepEqual(kept.slice(1), ['m3', 'm4', 'm5', 'm1']);
    assert.equal(receipt.rounds[0].dropped, 2);
  });

  test('a failed baseline measure, a missing input or a thrown agent end with an error receipt, never ok', async () => {
    const failed = critiqueScenario({ measures: { '0:baseline': { exit_code: 3, json: null, stderr_tail: 'error: Chromium missing' } }, critics: {} });
    const r1 = plain(await feCritique(failed.api, CRITIQUE_INPUT));
    assertValid('urn:frontend:schema:critique-receipt:1', r1);
    assert.equal(r1.ok, false);
    assert.equal(r1.stop_reason, 'error');
    assert.match(r1.error, /measure of round 0 \(baseline\) failed: exit 3 error: Chromium missing/);
    assert.ok(failed.receiptText(), 'the error receipt is written too');

    const missing = critiqueScenario({ measures: {}, critics: {} });
    const r2 = plain(await feCritique(missing.api, { ...CRITIQUE_INPUT, cwd: '' }));
    assert.equal(r2.error, 'input is missing cwd');
    assert.equal(missing.calls.filter((c) => /measure/.test(c.prompt)).length, 0);

    const thrown = critiqueScenario({ measures: { '0:baseline': measure(0, 'baseline') }, critics: {}, throwOn: /^kind: critique$/m });
    const r3 = plain(await feCritique(thrown.api, CRITIQUE_INPUT));
    assert.equal(r3.ok, true, 'parallel() turns a thrown critic into null, so the round simply keeps no issue');
    const thrownAll = critiqueScenario({ measures: { '0:baseline': measure(0, 'baseline') }, critics: {}, throwOn: /^image: /m });
    const r4 = plain(await feCritique(thrownAll.api, CRITIQUE_INPUT));
    assert.equal(r4.probes.pass, false, 'probes that die count as not restating');
  });

  test('an uncommitted fix or a failed restore stops the run with an error', async () => {
    const uncommitted = critiqueScenario({
      measures: { '0:baseline': measure(0, 'baseline'), '1:candidate': measure(1, 'candidate', { sha: 'aaaa000' }) },
      critics: { 1: [[issue('m3', 'layout')], [issue('m3', 'layout')], []] },
      fixes: { 1: { sha: 'aaaa000', files: ['app/a.css'], summary: 'forgot to commit', unresolved: [] } },
    });
    const r1 = plain(await feCritique(uncommitted.api, CRITIQUE_INPUT));
    assert.equal(r1.ok, false);
    assert.match(r1.error, /changed files but made no commit/);
    assert.equal(uncommitted.restores.length, 0, 'uncommitted work is never discarded');

    const stuck = critiqueScenario({
      measures: { '0:baseline': measure(0, 'baseline'), '1:candidate': measure(1, 'candidate', { sha: 'bbbb111' }) },
      critics: { 1: [[issue('m3', 'layout')], [issue('m3', 'layout')], []] },
      pairwise: { 1: ['A', 'B'] },
      restoreExit: 1,
    });
    const r2 = plain(await feCritique(stuck.api, CRITIQUE_INPUT));
    assert.equal(r2.ok, false);
    assert.match(r2.error, /restoring the best-so-far aaaa000 failed/);
    assert.deepEqual(r2.rounds[0].restored, { to: 'aaaa000', ok: false });
  });

  test('the same answers give the same receipt (resume-safe, no hidden state)', async () => {
    const scenario = () => critiqueScenario({
      measures: { '0:baseline': measure(0, 'baseline'), '1:candidate': measure(1, 'candidate', { sha: 'bbbb111', scores: { layout: 12, typography: 8 } }) },
      critics: { 1: [[issue('m3', 'layout')], [issue('m3', 'layout')], []], 2: [[], [], []] },
      pairwise: { 1: ['B', 'A'] },
    });
    const a = plain(await feCritique(scenario().api, CRITIQUE_INPUT));
    const b = plain(await feCritique(scenario().api, CRITIQUE_INPUT));
    assert.deepEqual(a, b);
  });
});

/**
 * A scripted directions run.
 * @param {{screens?: Record<string, boolean[]>, renderFails?: string[], genericFails?: boolean, boardOk?: boolean}} s
 */
function directionsScenario(s = {}) {
  const attempts = /** @type {Record<string, number>} */ ({});
  return mockApi((prompt, opts) => {
    if (opts.schema && opts.schema.properties && opts.schema.properties.exit_code) {
      const command = /^cd ".+?" && (.+)$/m.exec(prompt)?.[1] || '';
      const render = / render --direction ([A-C]) /.exec(command);
      if (render) {
        if ((s.renderFails || []).includes(render[1])) return { exit_code: 3, json: null, stderr_tail: 'error: Chromium missing' };
        return { exit_code: 0, json: { direction: render[1], hero_desktop: `D/${render[1]}/hero-desktop.png`, hero_mobile: `D/${render[1]}/hero-mobile.png` }, stderr_tail: '' };
      }
      const screen = / screen --direction ([A-C]) /.exec(command);
      if (screen) {
        const id = screen[1];
        attempts[id] = (attempts[id] || 0) + 1;
        const ok = ((s.screens || {})[id] || [true, true])[attempts[id] - 1] !== false;
        return ok
          ? { exit_code: 0, json: { direction: id, ok: true, findings: [] }, stderr_tail: '' }
          : { exit_code: 1, json: { direction: id, ok: false, findings: [{ check: 'tells.tier1', detail: 'SL-T01 on the hero' }], identical_to_generic: ['accent'] }, stderr_tail: '' };
      }
      if (/ board --state /.test(command)) return { exit_code: 0, json: { ok: s.boardOk !== false, path: 'D/board.png', directions: ['A', 'B', 'C'] }, stderr_tail: '' };
      return { exit_code: 2, json: null, stderr_tail: `unexpected command ${command}` };
    }
    if (prompt.includes('/brief.json and nothing else')) return { generic_brief: 'a landing page and dashboard for a liquid staking protocol' };
    if (prompt.startsWith('Draw a design token plan')) return s.genericFails ? null : { files: ['D/generic/tokens.json'] };
    const id = /^You draw direction ([A-C]) /.exec(prompt)?.[1] || '?';
    return { direction: id, name: `Direction ${id}`, files: [`D/${id}/tokens.json`], rationale: 'scripted', trade_off: 'scripted' };
  });
}

const DIRECTIONS_INPUT = Object.freeze({
  task: 'T007',
  cwd: 'C:/work/repo',
  skill: 'C:/Users/Utilisateur/.claude/skills/frontend',
  profile: 'C:/work/repo/.execution/profile.json',
  state: 'C:/work/repo/.execution/frontend',
  mode: 'full',
  references: 'on',
  agents: { designer: { agentType: 'execution-implementer', model: 'opus', effort: 'high' } },
});

describe('assets/wave-fragments/directions.js (feDirections)', () => {
  test('full mode draws three directions on three anchors, screens them against the generic plan and writes the board', async () => {
    const run = directionsScenario();
    const receipt = plain(await feDirections(run.api, DIRECTIONS_INPUT));
    assertValid('urn:frontend:schema:directions-receipt:1', receipt);
    assert.equal(receipt.ok, true);
    assert.deepEqual(receipt.directions.map((/** @type {any} */ d) => [d.id, d.anchor, d.attempts, d.screened]), [['A', 'customer-a', 1, true], ['B', 'domain', 1, true], ['C', 'customer-b', 1, true]]);
    assert.equal(receipt.generic.sentence, 'a landing page and dashboard for a liquid staking protocol');
    assert.deepEqual(receipt.board, { ok: true, path: 'D/board.png' });
    const generic = run.calls.find((c) => c.prompt.startsWith('Draw a design token plan'));
    assert.ok(generic && !generic.prompt.includes('brief.md') && !generic.prompt.includes('pattern-ledger'), 'the generic plan sees the generic sentence only');
    assert.match(String(generic?.prompt), /Write C:\/work\/repo\/\.execution\/frontend\/similar-prompt\/tokens\.json /);
    assert.equal(generic?.opts.agentType, undefined, 'the generic plan runs in a plain agent, not the implementer');
    assert.equal(receipt.generic.dir, 'C:/work/repo/.execution/frontend/similar-prompt', 'the generic plan stays out of directions/');
    const screen = run.calls.find((c) => / screen --direction A /.test(c.prompt));
    assert.match(String(screen?.prompt), /--generic "C:\/work\/repo\/\.execution\/frontend\/similar-prompt"/);
    const draw = run.calls.find((c) => c.prompt.startsWith('You draw direction A'));
    assert.match(String(draw?.prompt), /pattern-ledger\.md/);
    assert.doesNotMatch(String(draw?.prompt), /11-tells/);
    assert.equal(draw?.opts.agentType, 'execution-implementer');
  });

  test('a direction that fails screening is redrawn once with the findings', async () => {
    const run = directionsScenario({ screens: { B: [false, true] } });
    const receipt = plain(await feDirections(run.api, DIRECTIONS_INPUT));
    assert.equal(receipt.ok, true);
    assert.equal(receipt.directions[1].attempts, 2);
    const redraw = run.calls.filter((c) => c.prompt.startsWith('You draw direction B'))[1];
    assert.match(redraw.prompt, /failed screening[\s\S]*tells\.tier1: SL-T01 on the hero[\s\S]*identical to the generic plan: accent/);
  });

  test('a direction that fails twice, a failed render or a missing generic plan leaves the receipt not ok', async () => {
    const twice = plain(await feDirections(directionsScenario({ screens: { C: [false, false] } }).api, DIRECTIONS_INPUT));
    assertValid('urn:frontend:schema:directions-receipt:1', twice);
    assert.equal(twice.ok, false);
    assert.equal(twice.directions[2].screened, false);
    assert.equal(twice.directions[2].attempts, 2);
    const render = plain(await feDirections(directionsScenario({ renderFails: ['A'] }).api, DIRECTIONS_INPUT));
    assert.equal(render.ok, false);
    assert.equal(render.directions[0].rendered, false);
    assert.match(render.directions[0].findings[0], /render failed: exit 3/);
    const generic = plain(await feDirections(directionsScenario({ genericFails: true }).api, DIRECTIONS_INPUT));
    assert.equal(generic.ok, false);
    assert.equal(generic.generic.ok, false);
    assert.ok(generic.directions.every((/** @type {any} */ d) => !d.screened));
  });

  test('small mode draws two, references off anchors away from customers, a given generic brief skips its runner', async () => {
    const small = plain(await feDirections(directionsScenario().api, { ...DIRECTIONS_INPUT, mode: 'small' }));
    assert.deepEqual(small.directions.map((/** @type {any} */ d) => d.id), ['A', 'B']);
    const off = directionsScenario();
    const receipt = plain(await feDirections(off.api, { ...DIRECTIONS_INPUT, references: 'off', generic_brief: 'a dashboard for a staking queue' }));
    assert.deepEqual(receipt.directions.map((/** @type {any} */ d) => d.anchor), ['domain', 'utilitarian', 'category']);
    assert.equal(off.calls.filter((c) => c.prompt.includes('/brief.json and nothing else')).length, 0);
    assert.ok(!off.calls.some((c) => c.prompt.includes('pattern-ledger.md')), 'no pattern ledger without references');
  });

  test('a missing input ends with an error receipt and no agent call', async () => {
    const run = directionsScenario();
    const receipt = plain(await feDirections(run.api, { ...DIRECTIONS_INPUT, state: '' }));
    assertValid('urn:frontend:schema:directions-receipt:1', receipt);
    assert.equal(receipt.ok, false);
    assert.equal(receipt.error, 'input is missing state');
    assert.equal(run.calls.length, 0);
  });
});
