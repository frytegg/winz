// @ts-check
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  buildBoard, buildLogoBoard, GATES, pngSize, readPast, recordPast, renderDirection, run, screenDirection, TEMPLATE_GENERATOR,
} from '../../board.mjs';
import { launch } from '../../lib/browser.mjs';
import { defaultProfile } from '../../lib/profile.mjs';
import { formatErrors, SchemaRegistry } from '../assets/json-schema.mjs';
import { FIXTURES, GENERIC, REGISTRY, RULES, fixtureState, runCli, tempDir } from './helpers.mjs';

/** @typedef {import('playwright-core').Browser} Browser */

const SKILL = path.resolve(FIXTURES, '..', '..', '..', '..');
const profile = defaultProfile();

/** @type {Browser} */
let browser;
/** @type {string[]} */
const cleanup = [];
let past = '';

/**
 * @param {string} state
 * @param {string} id
 */
function screen(state, id) {
  return screenDirection({ browser, state, id, profile, root: state, generic: GENERIC, past, registry: REGISTRY, rulesDir: RULES });
}

describe('browser: board', () => {
  before(async () => {
    browser = await launch();
    const dir = tempDir('fe-board-past-');
    cleanup.push(dir);
    past = path.join(dir, 'past-directions.json');
    cpSync(path.join(FIXTURES, 'past-directions.json'), past);
  });

  after(async () => {
    await browser?.close();
    for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
  });

  test('render: a template comp from the tokens and a designer comp, both sizes, and masked board images', async () => {
    const state = await fixtureState();
    cleanup.push(state);
    const a = await renderDirection({ browser, state, id: 'A', profile, root: state });
    assert.equal(a.comp, 'template');
    const hero = readFileSync(path.join(state, 'directions', 'A', 'hero.html'), 'utf8');
    assert.match(hero, new RegExp(`content="${TEMPLATE_GENERATOR}"`));
    const b = await renderDirection({ browser, state, id: 'B', profile, root: state });
    assert.equal(b.comp, 'hero');
    for (const id of ['A', 'B']) {
      const dir = path.join(state, 'directions', id);
      assert.deepEqual(pngSize(path.join(dir, 'hero-desktop.png')), { width: 1440, height: 900 });
      assert.deepEqual(pngSize(path.join(dir, 'hero-mobile.png')), { width: 780, height: 1688 });
      assert.deepEqual(pngSize(path.join(dir, 'hero-desktop.board.png')), { width: 1440, height: 900 });
      assert.notDeepEqual(readFileSync(path.join(dir, 'hero-desktop.png')), readFileSync(path.join(dir, 'hero-desktop.board.png')), `${id}: the board image is masked`);
    }
    const masked = /** @type {Record<string, {replaced: number, remaining: string[]}>} */ (b.masked);
    assert.ok(masked.desktop.replaced >= 2, 'the customer and the sponsor are masked');
    assert.deepEqual(masked.desktop.remaining, []);
    assert.deepEqual(b.blocked, []);
    const record = JSON.parse(readFileSync(path.join(state, 'directions', 'B', 'render.json'), 'utf8'));
    assert.equal(record.inputs.tokens_sha256.length, 64);

    const forced = await renderDirection({ browser, state, id: 'B', profile, root: state, mode: 'template' });
    assert.match(String(forced.comp_file), /hero\.template\.html$/);
    assert.doesNotMatch(readFileSync(path.join(state, 'directions', 'B', 'hero.html'), 'utf8'), /board\.mjs template/, 'the designer\'s hero.html is untouched');
  });

  test('screen: the two sound directions are clean; the defective one fails on every check that applies', async () => {
    const state = await fixtureState(['C']);
    cleanup.push(state);
    for (const id of ['A', 'B', 'C']) await renderDirection({ browser, state, id, profile, root: state });
    const a = await screen(state, 'A');
    assert.deepEqual(a.findings.filter((f) => f.blocking), []);
    assert.equal(a.ok, true);
    assert.equal(a.fonts['desktop.display'], 'Fixture Grotesk', 'the planned font rendered');
    assert.ok(a.contrast.length > 0);
    const b = await screen(state, 'B');
    assert.equal(b.ok, true, JSON.stringify(b.findings));
    const c = await screen(state, 'C');
    assert.equal(c.ok, false);
    const checks = new Set(c.findings.filter((f) => f.blocking).map((f) => f.check));
    for (const check of ['tokens.contrast', 'render.network', 'render.viewport-meta', 'copy.hero', 'copy.placeholder', 'fonts.fallback', 'tells.tier1', 'tokens.palette', 'similar-prompt', 'past']) {
      assert.ok(checks.has(check), `${check} in ${[...checks].join(', ')}`);
    }
    const candidate = c.findings.find((f) => f.check === 'tells.candidate');
    assert.ok(candidate && !candidate.blocking && candidate.rule === 'SL-T02', 'a candidate tell is reported, never blocking');
    assert.equal(c.tells.score, 4, 'the anchor rule counts double');
    assert.deepEqual(c.near_duplicate_of, ['Old Hack/B']);
    assert.ok(c.identical_to_generic.some((i) => /#6d28d9/.test(i)));
    const network = c.findings.find((f) => f.check === 'render.network');
    assert.equal(network?.viewport, 'desktop, mobile', 'one finding per check, with the viewports it was seen at');
  });

  test('screen: a missing detector is an environment error; a detector that throws is a blocking finding', async () => {
    const state = await fixtureState();
    const rules = tempDir('fe-board-rules-');
    cleanup.push(state, rules);
    await renderDirection({ browser, state, id: 'B', profile, root: state });
    const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
    registry.rules = registry.rules.slice(0, 1);
    writeFileSync(path.join(rules, 'registry.json'), JSON.stringify(registry));
    await assert.rejects(
      screenDirection({ browser, state, id: 'B', profile, root: state, generic: GENERIC, past, registry: path.join(rules, 'registry.json'), rulesDir: rules }),
      (err) => err instanceof Error && Reflect.get(err, 'exitCode') === 3 && /SL-T01 are missing/.test(err.message),
    );
    const [gate] = await run({ root: state, profile, state, browser, args: { generic: GENERIC, past, registry: path.join(rules, 'registry.json'), rulesDir: rules } }, ['directions.screened']);
    assert.equal(gate.state, 'skipped', 'the gate reports the broken install as skipped, which never passes');
    assert.match(gate.detail, /cannot screen A: .*SL-T01 are missing/);
    mkdirSync(path.join(rules, 'runtime'));
    writeFileSync(path.join(rules, 'runtime', 'SL-T01.mjs'), 'export async function detect() {\n  throw new RangeError(\'boom\');\n}\n');
    const r = await screenDirection({ browser, state, id: 'B', profile, root: state, generic: GENERIC, past, registry: path.join(rules, 'registry.json'), rulesDir: rules });
    assert.equal(r.ok, false);
    const error = r.findings.find((f) => f.check === 'tells.error');
    assert.ok(error && error.blocking && /SL-T01: RangeError: boom/.test(error.detail));
    assert.equal(error.viewport, 'desktop, mobile');
  });

  test('screen: a comp edited after rendering is stale', async () => {
    const state = await fixtureState();
    cleanup.push(state);
    await renderDirection({ browser, state, id: 'B', profile, root: state });
    cpSync(path.join(FIXTURES, 'bad', 'C', 'hero.html'), path.join(state, 'directions', 'B', 'hero.html'));
    const r = await screen(state, 'B');
    assert.ok(r.findings.some((f) => f.check === 'render.stale' && f.blocking));
  });

  test('gates: directions.present and directions.screened pass, fail with a defective direction, and fail without a comp', async () => {
    const state = await fixtureState();
    cleanup.push(state);
    for (const id of ['A', 'B']) await renderDirection({ browser, state, id, profile, root: state });
    const ctx = { root: state, profile, state, browser, args: { generic: GENERIC, past, registry: REGISTRY, rulesDir: RULES } };
    const ok = await run(ctx, GATES.map((g) => g.id));
    assert.deepEqual(ok.map((g) => [g.id, g.state]), [['directions.present', 'ok'], ['directions.screened', 'ok']], JSON.stringify(ok));

    cpSync(path.join(FIXTURES, 'bad', 'C'), path.join(state, 'directions', 'C'), { recursive: true });
    await renderDirection({ browser, state, id: 'C', profile, root: state });
    const bad = await run(ctx, GATES.map((g) => g.id));
    assert.deepEqual(bad.map((g) => g.state), ['fail', 'fail']);
    assert.match(bad[0].detail, /C: anchored in the same source as A/);
    assert.match(bad[1].detail, /not screened clean: C/);
    assert.ok(bad[1].evidence.some((e) => e.route === 'C' && /tells\.tier1/.test(String(e.value))));

    rmSync(path.join(state, 'directions', 'C'), { recursive: true });
    rmSync(path.join(state, 'directions', 'B', 'hero-mobile.png'));
    const missing = await run(ctx, ['directions.present', 'directions.screened']);
    assert.equal(missing[0].state, 'fail');
    assert.match(missing[0].detail, /B: hero-mobile\.png is missing/);
    assert.equal(missing[1].state, 'fail', 'a direction whose comp image is gone is not screened');
  });

  test('board: board.json and the canvas skeleton of the screened directions, with masked titles and equal cases', async () => {
    const state = await fixtureState();
    cleanup.push(state);
    for (const id of ['A', 'B']) {
      await renderDirection({ browser, state, id, profile, root: state });
      const res = runCli(['screen', '--direction', id, '--state', state, '--root', state, '--generic', GENERIC, '--past', past, '--registry', REGISTRY, '--rules-dir', RULES, '--json']);
      assert.equal(res.status, 0, res.stderr);
    }
    const board = buildBoard({ state, profile, root: state });
    assert.equal(board.ok, true);
    assert.deepEqual(board.directions, ['A', 'B']);
    const artboards = /** @type {Array<Record<string, unknown>>} */ (board.artboards);
    assert.equal(artboards.length, 4);
    assert.ok(artboards.every((a) => String(a.png).endsWith('.board.png')), 'only masked images go on the board');
    const cases = /** @type {Array<Record<string, unknown>>} */ (board.cases);
    for (const c of cases) for (const key of ['name', 'anchor', 'tokens', 'signature', 'motivation', 'trade_off']) assert.ok(String(c[key]).length > 0, `${c.direction}.${key}`);
    const canvas = /** @type {{root: string, files: Record<string, string>, assets: Array<{placeholder: string, path: string}>}} */ (board.canvas);
    assert.deepEqual(Object.keys(canvas.files).sort(), ['project/A-mobile.dc.html', 'project/B-desktop.dc.html', 'project/B-mobile.dc.html', 'project/Main.dc.html', 'project/canvas.json']);
    for (const a of canvas.assets) {
      assert.ok(existsSync(a.path));
      const holder = Object.values(canvas.files).some((f) => readFileSync(f, 'utf8').includes(a.placeholder));
      assert.ok(holder, `${a.placeholder} is in an artboard`);
    }
    assert.doesNotMatch(JSON.stringify(board), /Northwind|Cardano/i, 'no company name on the board');

    rmSync(path.join(state, 'directions', 'B', 'screen.json'));
    const partial = buildBoard({ state, profile, root: state });
    assert.equal(partial.ok, false);
    assert.deepEqual(partial.directions, ['A']);
  });

  test('logos: one sheet per candidate and an overview, inside the image limits, with their canvas', async () => {
    const state = await fixtureState();
    cleanup.push(state);
    cpSync(path.join(FIXTURES, 'candidates'), path.join(state, 'brand', 'candidates'), { recursive: true });
    const board = await buildLogoBoard({ browser, state, profile });
    assert.deepEqual(board.candidates, ['1', '2']);
    const sheets = /** @type {Array<{n: string, path: string, width: number, height: number}>} */ (board.sheets);
    for (const s of sheets) {
      assert.equal(s.width, 1440);
      assert.ok(s.height > 600 && s.height <= 2576, `${s.n}: ${s.height}`);
      assert.deepEqual(pngSize(s.path), { width: s.width, height: s.height });
    }
    const overview = /** @type {{width: number, height: number}} */ (board.overview);
    assert.ok(overview.height < 900, 'the overview is cropped to its content');
    const canvas = JSON.parse(readFileSync(path.join(state, 'board', 'logos', 'canvas', 'project', 'canvas.json'), 'utf8'));
    assert.deepEqual(canvas.order, ['Main.dc.html', 'candidate-1.dc.html', 'candidate-2.dc.html']);
    assert.match(String(board.title), /^Queue Clock logo candidates H2$/);
  });

  test('CLI: render, screen and board print the shapes the directions fragment reads', async () => {
    const state = await fixtureState();
    cleanup.push(state);
    const registry = new SchemaRegistry();
    registry.add(JSON.parse(readFileSync(path.join(SKILL, 'assets', 'schemas', 'fragment-commands.schema.json'), 'utf8')));
    const base = ['--state', state, '--root', state, '--json'];
    for (const id of ['A', 'B']) {
      const r = runCli(['render', '--direction', id, ...base]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(formatErrors(registry.validate('urn:frontend:schema:fragment-commands:1#/$defs/render', r.json)), '');
      const s = runCli(['screen', '--direction', id, '--generic', GENERIC, '--past', past, '--registry', REGISTRY, '--rules-dir', RULES, ...base]);
      assert.equal(s.status, 0, s.stderr);
      assert.equal(formatErrors(registry.validate('urn:frontend:schema:fragment-commands:1#/$defs/screen', s.json)), '');
    }
    const b = runCli(['board', ...base]);
    assert.equal(b.status, 0, b.stderr);
    assert.equal(formatErrors(registry.validate('urn:frontend:schema:fragment-commands:1#/$defs/board', b.json)), '');
    const gates = runCli(['--gates', 'directions', '--generic', GENERIC, '--past', past, '--registry', REGISTRY, '--rules-dir', RULES, ...base]);
    assert.equal(gates.status, 0, gates.stderr);
    assert.deepEqual(gates.json.counts, { ok: 2, fail: 0, skipped: 0 });
    const all = runCli(['render', ...base]);
    assert.equal(all.status, 0, all.stderr);
    assert.deepEqual(all.json.directions.map((/** @type {any} */ d) => d.direction), ['A', 'B'], 'without --direction every direction is rendered');
  });

  test('record: after H1 the directions join the ledger, and a recorded direction is not its own near-duplicate', async () => {
    const state = await fixtureState();
    cleanup.push(state);
    const ledger = path.join(state, 'ledger.json');
    cpSync(past, ledger);
    for (const id of ['A', 'B']) await renderDirection({ browser, state, id, profile, root: state });
    const res = recordPast({ state, profile, root: state, pick: 'A', past: ledger });
    assert.deepEqual(res.added.map((e) => [e.direction, e.picked]), [['A', true], ['B', false]]);
    assert.equal(readPast(ledger).length, 4);
    const again = await screenDirection({ browser, state, id: 'A', profile, root: state, generic: GENERIC, past: ledger, registry: REGISTRY, rulesDir: RULES });
    assert.deepEqual(again.near_duplicate_of, []);
  });
});
