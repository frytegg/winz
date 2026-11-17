// @ts-check
/*
 * SL-M09: coloured glows, radial halos and blurred blobs. Krebs's colored-glow rule: blur of 15 px or more, HSL
 * saturation above 0.3, two or more elements [FD10 M09] [FD10-F11]; impeccable adds the radial halo and the radial
 * spotlight glow [FD10-F28]. Three shapes count: a blurred (filter) element painted in a saturated colour, an outset
 * box-shadow glow of a saturated colour, and a large, nearly textless element whose radial gradient fades a saturated
 * colour to transparent. Brand light effects in media products are the documented false positive.
 */
import { parseColor } from '../../lib/color.mjs';
import { rendered } from './SL-M01.mjs';
import { splitTopLevel } from './SL-MO2.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 * @typedef {import('../../lib/color.mjs').Rgba} Rgba
 */

export const RULE = 'SL-M09';
export const MAX_FINDINGS = 20;
export const MIN_BLUR_PX = 15;
export const MIN_SATURATION = 0.3;
export const MIN_ELEMENTS = 2;
const MIN_PAINT_ALPHA = 0.1;
const MIN_GLOW_ALPHA = 0.15;
const MIN_BLOB_PX = 60;
const MIN_HALO_PX = 150;
const COLOR_TOKEN = /(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\([^()]*\)|#[0-9a-f]{3,8}\b|\btransparent\b/gi;

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  const items = [];
  for (const el of elements) {
    if (!rendered(el)) continue;
    const kind = glowKind(el);
    if (kind) items.push({ selector: el.sel, box: el.box, kind: kind.kind, color: kind.color, blurPx: kind.blur });
  }
  if (items.length < MIN_ELEMENTS) return [];
  return items.slice(0, MAX_FINDINGS).map(({ selector, box, ...value }) => ({
    rule: RULE,
    layer: /** @type {const} */ ('runtime'),
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector,
    box,
    value: { ...value, total: items.length },
    detail: `${value.kind} in ${value.color}${value.blurPx ? ` blurred ${value.blurPx} px` : ''}, one of ${items.length} on the page; use neutral elevation and no decorative blobs`,
  }));
}

/**
 * The glow shape an element paints, or null.
 * @param {ElementInfo} el
 * @returns {{kind: 'blurred-blob' | 'glow' | 'radial-halo', color: string, blur: number} | null}
 */
export function glowKind(el) {
  const s = el.styles;
  const blur = blurPx(s.filter);
  if (blur >= MIN_BLUR_PX && el.box.w >= MIN_BLOB_PX && el.box.h >= MIN_BLOB_PX) {
    const paint = [s.backgroundColor, ...colorTokens(s.backgroundImage)].find((c) => saturated(c, MIN_PAINT_ALPHA));
    if (paint) return { kind: 'blurred-blob', color: paint, blur };
  }
  for (const layer of shadowLayers(s.boxShadow)) {
    if (!layer.inset && layer.blur >= MIN_BLUR_PX && saturated(layer.color, MIN_GLOW_ALPHA)) return { kind: 'glow', color: layer.color, blur: layer.blur };
  }
  if (el.box.w >= MIN_HALO_PX && el.box.h >= MIN_HALO_PX && el.text.length <= 40) {
    for (const layer of splitTopLevel(s.backgroundImage ?? '')) {
      if (!/^radial-gradient\(/i.test(layer)) continue;
      const stops = colorTokens(layer);
      const vivid = stops.find((c) => saturated(c, MIN_PAINT_ALPHA));
      const fades = stops.some((c) => (parseColor(c)?.a ?? 1) <= 0.05);
      if (vivid && fades) return { kind: 'radial-halo', color: vivid, blur: 0 };
    }
  }
  return null;
}

/**
 * HSL saturation (0..1) of a colour, the measure Krebs's rule uses.
 * @param {{r: number, g: number, b: number}} c
 * @returns {number}
 */
export function hslSaturation({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return (max - min) / (1 - Math.abs(2 * l - 1));
}

/**
 * @param {string} css
 * @param {number} minAlpha
 * @returns {boolean}
 */
function saturated(css, minAlpha) {
  const c = parseColor(css);
  return c !== null && c.a >= minAlpha && hslSaturation(c) > MIN_SATURATION;
}

/**
 * Largest blur() radius in px of a computed filter, 0 without one.
 * @param {string | undefined} filter
 * @returns {number}
 */
export function blurPx(filter) {
  let best = 0;
  for (const m of String(filter ?? '').matchAll(/blur\(\s*([\d.]+)px\s*\)/g)) best = Math.max(best, Number(m[1]));
  return best;
}

/**
 * @param {string | undefined} value
 * @returns {string[]}
 */
export function colorTokens(value) {
  return [...String(value ?? '').matchAll(COLOR_TOKEN)].map((m) => m[0]);
}

/**
 * Layers of a computed box-shadow: colour, blur radius and inset flag.
 * @param {string | undefined} value
 * @returns {Array<{color: string, blur: number, inset: boolean}>}
 */
export function shadowLayers(value) {
  if (!value || value === 'none') return [];
  return splitTopLevel(value).map((layer) => {
    const color = colorTokens(layer)[0] ?? 'transparent';
    const lengths = layer.replace(COLOR_TOKEN, ' ').match(/-?[\d.]+px/g) ?? [];
    return { color, blur: lengths[2] ? Number.parseFloat(lengths[2]) : 0, inset: /\binset\b/.test(layer) };
  });
}
