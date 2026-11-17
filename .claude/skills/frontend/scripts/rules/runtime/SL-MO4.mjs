// @ts-check
/*
 * SL-MO4: entrances from scale(0). An element should never animate in from scale(0), it "came from nowhere"; start
 * at 0.9 or more with opacity [FD03-F10]. Two sources: finite animations and transitions in the load-time motion log
 * whose first frame has a zero scale, and elements resting at a zero scale with a transition on transform or scale,
 * which will grow from nothing when they open. Loops (loaders) are not entrances.
 */
import { selectorFor } from '../../lib/dom.mjs';
import { dedupe, describe, endpoints, finding, motionLog, scaleOf } from './SL-MO2.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('./SL-MO2.mjs').Item} Item
 * @typedef {import('./SL-MO2.mjs').MotionRecord} MotionRecord
 */

export const RULE = 'SL-MO4';
export const MAX_FINDINGS = 20;
/** Both scale factors at or below this count as scale(0): scale(0.01) also comes from nowhere. */
export const ZERO_SCALE = 0.1;

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const [log, resting] = await Promise.all([
    motionLog(ctx, 'no-preference'),
    /** @type {Promise<Array<{sel: string, box: import('../../lib/dom.mjs').Box, transform: string, scale: string}>>} */ (
      ctx.page.evaluate(`(${restingAtZero.toString()})(${selectorFor.toString()})`)
    ),
  ]);
  /** @type {Item[]} */
  const items = [];
  for (const r of log.records) {
    const from = entersFromZero(r);
    if (from) items.push({ selector: r.selector, box: r.box, kind: r.kind, name: r.name, from, durationMs: Math.round(r.duration), source: 'motion-log' });
  }
  for (const el of resting) {
    const value = isZeroScale(el.transform) ? el.transform : el.scale;
    items.push({ selector: el.sel, box: el.box, kind: 'css-transition', name: 'transform', from: value, durationMs: null, source: 'at-rest' });
  }
  const unique = dedupe(items);
  return unique.slice(0, MAX_FINDINGS).map((item) => finding(RULE, ctx, item,
    `entrance from ${String(item.from)}: ${describe(item)}; start at scale 0.9 or more with opacity`,
    unique.length));
}

/**
 * The zero-scale starting value of a finite record that later grows, or null.
 * @param {MotionRecord} r
 * @returns {string | null}
 */
export function entersFromZero(r) {
  if (r.iterations === 'infinite' || r.frames.length < 2) return null;
  const [from, to] = endpoints(r);
  for (const key of ['transform', 'scale']) {
    const start = from.values[key];
    const end = to.values[key];
    if (start === undefined || end === undefined) continue;
    if (isZeroScale(start) && !isZeroScale(end)) return start;
  }
  return null;
}

/**
 * True when a transform or `scale` value collapses both axes to ZERO_SCALE or less.
 * @param {string | undefined} value
 * @returns {boolean}
 */
export function isZeroScale(value) {
  if (value === undefined) return false;
  const s = scaleOf(value);
  return s !== null && Math.abs(s.sx) <= ZERO_SCALE && Math.abs(s.sy) <= ZERO_SCALE;
}

/**
 * In-page: elements resting at a zero scale (transform matrix or the `scale` property) that transition transform,
 * scale or all with a duration above zero. Receives the selectorFor of lib/dom.mjs.
 * @param {(el: Element, counts?: Map<string, number>) => string} selectorOf
 * @returns {Array<{sel: string, box: {x: number, y: number, w: number, h: number}, transform: string, scale: string}>}
 */
export const restingAtZero = function restingAtZero(selectorOf) {
  const counts = new Map();
  /** @param {string} t @returns {number} */
  const ms = (t) => {
    const m = /^\s*([\d.]+)(ms|s)\s*$/.exec(t);
    return m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : 0;
  };
  /** @param {string} transform @param {string} scale @returns {boolean} */
  const zero = (transform, scale) => {
    const m = /^matrix\(([^)]*)\)$/.exec(transform);
    if (m) {
      const n = m[1].split(',').map(Number);
      if (Math.hypot(n[0], n[1]) <= 0.1 && Math.hypot(n[2], n[3]) <= 0.1) return true;
    }
    const m3 = /^matrix3d\(([^)]*)\)$/.exec(transform);
    if (m3) {
      const n = m3[1].split(',').map(Number);
      if (Math.hypot(n[0], n[1], n[2]) <= 0.1 && Math.hypot(n[4], n[5], n[6]) <= 0.1) return true;
    }
    if (scale && scale !== 'none') {
      const parts = scale.split(/\s+/).map((p) => (p.endsWith('%') ? Number.parseFloat(p) / 100 : Number.parseFloat(p)));
      if (parts.every((p) => Number.isFinite(p) && Math.abs(p) <= 0.1)) return true;
    }
    return false;
  };
  /** @type {Array<{sel: string, box: {x: number, y: number, w: number, h: number}, transform: string, scale: string}>} */
  const out = [];
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    const props = cs.transitionProperty.split(',').map((p) => p.trim());
    const durs = cs.transitionDuration.split(',').map(ms);
    const moves = props.some((p, i) => ['transform', 'scale', 'all'].includes(p) && durs[i % durs.length] > 0);
    if (!moves || !zero(cs.transform, cs.scale)) continue;
    const r = el.getBoundingClientRect();
    const w = el instanceof HTMLElement ? el.offsetWidth : r.width;
    const h = el instanceof HTMLElement ? el.offsetHeight : r.height;
    out.push({
      sel: selectorOf(el, counts),
      box: { x: Math.round(r.left + window.scrollX - w / 2), y: Math.round(r.top + window.scrollY - h / 2), w: Math.round(w), h: Math.round(h) },
      transform: cs.transform,
      scale: cs.scale,
    });
    if (out.length >= 50) break;
  }
  return out;
};
