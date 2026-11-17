// @ts-check
import { parseColor } from '../../lib/color.mjs';
import { laidOut } from './SL-T01.mjs';
import { emojiIn } from './SL-T03.mjs';
import { subtree } from './SL-T05.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 * @typedef {{icon: ElementInfo, wrapper: ElementInfo, heading: ElementInfo}} IconCard
 */

const RULE = 'SL-T08';

/** FD10 R08: 3 (or 6) equal-width siblings, widths within 12% ... */
export const COUNTS = Object.freeze([3, 6]);
export const WIDTH_SPREAD = 0.12;
/** ... each with an 8-48 px icon inside a filled 20-72 px wrapper, above a heading. */
export const ICON_SIZE = Object.freeze([8, 48]);
export const WRAPPER_SIZE = Object.freeze([20, 72]);
/** A fill a reader sees: background alpha of 5% or more, or a background image. */
export const FILL_ALPHA_MIN = 0.05;
/** A heading stand-in when the card has no h-element: bold short text. */
export const HEADING_STANDIN = Object.freeze({ weight: 600, words: 8 });
export const MAX_FINDINGS = 10;

/**
 * @param {number} v
 * @param {readonly number[]} range
 * @returns {boolean}
 */
function within(v, [lo, hi]) {
  return v >= lo && v <= hi;
}

/**
 * @param {ElementInfo} e
 * @returns {boolean}
 */
function filled(e) {
  const bg = parseColor(e.styles.backgroundColor);
  return (bg !== null && bg.a >= FILL_ALPHA_MIN) || (e.styles.backgroundImage ?? 'none') !== 'none';
}

/**
 * @param {ElementInfo} e
 * @returns {boolean}
 */
function iconLike(e) {
  if (!within(e.box.w, ICON_SIZE) || !within(e.box.h, ICON_SIZE)) return false;
  if (e.tag === 'svg' || e.tag === 'img') return true;
  if (e.tag === 'i') return e.text === '';
  return e.text !== '' && emojiIn(e.text).length === 1 && [...e.text.trim()].length <= 3;
}

/**
 * The icon, its filled wrapper and the heading below it inside one card, or null.
 * @param {ElementInfo[]} elements
 * @param {number} card
 * @returns {IconCard | null}
 */
export function iconCard(elements, card) {
  const [start, end] = subtree(elements, card);
  for (let i = start; i < end; i += 1) {
    const icon = elements[i];
    if (!laidOut(icon) || !iconLike(icon)) continue;
    let wrapper = within(icon.box.w, WRAPPER_SIZE) && within(icon.box.h, WRAPPER_SIZE) && filled(icon) ? icon : null;
    for (let k = icon.parent; !wrapper && k > card && k >= 0; k = elements[k].parent) {
      const w = elements[k];
      if (within(w.box.w, WRAPPER_SIZE) && within(w.box.h, WRAPPER_SIZE) && filled(w)) {
        wrapper = w;
        break;
      }
      if (w.box.w > WRAPPER_SIZE[1] || w.box.h > WRAPPER_SIZE[1]) break;
    }
    if (!wrapper) continue;
    const below = wrapper.box.y + wrapper.box.h - 2;
    for (let j = start; j < end; j += 1) {
      const h = elements[j];
      if (!laidOut(h) || h.box.y < below || h.text === '') continue;
      const isHeading = /^h[2-6]$/.test(h.tag) || h.role === 'heading' ||
        (Number(h.styles.fontWeight) >= HEADING_STANDIN.weight && h.text.split(/\s+/).length <= HEADING_STANDIN.words);
      if (isHeading) return { icon, wrapper, heading: h };
    }
  }
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
 * The icon-box row: a parent whose 3 or 6 laid-out children share one width (within 12%) and each hold an icon in a
 * small filled box above a heading. Stacked layouts count too (the template survives the mobile reflow); the value
 * says whether the cards sit in one row.
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  /** @type {Map<number, number[]>} */
  const children = new Map();
  elements.forEach((e, i) => {
    if (!laidOut(e) || e.parent < 0 || e.box.w < 1 || e.box.h < 1) return;
    const list = children.get(e.parent) ?? [];
    list.push(i);
    children.set(e.parent, list);
  });
  /** @type {RuntimeFinding[]} */
  const out = [];
  for (const [parent, kids] of children) {
    if (!COUNTS.includes(kids.length)) continue;
    const widths = kids.map((k) => elements[k].box.w);
    if (Math.min(...widths) <= 0 || Math.max(...widths) / Math.min(...widths) > 1 + WIDTH_SPREAD) continue;
    const cards = kids.map((k) => iconCard(elements, k));
    if (cards.some((c) => c === null)) continue;
    const found = /** @type {IconCard[]} */ (cards);
    const tops = kids.map((k) => elements[k].box.y);
    const row = Math.max(...tops) - Math.min(...tops) <= 8;
    out.push(finding(ctx, elements[parent].sel, {
      cards: kids.length,
      row,
      widths: widths.map(Math.round),
      icons: found.map((c) => `${c.icon.tag} ${Math.round(c.icon.box.w)}x${Math.round(c.icon.box.h)}`),
      wrappers: found.map((c) => `${Math.round(c.wrapper.box.w)}x${Math.round(c.wrapper.box.h)}`),
      headings: found.map((c) => c.heading.text.slice(0, 40)),
    }, `${kids.length} equal-width cards${row ? ' in a row' : ''}, each an icon in a filled ${Math.round(found[0].wrapper.box.w)}px box above a heading`));
    if (out.length >= MAX_FINDINGS) break;
  }
  return out;
}
