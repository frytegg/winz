// @ts-check
import { chainOf, laidOut } from './SL-T01.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 */

const RULE = 'SL-T10';

/** Decorative Lucide icons (not on an action) a page must render before "everywhere" can hold (provisional). */
export const DECORATIVE_MIN = 3;
/** ... and their ratio to the laid-out headings (FD10 R10, provisional until calibration). */
export const PER_HEADING_MIN = 0.5;
/** The icons FD10 S10 names as the generator's reflex set, in their Lucide class spelling. */
export const REFLEX_ICONS = Object.freeze(['sparkles', 'zap', 'shield', 'shield-check', 'check', 'check-circle', 'check-circle-2', 'circle-check', 'circle-check-big', 'arrow-right', 'bar-chart-3', 'chart-bar', 'chart-column', 'rocket']);

const ACTION_TAGS = new Set(['a', 'button', 'summary', 'label', 'select', 'input']);
const ACTION_ROLES = new Set(['link', 'button', 'menuitem', 'tab', 'option', 'switch', 'checkbox', 'radio']);

/**
 * The Lucide icon names in a class attribute (`lucide lucide-arrow-right` gives ['arrow-right']), or null when the
 * element is not a Lucide icon.
 * @param {string} classes
 * @returns {string[] | null}
 */
export function lucideNames(classes) {
  const tokens = String(classes ?? '').split(/\s+/);
  if (!tokens.includes('lucide')) return null;
  return tokens.filter((t) => t.startsWith('lucide-')).map((t) => t.slice('lucide-'.length)).filter((t) => t !== 'icon');
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
 * Rendered Lucide icons (svg.lucide) that decorate content rather than sit on an action, counted against the
 * headings they accompany.
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  /** @type {ElementInfo[]} */
  const decorative = [];
  let onActions = 0;
  /** @type {Map<string, number>} */
  const names = new Map();
  elements.forEach((e, i) => {
    if (!laidOut(e) || e.tag !== 'svg') return;
    const icon = lucideNames(e.meta.class ?? '');
    if (!icon) return;
    const onAction = [...chainOf(elements, i)].some((k) => k !== i && (ACTION_TAGS.has(elements[k].tag) || ACTION_ROLES.has(elements[k].role)));
    if (onAction) {
      onActions += 1;
      return;
    }
    decorative.push(e);
    for (const n of icon) names.set(n, (names.get(n) ?? 0) + 1);
  });
  const headings = elements.filter((e) => laidOut(e) && (/^h[1-6]$/.test(e.tag) || e.role === 'heading')).length;
  const perHeading = decorative.length / Math.max(1, headings);
  if (decorative.length < DECORATIVE_MIN || perHeading < PER_HEADING_MIN) return [];
  const used = [...names.entries()].sort((a, b) => b[1] - a[1]);
  const reflex = used.filter(([n]) => REFLEX_ICONS.includes(n)).map(([n]) => n);
  return [finding(ctx, decorative[0].sel, {
    decorative: decorative.length, onActions, headings, perHeading: Math.round(perHeading * 100) / 100,
    names: Object.fromEntries(used.slice(0, 12)), reflex,
  }, `${decorative.length} decorative Lucide icons for ${headings} headings (${onActions} more on actions)${reflex.length ? `; reflex set: ${reflex.join(', ')}` : ''}`)];
}
