// @ts-check
/*
 * SL-M04: a stat banner with unsourced numbers. Krebs's stat-banner pattern ("10K+ users · 99.9% uptime · 4.9★") is
 * 3 to 6 siblings with numeric text of 22 px or more, prices and ordinals excluded [FD10 M04] [FD10-F28]; Anthropic
 * calls the big number with a small label the default hero [FD15-F06]. The banner counts when at least one of its
 * figures carries neither data-ledger nor data-source; real, sourced metrics are the false positive.
 */
import { childLists, isSourced, statCarriers } from './SL-X01.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 */

export const RULE = 'SL-M04';
export const MAX_FINDINGS = 20;
export const MIN_ITEMS = 3;
export const MAX_ITEMS_IN_BANNER = 6;
/** A stat's item is at most this many levels below the banner. */
const MAX_HOPS = 4;
/** Items whose tops differ by at most this share one row. */
const ROW_TOLERANCE_PX = 16;

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  const banners = statBanners(elements);
  const flagged = banners
    .map((b) => ({ ...b, unsourced: b.stats.filter((s) => !isSourced(elements, s)) }))
    .filter((b) => b.unsourced.length > 0);
  return flagged.slice(0, MAX_FINDINGS).map((b) => {
    const figures = b.stats.map((s) => elements[s].text);
    const unsourced = b.unsourced.map((s) => elements[s].text);
    return {
      rule: RULE,
      layer: /** @type {const} */ ('runtime'),
      route: ctx.route?.path ?? '',
      viewport: ctx.viewport?.name ?? '',
      selector: elements[b.container].sel,
      box: elements[b.container].box,
      value: { figures, unsourced, total: flagged.length },
      detail: `stat banner of ${figures.length} figures (${figures.join(', ')}), ${unsourced.length} without data-ledger or data-source; show real, linked data or none`,
    };
  });
}

/**
 * Banners: containers with MIN_ITEMS to MAX_ITEMS_IN_BANNER child items holding exactly one stat each, the items laid
 * out side by side (at least two in one row).
 * @param {ElementInfo[]} elements
 * @returns {Array<{container: number, stats: number[]}>}
 */
export function statBanners(elements) {
  const stats = statCarriers(elements, childLists(elements));
  /** @type {Map<number, Map<number, number[]>>} */
  const byContainer = new Map();
  for (const s of stats) {
    let child = s;
    let parent = elements[s].parent;
    for (let hop = 0; hop < MAX_HOPS && parent >= 0; hop += 1) {
      let items = byContainer.get(parent);
      if (!items) byContainer.set(parent, (items = new Map()));
      items.set(child, [...(items.get(child) ?? []), s]);
      child = parent;
      parent = elements[parent].parent;
    }
  }
  /** @type {Array<{container: number, stats: number[]}>} */
  const out = [];
  for (const [container, items] of byContainer) {
    if (items.size < MIN_ITEMS || items.size > MAX_ITEMS_IN_BANNER) continue;
    if ([...items.values()].some((list) => list.length !== 1)) continue;
    const tops = [...items.keys()].map((i) => elements[i].box.y);
    const sharesRow = tops.some((y, k) => tops.some((z, m) => m !== k && Math.abs(y - z) <= ROW_TOLERANCE_PX));
    if (!sharesRow) continue;
    out.push({ container, stats: [...items.values()].map((list) => list[0]).sort((a, b) => a - b) });
  }
  return out;
}
