// @ts-check
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { contrastRatio, parseColor, toOklch } from '../../lib/color.mjs';
import { buildModel, evaluatePairs, formatOklch, makePalette, maxChroma, meetTarget, oklchGamutDistance } from '../../tokens.mjs';
import { FIXTURES, cli } from './helpers.mjs';

/** @param {string} css */
const rgba = (css) => /** @type {import('../../lib/color.mjs').Rgba} */ (parseColor(css));
/** @param {string} theme @param {string} css */
const ground = (theme, css) => ({ theme, css, rgba: rgba(css) });

test('each candidate meets its target on its ground, in gamut, on the brand hue', async () => {
  const grounds = [ground('light', '#fafafa'), ground('dark', 'oklch(0.18 0.012 250)')];
  const result = await makePalette({ key: { l: 0.6, c: 0.14, h: 250 }, grounds, ratios: [3, 4.5, 7], name: 'brand', groundName: 'bg' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.tokens.map((t) => t.name), ['brand-3', 'brand-4-5', 'brand-7']);
  for (const t of result.tokens) {
    for (const g of grounds) {
      const css = t.value[g.theme];
      const target = Number(t.name.slice(6).replace('-', '.'));
      const ratio = /** @type {number} */ (contrastRatio(rgba(css), g.rgba));
      assert.ok(ratio >= target, `${t.name} ${g.theme} ${css}: ${ratio} >= ${target}`);
      assert.ok(ratio < target + 0.35, `${t.name} ${g.theme} stays near its target (${ratio})`);
      assert.ok(/** @type {number} */ (oklchGamutDistance(css)) < 0.002, `${css} in gamut`);
      const { h, c } = toOklch(rgba(css));
      if (c > 0.03) assert.ok(Math.abs(h - 250) < 6, `${css} keeps the hue (${h})`);
    }
    assert.match(t.usage, / on bg \(candidate from hue 250/);
  }
  assert.ok(result.checks.length === 6 && result.checks.every((c) => c.leonardo.startsWith('#')));
  assert.deepEqual(result.warnings, [], "Leonardo's own deprecation notice is dropped");
});

test('candidates pasted into a tokens file pass tokens.contrast with the right minimums', async () => {
  const data = JSON.parse(readFileSync(path.join(FIXTURES, 'good', 'design', 'tokens.json'), 'utf8'));
  const grounds = data.color.themes.map((/** @type {any} */ t) => ground(t.id, data.color.tokens[0].value[t.id]));
  const result = await makePalette({ key: { l: 0.55, c: 0.12, h: 30 }, grounds, ratios: [3, 4.5, 7], name: 'brand', groundName: 'bg' });
  data.color.tokens.push(...result.tokens);
  const { model, problems } = buildModel(data, { root: FIXTURES, design: FIXTURES, rel: 'design/tokens.json', sha: '0123456789abcdef' });
  assert.deepEqual(problems, []);
  const pairs = evaluatePairs(model).results.filter((r) => r.fg.startsWith('brand-'));
  assert.equal(pairs.length, 6);
  assert.ok(pairs.every((p) => p.ok && p.bg === 'bg'));
  assert.deepEqual([...new Set(pairs.map((p) => `${p.fg}:${p.kind}:${p.required}`))], ['brand-3:large:3', 'brand-4-5:text:4.5', 'brand-7:text:7']);
});

test('a value just below its target is moved along lightness until it meets it', () => {
  const groundRgba = rgba('#ffffff');
  const start = rgba('#777777');
  const before = /** @type {number} */ (contrastRatio(start, groundRgba));
  assert.ok(before < 4.5);
  const met = meetTarget(start, groundRgba, 4.5);
  assert.ok(met && met.ratio >= 4.5 && met.ratio < 4.6 && met.steps > 0);
  const already = meetTarget(rgba('#595959'), groundRgba, 4.5);
  assert.equal(already?.steps, 0);
});

test('a target out of reach on its ground is reported, not faked', async () => {
  const result = await makePalette({ key: { l: 0.6, c: 0.1, h: 140 }, grounds: [ground('light', '#808080')], ratios: [7], name: 'brand', groundName: 'bg' });
  assert.equal(result.ok, false);
  assert.equal(result.checks[0].ratio, null);
  assert.equal(result.checks[0].value, null);
  assert.match(result.tokens[0].usage, /unreachable in light/);
});

test('oklch values are formatted with bounded precision and kept in gamut', () => {
  assert.equal(formatOklch(0.51234, 0.123456, 250.126), 'oklch(0.5123 0.1235 250.13)');
  assert.equal(formatOklch(0.5, 0.00001, 300), 'oklch(0.5 0 0)');
  const c = maxChroma(0.48, 250);
  assert.ok(c > 0.12 && c < 0.15);
  assert.ok(/** @type {number} */ (oklchGamutDistance(formatOklch(0.48, c, 250))) < 0.0002);
});

test('CLI: palette from a hue and a ground prints tokens shaped for tokens.json', () => {
  const r = cli(['palette', '--hue', '250', '--ground', '#fafafa', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, true);
  assert.deepEqual(report.grounds, [{ theme: 'light', value: '#fafafa' }]);
  assert.deepEqual(report.tokens.map((/** @type {any} */ t) => Object.keys(t)), [['name', 'value', 'usage'], ['name', 'value', 'usage'], ['name', 'value', 'usage']]);
  assert.match(r.stderr, /palette: key oklch\(/);
});

test('CLI: palette reads the grounds of every theme from tokens.json', () => {
  const r = cli(['palette', '--brand', 'oklch(0.55 0.15 30)', '--root', path.join(FIXTURES, 'good'), '--ratios', '4.5', '--name', 'clay', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.deepEqual(report.grounds.map((/** @type {any} */ g) => g.theme), ['light', 'dark']);
  assert.deepEqual(Object.keys(report.tokens[0].value), ['light', 'dark']);
  assert.equal(report.tokens[0].name, 'clay-4-5');
});

test('CLI: an unreachable target exits 1 and bad input exits 2', () => {
  const unreachable = cli(['palette', '--hue', '140', '--ground', '#808080', '--ratios', '7']);
  assert.equal(unreachable.code, 1);
  assert.match(unreachable.stderr, /out of reach/);
  assert.equal(cli(['palette', '--ground', '#fff']).code, 2, 'neither --hue nor --brand');
  assert.equal(cli(['palette', '--hue', '400', '--ground', '#fff']).code, 2);
  assert.equal(cli(['palette', '--hue', '250', '--ground', 'oklch(1 0 0 / 0.5)']).code, 2, 'a translucent ground');
  assert.equal(cli(['palette', '--hue', '250', '--ground', '#fff', '--ratios', '1']).code, 2);
  assert.equal(cli(['palette', '--hue', '250', '--ground', 'light=#fff', '--ground', '#000']).code, 2);
});
