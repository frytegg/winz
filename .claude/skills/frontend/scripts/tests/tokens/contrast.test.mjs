// @ts-check
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { buildModel, checkContrast, declaredGrounds, declaredPairs, evaluatePairs, pairKind } from '../../tokens.mjs';
import { FIXTURES, copyFixture, editJson } from './helpers.mjs';

const GOOD = path.join(FIXTURES, 'good');
/** @returns {any} */
const good = () => JSON.parse(readFileSync(path.join(GOOD, 'design', 'tokens.json'), 'utf8'));
/** @param {any} data */
const modelOf = (data) => {
  const { model, problems } = buildModel(data, { root: GOOD, design: path.join(GOOD, 'design'), rel: 'design/tokens.json', sha: '0123456789abcdef' });
  assert.deepEqual(problems, []);
  return model;
};

test('passing fixture: every declared pair of the good fixture meets its minimum', async () => {
  const result = await checkContrast({ root: GOOD });
  assert.equal(result.state, 'ok', result.detail);
  assert.match(result.detail, /22 pair checks over 2 theme/);
  const muted = result.evidence.find((e) => e.fg === 'text-muted' && e.bg === 'surface' && e.theme === 'light');
  assert.equal(muted?.required, 4.5);
  assert.equal(muted?.ok, true);
});

test('failing fixture: untouched shadcn defaults fail with the ratios FD16-F28 measured', async () => {
  const result = await checkContrast({ root: path.join(FIXTURES, 'contrast-fail') });
  assert.equal(result.state, 'fail');
  /** @param {string} fg @param {string} bg @param {string} theme */
  const find = (fg, bg, theme) => result.evidence.find((e) => e.fg === fg && e.bg === bg && e.theme === theme);
  assert.equal(find('muted-foreground', 'muted', 'light')?.ratio, 4.34);
  assert.equal(find('muted-foreground', 'muted', 'light')?.ok, false);
  assert.equal(find('input', 'background', 'light')?.ratio, 1.26);
  assert.equal(find('input', 'background', 'dark')?.ratio, 1.47, 'white at 15% composited on the dark ground');
  assert.equal(find('input', 'background', 'dark')?.required, 3);
  assert.equal(find('foreground', 'background', 'light')?.ok, true, 'foreground pairs with background by name');
  assert.equal(result.evidence.filter((e) => e.fg === 'muted-foreground').length, 2, 'usage and name name the same pair once');
  assert.match(result.detail, /below minimum/);
});

test('a theme without its own value inherits the base value', () => {
  const data = good();
  delete data.color.tokens[3].value.dark;
  const { results } = evaluatePairs(modelOf(data));
  const dark = results.find((r) => r.fg === 'text-muted' && r.bg === 'bg' && r.theme === 'dark');
  assert.ok(dark && dark.ratio !== null && dark.ratio > 2.5 && dark.ratio < 3, `the light muted grey on the dark ground (${dark?.ratio})`);
  assert.equal(dark?.ok, false);
});

test('an explicit ratio in a usage raises the minimum; a lower one never lowers it', () => {
  const data = good();
  data.color.tokens[3].usage = 'secondary text, 7:1 on bg';
  data.color.tokens[2].usage = 'body text, 3:1 on bg';
  const { results } = evaluatePairs(modelOf(data));
  assert.equal(results.find((r) => r.fg === 'text-muted' && r.theme === 'light')?.required, 7);
  assert.equal(results.find((r) => r.fg === 'text-muted' && r.theme === 'light')?.ok, false, '6.53:1 is below the declared 7:1');
  assert.equal(results.find((r) => r.fg === 'text' && r.theme === 'light')?.required, 4.5);
});

test('surfaces need a 1.1:1 step in dark themes only', () => {
  const data = good();
  data.color.tokens[1].value.dark = 'oklch(0.19 0.012 250)';
  const { results } = evaluatePairs(modelOf(data));
  const dark = results.find((r) => r.fg === 'surface' && r.theme === 'dark');
  const light = results.find((r) => r.fg === 'surface' && r.theme === 'light');
  assert.equal(dark?.required, 1.1);
  assert.equal(dark?.ok, false);
  assert.equal(light?.required, null);
  assert.equal(light?.ok, true);
});

test('a text colour that names no ground fails, and so does a misspelt ground', async () => {
  const copy = copyFixture('good');
  try {
    editJson(path.join(copy.dir, 'design', 'tokens.json'), (d) => {
      d.color.tokens[2].usage = 'body text';
      d.color.tokens[3].usage = 'secondary text on surface-2';
    });
    const result = await checkContrast({ root: copy.dir });
    assert.equal(result.state, 'fail');
    assert.ok(result.evidence.some((e) => /"text" is text but its usage names no ground/.test(String(e.value))));
    assert.ok(result.evidence.some((e) => /names "surface-2" as a ground/.test(String(e.value))));
  } finally {
    copy.cleanup();
  }
});

test('no declared pair at all fails rather than passing empty', async () => {
  const copy = copyFixture('good');
  try {
    editJson(path.join(copy.dir, 'design', 'tokens.json'), (d) => {
      for (const t of d.color.tokens) t.usage = 'a colour';
      d.color.tokens = d.color.tokens.filter((/** @type {any} */ t) => t.name !== 'on-primary');
    });
    const result = await checkContrast({ root: copy.dir });
    assert.equal(result.state, 'fail');
    assert.match(result.detail, /declares no text and ground pair/);
  } finally {
    copy.cleanup();
  }
});

test('grounds are read after on, over or against, joined by commas, and or slashes', () => {
  const names = new Set(['bg', 'surface', 'card', 'primary', 'surface-2']);
  assert.deepEqual(declaredGrounds('secondary text, 4.5:1 or more on bg and surface', names).grounds, ['bg', 'surface']);
  assert.deepEqual(declaredGrounds('focus ring on bg, surface or card', names).grounds, ['bg', 'surface', 'card']);
  assert.deepEqual(declaredGrounds('label over `primary`', names).grounds, ['primary']);
  assert.deepEqual(declaredGrounds('text on top of surface-2 / card', names).grounds, ['surface-2', 'card']);
  assert.deepEqual(declaredGrounds('shown on hover', names), { grounds: [], unknown: [], subject: 'shown on hover' });
  assert.deepEqual(declaredGrounds('text on surface-3', names).unknown, ['surface-3']);
  assert.equal(declaredGrounds('large headings on bg', names).subject.trim(), 'large headings');
});

test('the kind comes from the words before the ground, then from the name', () => {
  assert.deepEqual(pairKind('card surface ', 'surface'), { kind: 'surface', byKeyword: true });
  assert.deepEqual(pairKind('focus ring ', 'accent'), { kind: 'ui', byKeyword: true });
  assert.deepEqual(pairKind('input border and placeholder text ', 'x'), { kind: 'text', byKeyword: true });
  assert.deepEqual(pairKind('large headings ', 'x'), { kind: 'large', byKeyword: true });
  assert.deepEqual(pairKind('disabled label ', 'x'), { kind: 'decor', byKeyword: true });
  assert.deepEqual(pairKind('', 'on-primary'), { kind: 'text', byKeyword: true });
  assert.deepEqual(pairKind('', 'border-strong'), { kind: 'ui', byKeyword: true });
  assert.deepEqual(pairKind('brand accent ', 'accent'), { kind: 'text', byKeyword: false });
});

test('naming conventions declare pairs: on-<x>, <x>-foreground, foreground on background', () => {
  const data = good();
  data.color.tokens.push(
    { name: 'primary-foreground', value: { light: '#ffffff' }, usage: 'a label colour' },
    { name: 'background', value: { light: '#ffffff' }, usage: 'page' },
    { name: 'foreground', value: { light: '#111111' }, usage: 'default ink' },
  );
  const { pairs } = declaredPairs(modelOf(data));
  /** @param {string} fg */
  const of = (fg) => pairs.filter((p) => p.fg === fg).map((p) => [p.bg, p.source]);
  assert.deepEqual(of('on-primary'), [['primary', 'usage']]);
  assert.deepEqual(of('primary-foreground'), [['primary', 'name']]);
  assert.deepEqual(of('foreground'), [['background', 'name']]);
});

test('a translucent ground is composited on its own ground before measuring', () => {
  const data = good();
  data.color.tokens.push({ name: 'scrim', value: { light: 'oklch(0 0 0 / 0.5)', dark: 'oklch(0 0 0 / 0.5)' }, usage: 'overlay surface on bg' });
  data.color.tokens.push({ name: 'scrim-text', value: { light: '#ffffff', dark: '#ffffff' }, usage: 'text on scrim' });
  const { results } = evaluatePairs(modelOf(data));
  const light = results.find((r) => r.fg === 'scrim-text' && r.theme === 'light');
  assert.ok(light && light.ratio !== null && light.ratio > 4 && light.ratio < 5, `white on half-black over a near-white ground (${light?.ratio})`);
});
