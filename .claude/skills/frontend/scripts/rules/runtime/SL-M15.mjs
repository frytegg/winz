// @ts-check
/*
 * SL-M15: nested cards: a bordered, shadowed or filled container inside another such container [FD10 M15]
 * [FD10-F28]. A card here is a rendered, padded, content-holding block narrower than the viewport (full-width bands
 * are sections, not cards) that sets itself apart with a border on all sides, a shadow, or a fill that differs from
 * what is behind it. Fires on MIN_NESTED or more cards inside cards. Dashboards with real grouping are the documented
 * false positive (category allowlist); impeccable's own nested-cards rule fired six times on linear.app (FD02).
 */
import { composite, parseColor, toOklch } from '../../lib/color.mjs';
import { rendered } from './SL-M01.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 * @typedef {import('../../lib/color.mjs').Rgba} Rgba
 */

export const RULE = 'SL-M15';
export const MAX_FINDINGS = 20;
export const MIN_NESTED = 2;
const MIN_W = 80;
const MIN_H = 48;
const MAX_WIDTH_SHARE = 0.9;
const MIN_PADDING_PX = 8;
const MIN_FILL_DISTANCE = 0.02;
const NOT_CARDS = new Set(['button', 'a', 'input', 'select', 'textarea', 'img', 'svg', 'video', 'canvas', 'iframe', 'pre', 'code', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'hr', 'html', 'body', 'main', 'header', 'footer', 'nav', 'dialog']);
const WHITE = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  const cards = cardFlags(elements, ctx.viewport?.width ?? 1440);
  /** @type {Array<{outer: number, inner: number}>} */
  const pairs = [];
  elements.forEach((el, i) => {
    if (!cards[i]) return;
    for (let k = el.parent; k >= 0; k = elements[k].parent) {
      if (cards[k]) {
        pairs.push({ outer: k, inner: i });
        break;
      }
    }
  });
  if (pairs.length < MIN_NESTED) return [];
  return pairs.slice(0, MAX_FINDINGS).map(({ outer, inner }) => ({
    rule: RULE,
    layer: /** @type {const} */ ('runtime'),
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector: elements[inner].sel,
    box: elements[inner].box,
    value: { inside: elements[outer].sel, total: pairs.length },
    detail: `card ${elements[inner].sel} nested inside card ${elements[outer].sel} (${pairs.length} nested on the page); flatten and separate with spacing`,
  }));
}

/**
 * Which collected elements are cards (see the module comment), with fills compared against the composited
 * background behind each element.
 * @param {ElementInfo[]} elements
 * @param {number} viewWidth
 * @returns {boolean[]}
 */
export function cardFlags(elements, viewWidth) {
  /** @type {Rgba[]} */
  const behind = [];
  elements.forEach((el, i) => {
    const below = el.parent >= 0 ? behind[el.parent] : WHITE;
    const own = parseColor(el.styles.backgroundColor);
    behind[i] = own && own.a > 0 ? composite(own, below) : below;
  });
  return elements.map((el, i) => {
    if (!rendered(el) || NOT_CARDS.has(el.tag)) return false;
    if (el.box.w < MIN_W || el.box.h < MIN_H || el.box.w > MAX_WIDTH_SHARE * viewWidth || el.text.length < 10) return false;
    const s = el.styles;
    if (Math.max(Number.parseFloat(s.paddingTop) || 0, Number.parseFloat(s.paddingLeft) || 0) < MIN_PADDING_PX) return false;
    const sides = [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].every((w) => Number.parseFloat(w) >= 1);
    const borderColor = parseColor(s.borderTopColor);
    if (sides && borderColor && borderColor.a >= 0.1) return true;
    if (s.boxShadow && s.boxShadow !== 'none') return true;
    const own = parseColor(s.backgroundColor);
    if (!own || own.a < 0.5) return false;
    const below = el.parent >= 0 ? behind[el.parent] : WHITE;
    return distance(behind[i], below) >= MIN_FILL_DISTANCE;
  });
}

/**
 * @param {Rgba} a
 * @param {Rgba} b
 * @returns {number}
 */
function distance(a, b) {
  const p = toOklch(a);
  const q = toOklch(b);
  const rad = Math.PI / 180;
  return Math.hypot(p.l - q.l, p.c * Math.cos(p.h * rad) - q.c * Math.cos(q.h * rad), p.c * Math.sin(p.h * rad) - q.c * Math.sin(q.h * rad));
}
