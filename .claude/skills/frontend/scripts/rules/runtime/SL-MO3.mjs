// @ts-check
/*
 * SL-MO3: UI durations of 500 ms or more. UI animations stay under 300 ms; press 100-160, tooltip 125-200, dropdown
 * 150-250, modal 200-300; only full-height sheets reach 500 ms [FD03-F07], and toasts near 400 ms are a documented
 * exception below the threshold [FD03-F23]. Loops are not response times and page-level motion is out of scope, so
 * both are skipped. Sources: the load-time motion log (entrances, reveals) and the computed transitions at rest
 * (hover and state changes).
 */
import { rendered } from './SL-M01.mjs';
import { dedupe, describe, finding, motionLog, transitionPairs } from './SL-MO2.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('./SL-MO2.mjs').Item} Item
 * @typedef {import('./SL-MO2.mjs').MotionRecord} MotionRecord
 */

export const RULE = 'SL-MO3';
export const MAX_FINDINGS = 20;
/** Registry scope: transitions and animations of 500 ms or more on UI elements. */
export const MIN_MS = 500;
/** A layer at least this share of the viewport height is a full-height sheet (500 ms allowed) or the page. */
export const FULL_HEIGHT = 0.9;
export const FULL_WIDTH = 0.95;

const PAGE_TAGS = new Set(['html', 'body', 'main']);

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const [log, elements] = await Promise.all([motionLog(ctx, 'no-preference'), ctx.cache.elements()]);
  const view = log.viewport ?? { w: ctx.viewport.width, h: ctx.viewport.height };
  /** @type {Item[]} */
  const items = [];
  for (const r of log.records) {
    if (r.iterations === 'infinite') continue;
    if (tooLong(r.duration, r.tag, r.layout, view)) {
      items.push({ selector: r.selector, box: r.box, kind: r.kind, name: r.name, durationMs: Math.round(r.duration), source: 'motion-log' });
    }
  }
  for (const el of elements) {
    if (!rendered(el)) continue;
    const longest = transitionPairs(el.styles.transitionProperty, el.styles.transitionDuration)
      .reduce((best, p) => (p.durationMs > best.durationMs ? p : best), { property: '', durationMs: 0, easing: '' });
    if (tooLong(longest.durationMs, el.tag, { w: el.box.w, h: el.box.h }, view)) {
      items.push({ selector: el.sel, box: el.box, kind: 'css-transition', name: longest.property, durationMs: Math.round(longest.durationMs), source: 'at-rest' });
    }
  }
  const unique = dedupe(items);
  return unique.slice(0, MAX_FINDINGS).map((item) => finding(RULE, ctx, item,
    `UI motion of ${MIN_MS} ms or more: ${describe(item)}; keep UI motion under 300 ms (press 160, tooltip 200, dropdown 250, modal 300)`,
    unique.length));
}

/**
 * True for a UI duration at or above MIN_MS: page-level layers are skipped, full-height sheets may take MIN_MS but
 * not more.
 * @param {number} durationMs
 * @param {string} tag
 * @param {{w: number, h: number}} layout
 * @param {{w: number, h: number}} view
 * @returns {boolean}
 */
export function tooLong(durationMs, tag, layout, view) {
  if (!(durationMs >= MIN_MS)) return false;
  if (PAGE_TAGS.has(tag)) return false;
  const fullHeight = view.h > 0 && layout.h >= FULL_HEIGHT * view.h;
  if (fullHeight && view.w > 0 && layout.w >= FULL_WIDTH * view.w) return false;
  if (fullHeight && durationMs <= MIN_MS) return false;
  return true;
}
