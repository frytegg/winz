// @ts-check
/*
 * SL-MO5: motion that ignores prefers-reduced-motion. Reduced motion means fewer and gentler animations, not zero:
 * keep opacity and colour, remove movement [FD03-F15]. WCAG 2.3.3's motion excludes colour and opacity but no longer
 * blurring, and axe has no rule for it, so this skill owns the check: the page is loaded twice in fresh contexts
 * (no-preference, reduce) and every moving animation of the first load that runs identically in the second is a
 * finding [FD03-F15] [FD06-F07]. Opacity-only or colour-only motion is the documented false positive and never counts.
 */
import { dedupe, describe, finding, motionLog } from './SL-MO2.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('./SL-MO2.mjs').Item} Item
 * @typedef {import('./SL-MO2.mjs').MotionRecord} MotionRecord
 */

export const RULE = 'SL-MO5';
export const MAX_FINDINGS = 20;

/** Keyframe keys (camelCase, as getKeyframes() names them) whose change moves, resizes or reshapes an element. */
const MOVEMENT = /^(?:transform|translate|scale|rotate|offset[A-Z]\w*|top|left|right|bottom|inset\w*|width|height|minWidth|minHeight|maxWidth|maxHeight|margin\w*|padding\w*|backgroundPosition\w*|objectPosition|clipPath|perspective)$/;

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const [base, reduced] = await Promise.all([motionLog(ctx, 'no-preference'), motionLog(ctx, 'reduce')]);
  const moving = base.records.filter((r) => movingProperties(r).length > 0);
  /** @type {Item[]} */
  const items = [];
  for (const r of moving) {
    if (!reduced.records.some((q) => sameMotion(r, q))) continue;
    items.push({
      selector: r.selector,
      box: r.box,
      kind: r.kind,
      name: r.name,
      properties: movingProperties(r),
      durationMs: Math.round(r.duration),
      iterations: r.iterations,
    });
  }
  const unique = dedupe(items);
  const totals = { moving: moving.length, reducedMotionRules: base.reducedMotionRules, unreadableSheets: base.unreadableSheets };
  return unique.slice(0, MAX_FINDINGS).map((item) => finding(RULE, ctx, { ...item, ...totals },
    `${describe(item)} moves (${(/** @type {string[]} */ (item.properties)).join(', ')}) unchanged under prefers-reduced-motion: reduce; keep opacity and colour, remove the movement`,
    unique.length));
}

/**
 * The movement properties a record actually changes (two frames differ), including a filter whose blur changes.
 * @param {MotionRecord} r
 * @returns {string[]}
 */
export function movingProperties(r) {
  /** @type {string[]} */
  const out = [];
  const keys = new Set(r.frames.flatMap((f) => Object.keys(f.values)));
  for (const key of keys) {
    const values = r.frames.map((f) => f.values[key]).filter((v) => v !== undefined);
    if (new Set(values).size < 2) continue;
    if (MOVEMENT.test(key) || (key === 'filter' && values.some((v) => /blur\(/.test(v)))) out.push(key);
  }
  return out;
}

/**
 * True when `q` (reduce run) is the same animation as `r` (no-preference run) with the same duration and the same
 * values for every property `r` moves.
 * @param {MotionRecord} r
 * @param {MotionRecord} q
 * @returns {boolean}
 */
export function sameMotion(r, q) {
  if (!r.selector || r.selector !== q.selector || r.kind !== q.kind || r.name !== q.name || r.pseudo !== q.pseudo) return false;
  if (!(q.duration > 0) || Math.abs(q.duration - r.duration) >= 1) return false;
  return movingProperties(r).every((key) => {
    const a = r.frames.map((f) => f.values[key]);
    const b = q.frames.map((f) => f.values[key]);
    return a.length === b.length && a.every((v, i) => v === b[i]);
  });
}
