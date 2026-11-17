// @ts-check
/*
 * SL-C01: pill buttons everywhere. Anthropic's Opus 5.5 example bans "pill-shaped buttons" with the rest of the house
 * style; the measurable signal is a button radius of at least half its height [FD15-F04] [FD15 Anthropic-named tells].
 * Buttons are button-role elements and links styled as buttons (a fill, a gradient or a border plus horizontal
 * padding); round icon buttons, whose radius is half their height by construction, are left out. Fires when most of
 * at least MIN_PILLS buttons are pills. A brand that uses pills deliberately is the documented false positive
 * (category allowlist).
 */
import { parseColor } from '../../lib/color.mjs';
import { rendered } from './SL-M01.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 */

export const RULE = 'SL-C01';
export const MIN_PILLS = 3;
/** "Most buttons". */
export const MIN_SHARE = 0.5;
const MIN_ASPECT = 1.4;
const BLOCKISH = new Set(['inline-block', 'block', 'flex', 'inline-flex', 'grid', 'inline-grid']);

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  const buttons = elements.filter(isButtonLike);
  const pills = buttons.filter(isPill);
  if (pills.length < MIN_PILLS || pills.length / buttons.length <= MIN_SHARE) return [];
  return [{
    rule: RULE,
    layer: 'runtime',
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector: pills[0].sel,
    box: pills[0].box,
    value: { count: pills.length, buttons: buttons.length, items: pills.slice(0, 12).map((p) => ({ selector: p.sel, box: p.box, text: p.text.slice(0, 40), radius: p.styles.borderRadius })) },
    detail: `${pills.length} of ${buttons.length} buttons are pills (radius at least half the height, e.g. "${pills[0].text.slice(0, 30)}" at ${pills[0].styles.borderRadius}); set radius by role from the tokens`,
  }];
}

/**
 * A rendered button-role element, or a link styled as a button; text-width, not a round icon button.
 * @param {ElementInfo} el
 * @returns {boolean}
 */
export function isButtonLike(el) {
  if (!rendered(el) || el.box.h < 16 || el.box.h > 80 || el.box.w / el.box.h < MIN_ASPECT) return false;
  if (el.role === 'button') return true;
  if (el.role !== 'link' || !BLOCKISH.has(el.styles.display)) return false;
  const fill = parseColor(el.styles.backgroundColor);
  const painted = (el.styles.backgroundImage ?? 'none') !== 'none';
  const bordered = Number.parseFloat(el.styles.borderTopWidth) >= 1;
  return ((fill !== null && fill.a >= 0.1) || painted || bordered) && Number.parseFloat(el.styles.paddingLeft) >= 8;
}

/**
 * True when the top-left radius is at least half the height (9999px, 50%, or a px value that large).
 * @param {ElementInfo} el
 * @returns {boolean}
 */
export function isPill(el) {
  const first = String(el.styles.borderRadius ?? '').trim().split(/[\s/]+/)[0] ?? '';
  const n = Number.parseFloat(first);
  if (!Number.isFinite(n)) return false;
  const radius = first.endsWith('%') ? (n / 100) * el.box.h : n;
  return radius >= el.box.h / 2 - 1;
}
