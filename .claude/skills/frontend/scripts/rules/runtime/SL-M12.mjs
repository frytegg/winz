// @ts-check
/*
 * SL-M12: the centred hero with the "Get started" plus "Learn more" pair: Krebs's center_aligned_hero fired on 22% of
 * Show HN pages [FD10-F11]; the stock CTA pair separates the generated corpora from the rest [FD14-F15] [FD10 M12].
 * Fires when the first-viewport h1 is centred and both CTAs sit in the hero just below it. A common human convention,
 * so it stays a candidate until calibrated.
 */
import { rendered } from './SL-M01.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 */

export const RULE = 'SL-M12';
export const PRIMARY = /^get started\b/i;
export const SECONDARY = /^learn more\b/i;
/** The CTAs sit within this distance below the h1's bottom edge. */
export const HERO_DEPTH_PX = 500;

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  const viewWidth = ctx.viewport?.width ?? 1440;
  const viewHeight = ctx.viewport?.height ?? 900;
  const h1 = elements.find((el) => el.tag === 'h1' && rendered(el) && el.box.y < viewHeight);
  if (!h1 || !isCentred(h1, viewWidth)) return [];
  const ctas = elements.filter((el) => rendered(el) && isAction(el) && el.box.y >= h1.box.y - 50 && el.box.y <= h1.box.y + h1.box.h + HERO_DEPTH_PX);
  const primary = ctas.find((el) => PRIMARY.test(label(el.text)));
  const secondary = ctas.find((el) => SECONDARY.test(label(el.text)));
  if (!primary || !secondary) return [];
  return [{
    rule: RULE,
    layer: 'runtime',
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector: h1.sel,
    box: h1.box,
    value: {
      count: 1,
      h1: h1.text.slice(0, 80),
      items: [primary, secondary].map((el) => ({ selector: el.sel, box: el.box, text: el.text })),
    },
    detail: `centred hero "${h1.text.slice(0, 60)}" with "${primary.text}" and "${secondary.text}"; let the hero show the protocol working`,
  }];
}

/**
 * Centred text, or a content-sized heading centred in the viewport.
 * @param {ElementInfo} el
 * @param {number} viewWidth
 * @returns {boolean}
 */
export function isCentred(el, viewWidth) {
  if (['center', '-webkit-center'].includes(el.styles.textAlign)) return true;
  const middle = el.box.x + el.box.w / 2;
  return el.box.w < 0.7 * viewWidth && Math.abs(middle - viewWidth / 2) <= 0.03 * viewWidth;
}

/**
 * @param {ElementInfo} el
 * @returns {boolean}
 */
function isAction(el) {
  return el.role === 'button' || el.role === 'link' || el.tag === 'button' || el.tag === 'a';
}

/**
 * Button text without trailing arrows or chevrons.
 * @param {string} text
 * @returns {string}
 */
function label(text) {
  return String(text ?? '').replace(/[\s→›»>↗➜⟶-]+$/u, '').trim();
}
