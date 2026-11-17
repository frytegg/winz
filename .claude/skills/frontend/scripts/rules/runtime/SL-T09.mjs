// @ts-check
import { parseColor } from '../../lib/color.mjs';
import { wordCount } from '../../lib/text.mjs';
import { chainOf, laidOut } from './SL-T01.mjs';
import { subtree } from './SL-T05.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 * @typedef {'pill' | 'boxed' | 'caps'} Shape
 */

const RULE = 'SL-T09';

/** Krebs's hero-eyebrow-pill geometry (FD10-F26, R09). */
export const ABOVE_PX = 220;
export const LABEL_WIDTH = Object.freeze([40, 600]);
export const LABEL_HEIGHT = Object.freeze([16, 56]);
export const LABEL_WORDS_MAX = 6;
export const FILL_ALPHA_MIN = 0.05;
export const BORDER_MIN = 1;
export const CAPS_TRACKING_MIN = 0.5;
export const CAPS_WIDTH_MAX = 320;
/** A full-width strip is a bar (a mobile header), never a label. */
export const BAR_SHARE = 0.9;
export const MAX_FINDINGS = 3;

/**
 * @param {string} css
 * @returns {number}
 */
function px(css) {
  const n = Number.parseFloat(css);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The smallest corner radius in px of a computed border-radius (percentages resolved against the shorter side).
 * @param {string} css
 * @param {number} w
 * @param {number} h
 * @returns {number}
 */
function cornerRadius(css, w, h) {
  const values = String(css ?? '').split('/')[0].trim().split(/\s+/).filter(Boolean);
  if (values.length === 0) return 0;
  return Math.min(...values.map((v) => (v.endsWith('%') ? (Number.parseFloat(v) / 100) * Math.min(w, h) : px(v))));
}

/**
 * Which label shape an element has, if any: a pill (radius at least half its height, filled or bordered), a boxed
 * label (filled or bordered), or tracked capitals no wider than 320 px.
 * @param {ElementInfo} e
 * @returns {Shape | null}
 */
export function labelShape(e) {
  const fill = parseColor(e.styles.backgroundColor);
  const filledBox = (fill !== null && fill.a >= FILL_ALPHA_MIN) || (e.styles.backgroundImage ?? 'none') !== 'none';
  const sides = /** @type {const} */ (['Top', 'Right', 'Bottom', 'Left']);
  const bordered = sides.some((s) => px(e.styles[`border${s}Width`]) >= BORDER_MIN && (parseColor(e.styles[`border${s}Color`])?.a ?? 0) > 0);
  if (filledBox || bordered) return cornerRadius(e.styles.borderRadius, e.box.w, e.box.h) >= e.box.h / 2 - 0.5 ? 'pill' : 'boxed';
  const letters = e.text.replace(/[^\p{L}]/gu, '');
  const capitals = e.styles.textTransform === 'uppercase' || (letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase());
  if (capitals && px(e.styles.letterSpacing) >= CAPS_TRACKING_MIN && e.box.w <= CAPS_WIDTH_MAX) return 'caps';
  return null;
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
 * A badge, boxed label or tracked-caps eyebrow within 220 px above the first h1: 40-600 x 16-56 px, six words or
 * fewer. Navigation, links and buttons are skipped, and so is a label that links to proof (an a[href] or data-proof
 * inside it): that is the fix FD10 T09 names.
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  const h1Index = elements.findIndex((e) => laidOut(e) && e.tag === 'h1');
  if (h1Index < 0) return [];
  const h1 = elements[h1Index];
  const h1Chain = chainOf(elements, h1Index);
  /** @type {Array<{e: ElementInfo, shape: Shape, gap: number}>} */
  const labels = [];
  let skipUntil = -1;
  for (let i = 0; i < elements.length; i += 1) {
    if (i < skipUntil) continue;
    const e = elements[i];
    if (!laidOut(e) || h1Chain.has(i) || e.text === '') continue;
    const bottom = e.box.y + e.box.h;
    const gap = h1.box.y - bottom;
    if (gap < -2 || gap > ABOVE_PX) continue;
    if (e.box.x + e.box.w <= h1.box.x || e.box.x >= h1.box.x + h1.box.w) continue;
    if (e.box.w < LABEL_WIDTH[0] || e.box.w > LABEL_WIDTH[1] || e.box.h < LABEL_HEIGHT[0] || e.box.h > LABEL_HEIGHT[1]) continue;
    if (e.box.w >= BAR_SHARE * ctx.viewport.width || wordCount(e.text) > LABEL_WORDS_MAX) continue;
    const chain = [...chainOf(elements, i)].map((k) => elements[k]);
    if (chain.some((a) => a.role === 'navigation' || a.tag === 'nav' || a.role === 'link' || a.role === 'button' || a.tag === 'a' || a.tag === 'button' ||
      a.styles.position === 'fixed' || a.styles.position === 'sticky')) continue;
    const [start, end] = subtree(elements, i);
    const inside = elements.slice(start, end);
    if ('data-proof' in e.attrs || inside.some((d) => ['link', 'button'].includes(d.role) || ['a', 'button', 'input', 'select'].includes(d.tag) || 'data-proof' in d.attrs)) continue;
    const shape = labelShape(e);
    if (!shape) continue;
    labels.push({ e, shape, gap });
    skipUntil = end;
  }
  labels.sort((a, b) => a.gap - b.gap);
  return labels.slice(0, MAX_FINDINGS).map(({ e, shape, gap }) => finding(ctx, e.sel, {
    shape, text: e.text.slice(0, 80), gap: Math.round(gap), size: { w: Math.round(e.box.w), h: Math.round(e.box.h) },
    status: e.attrs['data-status'] ?? null,
  }, `${shape} label "${e.text.slice(0, 40)}" ${Math.round(Math.max(0, gap))}px above the h1`));
}
