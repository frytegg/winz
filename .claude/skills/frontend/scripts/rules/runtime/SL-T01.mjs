// @ts-check
import { parseColor, toHex } from '../../lib/color.mjs';
import { selectorFor } from '../../lib/dom.mjs';

/*
 * SL-T01 runtime: purple-to-blue gradients on rendered elements and pseudo-elements (FD10 T01, R01).
 * This module also exports the helpers the other owner-tell detectors share (gradient stops, the laid-out tests,
 * ancestor chains), because rules/runtime/ may hold detector files only.
 */

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 * @typedef {import('../../lib/dom.mjs').Box} Box
 * @typedef {import('../../lib/color.mjs').Rgba} Rgba
 * @typedef {{h: number, s: number, l: number}} Hsl
 * @typedef {'purple' | 'blue' | 'ramp'} Band
 * @typedef {'cta' | 'hero' | 'text' | 'page' | 'other'} Prominence
 * @typedef {{sel: string, backgroundImage: string, box: Box, page: boolean}} PseudoLayer
 */

const RULE = 'SL-T01';

/** Krebs's isPurple (FD10-F23): HSL hue 250 to 300 degrees, both ends included. */
export const PURPLE_HUE = Object.freeze([250, 300]);
/** Blue and cyan, below the purple band (FD14-F07; indigo-500 sits near 239 degrees and counts as blue). */
export const BLUE_HUE = Object.freeze([180, 250]);
/** Green, yellow and orange stops make a multi-hue data ramp, not the purple-to-blue sweep (FD14-F07). */
export const RAMP_HUE = Object.freeze([30, 170]);
/** Krebs: saturation above 0.25, lightness between 0.15 and 0.85, alpha 0.3 or more. */
export const SATURATION_MIN = 0.25;
export const LIGHTNESS = Object.freeze([0.15, 0.85]);
export const ALPHA_MIN = 0.3;
export const MAX_FINDINGS = 20;

const GRADIENT_LAYER = /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;
const COLOR_FUNCTION = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
/** @type {Record<Prominence, number>} */
const RANK = { cta: 0, hero: 1, text: 2, page: 3, other: 4 };
/** @type {Record<Prominence, string>} */
const PLACE = { cta: 'a call to action', hero: 'the hero', text: 'text', page: 'the page ground', other: '' };

/**
 * Splits a CSS value at its top-level commas (commas inside functions do not split).
 * @param {string} css
 * @returns {string[]}
 */
export function topLevelParts(css) {
  /** @type {string[]} */
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i += 1) {
    const c = css[i];
    if (c === '(') depth += 1;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) {
      parts.push(css.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = css.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

/**
 * The colour a gradient argument starts with (`rgb(...) 40%`, `#fff 10%`, `transparent`), or null for geometry
 * arguments such as `to right`, `circle at 50% 50%` or a bare colour hint.
 * @param {string} argument
 * @returns {Rgba | null}
 */
function argumentColor(argument) {
  const arg = argument.trim();
  if (COLOR_FUNCTION.test(arg)) {
    let depth = 0;
    for (let i = arg.indexOf('('); i < arg.length; i += 1) {
      if (arg[i] === '(') depth += 1;
      else if (arg[i] === ')') {
        depth -= 1;
        if (depth === 0) return parseColor(arg.slice(0, i + 1));
      }
    }
    return null;
  }
  const word = arg.split(/\s+/)[0];
  return word ? parseColor(word) : null;
}

/**
 * The colour stops of every gradient layer of a computed `background-image`, parsed to sRGB. Layers that are not
 * gradients (`url()`, `none`) are skipped, and so are colours the parser does not know (`currentcolor` never
 * reaches a computed value).
 * @param {string} css
 * @returns {Rgba[][]} one array of stops per gradient layer
 */
export function gradientStops(css) {
  if (typeof css !== 'string' || !css.includes('gradient(')) return [];
  /** @type {Rgba[][]} */
  const layers = [];
  for (const layer of topLevelParts(css)) {
    if (!GRADIENT_LAYER.test(layer)) continue;
    const inner = layer.slice(layer.indexOf('(') + 1, layer.lastIndexOf(')'));
    /** @type {Rgba[]} */
    const stops = [];
    for (const argument of topLevelParts(inner)) {
      const color = argumentColor(argument);
      if (color) stops.push(color);
    }
    if (stops.length > 0) layers.push(stops);
  }
  return layers;
}

/**
 * HSL of a gamma-encoded sRGB colour: hue in degrees 0..360, saturation and lightness 0..1 (the model Krebs's
 * detector uses).
 * @param {{r: number, g: number, b: number}} c
 * @returns {Hsl}
 */
export function toHsl({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return { h: h < 0 ? h + 360 : h, s, l };
}

/**
 * Whether a stop is a saturated, visible colour of one hue band (Krebs's saturation, lightness and alpha floors).
 * The purple band includes both ends, as Krebs's `h >= 250 && h <= 300`; the others exclude their upper end.
 * @param {Rgba} c
 * @param {Band} band
 * @returns {boolean}
 */
export function inBand(c, band) {
  if (c.a < ALPHA_MIN) return false;
  const { h, s, l } = toHsl(c);
  if (!(s > SATURATION_MIN && l > LIGHTNESS[0] && l < LIGHTNESS[1])) return false;
  if (band === 'purple') return h >= PURPLE_HUE[0] && h <= PURPLE_HUE[1];
  const [lo, hi] = band === 'blue' ? BLUE_HUE : RAMP_HUE;
  return h >= lo && h < hi;
}

/**
 * The purple and blue stops of a background-image when it sweeps purple into blue or cyan, or null. A gradient that
 * also carries a green, yellow or orange stop is a data ramp and does not count.
 * @param {string} css
 * @returns {{purple: string[], blue: string[], stops: number} | null}
 */
export function purpleToBlue(css) {
  const stops = gradientStops(css).flat();
  const purple = stops.filter((c) => inBand(c, 'purple'));
  const blue = stops.filter((c) => inBand(c, 'blue'));
  if (purple.length === 0 || blue.length === 0) return null;
  if (stops.some((c) => inBand(c, 'ramp'))) return null;
  return { purple: purple.map(toHex), blue: blue.map(toHex), stops: stops.length };
}

/**
 * Whether an element is laid out on the page: it has a box and is not visibility:hidden. Opacity is ignored on
 * purpose: content a scroll reveal holds at opacity 0 is rendered content (the reader sees it once scrolled to), and
 * the shared page is read at rest.
 * @param {ElementInfo} e
 * @returns {boolean}
 */
export function laidOut(e) {
  return e.box.w >= 1 && e.box.h >= 1 && e.styles.visibility !== 'hidden' && e.styles.display !== 'none';
}

/**
 * The same test for a collectText entry: shown, or held at opacity 0 inside a laid-out box.
 * @param {import('../../lib/dom.mjs').TextInfo} t
 * @returns {boolean}
 */
export function laidOutText(t) {
  return t.visible || (t.opacity < 0.01 && t.box.w >= 1 && t.box.h >= 1);
}

/**
 * Index of the nearest collected ancestors of `index`, itself included (collectElements' parent links).
 * @param {ElementInfo[]} elements
 * @param {number} index
 * @returns {Set<number>}
 */
export function chainOf(elements, index) {
  /** @type {Set<number>} */
  const chain = new Set();
  for (let i = index; i >= 0 && i < elements.length; i = elements[i].parent) chain.add(i);
  return chain;
}

/**
 * Runs `fn(selectorFor, arg)` inside the page, read-only, with lib/dom.mjs's selector function in scope.
 * @template A, R
 * @param {import('playwright-core').Page} page
 * @param {(selectorOf: (el: Element) => string, arg: A) => R} fn
 * @param {A} arg
 * @returns {Promise<R>}
 */
function inPage(page, fn, arg) {
  return /** @type {Promise<R>} */ (page.evaluate(`(${fn.toString()})(${selectorFor.toString()}, ${JSON.stringify(arg) ?? 'undefined'})`));
}

/**
 * In-page: gradients collectElements cannot see, those of `::before` / `::after` and of the root element.
 * @param {(el: Element) => string} selectorOf
 * @param {{max: number}} arg
 * @returns {PseudoLayer[]}
 */
function pseudoGradients(selectorOf, arg) {
  /** @type {PseudoLayer[]} */
  const out = [];
  const root = document.documentElement;
  const rootImage = getComputedStyle(root).backgroundImage;
  if (rootImage && rootImage.includes('gradient(')) {
    out.push({ sel: 'html', backgroundImage: rootImage, box: { x: 0, y: 0, w: root.scrollWidth, h: root.scrollHeight }, page: true });
  }
  const skip = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'title', 'head', 'base']);
  for (const el of Array.from(document.querySelectorAll('body, body *'))) {
    if (out.length >= arg.max) break;
    if (skip.has(el.localName) || (el.localName !== 'svg' && el.closest('svg'))) continue;
    for (const which of ['::before', '::after']) {
      const cs = getComputedStyle(el, which);
      if (!cs.content || cs.content === 'none' || cs.content === 'normal' || cs.display === 'none') continue;
      if (!cs.backgroundImage.includes('gradient(') || Number(cs.opacity) === 0) continue;
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      out.push({
        sel: `${selectorOf(el)}${which}`,
        backgroundImage: cs.backgroundImage,
        box: { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height },
        page: el === document.body,
      });
    }
  }
  return out;
}

/**
 * @param {ElementInfo} e
 * @param {number} index
 * @param {Set<number>} heroChain the first h1 and its ancestors
 * @param {{width: number, height: number}} view
 * @returns {Prominence}
 */
function prominenceOf(e, index, heroChain, view) {
  if (index === 0) return 'page';
  if (e.tag === 'button' || e.role === 'button' || e.role === 'link') return 'cta';
  if (e.styles.backgroundClip === 'text' || e.styles.webkitBackgroundClip === 'text') return 'text';
  if (e.box.y < view.height && heroChain.has(index) && e.box.h <= 1.5 * view.height) return 'hero';
  if (e.box.y < view.height && e.box.w >= 0.5 * view.width && e.box.h >= 0.3 * view.height) return 'hero';
  return 'other';
}

/**
 * @param {RuntimeContext} ctx
 * @param {string} selector
 * @param {unknown} value
 * @param {string} detail
 * @returns {RuntimeFinding}
 */
function finding(ctx, selector, value, detail) {
  return { rule: RULE, layer: 'runtime', route: ctx.route?.path ?? '', viewport: ctx.viewport?.name ?? '', selector, value, detail };
}

/**
 * Purple-to-blue gradients on laid-out elements, `::before` / `::after` and the root, CTAs and heroes first. A
 * gradient inside an image or SVG file is never looked at here: the sponsor allowlist exempts such files by hash.
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  const pseudos = await inPage(ctx.page, pseudoGradients, { max: 2000 });
  const view = ctx.viewport;
  const h1 = elements.findIndex((e) => laidOut(e) && e.tag === 'h1');
  const heroChain = h1 >= 0 ? chainOf(elements, h1) : new Set();
  /** @type {Array<{rank: number, finding: RuntimeFinding}>} */
  const hits = [];
  elements.forEach((e, i) => {
    if (!laidOut(e)) return;
    const sweep = purpleToBlue(e.styles.backgroundImage ?? '');
    if (!sweep) return;
    const prominence = prominenceOf(e, i, heroChain, view);
    hits.push({
      rank: RANK[prominence],
      finding: finding(ctx, e.sel, { prominence, ...sweep, gradient: e.styles.backgroundImage.slice(0, 300) },
        `purple-to-blue gradient on ${prominence === 'page' ? PLACE.page : `${PLACE[prominence]} <${e.tag}>`.trim()} (purple ${sweep.purple.join(' ')}, blue ${sweep.blue.join(' ')})`),
    });
  });
  for (const p of pseudos) {
    const sweep = purpleToBlue(p.backgroundImage);
    if (!sweep) continue;
    const big = p.box.y < view.height && p.box.w >= 0.5 * view.width && p.box.h >= 0.3 * view.height;
    /** @type {Prominence} */
    const prominence = p.page ? 'page' : big ? 'hero' : 'other';
    hits.push({
      rank: RANK[prominence],
      finding: finding(ctx, p.sel, { prominence, ...sweep, gradient: p.backgroundImage.slice(0, 300) },
        `purple-to-blue gradient on ${p.sel} (purple ${sweep.purple.join(' ')}, blue ${sweep.blue.join(' ')})`),
    });
  }
  return hits.sort((a, b) => a.rank - b.rank).slice(0, MAX_FINDINGS).map((h) => h.finding);
}
