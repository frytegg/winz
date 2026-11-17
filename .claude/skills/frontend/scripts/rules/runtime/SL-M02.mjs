// @ts-check
/*
 * SL-M02: a tracked ALL-CAPS eyebrow above every heading, the template-chrome label Anthropic lists [FD15-F05]
 * [FD10-F04]. The case alone is not the tell: Krebs dropped all-caps headings because they "fired only on clean"
 * sites [FD10-F12], and the fix allows one eyebrow per three sections, so this counts repetition: short uppercase
 * labels with letter-spacing of 0.5 px or more sitting directly above h2 and h3 headings, against all of them.
 */
import { rendered } from './SL-M01.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 */

export const RULE = 'SL-M02';
export const MAX_ITEMS = 12;
export const MIN_TRACKING_PX = 0.5;
/** An eyebrow sits at most this far above its heading. */
export const MAX_GAP_PX = 32;
export const MIN_EYEBROWS = 3;
/** Share of h2/h3 headings carrying an eyebrow at which repetition becomes the tell ("above every heading"). */
export const MIN_SHARE = 0.5;
const MAX_WORDS = 6;
const MAX_CHARS = 48;

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  const headings = elements.map((_, i) => i).filter((i) => rendered(elements[i]) && (elements[i].tag === 'h2' || elements[i].tag === 'h3'));
  const labels = elements.map((_, i) => i).filter((i) => isEyebrow(elements, i));
  const pairs = [];
  for (const h of headings) {
    const label = labelAbove(elements, h, labels);
    if (label !== null) pairs.push({ h, label });
  }
  if (pairs.length < MIN_EYEBROWS || pairs.length / headings.length < MIN_SHARE) return [];
  const items = pairs.map(({ h, label }) => ({
    selector: elements[label].sel,
    box: elements[label].box,
    text: elements[label].text,
    letterSpacing: elements[label].styles.letterSpacing,
    heading: elements[h].text.slice(0, 80),
  }));
  return [{
    rule: RULE,
    layer: 'runtime',
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector: items[0].selector,
    box: items[0].box,
    value: { count: items.length, headings: headings.length, items: items.slice(0, MAX_ITEMS) },
    detail: `${items.length} of ${headings.length} h2/h3 headings carry a tracked uppercase label above them (e.g. "${items[0].text}"); keep at most one per three sections, or none`,
  }];
}

/**
 * A short, rendered, uppercase label with letter-spacing of MIN_TRACKING_PX or more, and the deepest element holding
 * that text.
 * @param {ElementInfo[]} elements
 * @param {number} i
 * @returns {boolean}
 */
export function isEyebrow(elements, i) {
  const el = elements[i];
  if (!rendered(el) || /^h[1-6]$/.test(el.tag)) return false;
  const text = el.text.trim();
  if (text.length === 0 || text.length > MAX_CHARS || text.split(/\s+/).length > MAX_WORDS) return false;
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2) return false;
  const upper = el.styles.textTransform === 'uppercase' || letters === letters.toUpperCase();
  if (!upper || trackingPx(el.styles.letterSpacing) < MIN_TRACKING_PX) return false;
  return !elements.some((other, k) => other.parent === i && other.text.trim() === text && rendered(elements[k]));
}

/**
 * Letter-spacing in px from its computed value ("normal" is 0).
 * @param {string | undefined} value
 * @returns {number}
 */
export function trackingPx(value) {
  const n = Number.parseFloat(value ?? '');
  return Number.isFinite(n) ? n : 0;
}

/**
 * The nearest label directly above a heading: ends above the heading's top, at most MAX_GAP_PX away, overlapping it
 * horizontally, smaller type, and neither inside nor around it.
 * @param {ElementInfo[]} elements
 * @param {number} h
 * @param {number[]} labels
 * @returns {number | null}
 */
export function labelAbove(elements, h, labels) {
  const head = elements[h];
  let best = null;
  let bestGap = Infinity;
  for (const l of labels) {
    const label = elements[l];
    const gap = head.box.y - (label.box.y + label.box.h);
    if (gap < -2 || gap > MAX_GAP_PX) continue;
    if (label.box.x >= head.box.x + head.box.w || label.box.x + label.box.w <= head.box.x) continue;
    if (!(Number.parseFloat(label.styles.fontSize) < Number.parseFloat(head.styles.fontSize))) continue;
    if (related(elements, h, l)) continue;
    if (gap < bestGap) {
      best = l;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * True when one element contains the other.
 * @param {ElementInfo[]} elements
 * @param {number} a
 * @param {number} b
 * @returns {boolean}
 */
function related(elements, a, b) {
  for (let k = elements[a].parent; k >= 0; k = elements[k].parent) if (k === b) return true;
  for (let k = elements[b].parent; k >= 0; k = elements[k].parent) if (k === a) return true;
  return false;
}
