// @ts-check
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..', '..', '..');
const LIB = JSON.parse(readFileSync(path.join(SKILL, 'assets', 'task-templates', 'frontend.json'), 'utf8'));
const CONTRACTS = readFileSync(path.join(SKILL, 'scripts', 'CONTRACTS.md'), 'utf8');
const CHECK = 'node C:/Users/Utilisateur/.claude/skills/frontend/scripts/frontend-check.mjs --json';
const REFS = 'C:/Users/Utilisateur/.claude/skills/frontend/references/';

/** Reference files SKILL.md names; 11-tells.md is for the checker, the critics and reviewers only. */
const REFERENCE_NAMES = ['00-contract', '01-brief', '02-references', '03-directions', '04-brand', '05-tokens', '06-build', '07-states-web3', '08-motion', '09-recording', '10-gates', '12-critique', '13-stack', '14-copy', '15-ip-provenance'];

/** Placeholders a writes glob may use. */
const WRITE_PLACEHOLDERS = ['{ui_root}', '{group}', '{design}', '{state}', '{private_dir}', '{profile}'];

/**
 * @typedef {{id: string, title: string, kind: string, phase: string, pre_t0: boolean, runner: string, fragment: any,
 *   instances: string, params: any, depends: string[], covers: any, writes: string[], resources: string[], estimate: any,
 *   model: string | null, effort: string | null, proof: any, brief_refs: string[], small_mode: any, manual: any}} Template
 * @typedef {{key: string, template: string, group: string, depends: string[], external: string[], writes: string[],
 *   resources: string[], proof: string, input: any, covers: string[], estimate: any}} Task
 */

/** @type {Template[]} */
const TEMPLATES = LIB.templates;

/** Gate groups and ids from scripts/CONTRACTS.md section 4, so a renamed gate breaks this test. */
function contractGates() {
  const section = CONTRACTS.slice(CONTRACTS.indexOf('| group | gates (module) |'), CONTRACTS.indexOf('`--phase build`'));
  const groups = new Set();
  const ids = new Set();
  for (const line of section.split('\n')) {
    const m = /^\| ([a-z0-9]+) \| (.+) \|$/.exec(line.trim());
    if (!m) continue;
    groups.add(m[1]);
    for (const g of m[2].matchAll(/`([a-z0-9]+\.[a-z0-9.*-]+)`/g)) ids.add(g[1]);
  }
  return { groups, ids };
}

/**
 * @param {string} gate
 * @param {{groups: Set<string>, ids: Set<string>}} known
 * @returns {boolean}
 */
function isKnownGate(gate, known) {
  if (known.groups.has(gate) || known.ids.has(gate)) return true;
  return /^recording\.g\d{2}$/.test(gate) && known.ids.has('recording.*');
}

/**
 * @param {string} text
 * @param {Record<string, string>} values
 * @returns {string}
 */
function substitute(text, values) {
  return text.replace(/\{([a-z_]+)\}/g, (all, name) => (name in values ? values[name] : all));
}

/**
 * @param {string} text
 * @param {{replace: Array<{from: string, to: string}>}} stack
 * @returns {string}
 */
function applyStack(text, stack) {
  let out = text;
  for (const r of stack.replace) out = out.split(r.from).join(r.to);
  return out;
}

/**
 * @param {any} value
 * @param {(s: string) => string} fn
 * @returns {any}
 */
function mapStrings(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]));
  return value;
}

/**
 * Reference instantiation, following the file's rules, the way exec.py plan instantiate is specified to.
 * @param {{mode: 'full' | 'small', references: 'on' | 'off', stack: string, nameConfirmed: boolean,
 *   groups: Array<{id: string, features: string[]}>}} plan
 * @param {any} [lib] the template library (a modified copy in the negative controls)
 * @returns {Task[]}
 */
function instantiate({ mode, references, stack, nameConfirmed, groups }, lib = LIB) {
  const stackDef = lib.stacks[stack];
  /** @type {Task[]} */
  const tasks = [];
  /** @type {Map<string, string[]>} */
  const keysOf = new Map();
  for (const t of /** @type {Template[]} */ (lib.templates)) {
    if (mode === 'small' && !t.small_mode.include) continue;
    const refOv = (t.params.references || {})[references] || {};
    const modeOv = (t.params.mode || {})[mode] || {};
    if (refOv.include === false || modeOv.include === false) continue;
    const instances = modeOv.instances || refOv.instances || t.instances;
    const writes = modeOv.writes || refOv.writes || t.writes;
    const deps = [...t.depends, ...(refOv.depends || []), ...(modeOv.depends || [])];
    const units = instances === 'per-group'
      ? groups.map((g) => ({ group: g.id, features: g.features }))
      : [{ group: 'all', features: groups.flatMap((g) => g.features) }];
    const keys = [];
    for (const u of units) {
      const key = instances === 'per-group' ? `${t.id}:${u.group}` : t.id;
      keys.push(key);
      const values = {
        ui_root: 'app', group: u.group, features: u.features.join(','), design: 'design',
        state: 'C:/work/repo/.execution/frontend', private_dir: 'C:/work/private', profile: 'C:/work/repo/.execution/profile.json',
        preview: '4173', task_id: `T-${key}`, workdir: 'C:/work/repo', mode, references,
        implementer_agent: 'execution-implementer', build_prefix: 'pnpm -C apps/web build && ',
        serve_target: '--start "pnpm -C apps/web start" --url http://127.0.0.1:4173',
      };
      const resolve = (/** @type {string} */ s) => substitute(applyStack(s, stackDef), values);
      const proof = resolve(t.proof.spec);
      const resources = t.resources.map(resolve);
      if (/--serve |--start /.test(proof)) for (const r of stackDef.add_resources) if (!resources.includes(resolve(r))) resources.push(resolve(r));
      tasks.push({
        key,
        template: t.id,
        group: u.group,
        depends: deps.filter((d) => d.startsWith('FE-')),
        external: deps.filter((d) => !d.startsWith('FE-') && !(d === 'decision:project-name' && nameConfirmed)),
        writes: writes.map(resolve),
        resources,
        proof,
        input: t.fragment ? mapStrings(t.fragment.input, resolve) : null,
        covers: t.covers.rule === 'feature-group' ? [...u.features] : [],
        estimate: t.estimate[mode],
      });
    }
    keysOf.set(t.id, keys);
  }
  for (const task of tasks) {
    task.depends = task.depends.flatMap((d) => {
      const keys = keysOf.get(d);
      if (!keys) throw new Error(`${task.key} depends on ${d}, which is not instantiated for ${mode}/${references}`);
      return keys;
    });
  }
  if (stackDef.sections === 'serial') {
    const sections = tasks.filter((t) => t.template === 'FE-1x');
    sections.forEach((s, i) => {
      const before = i === 0 ? keysOf.get('FE-09') || [] : [sections[i - 1].key];
      for (const k of before) if (!s.depends.includes(k)) s.depends.push(k);
    });
  }
  return tasks;
}

/**
 * Transitive closure: for each task key, every key it depends on, directly or not. Throws on a cycle.
 * @param {Task[]} tasks
 * @returns {Map<string, Set<string>>}
 */
function ancestors(tasks) {
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  /** @type {Map<string, Set<string>>} */
  const memo = new Map();
  /** @type {Set<string>} */
  const visiting = new Set();
  /** @param {string} key @returns {Set<string>} */
  const walk = (key) => {
    const known = memo.get(key);
    if (known) return known;
    if (visiting.has(key)) throw new Error(`dependency cycle through ${key}`);
    visiting.add(key);
    const out = new Set();
    const task = byKey.get(key);
    if (!task) throw new Error(`unknown task ${key}`);
    for (const d of task.depends) {
      out.add(d);
      for (const a of walk(d)) out.add(a);
    }
    visiting.delete(key);
    memo.set(key, out);
    return out;
  };
  for (const t of tasks) walk(t.key);
  return memo;
}

/**
 * Pairs of tasks that may run at the same time (no dependency path between them) yet write overlapping globs or hold
 * the same unary resource: what /execution's validator refuses.
 * @param {Task[]} tasks
 * @returns {string[]}
 */
function conflicts(tasks) {
  const closure = ancestors(tasks);
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < tasks.length; i += 1) {
    for (let j = i + 1; j < tasks.length; j += 1) {
      const a = tasks[i];
      const b = tasks[j];
      if (closure.get(a.key)?.has(b.key) || closure.get(b.key)?.has(a.key)) continue;
      for (const wa of a.writes) {
        for (const wb of b.writes) if (globsOverlap(wa, wb)) out.push(`${a.key} and ${b.key} both write ${wa} / ${wb}`);
      }
      for (const r of a.resources) if (b.resources.includes(r)) out.push(`${a.key} and ${b.key} both hold ${r}`);
    }
  }
  return out;
}

/**
 * Conservative glob overlap: compares segments until a ** or the end; a segment with * or ? overlaps a literal it
 * matches and any other wildcard segment.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function globsOverlap(a, b) {
  const split = (/** @type {string} */ g) => g.replace(/\\/g, '/').replace(/^\.\//, '').split('/').filter((s) => s !== '' && s !== '.');
  const sa = split(a);
  const sb = split(b);
  const wild = (/** @type {string} */ s) => /[*?]/.test(s);
  const segRe = (/** @type {string} */ s) => new RegExp(`^${s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`, 'i');
  for (let i = 0; ; i += 1) {
    const x = sa[i];
    const y = sb[i];
    if (x === '**' || y === '**') return true;
    if (x === undefined || y === undefined) return x === undefined && y === undefined;
    if (wild(x) && wild(y)) continue;
    if (wild(x) ? !segRe(x).test(y) : wild(y) ? !segRe(y).test(x) : x.toLowerCase() !== y.toLowerCase()) return false;
  }
}

const GROUPS = [
  { id: 'G1', features: ['FR-001', 'FR-002'] },
  { id: 'G2', features: ['FR-003', 'FR-004'] },
  { id: 'G3', features: ['FR-005'] },
];
/** @type {Array<{mode: 'full' | 'small', references: 'on' | 'off', stack: string, nameConfirmed: boolean, groups: typeof GROUPS}>} */
const PLANS = [];
for (const mode of /** @type {const} */ (['full', 'small'])) {
  for (const references of /** @type {const} */ (['on', 'off'])) {
    for (const stack of Object.keys(LIB.stacks)) {
      for (const nameConfirmed of [true, false]) PLANS.push({ mode, references, stack, nameConfirmed, groups: GROUPS });
    }
  }
}

describe('assets/task-templates/frontend.json', () => {
  test('ids are unique, in order FE-00..FE-21 with FE-1x between FE-09 and FE-20, and depend only on earlier templates', () => {
    const ids = TEMPLATES.map((t) => t.id);
    assert.deepEqual(ids, ['FE-00', 'FE-01', 'FE-02', 'FE-03', 'FE-04', 'FE-05', 'FE-06', 'FE-07', 'FE-08', 'FE-09', 'FE-1x', 'FE-20', 'FE-21']);
    TEMPLATES.forEach((t, i) => {
      const earlier = ids.slice(0, i);
      const all = [...t.depends, ...Object.values(t.params).flatMap((p) => Object.values(p).flatMap((o) => o.depends || []))];
      for (const d of all) {
        if (d.startsWith('FE-')) assert.ok(earlier.includes(d), `${t.id} depends on ${d}, which is not earlier`);
        else assert.ok(Object.hasOwn(LIB.symbolic_depends, d), `${t.id}: unknown symbolic dependency ${d}`);
      }
    });
  });

  test('the dependency rules of ARCHITECTURE.md 12 and /execution 3.2 hold', () => {
    const byId = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));
    assert.deepEqual(byId['FE-03'].params.references, { on: { depends: ['FE-02'] }, off: { depends: ['FE-00'] } });
    assert.ok(byId['FE-07'].depends.includes('FE-06'), 'FE-07 always after FE-06');
    assert.ok(byId['FE-05'].depends.includes('decision:project-name'), 'the logo waits for the project name');
    assert.equal(byId['FE-21'].phase, 'deliverable');
    assert.deepEqual(byId['FE-21'].depends, ['FE-20', 'manual:harden-review']);
    assert.equal(byId['FE-01'].params.references.off.include, false);
    assert.equal(byId['FE-02'].params.references.off.include, false);
    assert.equal(byId['FE-1x'].instances, 'per-group');
    assert.equal(byId['FE-1x'].covers.rule, 'feature-group');
    assert.equal(byId['FE-1x'].covers.depends_on_covering_tasks, true);
    for (const t of TEMPLATES) {
      for (const d of t.depends) assert.ok(!/\bor\b|\bif\b/.test(d), `${t.id}: dependency ${d} reads as conditional`);
    }
  });

  test('owner checkpoints are decision or manual tasks with steps, an answer to bring back and where', () => {
    const owner = TEMPLATES.filter((t) => t.kind === 'manual' || t.kind === 'decision');
    assert.deepEqual(owner.map((t) => t.id), ['FE-01', 'FE-04', 'FE-06', 'FE-21']);
    for (const t of owner) {
      assert.equal(t.runner, 'owner');
      assert.ok(t.manual.steps.length >= 3, `${t.id}: steps`);
      assert.ok(t.manual.bring_back.length > 20, `${t.id}: bring_back`);
      assert.ok(['phone', 'laptop'].includes(t.manual.where), `${t.id}: where`);
      assert.equal(t.proof.type, 'file');
      assert.equal(t.small_mode.include, true);
    }
    for (const id of ['FE-04', 'FE-06']) {
      const t = owner.find((o) => o.id === id);
      assert.equal(t?.kind, 'decision');
      assert.ok(typeof t?.manual.options_source === 'string' && t.manual.options_source.startsWith('{state}/'), `${id}: options_source`);
      assert.ok(t?.manual.steps.some((/** @type {string} */ s) => /canvas are not answers/.test(s)), `${id}: answers through Notion or Remote Control only`);
    }
    assert.equal(owner.find((o) => o.id === 'FE-21')?.manual.where, 'laptop');
  });

  test('command proofs run frontend-check with --json and the profile, and UI proofs chain the build first', () => {
    const known = contractGates();
    assert.ok(known.groups.size >= 12 && known.ids.size >= 40, 'gate table parsed from CONTRACTS.md');
    for (const t of TEMPLATES.filter((x) => x.proof.type === 'command')) {
      const spec = t.proof.spec;
      assert.ok(spec.includes(CHECK), `${t.id}: runs ${CHECK}`);
      assert.ok(spec.includes('--profile "{profile}"'), `${t.id}: --profile "{profile}"`);
      assert.ok(spec.includes('--state "{state}"'), `${t.id}: --state "{state}"`);
      assert.equal(t.proof.expect, 'exit 0');
      assert.ok(t.proof.max_runtime_min <= 10, `${t.id}: proof runtime`);
      if (spec.includes('--serve')) {
        assert.ok(spec.includes('pnpm -C "{ui_root}" build && '), `${t.id}: chains the build`);
        assert.ok(spec.endsWith('--serve "{ui_root}/dist"'), `${t.id}: serves the build last`);
        assert.ok(spec.indexOf('build && ') < spec.indexOf(CHECK), `${t.id}: build before the check`);
      }
      const gates = /--gates ([^ ]+)/.exec(spec);
      const phase = /--phase ([^ ]+)/.exec(spec);
      assert.ok(gates || phase, `${t.id}: names its gates or phase`);
      if (gates) for (const g of gates[1].split(',')) assert.ok(isKnownGate(g, known), `${t.id}: unknown gate ${g}`);
      if (phase) assert.equal(phase[1], '{mode}', `${t.id}: the phase follows the mode (--phase {mode})`);
    }
    const sections = TEMPLATES.find((t) => t.id === 'FE-1x');
    assert.ok(sections?.proof.spec.includes('--features {features}'), 'FE-1x restricts coverage to its features');
  });

  test('the gates of each template cover ARCHITECTURE.md 12.1 and the references', () => {
    /** @type {Record<string, string[]>} */
    const expected = {
      'FE-00': ['brief'],
      'FE-02': ['refs'],
      'FE-03': ['directions'],
      'FE-05': ['brand.candidates'],
      'FE-07': ['tokens', 'ip.fonts', 'ip.hotlinks'],
      'FE-08': ['render', 'firstview', 'coverage.hero'],
      'FE-09': ['brand', 'ip.fonts', 'ip.provenance', 'ip.sponsor-marks'],
      'FE-1x': ['coverage', 'render', 'tells'],
    };
    for (const [id, gates] of Object.entries(expected)) {
      const t = TEMPLATES.find((x) => x.id === id);
      const listed = (/--gates ([^ ]+)/.exec(String(t?.proof.spec))?.[1] || '').split(',');
      assert.deepEqual(listed, gates, `${id}: --gates ${gates.join(',')}`);
    }
    for (const t of TEMPLATES) {
      const listed = (/--gates ([^ ]+)/.exec(String(t.proof.spec))?.[1] || '').split(',').filter(Boolean);
      const named = /([a-z0-9]+\.[a-z0-9-]+) must fail/.exec(String(t.proof.negative_control))?.[1];
      if (listed.length === 0 || !named) continue;
      const selected = listed.some((g) => g === named || named.startsWith(`${g}.`));
      assert.ok(selected, `${t.id}: its negative control names ${named}, which --gates ${listed.join(',')} does not run`);
    }
    assert.ok(TEMPLATES.find((x) => x.id === 'FE-20')?.proof.spec.includes('--phase {mode}'), 'FE-20 ends with --phase {mode}: build in full mode, small in small mode');
    assert.ok(TEMPLATES.find((x) => x.id === 'FE-20')?.proof.spec.includes('--verify-receipt "{state}/critique/receipt.json"'), 'FE-20 checks its receipt');
  });

  test('--phase {mode} instantiates to a phase frontend-check runs: the build set in full mode, the small set in small mode', async () => {
    const { PHASES, SMALL_GROUPS, normaliseFlags, phaseGroups } = await import('../../frontend-check.mjs');
    const { defaultProfile } = await import('../../lib/profile.mjs');
    const spec = String(TEMPLATES.find((x) => x.id === 'FE-20')?.proof.spec);
    for (const mode of ['full', 'small']) {
      const phase = /--phase ([^ ]+)/.exec(spec.replaceAll('{mode}', mode))?.[1] ?? '';
      assert.ok(PHASES.includes(phase), `${mode}: --phase ${phase} is accepted`);
      const groups = phaseGroups(normaliseFlags({ phase }).phase, defaultProfile());
      if (mode === 'small') assert.deepEqual(groups, [...SMALL_GROUPS]);
      else assert.ok(groups.includes('brand') && groups.includes('tokens') && groups.includes('motion'), 'full mode gates brand, tokens and motion');
    }
  });

  test('every template carries the agreed fields, with estimates p10 <= p50 <= p90 and single agents within 60 min', () => {
    for (const t of TEMPLATES) {
      for (const which of ['full', 'small', 'verify']) {
        const r = t.estimate[which];
        assert.ok(r.p10 <= r.p50 && r.p50 <= r.p90, `${t.id}: estimate.${which} is ordered`);
      }
      assert.ok(t.estimate.basis.length > 20, `${t.id}: estimate basis`);
      if (t.runner === 'agent') {
        assert.ok(t.estimate.full.p90 <= 60 && t.estimate.small.p90 <= 60, `${t.id}: p90 within /execution's 60 min sizing rule`);
      }
      if (t.kind === 'manual' || t.kind === 'decision') {
        assert.equal(t.model, null);
        assert.equal(t.effort, null);
      } else {
        assert.equal(t.model, 'opus');
        assert.ok(['medium', 'high'].includes(String(t.effort)), `${t.id}: effort`);
      }
      assert.ok(t.small_mode.note.length > 5, `${t.id}: small_mode note`);
      assert.ok(t.covers.description.length > 5, `${t.id}: covers description`);
    }
  });

  test('pre-T0 tasks are the research ones only, and no task before kickoff makes a visual', () => {
    assert.deepEqual(TEMPLATES.filter((t) => t.pre_t0).map((t) => t.id), ['FE-00', 'FE-01', 'FE-02']);
  });

  test('brief_refs are absolute reference paths, never the tells catalogue', () => {
    const refsDir = path.join(SKILL, 'references');
    for (const t of TEMPLATES) {
      assert.ok(t.brief_refs.length > 0, `${t.id}: brief_refs`);
      for (const ref of t.brief_refs) {
        assert.ok(ref.startsWith(REFS), `${t.id}: ${ref} is under references/`);
        const name = path.basename(ref, '.md');
        assert.notEqual(name, '11-tells', `${t.id}: implementers never get the tells catalogue`);
        assert.ok(REFERENCE_NAMES.includes(name), `${t.id}: ${name} is not a reference SKILL.md names`);
        if (existsSync(refsDir) && existsSync(path.join(refsDir, '00-contract.md'))) {
          assert.ok(existsSync(path.join(refsDir, `${name}.md`)), `${t.id}: references/${name}.md does not exist`);
        }
      }
      if (t.runner !== 'owner') assert.ok(t.brief_refs.some((r) => r.endsWith('00-contract.md')), `${t.id}: reads the contract`);
    }
  });

  test('writes use only the agreed placeholders and every placeholder used is declared', () => {
    const declared = Object.keys(LIB.placeholders);
    const strings = JSON.stringify(TEMPLATES) + JSON.stringify(LIB.stacks);
    for (const m of strings.matchAll(/\{([a-z_]+)\}/g)) assert.ok(declared.includes(`{${m[1]}}`), `undeclared placeholder {${m[1]}}`);
    for (const t of TEMPLATES) {
      const allWrites = [t.writes, ...Object.values(t.params).flatMap((p) => Object.values(p).map((o) => o.writes || []))].flat();
      for (const w of allWrites) {
        for (const m of w.matchAll(/\{[a-z_]+\}/g)) assert.ok(WRITE_PLACEHOLDERS.includes(m[0]), `${t.id}: ${m[0]} in writes`);
      }
    }
  });

  test('fragment templates point at their wave fragment', () => {
    for (const t of TEMPLATES.filter((x) => x.runner === 'fragment')) {
      const file = t.fragment.file;
      assert.ok(existsSync(file), `${t.id}: ${file} exists`);
      assert.ok(readFileSync(file, 'utf8').includes(`async function ${t.fragment.function}(api, input)`), `${t.id}: defines ${t.fragment.function}`);
      assert.equal(t.fragment.input.state, '{state}');
      assert.equal(t.fragment.input.profile, '{profile}');
    }
    assert.deepEqual(TEMPLATES.filter((x) => x.runner === 'fragment').map((x) => x.id), ['FE-03', 'FE-20']);
  });

  test('every stack replacement applies to some proof', () => {
    const specs = TEMPLATES.map((t) => t.proof.spec).join('\n');
    for (const [name, stack] of Object.entries(LIB.stacks)) {
      for (const r of stack.replace) assert.ok(specs.includes(r.from), `${name}: replacement ${r.from} matches no proof`);
    }
  });

  for (const plan of PLANS) {
    const label = `${plan.mode} mode, references ${plan.references}, ${plan.stack}, name ${plan.nameConfirmed ? 'confirmed' : 'pending'}`;
    test(`instantiates cleanly: ${label}`, () => {
      const tasks = instantiate(plan);
      const keys = tasks.map((t) => t.key);
      const closure = ancestors(tasks);
      for (const t of tasks) {
        for (const s of [t.proof, ...t.writes, ...t.resources, JSON.stringify(t.input)]) {
          assert.ok(!/\{[a-z_]+\}/.test(s), `${t.key}: unresolved placeholder in ${s}`);
        }
      }
      const has = (/** @type {string} */ k) => keys.includes(k);
      assert.equal(has('FE-01'), plan.references === 'on');
      assert.equal(has('FE-02'), plan.references === 'on');
      const fe03 = tasks.find((t) => t.key === 'FE-03');
      assert.deepEqual(fe03?.depends, [plan.references === 'on' ? 'FE-02' : 'FE-00']);
      const fe05 = tasks.find((t) => t.key === 'FE-05');
      assert.equal(fe05?.external.includes('decision:project-name'), !plan.nameConfirmed);
      const sections = tasks.filter((t) => t.template === 'FE-1x');
      if (plan.mode === 'full') {
        assert.deepEqual(sections.map((s) => s.group), ['G1', 'G2', 'G3']);
        assert.deepEqual(sections[0].covers, ['FR-001', 'FR-002']);
        assert.ok(sections[1].proof.includes('--features FR-003,FR-004 '), 'per-group --features');
      } else {
        assert.equal(sections.length, 1);
        assert.equal(sections[0].group, 'all');
        assert.ok(sections[0].depends.includes('FE-09'), 'small mode builds the page after the brand files');
      }
      const fe20 = tasks.find((t) => t.key === 'FE-20');
      for (const s of sections) assert.ok(closure.get('FE-20')?.has(s.key), `FE-20 comes after ${s.key}`);
      assert.ok(closure.get('FE-21')?.has('FE-20'));
      assert.ok(closure.get('FE-07')?.has('FE-06'));
      assert.equal(fe20?.input.critique.$from, 'frontend.critique');
      if (plan.stack === 'static-html') assert.ok(tasks.every((t) => !t.proof.includes('pnpm')), 'static-html builds nothing');
      if (plan.stack === 'next') assert.ok(sections.every((s) => s.proof.includes('--start ') && s.resources.includes('port:4173')));
      assert.deepEqual(conflicts(tasks), []);
    });
  }

  test('negative controls: a write overlap, a shared resource and a cycle are caught', () => {
    const plan = { mode: /** @type {const} */ ('full'), references: /** @type {const} */ ('on'), stack: 'vite-react', nameConfirmed: true, groups: GROUPS };
    const overlap = JSON.parse(JSON.stringify(LIB));
    overlap.templates.find((/** @type {Template} */ t) => t.id === 'FE-09').writes.push('{ui_root}/src/**');
    assert.ok(conflicts(instantiate(plan, overlap)).some((c) => c.includes('FE-09') && c.includes('FE-1x:G1')));
    const shared = JSON.parse(JSON.stringify(LIB));
    shared.templates.find((/** @type {Template} */ t) => t.id === 'FE-1x').resources = ['browser'];
    assert.ok(conflicts(instantiate(plan, shared)).some((c) => c.includes('both hold browser')));
    const cyclic = JSON.parse(JSON.stringify(LIB));
    cyclic.templates.find((/** @type {Template} */ t) => t.id === 'FE-00').depends = ['FE-21'];
    assert.throws(() => ancestors(instantiate(plan, cyclic)), /cycle/);
    const dropped = JSON.parse(JSON.stringify(LIB));
    dropped.templates.find((/** @type {Template} */ t) => t.id === 'FE-03').params = {};
    dropped.templates.find((/** @type {Template} */ t) => t.id === 'FE-03').depends = ['FE-02'];
    assert.throws(() => instantiate({ ...plan, references: 'off' }, dropped), /not instantiated/);
  });

  test('glob overlap helper', () => {
    assert.equal(globsOverlap('app/src/sections/G1/**', 'app/src/sections/G2/**'), false);
    assert.equal(globsOverlap('app/**', 'app/src/sections/G1/x.tsx'), true);
    assert.equal(globsOverlap('app/src/app/layout.*', 'app/src/app/layout.tsx'), true);
    assert.equal(globsOverlap('app/src/app/layout.*', 'app/src/sections/G1/**'), false);
    assert.equal(globsOverlap('design/provenance.json', 'design/provenance.json'), true);
    assert.equal(globsOverlap('design/tokens.json', 'design/routes.json'), false);
    assert.equal(globsOverlap('./brand/**', 'brand/mark.svg'), true);
  });
});
