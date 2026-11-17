// @ts-check
/*
 * SL-M08: the near-black neutral ground of the starters: create-next-app's and shadcn's dark #0a0a0a (oklch(0.145 0
 * 0)), zinc-950, pure black, the tinted near-black #0B0B0B or #111 [FD10-F06] [FD10-F07] [FD15-F05]. Fires when the
 * first viewport's dominant ground has a relative luminance below 0.01 and no hue (OKLCH chroma below 0.03; slate-950
 * at 0.04 is a chosen hue, not the default). Dark-first products are the documented false positive.
 */
import { parseColor, relativeLuminance, toOklch } from '../../lib/color.mjs';
import { GROUND_SHARE, pageGround, textRendered } from './SL-M01.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').TextInfo} TextInfo
 */

export const RULE = 'SL-M08';
export const MAX_LUMINANCE = 0.01;
export const MAX_CHROMA = 0.03;

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const [ground, texts] = await Promise.all([pageGround(ctx.page), ctx.cache.text()]);
  if (!ground.hex || ground.share < GROUND_SHARE || !isNearBlackNeutral(ground.hex)) return [];
  const text = dominantTextColor(texts);
  return [{
    rule: RULE,
    layer: 'runtime',
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector: 'body',
    box: null,
    value: { count: 1, ground: ground.hex, groundShare: ground.share, luminance: relativeLuminance(ground.hex), text },
    detail: `neutral near-black ground ${ground.hex} on ${Math.round(ground.share * 100)}% of the first viewport (luminance ${relativeLuminance(ground.hex).toFixed(4)})${text ? `, body text mostly ${text.color}` : ''}; take the ground and neutrals from the brand research`,
  }];
}

/**
 * @param {string} css
 * @returns {boolean}
 */
export function isNearBlackNeutral(css) {
  const c = parseColor(css);
  if (!c || c.a < 0.99) return false;
  return relativeLuminance(c) < MAX_LUMINANCE && toOklch(c).c < MAX_CHROMA;
}

/**
 * The colour of most rendered text, weighted by characters, with its share.
 * @param {TextInfo[]} texts
 * @returns {{color: string, share: number} | null}
 */
export function dominantTextColor(texts) {
  /** @type {Map<string, number>} */
  const weights = new Map();
  let total = 0;
  for (const t of texts) {
    if (!textRendered(t)) continue;
    weights.set(t.color, (weights.get(t.color) ?? 0) + t.text.length);
    total += t.text.length;
  }
  const top = [...weights.entries()].sort((a, b) => b[1] - a[1])[0];
  return top && total > 0 ? { color: top[0], share: Math.round((top[1] / total) * 100) / 100 } : null;
}
