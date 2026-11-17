// @ts-check
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  TOKEN_NAME, buildModel, checkStructure, colorLiteralKind, isLength, loadModel, motionKind, oklchGamutDistance, parseStack,
} from '../../tokens.mjs';
import { FIXTURES } from './helpers.mjs';

const GOOD = path.join(FIXTURES, 'good');
/** @returns {any} */
const good = () => JSON.parse(readFileSync(path.join(GOOD, 'design', 'tokens.json'), 'utf8'));
/** @param {any} data */
const paths = (data) => checkStructure(data).map((p) => p.path);
/** @param {any} data */
const model = (data) => buildModel(data, { root: GOOD, design: path.join(GOOD, 'design'), rel: 'design/tokens.json', sha: '0123456789abcdef' });

test('the good fixture is structurally valid and builds a model, light first', () => {
  const { model: m, problems } = loadModel(GOOD, path.join(GOOD, 'design'));
  assert.deepEqual(problems, []);
  assert.ok(m);
  assert.equal(m.base, 'light');
  assert.deepEqual(m.themes.map((t) => [t.id, t.scheme]), [['light', 'light'], ['dark', 'dark']]);
  assert.equal(m.colors[0].cssVar, '--color-bg');
  assert.equal(m.lists.spacing[0].cssVar, '--spacing-1');
  assert.equal(m.lists.radius[0].cssVar, '--radius-sm');
  assert.equal(m.lists.shadow[0].cssVar, '--shadow-raised');
  assert.equal(m.lists.motion.find((t) => t.name === 'ease-out')?.cssVar, '--ease-out');
  assert.equal(m.lists.motion.find((t) => t.name === 'duration-press')?.cssVar, '--duration-press');
  assert.equal(m.groups.find((g) => g.name === 'data')?.data, true);
  assert.equal(m.groups.find((g) => g.name === 'body')?.data, false);
  assert.equal(m.fonts[1].role, 'mono');
});

test('a dark-first file still builds light on the base, and other themes inherit it', () => {
  const data = good();
  data.color.themes.reverse();
  delete data.color.tokens[4].value.dark;
  const { model: m, problems } = model(data);
  assert.deepEqual(problems, []);
  assert.equal(m.base, 'light');
  assert.equal(m.themes[0].id, 'light');
  assert.deepEqual(Object.keys(m.colors[4].values), ['light']);
});

test('the invalid fixture lists its structural problems with their JSON paths', () => {
  const data = JSON.parse(readFileSync(path.join(FIXTURES, 'invalid', 'design', 'tokens.json'), 'utf8'));
  const found = paths(data);
  for (const expected of [
    'meta', 'palette', 'version', 'color.themes[0].id', 'color.tokens[0].name', 'color.tokens[1].usage',
    'type.fonts[0].license', 'type.fonts[0].licenseFile', 'type.fonts[0].source', 'type.fonts[0].file',
    'type.families.body', 'type.families.mono', 'type.groups', 'spacing.tokens[0].value',
  ]) {
    assert.ok(found.includes(expected), `reports ${expected} (got ${found.join(', ')})`);
  }
});

test('an empty usage is a structural problem (the FE-07 negative control)', () => {
  const data = good();
  data.color.tokens[3].usage = '';
  assert.deepEqual(paths(data), ['color.tokens[3].usage']);
  data.color.tokens[3].usage = '  \t ';
  assert.deepEqual(paths(data), ['color.tokens[3].usage']);
});

test('names, duplicates, theme keys, base values and unsafe values are checked', () => {
  const cases = [
    [(/** @type {any} */ d) => { d.color.tokens[0].name = 'Bg'; }, 'color.tokens[0].name'],
    [(/** @type {any} */ d) => { d.color.tokens[1].name = 'bg'; }, 'color.tokens[1].name'],
    [(/** @type {any} */ d) => { d.color.tokens[0].value.night = '#000'; }, 'color.tokens[0].value.night'],
    [(/** @type {any} */ d) => { delete d.color.tokens[0].value.light; }, 'color.tokens[0].value'],
    [(/** @type {any} */ d) => { d.color.tokens[0].value.light = 'red; } body { color: red'; }, 'color.tokens[0].value.light'],
    [(/** @type {any} */ d) => { d.color.tokens[0].extra = 1; }, 'color.tokens[0].extra'],
    [(/** @type {any} */ d) => { d.type.groups[1].styles[0].name = 'display-l'; }, 'type.groups[1].styles[0].name'],
    [(/** @type {any} */ d) => { d.type.fonts[0].family = 'Fixture Sans, sans-serif'; }, 'type.fonts[0].family'],
    [(/** @type {any} */ d) => { d.type.fonts[0].file = '../outside.woff2'; }, 'type.fonts[0].file'],
    [(/** @type {any} */ d) => { d.type.fonts[0].weight = 1200; }, 'type.fonts[0].weight'],
    [(/** @type {any} */ d) => { d.type.fonts[0].style = 'slanted'; }, 'type.fonts[0].style'],
    [(/** @type {any} */ d) => { d.shadow.tokens[0].value.night = '0 0 1px #000'; }, 'shadow.tokens[0].value.night'],
    [(/** @type {any} */ d) => { delete d.shadow.tokens[0].value.light; }, 'shadow.tokens[0].value'],
    [(/** @type {any} */ d) => { d.meta.sources = 'PL-03'; }, 'meta.sources'],
    [(/** @type {any} */ d) => { d.version = 'v'; d.name = ''; }, 'name'],
  ];
  for (const [change, expected] of cases) {
    const data = good();
    /** @type {(d: any) => void} */ (change)(data);
    assert.ok(paths(data).includes(/** @type {string} */ (expected)), `reports ${expected} (got ${paths(data).join(', ')})`);
  }
});

test('buildModel blocks unreadable colours, groups without a role and colliding CSS variables', () => {
  let data = good();
  data.color.tokens[0].value.light = 'var(--bg)';
  assert.deepEqual(model(data).problems.map((p) => [p.rule, p.path]), [['TK-02', 'color.tokens[0].value.light']]);
  data = good();
  data.type.groups[0].family = 'Third Face';
  assert.deepEqual(model(data).problems.map((p) => [p.rule, p.path]), [['TK-12', 'type.groups[0].family']]);
  data = good();
  data.type.families.mono = null;
  assert.ok(model(data).problems.some((p) => p.path === 'type.groups[2].family' && /mono role/.test(p.message)));
  data = good();
  data.spacing.tokens.push({ name: 'spacing-1', value: '4px', usage: 'a second name for the first step' });
  assert.ok(model(data).problems.some((p) => /--spacing-1/.test(p.message)), 'two tokens on --spacing-1');
});

test('a group may name its family by role or by family name', () => {
  const data = good();
  data.type.groups[2].family = 'Fixture Mono';
  data.type.groups[1].family = 'Fixture Sans';
  const { model: m, problems } = model(data);
  assert.deepEqual(problems, []);
  assert.equal(m.groups[2].role, 'mono');
  assert.equal(m.groups[1].role, 'body');
});

test('font stacks split on commas outside quotes', () => {
  assert.deepEqual(parseStack('"IBM Plex Sans", Arial,  sans-serif'), ['IBM Plex Sans', 'Arial', 'sans-serif']);
  assert.deepEqual(parseStack("'Fancy, Inc' , serif"), ['Fancy, Inc', 'serif']);
  assert.deepEqual(parseStack('Charter'), ['Charter']);
});

test('motion values are durations, timing functions or transitions', () => {
  assert.equal(motionKind('160ms'), 'duration');
  assert.equal(motionKind('0.2s'), 'duration');
  assert.equal(motionKind('cubic-bezier(0.23, 1, 0.32, 1)'), 'easing');
  assert.equal(motionKind('ease-out'), 'easing');
  assert.equal(motionKind('steps(4, end)'), 'easing');
  assert.equal(motionKind('transform 160ms ease-out'), 'transition');
  assert.equal(motionKind('fast'), 'other');
});

test('colour literals: hex, rgb() and oklch() are accepted, references and names are not', () => {
  assert.equal(colorLiteralKind('#fff'), 'hex');
  assert.equal(colorLiteralKind('#11223344'), 'hex');
  assert.equal(colorLiteralKind('rgb(0 0 0 / 0.5)'), 'rgb');
  assert.equal(colorLiteralKind('oklch(0.5 0.1 250)'), 'oklch');
  assert.equal(colorLiteralKind('var(--x)'), 'reference');
  assert.equal(colorLiteralKind('color-mix(in oklch, red, blue)'), 'reference');
  assert.equal(colorLiteralKind('oklch(from red l c h)'), 'reference');
  assert.equal(colorLiteralKind('red'), 'named');
  assert.equal(colorLiteralKind('transparent'), 'named');
  assert.equal(colorLiteralKind('currentColor'), 'named');
  assert.equal(colorLiteralKind('hsl(0 0% 0%)'), 'other');
});

test('the gamut distance separates in-gamut oklch from what a screen clips', () => {
  assert.ok(/** @type {number} */ (oklchGamutDistance('oklch(0.6 0.02 250)')) < 1e-4);
  assert.ok(/** @type {number} */ (oklchGamutDistance('oklch(62.3% 0.214 259.815)')) > 0.002, "Tailwind blue-500 lies outside sRGB (FD16-F28)");
  assert.ok(/** @type {number} */ (oklchGamutDistance('oklch(0.48 0.15 250)')) > 0.002);
  assert.ok(/** @type {number} */ (oklchGamutDistance('oklch(1.2 0 0)')) > 0.002, 'lightness above 1');
  assert.equal(oklchGamutDistance('#fff'), null);
});

test('lengths accept dimensions, zero and CSS math, not words', () => {
  for (const v of ['4px', '0.25rem', '-0.01em', '50%', '0', 'clamp(1rem, 0.9rem + 0.5vw, 1.25rem)', 'calc(100% - 2px)']) assert.ok(isLength(v), v);
  for (const v of ['4', 'auto', 'clamp()', 'calc(1px', 'large']) assert.ok(!isLength(v), v);
  assert.ok(isLength('1.5', { unitless: true }));
});

test('token names follow CONTRACTS 6.2', () => {
  for (const ok of ['bg', 'text-muted', '1', 'a'.repeat(64)]) assert.ok(TOKEN_NAME.test(ok), ok);
  for (const bad of ['-bg', 'Bg', 'bg_x', 'a'.repeat(65), '']) assert.ok(!TOKEN_NAME.test(bad), bad);
});
