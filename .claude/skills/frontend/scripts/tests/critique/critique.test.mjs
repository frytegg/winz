// @ts-check
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import {
  aggregateScores, buildChecklist, captureViewports, chooseMarks, classifyElements, consolidateIssues, decide, evaluateProbes,
  fnv1a32, gateProblems, loadBrief, MarkRegistry, MAX_TILES, mentions, parseChecklist, planTiles, primaryKind, proposition,
  receiptChecksum, renderTemplate, repeatedRuns, sameTextKey, SKILL_DIR, snapshotOf, summariseGates, tilesFor, validateSchema,
  verifyReceipt,
} from '../../critique.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import { FIXTURES, git, gitRepoWithSite, runCli, stateWithBrief, tempDir, writeJsonFile } from './helpers.mjs';

/** @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo */

/** @type {string[]} */
const cleanup = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

/**
 * @param {Partial<ElementInfo> & {sel: string}} over
 * @returns {ElementInfo}
 */
function el(over) {
  return {
    tag: 'div', role: '', box: { x: 0, y: 0, w: 100, h: 20 }, visible: true, text: '', styles: {}, attrs: {}, meta: {}, parent: 0, depth: 1,
    ...over,
  };
}

describe('checksums and schema validation', () => {
  test('fnv1a32 matches the published FNV-1a 32-bit vectors', () => {
    assert.equal(fnv1a32(''), '811c9dc5');
    assert.equal(fnv1a32('a'), 'e40c292c');
    assert.equal(fnv1a32('foobar'), 'bf9cf968');
  });

  test('receiptChecksum hashes the receipt without its checksum key, in written order', () => {
    const receipt = { fragment: 'feCritique', ok: true, checksum: 'fnv1a32:00000000' };
    assert.equal(receiptChecksum(receipt), `fnv1a32:${fnv1a32(JSON.stringify({ fragment: 'feCritique', ok: true }))}`);
    assert.notEqual(receiptChecksum({ ok: true, fragment: 'feCritique' }), receiptChecksum(receipt), 'key order is part of the content');
  });

  test('validateSchema handles the keywords the skill schemas use', () => {
    const schema = {
      type: 'object', required: ['a', 'b'], additionalProperties: false,
      properties: {
        a: { enum: ['x', 'y'] }, b: { oneOf: [{ type: 'null' }, { $ref: '#/$defs/n' }] }, c: { type: 'string', pattern: '^[0-9a-f]{7,64}$' },
        d: { type: 'array', maxItems: 2, items: { type: 'integer', minimum: 1 } },
      },
      allOf: [{ if: { properties: { a: { const: 'y' } } }, then: { properties: { b: { type: 'null' } } } }],
      $defs: { n: { type: 'number' } },
    };
    assert.deepEqual(validateSchema(schema, { a: 'x', b: 3, c: 'abcdef0', d: [1, 2] }), []);
    const errors = validateSchema(schema, { a: 'z', b: 'no', c: 'XYZ', d: [0, 1, 2], e: 1 });
    for (const fragment of ['$.a: must be one of', '$.b: matches 0 of oneOf', '$.c: does not match', '$.d: more than 2 items', '$.d[0]: below 1', '$: unexpected property e']) {
      assert.ok(errors.some((e) => e.startsWith(fragment)), `${fragment} in ${errors.join(' | ')}`);
    }
    assert.ok(validateSchema(schema, { a: 'y', b: 3 }).some((e) => e.startsWith('$.b: expected null')), 'if/then applies');
    assert.ok(validateSchema(schema, { b: null }).includes('$: missing a'));
  });
});

describe('brief and checklist', () => {
  test('loadBrief reads the hero, sponsors and features, and the proposition joins H1 and sentence', () => {
    const state = stateWithBrief();
    cleanup.push(state);
    const brief = loadBrief(state);
    assert.equal(brief.h1, 'Settle withdrawals on time');
    assert.deepEqual(brief.sponsors, ['Cardano']);
    assert.deepEqual(brief.features.map((f) => `${f.id}:${f.status}`), ['FR-001:testnet', 'FR-002:simulated']);
    assert.equal(proposition(brief), 'Settle withdrawals on time. Treasury teams see when each Cardano withdrawal will settle, before they promise a date.');
  });

  test('loadBrief refuses a missing brief or a brief without its hero', () => {
    const empty = tempDir('fe-critique-empty-');
    cleanup.push(empty);
    assert.throws(() => loadBrief(empty), (err) => err instanceof Error && /brief not found/.test(err.message) && Reflect.get(err, 'exitCode') === 2);
    writeJsonFile(path.join(empty, 'brief.json'), { hero: { h1: '', sentence: '' } });
    assert.throws(() => loadBrief(empty), /no hero\.h1 or hero\.sentence/);
    assert.equal(loadBrief(empty, { requireHero: false }).h1, '');
  });

  test('renderTemplate drops the leading comment, fills values, repeats each blocks and escapes table pipes', () => {
    const template = '<!--\nnotes {{x}}\n-->\n# {{project.name}}\n| id | item |\n|---|---|\n{{#each features}}\n| F-{{this.id}} | {{this.title}} |\n{{/each}}\nend';
    const out = renderTemplate(template, { project: { name: 'P | Q' }, features: [{ id: 'FR-1', title: 'A' }, { id: 'FR-2', title: 'B  c' }] });
    assert.equal(out, '# P \\| Q\n| id | item |\n|---|---|\n| F-FR-1 | A |\n| F-FR-2 | B c |\nend');
    assert.throws(() => renderTemplate('{{#each x}}\nno close', {}), /has no \{\{\/each\}\}/);
  });

  test('parseChecklist reads the rows under each section and keeps escaped pipes', () => {
    const items = parseChecklist('## One\n| id | item | how | source |\n|---|---|---|---|\n| A1 | a \\| b | h | s |\n## Two\n| B1 | x | y | z |\n');
    assert.deepEqual(items.map((i) => [i.id, i.section, i.item]), [['A1', 'One', 'a | b'], ['B1', 'Two', 'x']]);
  });

  test('buildChecklist renders the shared template: six first-view items, four per feature, and the page items', () => {
    const state = stateWithBrief();
    cleanup.push(state);
    const { markdown, items } = buildChecklist(loadBrief(state));
    const ids = items.map((i) => i.id);
    assert.deepEqual(ids.slice(0, 6), ['FV1', 'FV2', 'FV3', 'FV4', 'FV5', 'FV6']);
    for (const id of ['F-FR-001.a', 'F-FR-001.d', 'F-FR-002.c', 'H1', 'H2', 'E1', 'L1', 'L3', 'T1', 'T3', 'C1', 'C2', 'W1', 'W2', 'S1', 'S2', 'M1']) assert.ok(ids.includes(id), id);
    assert.equal(items.length, 6 + 4 * 2 + 3 + 6 + 7);
    assert.match(markdown, /The H1 reads exactly "Settle withdrawals on time"/);
    assert.match(markdown, /Its status label reads simulated/);
    assert.doesNotMatch(markdown, /\{\{|<!--/);
  });
});

describe('viewports and tile planning', () => {
  test('captureViewports takes the profile desktop and mobile entries and keeps tiles under the 2576 px edge', () => {
    const vps = captureViewports(defaultProfile());
    assert.deepEqual(vps.map((v) => `${v.name} ${v.width}x${v.height}@${v.dpr}`), ['desktop 1440x900@1', 'mobile 390x844@2']);
    const tall = captureViewports(defaultProfile({ viewports: [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 1000, dpr: 3, isMobile: true }] }));
    assert.ok(tall[1].dpr * 1000 <= 2576 && tall[1].dpr > 2.5, `dpr ${tall[1].dpr}`);
    assert.equal(tall[1].isMobile, true);
  });

  test('tilesFor adds a tile only while a quarter viewport of new content remains', () => {
    assert.equal(tilesFor(500, 900), 1);
    assert.equal(tilesFor(1100, 900), 1);
    assert.equal(tilesFor(1125, 900), 2);
    assert.equal(tilesFor(2700, 900), 3);
  });

  test('planTiles spreads the budget breadth first and never exceeds it', () => {
    const plan = planTiles([{ key: 'a', height: 4000, vh: 900 }, { key: 'b', height: 3000, vh: 800 }, { key: 'c', height: 700, vh: 900 }], 6);
    assert.deepEqual(Object.fromEntries(plan), { a: [0, 1, 2], b: [0, 1], c: [0] });
    const small = planTiles([{ key: 'a', height: 9000, vh: 900 }, { key: 'b', height: 9000, vh: 900 }], 3);
    assert.deepEqual(Object.fromEntries(small), { a: [0, 1], b: [0] });
    assert.equal(MAX_TILES * 2, 20, 'a pairwise call reads two versions of at most ten tiles');
  });

  test('chooseMarks keeps markers and headings first, caps the count and returns document order', () => {
    const rects = ['1', '2', '3', '4'].map((id) => ({ id, x: 0, y: 0, w: 10, h: 10 }));
    const chosen = chooseMarks(rects, new Map([['1', 4], ['2', 0], ['3', 1], ['4', 4]]), 2);
    assert.deepEqual(chosen.map((c) => c.id), ['2', '3']);
  });
});

describe('page analysis on collector output', () => {
  test('classifyElements finds markers, headings, controls, images and text blocks, not text inside a control', () => {
    const elements = [
      el({ sel: 'body', tag: 'body', parent: -1, depth: 0 }),
      el({ sel: 'h1', tag: 'h1', role: 'heading', attrs: { 'data-hero': 'h1' } }),
      el({ sel: 'p', tag: 'p', styles: { display: 'block' } }),
      el({ sel: 'p > span', tag: 'span', styles: { display: 'inline' }, parent: 2, depth: 2 }),
      el({ sel: 'button', tag: 'button', role: 'button' }),
      el({ sel: 'button > span', tag: 'span', styles: { display: 'inline' }, parent: 4, depth: 2 }),
      el({ sel: 'img', tag: 'img', role: 'img' }),
      el({ sel: 'a', tag: 'a', meta: { href: '#x' } }),
    ];
    /** @param {string} sel */
    const text = (sel) => ({ sel, text: 'words', fontSize: 16, fontFamily: 'Arial', fontWeight: 400, fontStyle: 'normal', color: 'rgb(0, 0, 0)', bg: 'rgb(255, 255, 255)', bgImage: null, box: { x: 0, y: 0, w: 10, h: 10 }, inViewport: true, recRole: null, tag: 'span', source: /** @type {const} */ ('text'), visible: true, opacity: 1, textTransform: 'none', letterSpacing: 'normal', lineHeight: 'normal' });
    const kinds = classifyElements(elements, [text('p > span'), text('button > span')]);
    assert.deepEqual([...(kinds.get(1) ?? [])].sort(), ['heading', 'marker']);
    assert.deepEqual([...(kinds.get(2) ?? [])], ['text'], 'the span lifts to its block');
    assert.equal(kinds.has(3), false);
    assert.deepEqual([...(kinds.get(4) ?? [])], ['interactive']);
    assert.equal(kinds.has(5), false, 'text inside a control is not a text block');
    assert.deepEqual([...(kinds.get(6) ?? [])], ['image']);
    assert.deepEqual([...(kinds.get(7) ?? [])], ['interactive']);
    assert.deepEqual(primaryKind(/** @type {Set<string>} */ (kinds.get(1))), { kind: 'heading', priority: 0 });
  });

  test('repeatedRuns finds equal siblings in a column or a row and skips text flow', () => {
    const elements = [
      el({ sel: 'body', tag: 'body', parent: -1, depth: 0 }),
      el({ sel: 'c1', box: { x: 0, y: 0, w: 300, h: 40 } }),
      el({ sel: 'c2', box: { x: 0, y: 50, w: 300, h: 60 } }),
      el({ sel: 'c3', box: { x: 0, y: 140, w: 302, h: 40 } }),
      el({ sel: 'p1', tag: 'p', box: { x: 0, y: 200, w: 300, h: 20 } }),
      el({ sel: 'p2', tag: 'p', box: { x: 0, y: 230, w: 300, h: 20 } }),
      el({ sel: 'p3', tag: 'p', box: { x: 0, y: 290, w: 300, h: 20 } }),
    ];
    const runs = repeatedRuns(elements, [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(runs.map((r) => [r.axis, r.indexes]), [['column', [1, 2, 3]]]);
    const row = [el({ sel: 'body', parent: -1, depth: 0 }), ...[0, 1, 2].map((k) => el({ sel: `r${k}`, tag: 'li', box: { x: k * 110, y: 0, w: 100, h: 80 } }))];
    assert.deepEqual(repeatedRuns(row, [1, 2, 3]).map((r) => r.axis), ['row']);
  });

  test('mentions matches whole words and sameTextKey ignores case, spacing and end punctuation', () => {
    assert.equal(mentions('Built on the Cardano testnet', 'cardano'), true);
    assert.equal(mentions('Cardanos', 'Cardano'), false);
    assert.equal(sameTextKey('  SETTLE  withdrawals on time. '), sameTextKey('Settle withdrawals on time'));
  });

  test('aggregateScores averages the typography sub-checks and leaves out what was not measured', () => {
    const analysis = { kinds: new Map(), notes: [], features: [], layoutIssues: 2, problems: [], items: [
      { dim: 'typography', sub: 'body-size', ok: true }, { dim: 'typography', sub: 'body-size', ok: false }, { dim: 'typography', sub: 'orphans', ok: true },
      { dim: 'contrast', sub: 'text', ok: true },
    ] };
    const scores = aggregateScores([analysis], [{ id: 'FR-1', found: true, ok: true, el: 0, missing: [] }, { id: 'FR-2', found: false, ok: false, el: -1, missing: ['surface'] }]);
    assert.deepEqual(scores, { typography: 75, contrast: 100, layout: 60, features: 50 });
  });
});

describe('gates', () => {
  test('summariseGates counts states and lists failed and skipped gates as failing', () => {
    const report = JSON.parse(readFileSync(path.join(FIXTURES, 'gates-fail.json'), 'utf8'));
    assert.deepEqual(summariseGates(report), { ok: false, counts: { ok: 2, fail: 1, skipped: 1 }, failing: ['render.clipping', 'motion.reduced'] });
    const okReport = JSON.parse(readFileSync(path.join(FIXTURES, 'gates-ok.json'), 'utf8'));
    assert.deepEqual(summariseGates(okReport).failing, []);
    assert.equal(summariseGates({ ...okReport, gates: [...okReport.gates, { ...okReport.gates[0], id: 'x.y', state: 'skipped' }] }).ok, false, 'a skipped gate never counts as passing');
  });

  test('gateProblems ties a failing gate to the mark of its evidence selector', () => {
    const registry = new MarkRegistry();
    const route = { path: '/', name: 'home', first: true, features: [], states: [] };
    const h1 = registry.add(route, el({ sel: 'h1', tag: 'h1', role: 'heading', text: 'Title' }), ['heading'], 'desktop');
    const report = JSON.parse(readFileSync(path.join(FIXTURES, 'gates-fail.json'), 'utf8'));
    const problems = gateProblems(report, registry);
    assert.equal(problems.length, 1);
    assert.deepEqual([problems[0].mark, problems[0].check, problems[0].viewport], [h1.id, 'render.clipping', 'desktop']);
    assert.match(problems[0].problem, /1 clipped text container \(238px\)/);
  });
});

describe('issues, acceptance and probes', () => {
  /**
   * @param {Array<{mark: string, item?: string, category?: string, problem?: string}>} issues
   * @returns {Record<string, unknown>}
   */
  const critic = (issues) => ({ issues: issues.map((i) => ({ category: 'layout', problem: 'measured', fix: 'concrete', ...i })) });

  test('an issue is kept when two critics raise it or a check confirms its mark; one critic alone is dropped', () => {
    const results = [
      critic([{ mark: '3', item: 'T1' }, { mark: '9' }]),
      critic([{ mark: '3', item: 'T1' }, { mark: '7' }]),
      critic([{ mark: '5' }]),
    ];
    const { issues, dropped } = consolidateIssues(results, [{ mark: '5' }], {});
    assert.deepEqual(issues.map((i) => [i.key, i.votes, i.confirmed]), [['5|layout', 1, true], ['3|T1', 2, false]]);
    assert.equal(dropped, 2);
  });

  test('consolidation caps at five issues, skips duplicates within a critic and issues tried three times', () => {
    const many = critic(['1', '2', '3', '4', '5', '6'].map((mark) => ({ mark })));
    const twice = [many, many];
    assert.equal(consolidateIssues(twice, [], {}).issues.length, 5, 'each critic contributes at most five issues');
    const dup = critic([{ mark: '1' }, { mark: '1' }]);
    assert.deepEqual(consolidateIssues([dup], [], {}).issues, [], 'one critic repeating itself is one vote');
    assert.deepEqual(consolidateIssues([critic([{ mark: '1' }]), critic([{ mark: '1' }])], [], { '1|layout': 3 }).issues, []);
    assert.equal(consolidateIssues([critic([{ mark: '1', problem: '' }]), critic([{ mark: '1', problem: '' }])], [], {}).issues.length, 0, 'an issue without a measured problem is discarded');
  });

  /** @param {Partial<import('../../critique.mjs').Snapshot>} over */
  const snap = (over) => ({ round: 0, sha: 'a'.repeat(40), ui_tree: 'b'.repeat(40), gates: { ok: true, counts: { ok: 3, fail: 0, skipped: 0 }, failing: [] }, scores: { typography: 80, layout: 100 }, ...over });

  test('decide accepts only without gate regression or score drop, and with the candidate preferred in both orders', () => {
    assert.deepEqual(decide(snap({}), snap({ round: 1, scores: { typography: 90, layout: 100 } }), 'B', 'A'), {
      accepted: true, reasons: [], pairwise: { ab: 'B', ba: 'A', consistent: true }, improved: [],
    });
    const regression = decide(snap({}), snap({ gates: { ok: false, counts: { ok: 2, fail: 1, skipped: 0 }, failing: ['render.cls'] } }), 'B', 'A');
    assert.equal(regression.accepted, false);
    assert.deepEqual(regression.reasons, ['gate regression: render.cls']);
    const drop = decide(snap({}), snap({ scores: { typography: 79.9, layout: 100 } }), 'B', 'A');
    assert.deepEqual(drop.reasons, ['score typography dropped from 80 to 79.9']);
    assert.deepEqual(decide(snap({}), snap({ scores: { layout: 100 } }), 'B', 'A').reasons, ['score typography missing']);
    const bias = decide(snap({}), snap({}), 'B', 'B');
    assert.equal(bias.accepted, false);
    assert.equal(bias.pairwise.consistent, false, 'both verdicts name the same position');
    assert.equal(decide(snap({}), snap({}), 'tie', 'tie').accepted, false, 'a tie is no improvement');
    const fixedGate = decide(snap({ gates: { ok: false, counts: { ok: 2, fail: 1, skipped: 0 }, failing: ['a11y.axe'] } }), snap({}), 'B', 'A');
    assert.deepEqual([fixedGate.accepted, fixedGate.improved], [true, ['a11y.axe']]);
  });

  test('evaluateProbes needs the minimum on every viewport', () => {
    const answers = ['p1', 'p2', 'p3', 'p4', 'p5'].map((probe) => ({ probe, answer: `${probe} says` }));
    const yes = { p1: true, p2: true, p3: true, p4: true, p5: false };
    const pass = evaluateProbes([{ viewport: 'desktop', answers, verdicts: yes }, { viewport: 'mobile', answers, verdicts: yes }], { of: 5, minMatch: 4, measuredOn: 2 });
    assert.equal(pass.pass, true);
    assert.deepEqual(pass.viewports.map((v) => v.matched), [4, 4]);
    const fail = evaluateProbes([{ viewport: 'desktop', answers, verdicts: yes }, { viewport: 'mobile', answers: [], verdicts: {} }], { of: 5, minMatch: 4, measuredOn: 2 });
    assert.equal(fail.pass, false);
  });

  test('snapshotOf keeps the receipt fields of a measure', () => {
    const s = snapshotOf({ round: 2, sha: 'abc1234', ui_tree: 'def5678', gates: { ok: true, counts: { ok: 1, fail: 0, skipped: 0 }, failing: [] }, scores: { a: 1, b: 'x' }, tiles: [] });
    assert.deepEqual(s, { round: 2, sha: 'abc1234', ui_tree: 'def5678', gates: { ok: true, counts: { ok: 1, fail: 0, skipped: 0 }, failing: [] }, scores: { a: 1 } });
  });
});

describe('CLI: issues, accept and probes on a round folder', () => {
  /**
   * A state folder with a baseline measure as best-so-far and a candidate for round 1.
   * @param {{candidateScores?: Record<string, number>, candidateFailing?: string[]}} [opts]
   */
  function setup(opts = {}) {
    const state = stateWithBrief();
    cleanup.push(state);
    const crit = path.join(state, 'critique');
    const gates = (/** @type {string[]} */ failing) => ({ ok: failing.length === 0, counts: { ok: 3 - failing.length, fail: failing.length, skipped: 0 }, failing });
    const baseline = { round: 0, label: 'baseline', sha: 'a'.repeat(40), ui_tree: 'b'.repeat(40), gates: gates([]), scores: { typography: 80, contrast: 100 }, deterministic: [{ mark: '7', check: 'typography.body-size', problem: '14px', fix: '16px' }], task_file: path.join(crit, 'round-0', 'baseline', 'task.md'), tiles: [] };
    const candidate = { ...baseline, round: 1, label: 'candidate', sha: 'c'.repeat(40), ui_tree: 'd'.repeat(40), gates: gates(opts.candidateFailing ?? []), scores: opts.candidateScores ?? { typography: 95, contrast: 100 } };
    writeJsonFile(path.join(crit, 'round-0', 'baseline', 'measure.json'), baseline);
    writeJsonFile(path.join(crit, 'best.json'), { version: 1, measure: path.join(crit, 'round-0', 'baseline', 'measure.json'), round: 0 });
    writeJsonFile(path.join(crit, 'round-1', 'candidate', 'measure.json'), candidate);
    const issue = (/** @type {string} */ mark, /** @type {string} */ item) => ({ mark, item, category: 'typography', problem: 'body text 14px', fix: 'use the 16px body token' });
    writeJsonFile(path.join(crit, 'round-1', 'critics', 'c1.json'), { pass_id: 'T-r1-c1', kind: 'critique', checklist: [{ id: 'T1', answer: 'no', mark: '7' }], issues: [issue('7', 'T1'), issue('9', 'L1')] });
    writeJsonFile(path.join(crit, 'round-1', 'critics', 'c2.json'), { pass_id: 'T-r1-c2', kind: 'critique', checklist: [], issues: [issue('9', 'L1')] });
    writeJsonFile(path.join(crit, 'round-1', 'critics', 'c3.json'), { pass_id: 'T-r1-c3', kind: 'critique', checklist: [], issues: [{ mark: '4' }] });
    return { state, crit };
  }

  /**
   * @param {string} crit
   * @param {string} ab
   * @param {string} ba
   */
  function pairwise(crit, ab, ba) {
    writeJsonFile(path.join(crit, 'round-1', 'pairwise-ab.json'), { pass_id: 'T-r1-pAB', kind: 'pairwise', checklist: [{ id: 'T1', a: 'no', b: 'yes' }], preferred: ab, reason: 'B fixes the body size' });
    writeJsonFile(path.join(crit, 'round-1', 'pairwise-ba.json'), { pass_id: 'T-r1-pBA', kind: 'pairwise', checklist: [{ id: 'T1', a: 'yes', b: 'no' }], preferred: ba, reason: 'A fixes the body size' });
  }

  test('issues keeps the confirmed and the agreed issues and reports an invalid critic output', () => {
    const { state } = setup();
    const res = runCli(['issues', '--round', '1', '--state', state, '--root', state, '--json']);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(res.json.issues.map((/** @type {any} */ i) => [i.key, i.votes, i.confirmed]), [['7|T1', 1, true], ['9|L1', 2, false]]);
    assert.equal(res.json.critics_returned, 2);
    assert.equal(res.json.invalid.length, 1, 'c3 lacks category, problem and fix');
    assert.ok(existsSync(path.join(state, 'critique', 'round-1', 'issues.json')));
  });

  test('accept moves the best-so-far when the candidate wins both orders, and writes a schema-valid round', () => {
    const { state, crit } = setup();
    pairwise(crit, 'B', 'A');
    const res = runCli(['accept', '--round', '1', '--state', state, '--root', state, '--json']);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.json.round.verdict, 'accepted');
    assert.deepEqual(res.json.round.pairwise, { ab: 'B', ba: 'A', consistent: true });
    const schema = JSON.parse(readFileSync(path.join(SKILL_DIR, 'assets', 'schemas', 'critique-receipt.schema.json'), 'utf8'));
    assert.deepEqual(validateSchema({ $ref: '#/$defs/round' }, res.json.round, schema), []);
    const best = JSON.parse(readFileSync(path.join(crit, 'best.json'), 'utf8'));
    assert.match(best.measure.replace(/\\/g, '/'), /round-1\/candidate\/measure\.json$/);
    assert.equal(res.json.best_after.sha, 'c'.repeat(40));
    const history = JSON.parse(readFileSync(path.join(crit, 'history.json'), 'utf8'));
    assert.deepEqual(history.attempts, { '7|T1': 1, '9|L1': 1 });
    assert.ok(existsSync(path.join(crit, 'round-1', 'receipt.json')));
  });

  test('accept rejects on position bias, a score drop or a gate regression, and keeps the best-so-far', () => {
    /** @type {Array<[string, {candidateScores?: Record<string, number>, candidateFailing?: string[]}, string, string, RegExp]>} */
    const cases = [
      ['bias', {}, 'B', 'B', /pairwise: the candidate was not preferred in both orders/],
      ['drop', { candidateScores: { typography: 95, contrast: 99 } }, 'B', 'A', /score contrast dropped from 100 to 99/],
      ['gate', { candidateFailing: ['render.cls'] }, 'B', 'A', /gate regression: render\.cls/],
    ];
    for (const [name, opts, ab, ba, reason] of cases) {
      const { state, crit } = setup(opts);
      pairwise(crit, ab, ba);
      const res = runCli(['accept', '--round', '1', '--state', state, '--root', state, '--json']);
      assert.equal(res.status, 1, `${name}: ${res.stderr}`);
      assert.equal(res.json.round.verdict, 'rejected', name);
      assert.ok(res.json.round.reasons.some((/** @type {string} */ r) => reason.test(r)), `${name}: ${res.json.round.reasons}`);
      const best = JSON.parse(readFileSync(path.join(crit, 'best.json'), 'utf8'));
      assert.match(best.measure.replace(/\\/g, '/'), /round-0\/baseline\/measure\.json$/, name);
      const history = JSON.parse(readFileSync(path.join(crit, 'history.json'), 'utf8'));
      assert.equal(history.rejected.length, 2, name);
    }
  });

  test('accept reads gate reports of the incumbent and the candidate when given, and rejects a regression they show', () => {
    const { state, crit } = setup();
    pairwise(crit, 'B', 'A');
    const res = runCli(['accept', '--round', '1', '--state', state, '--root', state, '--json',
      '--best-gates', path.join(FIXTURES, 'gates-ok.json'), '--candidate-gates', path.join(FIXTURES, 'gates-fail.json')]);
    assert.equal(res.status, 1, res.stderr);
    assert.deepEqual(res.json.round.reasons, ['gate regression: render.clipping, motion.reduced']);
    assert.deepEqual(res.json.round.candidate.gates.failing, ['render.clipping', 'motion.reduced']);
  });

  test('accept with no issue kept and no candidate records no-issue; a kept issue without a candidate is a usage error', () => {
    const { state, crit } = setup();
    rmSync(path.join(crit, 'round-1', 'candidate'), { recursive: true });
    for (const f of ['c1.json', 'c2.json']) rmSync(path.join(crit, 'round-1', 'critics', f));
    let res = runCli(['accept', '--round', '1', '--state', state, '--root', state, '--json']);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.json.round.verdict, 'no-issue');
    writeJsonFile(path.join(crit, 'round-1', 'critics', 'c1.json'), { pass_id: 'x', kind: 'critique', checklist: [], issues: [{ mark: '7', category: 'typography', problem: 'p', fix: 'f' }] });
    res = runCli(['accept', '--round', '1', '--state', state, '--root', state]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /no candidate measure/);
  });

  test('probes pass at four of five per viewport and accept records them', () => {
    const { state, crit } = setup();
    pairwise(crit, 'B', 'A');
    for (const viewport of ['desktop', 'mobile']) {
      for (let i = 1; i <= 5; i += 1) {
        writeJsonFile(path.join(crit, 'round-1', 'probes', viewport, `p${i}.json`), { pass_id: `p${i}`, answer: 'A queue that shows when withdrawals settle. It is for treasury teams.', what: 'queue', does: 'shows settlement', for_whom: 'treasury teams', unclear: false });
      }
      writeJsonFile(path.join(crit, 'round-1', 'probes', viewport, 'match.json'), { pass_id: 'm', kind: 'probe-match', matches: ['p1', 'p2', 'p3', 'p4', 'p5'].map((probe, k) => ({ probe, restates: viewport === 'desktop' || k < 3, reason: 'r' })) });
    }
    const res = runCli(['probes', '--round', '1', '--state', state, '--root', state, '--json']);
    assert.equal(res.status, 1, 'mobile has three of five');
    assert.deepEqual(res.json.viewports.map((/** @type {any} */ v) => [v.viewport, v.matched]), [['desktop', 5], ['mobile', 3]]);
    writeJsonFile(path.join(crit, 'round-1', 'probes', 'mobile', 'match.json'), { pass_id: 'm', kind: 'probe-match', matches: ['p1', 'p2', 'p3', 'p4', 'p5'].map((probe, k) => ({ probe, restates: k < 4, reason: 'r' })) });
    const accept = runCli(['accept', '--round', '1', '--state', state, '--root', state, '--json']);
    assert.equal(accept.status, 0, accept.stderr);
    assert.equal(accept.json.probes.pass, true);
    assert.equal(accept.json.probes.measured_on, 1);
  });

  test('usage errors exit 2 and --help exits 0', () => {
    assert.equal(runCli([]).status, 2);
    assert.equal(runCli(['nonsense']).status, 2);
    assert.match(runCli(['measure', '--serve', '.']).stderr, /needs --round <n> and --label/);
    assert.equal(runCli(['accept']).status, 2);
    assert.equal(runCli(['prepare', '--bogus']).status, 2);
    const help = runCli(['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--verify-receipt/);
  });
});

describe('receipt verification (the FE-20 proof)', () => {
  test('a sealed ok receipt whose UI tree is in HEAD passes; edits, ok false, a stale tree or no file fail with exit 1', () => {
    const repo = gitRepoWithSite(path.join(FIXTURES, 'good'));
    cleanup.push(repo.root);
    const snapshot = { round: 1, sha: repo.sha, ui_tree: repo.appTree, gates: { ok: true, counts: { ok: 3, fail: 0, skipped: 0 }, failing: [] }, scores: { typography: 100 } };
    /** @type {Record<string, unknown>} */
    const receipt = {
      fragment: 'feCritique', version: 1, task: 'T042', ok: true, mode: 'full', rounds_max: 3, rounds_run: 1, stop_reason: 'no-issue-kept', error: null,
      baseline: snapshot, best: snapshot,
      rounds: [{ round: 1, critics_asked: 3, critics_returned: 3, issues: [], dropped: 0, candidate: null, pairwise: null, verdict: 'no-issue', reasons: [], restored: null }],
      probes: { pass: true, min_match: 4, of: 5, measured_on: 0, viewports: [{ viewport: 'desktop', matched: 5, total: 5, answers: [] }] },
      ui_copy: { ok: true, path: 'ui-copy.md' }, receipt_path: 'critique/receipt.json', checksum: '',
    };
    receipt.checksum = receiptChecksum(receipt);
    const file = path.join(repo.root, 'receipt.json');
    writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
    assert.deepEqual(verifyReceipt(file, { root: repo.root }), { ok: true, errors: [] });
    assert.deepEqual(verifyReceipt(file, { root: repo.root, uiRoot: 'app' }), { ok: true, errors: [] });
    let res = runCli(['--verify-receipt', file, '--root', repo.root, '--json']);
    assert.equal(res.status, 0, res.stderr);

    writeFileSync(file, JSON.stringify({ ...receipt, ok: false }));
    res = runCli(['--verify-receipt', file, '--root', repo.root, '--json']);
    assert.equal(res.status, 1);
    assert.ok(res.json.errors.some((/** @type {string} */ e) => /checksum/.test(e)) && res.json.errors.some((/** @type {string} */ e) => /ok is false/.test(e)));

    const resealed = { ...receipt, ok: false, checksum: '' };
    resealed.checksum = receiptChecksum(resealed);
    writeFileSync(file, JSON.stringify(resealed));
    assert.deepEqual(verifyReceipt(file, { root: repo.root }).errors, ['receipt ok is false (stop: no-issue-kept)'], 'a correctly sealed receipt that says not ok still fails');

    const invalid = { ...receipt, stop_reason: 'gave-up', checksum: '' };
    invalid.checksum = receiptChecksum(invalid);
    writeFileSync(file, JSON.stringify(invalid));
    assert.match(verifyReceipt(file, { root: repo.root }).errors.join(' '), /^schema: \$\.stop_reason: must be one of/);

    writeFileSync(file, JSON.stringify(receipt));
    writeFileSync(path.join(repo.root, 'app', 'src', 'index.html'), '<!doctype html><title>changed</title>\n');
    git(repo.root, ['commit', '-qam', 'change the UI']);
    assert.match(verifyReceipt(file, { root: repo.root }).errors.join(' '), /no longer a folder of HEAD/);
    assert.match(verifyReceipt(file, { root: repo.root, uiRoot: 'app' }).errors.join(' '), /is not HEAD:app/);

    res = runCli(['--verify-receipt', path.join(repo.root, 'missing.json'), '--root', repo.root, '--json']);
    assert.equal(res.status, 1);
    assert.match(res.json.errors[0], /receipt not found/);
  });
});
