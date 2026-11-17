// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACHROMATIC_CHROMA, NAMED_COLORS, composite, contrastRatio, hueOf, parseColor, relativeLuminance, toHex, toOklch,
} from '../../lib/color.mjs';

/**
 * @param {string} css
 * @param {[number, number, number, number]} expected 0..255 channels and 0..1 alpha
 * @param {number} [tolerance] in 0..255 units
 */
function assertRgba(css, [r, g, b, a], tolerance = 0.6) {
  const c = parseColor(css);
  assert.ok(c, `${css} parses`);
  const got = [c.r * 255, c.g * 255, c.b * 255];
  [r, g, b].forEach((want, i) => assert.ok(Math.abs(got[i] - want) <= tolerance, `${css} channel ${i}: ${got[i]} vs ${want}`));
  assert.ok(Math.abs(c.a - a) < 0.005, `${css} alpha ${c.a} vs ${a}`);
}

test('hex in all four lengths', () => {
  assertRgba('#fff', [255, 255, 255, 1]);
  assertRgba('#0008', [0, 0, 0, 0x88 / 255]);
  assertRgba('#7C3AED', [124, 58, 237, 1]);
  assertRgba('#7c3aed80', [124, 58, 237, 128 / 255]);
  assert.equal(parseColor('#12345'), null);
  assert.equal(parseColor('#ggg'), null);
});

test('rgb() and rgba(): legacy commas, modern spaces, percentages, none', () => {
  assertRgba('rgb(255, 0, 0)', [255, 0, 0, 1]);
  assertRgba('rgba(0,0,255,.5)', [0, 0, 255, 0.5]);
  assertRgba('rgb(255 0 0 / 50%)', [255, 0, 0, 0.5]);
  assertRgba('rgb(100% 50% 0%)', [255, 127.5, 0, 1]);
  assertRgba('RGB( 10 20 30 )', [10, 20, 30, 1]);
  assertRgba('rgb(none 0 0)', [0, 0, 0, 1]);
  assertRgba('rgb(300 -5 0 / 2)', [255, 0, 0, 1]);
  assert.equal(parseColor('rgb(1, 2)'), null);
  assert.equal(parseColor('rgb(1, 2, 3 / 0.5)'), null, 'commas and a slash do not mix');
  assert.equal(parseColor('rgb(1deg 2 3)'), null);
});

test('hsl(), hsla() and hwb()', () => {
  assertRgba('hsl(120deg 100% 50%)', [0, 255, 0, 1]);
  assertRgba('hsl(120, 100%, 25%)', [0, 127.5, 0, 1]);
  assertRgba('hsla(240, 100%, 50%, 0.25)', [0, 0, 255, 0.25]);
  assertRgba('hsl(0.5turn 100 50)', [0, 255, 255, 1]);
  assertRgba('hsl(-120 100% 50%)', [0, 0, 255, 1]);
  assertRgba('hwb(0 0% 0%)', [255, 0, 0, 1]);
  assertRgba('hwb(0 60% 60%)', [127.5, 127.5, 127.5, 1]);
});

test('oklch(), oklab(), lab(), lch() land on the sRGB primaries they describe', () => {
  assertRgba('oklch(0.62796 0.25768 29.234)', [255, 0, 0, 1], 1.5);
  assertRgba('oklch(62.796% 0.25768 29.234 / 0.5)', [255, 0, 0, 0.5], 1.5);
  assertRgba('oklab(0.62796 0.22486 0.12585)', [255, 0, 0, 1], 1.5);
  assertRgba('oklch(1 0 0)', [255, 255, 255, 1], 0.5);
  assertRgba('oklch(0 0 0)', [0, 0, 0, 1], 0.5);
  assertRgba('oklch(0.452 0.313214 264.052)', [0, 0, 255, 1], 1.5);
  assertRgba('lab(54.29 80.8 69.89)', [255, 0, 0, 1], 1.5);
  assertRgba('lch(54.29 106.84 40.85)', [255, 0, 0, 1], 1.5);
  assertRgba('lab(100 0 0)', [255, 255, 255, 1], 1);
  assertRgba('oklch(0.5 none 120)', [99, 99, 99, 1], 1.5);
});

test('color() predefined spaces; out-of-gamut colours are clipped per channel', () => {
  assertRgba('color(srgb 1 0 0)', [255, 0, 0, 1], 0);
  assertRgba('color(srgb 100% 50% 0% / 0.5)', [255, 127.5, 0, 0.5], 0);
  assertRgba('color(srgb-linear 0.2140 0.2140 0.2140)', [127.5, 127.5, 127.5, 1], 1);
  assertRgba('color(display-p3 1 1 1)', [255, 255, 255, 1], 0.5);
  assertRgba('color(display-p3 1 0 0)', [255, 0, 0, 1], 0.5);
  assertRgba('color(rec2020 1 1 1)', [255, 255, 255, 1], 0.5);
  assertRgba('color(a98-rgb 1 1 1)', [255, 255, 255, 1], 0.5);
  assertRgba('color(prophoto-rgb 1 1 1)', [255, 255, 255, 1], 0.5);
  assertRgba('color(xyz-d65 0.9505 1 1.089)', [255, 255, 255, 1], 1);
  assertRgba('color(xyz-d50 0.9642 1 0.8249)', [255, 255, 255, 1], 1);
  assert.equal(parseColor('color(unknown 1 0 0)'), null);
  assert.equal(parseColor('color(srgb 1, 0, 0)'), null);
});

test('named colours, transparent; unparseable values give null', () => {
  assert.equal(Object.keys(NAMED_COLORS).length, 148);
  assertRgba('rebeccapurple', [102, 51, 153, 1]);
  assertRgba('ReBeccaPurple', [102, 51, 153, 1]);
  assert.deepEqual(parseColor('transparent'), { r: 0, g: 0, b: 0, a: 0 });
  for (const value of ['currentcolor', 'var(--x)', 'color-mix(in srgb, red, blue)', 'rgb(from red r g b)',
    'rgb(calc(1) 2 3)', 'Canvas', '', 'not-a-colour', 'linear-gradient(red, blue)']) {
    assert.equal(parseColor(value), null, value);
  }
  assert.equal(parseColor(/** @type {string} */ (/** @type {unknown} */ (42))), null);
});

test('toOklch: white, black, and the hue of the primaries', () => {
  const white = toOklch({ r: 1, g: 1, b: 1 });
  assert.ok(Math.abs(white.l - 1) < 1e-6 && white.c < 1e-6 && white.h === 0);
  const black = toOklch({ r: 0, g: 0, b: 0 });
  assert.ok(Math.abs(black.l) < 1e-9 && black.c < 1e-9);
  const red = toOklch({ r: 1, g: 0, b: 0 });
  assert.ok(Math.abs(red.l - 0.628) < 0.001 && Math.abs(red.c - 0.2577) < 0.001 && Math.abs(red.h - 29.23) < 0.05);
  const blue = toOklch({ r: 0, g: 0, b: 1 });
  assert.ok(Math.abs(blue.h - 264.05) < 0.05);
});

test('relative luminance and WCAG contrast', () => {
  assert.equal(relativeLuminance({ r: 1, g: 1, b: 1 }), 1);
  assert.equal(relativeLuminance('#000'), 0);
  assert.throws(() => relativeLuminance('nope'), TypeError);
  assert.equal(contrastRatio('#000', '#fff'), 21);
  assert.equal(contrastRatio('#fff', '#000'), 21, 'order does not matter');
  const grey767676 = /** @type {number} */ (contrastRatio('#767676', '#fff'));
  assert.ok(grey767676 >= 4.5 && grey767676 < 4.55, `#767676 on white is ${grey767676}`);
  const grey777 = /** @type {number} */ (contrastRatio('#777', '#ffffff'));
  assert.ok(grey777 < 4.5 && grey777 > 4.47, `#777 on white is ${grey777} (fails AA, unrounded)`);
  assert.equal(contrastRatio('red', 'red'), 1);
  assert.equal(contrastRatio('nope', '#fff'), null);
});

test('contrast composites a translucent foreground over the background, and a translucent background over white', () => {
  const half = /** @type {number} */ (contrastRatio('rgba(0, 0, 0, 0.5)', '#fff'));
  const solid = /** @type {number} */ (contrastRatio('rgb(127.5, 127.5, 127.5)', '#fff'));
  assert.ok(Math.abs(half - solid) < 1e-9, 'half-black on white equals mid grey on white');
  assert.ok(half > 3.9 && half < 4.0);
  assert.equal(contrastRatio('#000', 'rgba(255, 255, 255, 0)'), 21, 'a transparent background shows white');
  assert.equal(contrastRatio('transparent', '#000'), 1, 'transparent text shows the background');
  const objectForm = contrastRatio({ r: 0, g: 0, b: 0, a: 1 }, { r: 1, g: 1, b: 1, a: 1 });
  assert.equal(objectForm, 21);
});

test('composite and toHex', () => {
  const c = composite({ r: 1, g: 0, b: 0, a: 0.5 }, { r: 0, g: 0, b: 1, a: 1 });
  assert.equal(toHex(c), '#800080');
  assert.deepEqual(composite({ r: 1, g: 1, b: 1, a: 0 }, { r: 0, g: 0, b: 0, a: 0 }), { r: 0, g: 0, b: 0, a: 0 });
  assert.equal(toHex({ r: 1, g: 0.5, b: 0, a: 1 }), '#ff8000');
  assert.equal(toHex({ r: 0, g: 0, b: 0, a: 0.5 }), '#00000080');
});

test('hueOf: degrees for chromatic colours, null for greys, transparent and garbage', () => {
  const purple = /** @type {number} */ (hueOf('#7c3aed'));
  assert.ok(purple > 285 && purple < 300, `violet hue ${purple}`);
  const blue = /** @type {number} */ (hueOf('#2563eb'));
  assert.ok(blue > 255 && blue < 270, `blue hue ${blue}`);
  assert.equal(hueOf('#888888'), null);
  assert.equal(hueOf('oklch(0.6 0.02 30)'), null, `chroma below ${ACHROMATIC_CHROMA} has no hue`);
  assert.notEqual(hueOf('oklch(0.6 0.05 30)'), null);
  assert.equal(hueOf('rgba(255, 0, 0, 0)'), null);
  assert.equal(hueOf('garbage'), null);
});
