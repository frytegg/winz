// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../../lib/errors.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import { aggregate } from '../../lib/report.mjs';
import {
  GATES, ROLE_BUDGETS, isMotion, missingUnderReduce, motionNotes, parseDuration, readManifest, resolveBudgets,
  revealedByScroll, run, selectGates,
} from '../../motion-check.mjs';

/** @typedef {import('../../motion-check.mjs').TextState} TextState */
/** @typedef {import('../../motion-check.mjs').AnimationRecord} AnimationRecord */

const CLI = fileURLToPath(new URL('../../motion-check.mjs', import.meta.url));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fe-motion-unit-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

/**
 * @param {string} key
 * @param {string | null} hidden
 * @param {Partial<TextState>} [over]
 * @returns {TextState}
 */
function text(key, hidden, over = {}) {
  return { key, sel: `p.${key.replace(/\W+/g, '-')}`, text: key, hidden, opacity: hidden ? 0 : 1, firstViewport: false, hero: null, metric: false, live: false, ...over };
}

/**
 * @param {Partial<AnimationRecord>} over
 * @returns {AnimationRecord}
 */
function record(over) {
  return {
    id: 1, phase: 'load', type: 'css-animation', name: 'x', sel: '.x', pseudo: null, properties: ['opacity'], frames: [{ opacity: '0' }, { opacity: '1' }],
    duration: 200, delay: 0, iterations: 1, easing: 'ease-out', role: 'ui', live: false, hero: false, fromHidden: true, manifest: [], transitionAll: false, ...over,
  };
}

describe('motion-check rules', () => {
  test('GATES are the three contract ids; selectGates takes the group and rejects unknown ids', () => {
    assert.deepEqual(GATES.map((g) => g.id), ['motion.reduced', 'motion.hidden-at-rest', 'motion.inventory']);
    assert.deepEqual(selectGates(['motion']), GATES.map((g) => g.id));
    assert.deepEqual(selectGates(['motion.inventory', 'motion.reduced']), ['motion.reduced', 'motion.inventory']);
    assert.throws(() => selectGates(['motion.speed']), UsageError);
  });

  test('isMotion: opacity and colours are not motion, geometry is; constant values never move', () => {
    assert.equal(isMotion('opacity', ['0', '1']), false);
    assert.equal(isMotion('background-color', ['red', 'blue']), false);
    assert.equal(isMotion('fill', ['red', 'blue']), false);
    assert.equal(isMotion('transform', ['none', 'translateY(24px)']), true);
    assert.equal(isMotion('transform', ['none', 'none']), false, 'an unchanged property does not move');
    assert.equal(isMotion('box-shadow', ['0 0 4px red', '0 0 4px blue']), false, 'a shadow that only changes colour');
    assert.equal(isMotion('box-shadow', ['0 0 4px red', '0 8px 24px red']), true);
    assert.equal(isMotion('--accent', ['#fff', '#000']), false, 'a colour custom property');
    assert.equal(isMotion('--offset', ['0px', '20px']), true);
  });

  test('parseDuration reads ms, s and bare numbers', () => {
    assert.equal(parseDuration('160ms'), 160);
    assert.equal(parseDuration('0.3s'), 300);
    assert.equal(parseDuration(250), 250);
    assert.equal(parseDuration('fast'), null);
  });

  test('resolveBudgets: research defaults, overridden only by an explicit per-role budget in the motion tokens', () => {
    const none = resolveBudgets(null);
    assert.deepEqual(none.budgets, { ...ROLE_BUDGETS });
    assert.equal(ROLE_BUDGETS.press, 160);
    assert.equal(ROLE_BUDGETS.modal, 300);
    const tokens = { motion: { tokens: [
      { name: 'duration-press', value: '120ms', usage: 'button press' },
      { name: 'duration-modal', value: '240ms', usage: 'dialogs', max_ms: 260 },
      { name: 'tooltip-in', value: '0.15s', usage: 'tooltips', role: 'tooltip', budget: [125, 180] },
    ] } };
    const r = resolveBudgets(tokens);
    assert.equal(r.budgets.press, 160, 'a token value never widens or narrows a budget by itself');
    assert.equal(r.budgets.modal, 260);
    assert.equal(r.budgets.tooltip, 180);
    assert.deepEqual(r.durations, [120, 240, 150]);
    assert.equal(r.overrides.length, 2);
    const wide = resolveBudgets({ motion: { tokens: [
      { name: 'duration-modal', value: '240ms', usage: 'dialogs', max_ms: 900 },
      { name: 'press', value: '120ms', usage: 'press', role: 'press', budget: [100, 400] },
    ] } });
    assert.equal(wide.budgets.modal, 300, 'a token never widens a role budget past MO-05');
    assert.equal(wide.budgets.press, 160);
    assert.equal(wide.overrides.length, 0);
  });

  test('motionNotes flags transition: all, ease-in entrances and scale(0) starts', () => {
    assert.deepEqual(motionNotes(record({})), []);
    assert.equal(motionNotes(record({ transitionAll: true, phase: 'hover' })).length, 1);
    assert.match(motionNotes(record({ easing: 'ease-in' })).join(), /ease-in on an entrance/);
    assert.match(motionNotes(record({ easing: 'cubic-bezier(0.4, 0, 1, 1)' })).join(), /ease-in/);
    assert.deepEqual(motionNotes(record({ easing: 'ease-in', phase: 'hover' })), [], 'ease-in on hover is not an entrance');
    assert.match(motionNotes(record({ frames: [{ transform: 'scale(0)' }, { transform: 'scale(1)' }] })).join(), /scale\(0\)/);
  });

  test('revealedByScroll: hidden before and visible after, or mounted on scroll; tickers and live regions ignored', () => {
    const before = [text('Hero', null), text('Proof', 'opacity 0'), text('42', 'opacity 0'), text('Feed', 'opacity 0', { live: true })];
    const after = [text('Hero', null), text('Proof', null), text('42', null), text('Feed', null, { live: true }), text('Late', null)];
    const found = revealedByScroll(before, after);
    assert.deepEqual(found.map((f) => f.after.key), ['Proof', 'Late']);
    assert.equal(found[0].before?.hidden, 'opacity 0');
    assert.equal(found[1].before, null);
    assert.deepEqual(revealedByScroll([text('A', null), text('A', null)], [text('A', null), text('A', null)]), [], 'duplicates are counted, not confused');
    assert.equal(revealedByScroll([text('A', null), text('A', 'opacity 0')], [text('A', null), text('A', null)]).length, 1);
  });

  test('missingUnderReduce: visible without the preference and missing under reduce', () => {
    const normal = [text('Hero', null), text('Disclosure', null), text('Feed', null, { live: true })];
    const reduced = [text('Hero', null), text('Disclosure', 'not displayed')];
    assert.deepEqual(missingUnderReduce(normal, reduced).map((t) => t.key), ['Disclosure']);
    assert.deepEqual(missingUnderReduce(normal, normal), []);
  });

  test('readManifest: absent is fine, malformed is a problem, triggers set roles', () => {
    assert.deepEqual(readManifest(path.join(tmp, 'none')), { entries: [], file: null, problem: null });
    const design = path.join(tmp, 'design');
    mkdirSync(design, { recursive: true });
    writeFileSync(path.join(design, 'motion.json'), JSON.stringify([{ selector: '.a', trigger: 'press' }, { selector: '.b', trigger: 'hover', purpose: 'Explanation' }]));
    const ok = readManifest(design);
    assert.equal(ok.problem, null);
    assert.deepEqual(ok.entries.map((e) => [e.role, e.purpose]), [['press', null], ['hover', 'explanation']]);
    writeFileSync(path.join(design, 'motion.json'), JSON.stringify({ animations: [{ trigger: 'load' }] }));
    assert.match(String(readManifest(design).problem), /needs a selector/);
    writeFileSync(path.join(design, 'motion.json'), '{');
    assert.match(String(readManifest(design).problem), /not valid JSON/);
  });
});

describe('motion-check without pages and CLI', () => {
  test('every gate is skipped without a base URL, and the report is not ok', async () => {
    const ctx = { root: tmp, profile: defaultProfile(), state: null, design: path.join(tmp, 'design'), routes: [], baseUrl: null, browser: null, viewports: [], args: {}, log: () => undefined };
    const results = await run(ctx);
    assert.deepEqual(results.map((r) => r.state), ['skipped', 'skipped', 'skipped']);
    assert.match(results[0].detail, /--serve/);
    assert.equal(aggregate(results).ok, false);
  });

  test('--help exits 0, an unknown gate exits 2, and no target exits 1 with every gate skipped', () => {
    const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Role budgets/);
    assert.equal(spawnSync(process.execPath, [CLI, '--root', tmp, '--gates', 'motion.speed'], { encoding: 'utf8' }).status, 2);
    const none = spawnSync(process.execPath, [CLI, '--root', tmp, '--state', path.join(tmp, 'state'), '--json'], { encoding: 'utf8' });
    assert.equal(none.status, 1, none.stderr);
    assert.deepEqual(JSON.parse(none.stdout).counts, { ok: 0, fail: 0, skipped: 3 });
  });

  test('with --out the checked repository is left untouched: no state folder is created (Q-F14)', () => {
    const repo = path.join(tmp, 'untouched');
    mkdirSync(repo, { recursive: true });
    const out = path.join(tmp, 'untouched-out');
    const r = spawnSync(process.execPath, [CLI, '--root', repo, '--out', out, '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stderr);
    assert.equal(existsSync(path.join(repo, '.frontend')), false, 'no .frontend folder in the checked root');
    assert.equal(existsSync(path.join(out, 'motion-check.json')), true, 'the report goes under --out');
  });
});
