// @ts-check
/*
 * SL-M10: a logo or text marquee: a row of three or more items under an endless horizontal translation, or a
 * <marquee> element [FD10 M10]. impeccable: continuously auto-scrolling content "demands attention it has not earned
 * and hides half its content at any moment" [FD10-F28]; record mode freezes it [FD20], so a paused loop still counts as
 * the design. Real partner lists are the documented false positive.
 */
import { transformFunctions } from './SL-MO2.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').AnimationInfo} AnimationInfo
 */

export const RULE = 'SL-M10';
export const MAX_FINDINGS = 20;
export const MIN_ROW_ITEMS = 3;

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const [animations, elements] = await Promise.all([ctx.cache.animations(), ctx.cache.elements()]);
  /** @type {Map<string, number>} */
  const index = new Map(elements.map((el, i) => [el.sel, i]));
  /** @type {number[]} */
  const childCount = elements.map(() => 0);
  for (const el of elements) if (el.parent >= 0) childCount[el.parent] += 1;
  const items = [];
  for (const a of animations) {
    if (!a.sel || !isHorizontalLoop(a)) continue;
    const i = index.get(a.sel);
    if (i === undefined || childCount[i] < MIN_ROW_ITEMS) continue;
    items.push({ selector: a.sel, box: elements[i].box, name: a.name, durationMs: Math.round(a.duration), items: childCount[i], playState: a.playState });
  }
  elements.forEach((el, i) => {
    if (el.tag === 'marquee' && el.box.w >= 1) items.push({ selector: el.sel, box: el.box, name: '<marquee>', durationMs: null, items: childCount[i], playState: 'running' });
  });
  return items.slice(0, MAX_FINDINGS).map(({ selector, box, ...value }) => ({
    rule: RULE,
    layer: /** @type {const} */ ('runtime'),
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector,
    box,
    value: { ...value, total: items.length },
    detail: `marquee row of ${value.items} items (${String(value.name)}, ${value.playState}); show a static, linked list`,
  }));
}

/**
 * An endless animation whose first and last frames translate horizontally to different places, with no vertical
 * movement.
 * @param {AnimationInfo} a
 * @returns {boolean}
 */
export function isHorizontalLoop(a) {
  if (a.iterations !== 'infinite' || a.keyframes.length < 2) return false;
  const first = a.keyframes[0];
  const last = a.keyframes[a.keyframes.length - 1];
  for (const key of ['transform', 'translate']) {
    const from = first[key];
    const to = last[key];
    if (typeof from !== 'string' || typeof to !== 'string') continue;
    const p = translation(key, from);
    const q = translation(key, to);
    if (p && q && p.y === 0 && q.y === 0 && p.x !== q.x) return true;
  }
  return false;
}

/**
 * Horizontal component (as written, "-50%", "0px") and vertical component (px, 0 when absent) of a translation-only
 * value of `transform` or `translate`, or null when the value does something else.
 * @param {string} property
 * @param {string} value
 * @returns {{x: string, y: number} | null}
 */
export function translation(property, value) {
  const v = value.trim();
  const zero = (/** @type {string | undefined} */ t) => (t === undefined ? 0 : Number.parseFloat(t) || 0);
  const norm = (/** @type {string} */ t) => (Number.parseFloat(t) === 0 ? '0' : t.trim());
  if (v === 'none') return { x: '0', y: 0 };
  if (property === 'translate') {
    const [x, y] = v.split(/\s+/);
    return { x: norm(x), y: zero(y) };
  }
  let x = '0';
  let y = 0;
  for (const f of transformFunctions(v)) {
    if (f.name === 'translatex') x = norm(f.args[0]);
    else if (f.name === 'translate' || f.name === 'translate3d') {
      x = norm(f.args[0]);
      y += zero(f.args[1]);
    } else if (f.name === 'translatey') y += zero(f.args[0]);
    else if (f.name === 'matrix' && f.args.length === 6) {
      x = norm(`${f.args[4]}px`);
      y += zero(f.args[5]);
    } else return null;
  }
  return { x, y };
}
