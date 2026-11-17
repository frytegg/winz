// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  GATES, RECEIPT_PATH, briefCompleteGate, briefShapeProblems, checkBrief, cleanValue, compileBrief, emptyBrief,
  extractFeatureIds, extractLabelled, extractListsUnderHeading, isActive, isListed, loadCatalogue, loadClaimsLedger,
  loadNeverShow, parseClaimsLedger, parseSources, readBrief, renderBriefMarkdown, renderTemplate, run, sponsorNames,
} from '../../brief.mjs';
import { aggregate, gate } from '../../lib/report.mjs';
import { defaultProfile, loadProfile } from '../../lib/profile.mjs';
import { SchemaRegistry } from '../assets/json-schema.mjs';

/** @typedef {import('../../brief.mjs').Brief} Brief */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(HERE, '..', '..');
const FIX = path.resolve(HERE, '..', 'fixtures', 'brief');
const FULL = path.join(FIX, 'full');
const VARIANTS = path.join(FIX, 'variants');
const EMPTY = path.join(FIX, 'empty');
const SCHEMA = path.resolve(SCRIPTS, '..', 'assets', 'schemas', 'brief.schema.json');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-brief-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

/** @param {string} name @returns {string} a fresh state folder */
function stateFolder(name) {
  const dir = path.join(tmp, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** @param {unknown} brief @returns {string[]} schema errors against assets/schemas/brief.schema.json */
function schemaErrors(brief) {
  const reg = new SchemaRegistry();
  const id = reg.add(JSON.parse(readFileSync(SCHEMA, 'utf8')));
  return reg.validate(id, brief).map((e) => `${e.path}: ${e.message}`);
}

const fullProfile = () => loadProfile(path.join(FULL, 'profile.json'));

describe('extraction from Markdown', () => {
  test('extractLabelled reads plain, bold, listed and two-cell table labels, and skips headers, wide rows and code', () => {
    const text = [
      'H1: Plain headline',
      '**Hero sentence:** Bold label, colon inside.',
      '- **Gap**: Bold label, colon outside.',
      '| Field | Value |',
      '|---|---|',
      '| Who loses | Lenders |',
      '| Name | Segment | What |',
      '|---|---|---|',
      '| How much | three cells | ignored |',
      '```',
      'H1: inside a fence',
      '```',
      'H1:',
      'Did you know: not a label',
    ].join('\n');
    const all = extractLabelled(text, ['h1', 'hero sentence', 'gap', 'who loses', 'how much', 'field', 'did']);
    assert.deepEqual(all.map((h) => [h.label, h.value, h.line]), [
      ['h1', 'Plain headline', 1],
      ['hero sentence', 'Bold label, colon inside.', 2],
      ['gap', 'Bold label, colon outside.', 3],
      ['who loses', 'Lenders', 6],
    ]);
  });

  test('cleanValue unwraps whole-value bold, code and quotes only', () => {
    assert.equal(cleanValue('**"A sentence."**'), 'A sentence.');
    assert.equal(cleanValue('“Curly quoted”'), 'Curly quoted');
    assert.equal(cleanValue('keeps **inner** bold'), 'keeps **inner** bold');
  });

  test('extractFeatureIds finds titles in headings, tables and lists, with the group of the enclosing heading', () => {
    const text = [
      '# Spec',
      '## G2 Claims',
      '### FR-010 (P1): Claim a finalised withdrawal',
      'Covers FR-010, FR-011 and FR-012.',
      '| FR-011 | Request a withdrawal | P2 |',
      '- **FR-012** Check the proof behind every figure',
      '## Notes',
      'FR-013',
    ].join('\n');
    assert.deepEqual(extractFeatureIds(text), [
      { id: 'FR-010', title: 'Claim a finalised withdrawal', group: 'G2', line: 3 },
      { id: 'FR-011', title: 'Request a withdrawal', group: 'G2', line: 5 },
      { id: 'FR-012', title: 'Check the proof behind every figure', group: 'G2', line: 6 },
      { id: 'FR-013', title: '', group: '', line: 8 },
    ]);
  });

  test('extractListsUnderHeading keeps the top-level items of a matching section only', () => {
    const text = readFileSync(path.join(FULL, 'docs', '45-RUNSHEET.md'), 'utf8');
    const sections = extractListsUnderHeading(text, /judge(?:['’]s)?\s+path/i);
    assert.equal(sections.length, 1);
    assert.deepEqual(sections[0].items.map((i) => i.line), [5, 6, 8]);
    assert.equal(extractListsUnderHeading('## The judge’s path\n- one\n', /judge(?:['’]s)?\s+path/i)[0].items[0].text, 'one');
  });
});

describe('shared readers', () => {
  test('parseClaimsLedger reads both vocabularies; only verified and backed rows are verified', () => {
    const ledger = loadClaimsLedger(path.join(FULL, 'research', 'findings', 'claims-ledger.md'));
    assert.deepEqual(ledger.rows.map((r) => [r.id, r.status]), [
      ['C-001', 'verified'], ['C-002', 'unverified'], ['C-003', 'cut'], ['A4', 'verified'], ['A5', 'unverified'], ['A6', 'cut'],
    ]);
    assert.deepEqual(ledger.verifiedIds, ['C-001', 'A4']);
    const json = parseClaimsLedger(JSON.stringify({ claims: [{ id: 'C-1', status: 'backed' }, { id: 2, status: 'pending' }] }), 'claims.json');
    assert.deepEqual(json.rows.map((r) => [r.id, r.status]), [['C-1', 'verified'], ['2', 'unknown']]);
    const none = loadClaimsLedger(path.join(FULL, 'research', 'findings', 'rubric.md'));
    assert.equal(none.rows.length, 0);
    assert.match(none.problems.join(), /no claim rows found/);
    assert.equal(loadClaimsLedger(path.join(tmp, 'nope.md')).exists, false);
  });

  test('loadNeverShow validates entries and records their lines; invalid ones are reported, not kept', () => {
    const list = loadNeverShow(path.join(FULL, 'never-show.json'));
    assert.deepEqual(list.entries.map((e) => [e.id, e.scope, e.line]), [['NS-001', 'both', 5], ['NS-002', 'rendered', 16], ['NS-003', 'repo', 27]]);
    assert.deepEqual(list.problems, []);
    const file = path.join(tmp, 'bad-never-show.json');
    writeFileSync(file, JSON.stringify({
      version: 1,
      entries: [
        { id: 'OK-1', class: 'never-public', pattern: 'fine', scope: 'both', source: 'a.md:1' },
        { id: 'BAD-1', class: 'secret', pattern: 'x', scope: 'both', source: 'a.md' },
        { id: 'BAD-2', class: 'embargo', pattern: 'x', scope: 'rendered', source: 'a.md' },
        { id: 'BAD-3', class: 'never-public', pattern: '(', regex: true, scope: 'both', source: 'a.md' },
        { id: 'BAD-4', class: 'never-public', pattern: 'x', until_utc: '2026-10-11 12:00', scope: 'both', source: 'a.md' },
        { id: 'BAD-5', class: 'never-public', pattern: 'x', source: 'a.md' },
        { id: 'OK-1', class: 'never-public', pattern: 'dup', scope: 'both', source: 'a.md' },
      ],
    }));
    const bad = loadNeverShow(file);
    assert.deepEqual(bad.entries.map((e) => e.id), ['OK-1']);
    assert.equal(bad.problems.length, 6);
    assert.match(bad.problems.join('\n'), /BAD-1: class must be one of/);
    assert.match(bad.problems.join('\n'), /BAD-2: an embargo needs until_utc/);
    assert.match(bad.problems.join('\n'), /BAD-3: pattern does not compile/);
    assert.match(bad.problems.join('\n'), /BAD-4: until_utc must be null or an ISO 8601 UTC date ending in Z/);
    assert.match(bad.problems.join('\n'), /BAD-5: scope must be one of/);
    assert.match(bad.problems.join('\n'), /OK-1: id OK-1 is used twice/);
    writeFileSync(file, '{not json');
    assert.match(loadNeverShow(file).problems[0], /not valid JSON/);
    assert.equal(loadNeverShow(path.join(tmp, 'absent.json')).exists, false);
  });

  test('isActive honours until_utc against the clock', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    assert.equal(isActive({ until_utc: null }, now), true);
    assert.equal(isActive({ until_utc: '2026-10-11T12:00:00Z' }, now), true);
    assert.equal(isActive({ until_utc: '2026-09-30T23:59:59Z' }, now), false);
  });

  test('loadCatalogue keeps rows with an id and a title and reports the rest', () => {
    const file = path.join(tmp, 'catalogue.json');
    writeFileSync(file, JSON.stringify([
      { id: 'FR-001', group: 'G1', title: 'One', priority: 'P1', status_expected: 'live' },
      { id: 'FR-001', group: 'G1', title: 'Twice', priority: 'P1' },
      { id: 'FR-2', group: 'G1', title: 'Bad id', priority: 'P1' },
      { id: 'FR-003', group: 'x', title: 'Bad group', priority: 'P9', status_expected: 'beta' },
    ], null, 2));
    const c = loadCatalogue(file);
    assert.deepEqual(c.features.map((f) => [f.id, f.status_expected, f.line]), [['FR-001', 'live', 3], ['FR-003', null, 22]]);
    assert.equal(c.problems.length, 5);
  });

  test('parseSources splits paths, line ranges and anchors, and never reads a drive letter as a line', () => {
    assert.deepEqual(parseSources('C:/a/b.md:12; research/x.md:3-5; C:/p/profile.json#project.name; docs/y.md'), [
      { raw: 'C:/a/b.md:12', path: 'C:/a/b.md', line: 12, lineEnd: null },
      { raw: 'research/x.md:3-5', path: 'research/x.md', line: 3, lineEnd: 5 },
      { raw: 'C:/p/profile.json#project.name', path: 'C:/p/profile.json', line: null, lineEnd: null },
      { raw: 'docs/y.md', path: 'docs/y.md', line: null, lineEnd: null },
    ]);
    assert.deepEqual(parseSources('C:/no-line.md').map((s) => s.path), ['C:/no-line.md']);
  });

  test('sponsorNames prefers the brief, then the allowlist names of the profile ids', () => {
    const brief = emptyBrief();
    assert.deepEqual(sponsorNames({ brief, profile: { sponsors: ['cardano', 'unlisted-co'] } }).map((s) => s.name), ['Cardano', 'unlisted-co']);
    brief.sponsors.push({ id: 'ledger', name: 'Ledger', strategy: '', source: 'x' });
    assert.deepEqual(sponsorNames({ brief, profile: { sponsors: ['cardano'] } }).map((s) => [s.name, s.from]), [['Ledger', 'brief']]);
  });

  test('isListed accepts the field, a parent, and the list form', () => {
    const missing = [{ field: 'hero', action: /** @type {const} */ ('question'), why: 'w' }, { field: 'sponsors[].strategy', action: /** @type {const} */ ('question'), why: 'w' }];
    assert.equal(isListed(missing, 'hero.h1'), true);
    assert.equal(isListed(missing, 'sponsors[cardano].strategy'), true);
    assert.equal(isListed(missing, 'gap.text'), false);
  });
});

describe('brief.md', () => {
  test('renderTemplate fills paths, repeats each blocks, renders empties as missing and escapes pipes in tables', () => {
    const template = '<!--\ntemplate header\n-->\n# {{project.name}}\n| a | b |\n{{#each rows}}\n| {{this.a}} | {{this.b}} |\n{{/each}}\n{{#each beats}}\n1. {{this}}\n{{/each}}\nflag: {{flag}} list: {{ids}} none: {{nothing}}';
    const out = renderTemplate(template, { project: { name: 'X' }, rows: [{ a: 'p|q', b: true }], beats: [], flag: false, ids: ['C-1', 'C-2'] });
    assert.equal(out, '# X\n| a | b |\n| p\\|q | yes |\n1. missing\nflag: no list: C-1, C-2 none: missing');
  });

  test('renderBriefMarkdown uses the skill template and leaves no placeholder', () => {
    const md = renderBriefMarkdown(/** @type {Brief} */ (JSON.parse(readFileSync(path.join(FIX, 'briefs', 'pass.json'), 'utf8'))));
    assert.match(md, /^# Frontend brief: Queue Clock$/m);
    assert.doesNotMatch(md, /\{\{|\}\}|template: assets/);
    assert.match(md, /\| sponsors\[cardano\]\.strategy \| manual-task \|/);
  });
});

describe('compileBrief', () => {
  test('the full workspace: every field sourced from its file, gaps listed as manual tasks, schema-valid', () => {
    const { brief, receipt } = compileBrief({ root: path.join(FULL, 'repo'), profile: fullProfile() });
    assert.deepEqual(brief.project, { name: 'Queue Clock', name_status: 'working', source: 'profile.json#project.name' });
    assert.equal(brief.sentences.broken, 'Withdrawal queues on Cardano lending pools hide when a withdrawal becomes claimable.');
    assert.equal(brief.sentences.source, 'research/findings/wave3/_recommendation.md:5; research/findings/wave3/_recommendation.md:6');
    assert.deepEqual([brief.hero.h1, brief.hero.sentence], ['See when your withdrawal clears', 'Lenders see where their withdrawal stands in the queue and when it becomes claimable.']);
    assert.equal(brief.gap.who_loses, 'Lenders who exit during a run');
    assert.equal(brief.use_case.source, 'research/findings/wave1/cardano-1-sponsor.md:5');
    assert.deepEqual(brief.sponsors.map((s) => [s.id, s.name]), [['cardano', 'Cardano']]);
    assert.deepEqual(brief.customers.map((c) => [c.name, c.url, c.url_source]), [['Example Lender', 'https://lender.example.invalid/', 'research/findings/wave1/cardano-1-sponsor.md:11']]);
    assert.deepEqual(brief.features.map((f) => [f.id, f.status, f.route, f.source]), [
      ['FR-001', 'testnet', '/', 'feature-catalogue.json:2'],
      ['FR-002', 'planned', '/queue', 'feature-catalogue.json:3'],
    ]);
    assert.deepEqual(brief.claims.ids, ['C-001', 'A4']);
    assert.deepEqual(brief.never_show.map((n) => [n.class, n.source]), [['embargo', 'never-show.json:5'], ['undisclosed-security', 'never-show.json:16'], ['never-public', 'never-show.json:27']]);
    assert.deepEqual(brief.judge_path, {
      beats: ['Open the deployed link and read the first screen.', 'Watch a queue position update on preprod.', 'Open the proof link behind the claim time.'],
      source: 'docs/45-RUNSHEET.md:5-8',
    });
    assert.deepEqual(brief.missing.map((m) => [m.field, m.action]), [
      ['sponsors[cardano].strategy', 'manual-task'],
      ['customers[Example Lender].category', 'manual-task'],
      ['features[].status', 'manual-task'],
      ['project.name_status', 'manual-task'],
    ]);
    assert.deepEqual(briefShapeProblems(brief), []);
    assert.deepEqual(schemaErrors(brief), []);
    assert.equal(receipt.workspace, FULL.replace(/\\/g, '/'));
    assert.equal(receipt.inputs.find((i) => i.key === 'storyboard')?.matcher, 'exact');
    assert.deepEqual(receipt.inputs.find((i) => i.key === 'storyboard')?.matches, ['docs/45-RUNSHEET.md']);
  });

  test('BF-02: a case-insensitive retry, then research/ re-rooted at docs/, and mode B asks questions', () => {
    const profile = loadProfile(path.join(VARIANTS, 'profile.json'));
    const { brief, receipt } = compileBrief({ root: VARIANTS, profile, workspace: VARIANTS });
    assert.equal(receipt.inputs.find((i) => i.key === 'rubric')?.matcher, 'case-insensitive');
    assert.equal(receipt.inputs.find((i) => i.key === 'spec')?.matcher, 'docs/ instead of research/, case-insensitive');
    assert.equal(brief.sentences.did, 'We attach a signed receipt to every payout and show it beside the amount.');
    assert.deepEqual([brief.hero.h1, brief.hero.source], ['Every payout with its receipt', 'docs/_Recommendation.md:7; docs/_Recommendation.md:8']);
    assert.ok(brief.missing.every((m) => m.action === 'question'));
    assert.ok(brief.missing.some((m) => m.field === 'gap.text'));
    assert.deepEqual(schemaErrors(brief), []);
  });

  test('an empty workspace: nothing invented, every required field listed with the reason and the fallback', () => {
    const profile = loadProfile(path.join(EMPTY, 'profile.json'));
    const { brief } = compileBrief({ root: EMPTY, profile, workspace: EMPTY });
    assert.equal(brief.hero.h1, '');
    assert.equal(brief.features.length, 0);
    const fields = brief.missing.map((m) => m.field);
    for (const f of ['project.name', 'sentences.broken', 'sentences.did', 'hero.h1', 'hero.sentence', 'gap.text', 'sponsors', 'customers', 'features', 'claims.path', 'never_show', 'judge_path.beats', 'spec', 'rubric']) {
      assert.ok(fields.includes(f), `missing lists ${f}`);
    }
    assert.match(brief.missing.find((m) => m.field === 'sentences.broken')?.why ?? '', /no hero copy is written without the two sentences/);
    assert.match(brief.missing.find((m) => m.field === 'never_show')?.why ?? '', /BF-09/);
    assert.deepEqual(schemaErrors(brief), []);
  });

  test('sources that disagree are a gap for the owner, never a pick', () => {
    const ws = path.join(tmp, 'conflict');
    mkdirSync(path.join(ws, 'research'), { recursive: true });
    writeFileSync(path.join(ws, 'research', 'SPEC.md'), 'H1: One headline\n');
    writeFileSync(path.join(ws, 'research', '_recommendation.md'), 'H1: Another headline\n');
    const { brief } = compileBrief({ root: ws, profile: defaultProfile(), workspace: ws });
    assert.equal(brief.hero.h1, '');
    assert.match(brief.missing.find((m) => m.field === 'hero.h1')?.why ?? '', /Sources disagree/);
  });

  test('without a catalogue, requirement ids in the spec become features flagged for confirmation', () => {
    const ws = path.join(tmp, 'spec-only');
    cpSync(path.join(FULL, 'research'), path.join(ws, 'research'), { recursive: true });
    const { brief } = compileBrief({ root: ws, profile: defaultProfile(), workspace: ws });
    assert.deepEqual(brief.features.map((f) => [f.id, f.title, f.group, f.status]), [
      ['FR-001', 'See where a withdrawal stands in the queue', 'G1', 'planned'],
      ['FR-002', 'Estimate when a withdrawal becomes claimable', 'G1', 'planned'],
    ]);
    assert.match(brief.missing.find((m) => m.field === 'features')?.why ?? '', /Enumerated from requirement ids/);
  });

  test('a re-run keeps what an agent filled with a source and lets a source file replace a hand edit', () => {
    const state = stateFolder('merge');
    const profile = fullProfile();
    const first = compileBrief({ root: path.join(FULL, 'repo'), profile }).brief;
    first.sponsors[0].strategy = 'Agentic commerce track: payments between agents';
    first.sponsors[0].source = `${first.sponsors[0].source}; research/findings/wave1/cardano-1-sponsor.md:3`;
    first.hero.h1 = 'Edited by hand';
    first.features[1].status = 'simulated';
    first.missing.push({ field: 'team', action: 'manual-task', why: 'Ask whether dev B builds UI.' });
    writeFileSync(path.join(state, 'brief.json'), JSON.stringify(first));
    const second = compileBrief({ root: path.join(FULL, 'repo'), profile, existing: readBrief(state).brief }).brief;
    assert.equal(second.sponsors[0].strategy, 'Agentic commerce track: payments between agents');
    assert.match(second.sponsors[0].source, /cardano-1-sponsor\.md:3/);
    assert.equal(second.hero.h1, 'See when your withdrawal clears');
    assert.equal(second.features[1].status, 'simulated');
    const fields = second.missing.map((m) => m.field);
    assert.ok(!fields.includes('sponsors[cardano].strategy'));
    assert.ok(!fields.includes('features[].status'));
    assert.ok(fields.includes('team'));
  });

  test('an existing never-show file with no entries is an answer, not a gap', () => {
    const profileFile = path.join(tmp, 'profile-empty-ns.json');
    const nsFile = path.join(tmp, 'never-show-empty.json');
    writeFileSync(nsFile, JSON.stringify({ version: 1, entries: [] }));
    writeFileSync(profileFile, JSON.stringify({ judged_surface: 'site', stack: 'existing', hosting: 'local', paths: { never_show: nsFile } }));
    const profile = loadProfile(profileFile);
    const { brief } = compileBrief({ root: EMPTY, profile, workspace: EMPTY });
    assert.equal(brief.never_show.length, 0);
    assert.ok(!brief.missing.some((m) => m.field === 'never_show'));
    assert.deepEqual(checkBrief(brief, { bases: [EMPTY], neverShowFile: { path: nsFile, exists: true } }).problems, []);
  });
});

describe('gate brief.complete', () => {
  /** @param {string} name @param {unknown} brief @returns {string} a state folder holding that brief.json */
  const withBrief = (name, brief) => {
    const state = stateFolder(name);
    writeFileSync(path.join(state, 'brief.json'), typeof brief === 'string' ? brief : JSON.stringify(brief, null, 2));
    return state;
  };
  const passBrief = () => JSON.parse(readFileSync(path.join(FIX, 'briefs', 'pass.json'), 'utf8'));
  const where = (/** @type {string} */ state) => ({ state, root: path.join(FULL, 'repo'), profile: fullProfile(), workspace: FULL });

  test('passing fixture: ok, with every gap as evidence', () => {
    const result = briefCompleteGate(where(withBrief('pass', passBrief())));
    assert.equal(result.state, 'ok', result.detail);
    assert.match(result.detail, /15 of 15 required fields filled and sourced, 4 gaps listed as missing/);
    assert.ok(result.evidence.some((e) => e.field === 'project.name_status'));
  });

  test('failing fixture: hero text without a source fails', () => {
    const result = briefCompleteGate(where(withBrief('unsourced', JSON.parse(readFileSync(path.join(FIX, 'briefs', 'fail-unsourced.json'), 'utf8')))));
    assert.equal(result.state, 'fail');
    assert.match(result.detail, /hero has text but no source/);
  });

  test('an empty required field that missing does not list fails', () => {
    const b = passBrief();
    b.gap = { text: '', who_loses: '', how_much: '', source: '' };
    const result = briefCompleteGate(where(withBrief('unlisted', b)));
    assert.equal(result.state, 'fail');
    assert.match(result.detail, /gap\.text is empty and not listed under missing/);
    b.missing.push({ field: 'gap', action: 'manual-task', why: 'Ask the owner.' });
    assert.equal(briefCompleteGate(where(withBrief('listed', b))).state, 'ok');
  });

  test('a source that does not exist, or a line past the end of its file, fails', () => {
    const b = passBrief();
    b.use_case.source = 'research/findings/wave1/no-such-file.md:3';
    b.judge_path.source = 'docs/45-RUNSHEET.md:5-80';
    const result = briefCompleteGate(where(withBrief('bad-source', b)));
    assert.equal(result.state, 'fail');
    const all = result.evidence.map((e) => String(e.value)).join('\n');
    assert.match(all, /use_case: source research\/findings\/wave1\/no-such-file\.md:3 does not resolve/);
    assert.match(all, /judge_path: source docs\/45-RUNSHEET\.md:5-80 points past the end of the file/);
  });

  test('a shape problem, a stale missing entry, a missing file and broken JSON fail', () => {
    const extra = passBrief();
    extra.hero.subtitle = 'not a field';
    assert.match(briefCompleteGate(where(withBrief('shape', extra))).detail, /hero\.subtitle is not a field of the brief/);
    const stale = passBrief();
    stale.missing.push({ field: 'hero.h1', action: 'manual-task', why: 'old' });
    assert.match(briefCompleteGate(where(withBrief('stale', stale))).detail, /missing lists hero\.h1, which is filled/);
    assert.match(briefCompleteGate(where(stateFolder('no-brief'))).detail, /brief\.json does not exist; run node brief\.mjs/);
    assert.match(briefCompleteGate(where(withBrief('broken', '{"project":'))).detail, /not valid JSON/);
  });

  test('no state directory is a skip, and a skipped gate never makes the report ok', () => {
    const result = briefCompleteGate({ state: null, root: path.join(FULL, 'repo'), profile: fullProfile() });
    assert.equal(result.state, 'skipped');
    const report = aggregate([result], { requested: GATES });
    assert.equal(report.ok, false);
    assert.equal(report.counts.skipped, 1);
    assert.equal(aggregate([gate(GATES[0]).ok('x')], { requested: GATES }).ok, true);
  });

  test('run(ctx, selected) answers only for brief.complete and finds the workspace from the receipt', async () => {
    const state = withBrief('run', passBrief());
    mkdirSync(path.join(state, 'receipts'), { recursive: true });
    writeFileSync(path.join(state, RECEIPT_PATH), JSON.stringify({ workspace: FULL }));
    const ctx = { root: path.join(tmp, 'elsewhere'), profile: defaultProfile(), state };
    mkdirSync(ctx.root, { recursive: true });
    assert.deepEqual(await run(ctx, ['coverage.hero']), []);
    const [result] = await run(ctx, ['brief']);
    assert.equal(result.id, 'brief.complete');
    assert.equal(result.state, 'ok', result.detail);
  });
});

describe('brief.mjs CLI', () => {
  const cli = (/** @type {string[]} */ args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'brief.mjs'), ...args], { encoding: 'utf8' });

  test('compiles, writes brief.json, brief.md and the receipt, and exits 0 with the report on stdout', () => {
    const state = stateFolder('cli');
    const out = cli(['--root', path.join(FULL, 'repo'), '--profile', path.join(FULL, 'profile.json'), '--state', state, '--json']);
    assert.equal(out.status, 0, out.stderr);
    const report = JSON.parse(out.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.tool, 'brief');
    assert.ok(existsSync(path.join(state, 'brief.json')) && existsSync(path.join(state, 'brief.md')) && existsSync(path.join(state, RECEIPT_PATH)));
    assert.doesNotMatch(readFileSync(path.join(state, 'brief.json'), 'utf8'), /\r/);
    assert.match(out.stderr, /missing project\.name_status \(manual-task\)/);
  });

  test('--check exits 1 on a failing brief and writes nothing; bad flags exit 2', () => {
    const state = stateFolder('cli-check');
    writeFileSync(path.join(state, 'brief.json'), readFileSync(path.join(FIX, 'briefs', 'fail-unsourced.json')));
    const check = cli(['--root', path.join(FULL, 'repo'), '--profile', path.join(FULL, 'profile.json'), '--state', state, '--workspace', FULL, '--check']);
    assert.equal(check.status, 1, check.stderr);
    assert.ok(!existsSync(path.join(state, 'brief.md')));
    assert.equal(cli(['--check', '--dry-run']).status, 2);
    assert.equal(cli(['--no-such-flag']).status, 2);
  });

  test('--dry-run prints the brief and creates no state folder', () => {
    const root = path.join(tmp, 'dry-root');
    mkdirSync(root, { recursive: true });
    const out = cli(['--root', root, '--profile', path.join(VARIANTS, 'profile.json'), '--workspace', VARIANTS, '--dry-run']);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(JSON.parse(out.stdout).hero.h1, 'Every payout with its receipt');
    assert.ok(!existsSync(path.join(root, '.frontend')));
  });
});
