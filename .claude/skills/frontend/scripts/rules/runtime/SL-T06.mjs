// @ts-check
import { parseColor, toOklch } from '../../lib/color.mjs';
import { chainOf, gradientStops, laidOut } from './SL-T01.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').ElementInfo} ElementInfo
 * @typedef {import('../../lib/dom.mjs').Box} Box
 */

const RULE = 'SL-T06';

/** Krebs's glass rule (FD10-F22, R06): blur of 2 px or more, background alpha 0.02 to 0.9, card-sized. */
export const BLUR_MIN = 2;
export const ALPHA_RANGE = Object.freeze([0.02, 0.9]);
export const CARD_WIDTH = Object.freeze([150, 820]);
export const CARD_HEIGHT = Object.freeze([40, 900]);
/** Sticky or fixed bars this wide are frosted navigation, a legitimate use (critic C11: T6 means cards). */
export const BAR_WIDTH_SHARE = 0.9;
/** Media under at least this share of the panel makes it an overlay on media (FD14-F08's legibility panels). */
export const MEDIA_COVER = 0.5;
/** Malewicz's glass: "a subtle, light border" (FD10-F22): 0.5 to 1.5 px on at least three edges, OKLCH L 0.75+. */
export const LIGHT_BORDER = Object.freeze({ min: 0.5, max: 1.5, lightness: 0.75, edges: 3 });
/** A "vivid" ground: some gradient stop with at least this OKLCH chroma. */
export const VIVID_CHROMA = 0.1;
export const MAX_FINDINGS = 20;

const MEDIA_TAGS = new Set(['img', 'video', 'canvas', 'iframe', 'picture', 'object', 'embed']);

/**
 * @param {string} css
 * @returns {number} the largest blur() radius in a backdrop-filter value, 0 when none
 */
export function blurRadius(css) {
  let max = 0;
  for (const m of String(css ?? '').matchAll(/blur\(\s*([\d.]+)px\s*\)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/**
 * @param {Box} a
 * @param {Box} b
 * @returns {number} intersection area
 */
function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * @param {string} backgroundImage
 * @returns {boolean}
 */
function vividGradient(backgroundImage) {
  return gradientStops(backgroundImage).flat().some((c) => c.a >= 0.3 && toOklch(c).c >= VIVID_CHROMA);
}

/**
 * @param {ElementInfo} e
 * @returns {boolean}
 */
function lightBorder(e) {
  const sides = [
    [e.styles.borderTopWidth, e.styles.borderTopColor],
    [e.styles.borderRightWidth, e.styles.borderRightColor],
    [e.styles.borderBottomWidth, e.styles.borderBottomColor],
    [e.styles.borderLeftWidth, e.styles.borderLeftColor],
  ];
  const light = sides.filter(([w, c]) => {
    const width = Number.parseFloat(w) || 0;
    const color = parseColor(c);
    return width >= LIGHT_BORDER.min && width <= LIGHT_BORDER.max && color !== null && color.a > 0 && toOklch(color).l >= LIGHT_BORDER.lightness;
  });
  return light.length >= LIGHT_BORDER.edges;
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
 * Glass cards: card-sized panels with a backdrop blur and a translucent fill, never full-width sticky or fixed bars,
 * navigation or banners, or panels over media. The value records the two co-occurring signals FD10-F22 names, a
 * light 1 px border and a vivid gradient ground.
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  const rootImage = await ctx.page.evaluate(() => getComputedStyle(document.documentElement).backgroundImage);
  const view = ctx.viewport;
  /** @type {RuntimeFinding[]} */
  const out = [];
  elements.forEach((e, i) => {
    if (!laidOut(e)) return;
    const blur = blurRadius(e.styles.backdropFilter);
    if (blur < BLUR_MIN) return;
    const fill = parseColor(e.styles.backgroundColor);
    const alpha = fill ? fill.a : 0;
    if (alpha < ALPHA_RANGE[0] || alpha > ALPHA_RANGE[1]) return;
    if (e.box.w < CARD_WIDTH[0] || e.box.w > CARD_WIDTH[1] || e.box.h < CARD_HEIGHT[0] || e.box.h > CARD_HEIGHT[1]) return;
    const pinned = e.styles.position === 'sticky' || e.styles.position === 'fixed';
    if (pinned && e.box.w >= BAR_WIDTH_SHARE * view.width) return;
    const chain = [...chainOf(elements, i)].map((k) => elements[k]);
    if (chain.some((a) => ['header', 'nav'].includes(a.tag) || ['banner', 'navigation'].includes(a.role))) return;
    const area = e.box.w * e.box.h;
    const ancestors = chain.slice(1);
    const earlier = elements.slice(0, i).filter((m) => laidOut(m) && !ancestors.includes(m) && overlap(m.box, e.box) > 0);
    if (earlier.some((m) => MEDIA_TAGS.has(m.tag) && overlap(m.box, e.box) >= MEDIA_COVER * area)) return;
    const layers = earlier.filter((m) => overlap(m.box, e.box) > 0.25 * area &&
      (m.styles.position === 'absolute' || m.styles.position === 'fixed' || blurRadius(m.styles.filter) > 0));
    const groundLayers = [...ancestors, ...layers].map((a) => a.styles.backgroundImage ?? '');
    const gradientGround = vividGradient(rootImage) || groundLayers.some(vividGradient);
    const border = lightBorder(e);
    out.push(finding(ctx, e.sel, {
      blur, alpha: Math.round(alpha * 1000) / 1000, size: { w: e.box.w, h: e.box.h }, lightBorder: border, gradientGround,
      cooccurrence: Number(border) + Number(gradientGround),
    }, `glass card <${e.tag}> ${Math.round(e.box.w)}x${Math.round(e.box.h)}: blur ${blur}px over a ${Math.round(alpha * 100)}% fill${border ? ', light 1px border' : ''}${gradientGround ? ', vivid gradient ground' : ''}`));
  });
  return out.slice(0, MAX_FINDINGS);
}
