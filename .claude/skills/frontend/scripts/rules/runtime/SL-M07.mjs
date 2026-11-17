// @ts-check
/*
 * SL-M07: the SaaS-card kit: content chopped into identical rounded cards, "one border-radius on everything
 * regardless of hierarchy, the same soft grey shadow (rgba(0,0,0,.1)) under each" [FD15-F05] [FD10-F04]; Tailwind's
 * shadow scale is exactly that rgb(0 0 0 / 0.1) [FD10-F08]. Fires when one radius-and-shadow signature with a soft
 * dark shadow covers at least MIN_CARDS cards and most of the page's card-like containers. A real design system with
 * one radius is the documented false positive.
 */
import { parseColor } from '../../lib/color.mjs';
import { rendered } from './SL-M01.mjs';
import { splitTopLevel } from './SL-MO2.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 */

export const RULE = 'SL-M07';
export const MIN_CARDS = 6;
/** Share of the card-like containers the dominant kit signature must cover ("on everything"). */
export const MIN_SHARE = 0.7;
export const MIN_RADIUS_PX = 8;
const MIN_W = 120;
const MIN_H = 80;
const CONTROL_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'img', 'svg', 'video', 'canvas', 'iframe', 'html', 'body']);

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  const cardLike = elements.filter(isCardLike);
  /** @type {Map<string, ElementInfo[]>} */
  const kits = new Map();
  for (const el of cardLike) {
    if (!softShadow(el.styles.boxShadow)) continue;
    const key = `${el.styles.borderRadius}|${el.styles.boxShadow}`;
    kits.set(key, [...(kits.get(key) ?? []), el]);
  }
  const top = [...kits.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!top || top[1].length < MIN_CARDS || top[1].length / cardLike.length < MIN_SHARE) return [];
  const [signature, cards] = top;
  const [radius, shadow] = signature.split('|');
  return [{
    rule: RULE,
    layer: 'runtime',
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector: cards[0].sel,
    box: cards[0].box,
    value: {
      count: cards.length,
      cardLike: cardLike.length,
      radius,
      shadow,
      items: cards.slice(0, 12).map((c) => ({ selector: c.sel, box: c.box })),
    },
    detail: `${cards.length} of ${cardLike.length} card-like containers share radius ${radius} and shadow ${shadow}; set radius and shadow by hierarchy, and use fewer containers`,
  }];
}

/**
 * A rendered container the size of a card, with text, a radius of MIN_RADIUS_PX or more and a shadow, border or fill.
 * @param {ElementInfo} el
 * @returns {boolean}
 */
export function isCardLike(el) {
  if (!rendered(el) || CONTROL_TAGS.has(el.tag) || el.box.w < MIN_W || el.box.h < MIN_H || el.text.length < 10) return false;
  if (radiusPx(el.styles.borderRadius, el.box) < MIN_RADIUS_PX) return false;
  const fill = parseColor(el.styles.backgroundColor);
  const bordered = Number.parseFloat(el.styles.borderTopWidth) >= 1;
  const shadowed = Boolean(el.styles.boxShadow) && el.styles.boxShadow !== 'none';
  return shadowed || bordered || (fill !== null && fill.a >= 0.5);
}

/**
 * Top-left radius in px of a computed border-radius ("12px", "9999px", "50%", "8px 8px 0px 0px").
 * @param {string | undefined} value
 * @param {{w: number, h: number}} box
 * @returns {number}
 */
export function radiusPx(value, box) {
  const first = String(value ?? '').trim().split(/[\s/]+/)[0] ?? '';
  const n = Number.parseFloat(first);
  if (!Number.isFinite(n)) return 0;
  return first.endsWith('%') ? (n / 100) * Math.min(box.w, box.h) : n;
}

/**
 * A soft dark drop shadow: every layer outset, dark (no channel above 0.35) and at most 0.25 alpha, one of them in
 * the 0.04 to 0.16 alpha band of Tailwind's rgb(0 0 0 / 0.1).
 * @param {string | undefined} value
 * @returns {boolean}
 */
export function softShadow(value) {
  if (!value || value === 'none') return false;
  let soft = false;
  for (const layer of splitTopLevel(value)) {
    if (/\binset\b/.test(layer)) return false;
    const token = /(?:rgba?|oklch|oklab|lab|lch|hsla?|color)\([^()]*\)|#[0-9a-f]{3,8}\b/i.exec(layer);
    const c = token ? parseColor(token[0]) : null;
    if (!c) return false;
    if (Math.max(c.r, c.g, c.b) > 0.35 || c.a > 0.25) return false;
    if (c.a >= 0.04 && c.a <= 0.16) soft = true;
  }
  return soft;
}
