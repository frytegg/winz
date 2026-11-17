// @ts-check
import { composite, contrastRatio, parseColor, relativeLuminance } from '../../lib/color.mjs';
import { laidOutText } from './SL-T01.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').TextInfo} TextInfo
 * @typedef {import('../../lib/color.mjs').Rgba} Rgba
 */

const RULE = 'SL-T07';

/** Krebs's perma-dark rule (FD10-F24, R07): a body darker than luminance 0.2 ... */
export const DARK_LUMINANCE = 0.2;
/** ... where 12% or more of the body-text leaves sit below 7:1. */
export const RATIO_FLOOR = 7;
export const SHARE_TRIGGER = 0.12;
/** Body text: 12 to 20 px, weight below 600 (Krebs). */
export const BODY_SIZE = Object.freeze([12, 20]);
export const BODY_WEIGHT_MAX = 600;
/** Too few leaves make a share meaningless. */
export const MIN_LEAVES = 5;

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
 * The ground the page paints behind its content: the body's background over the root's over the canvas (dark when
 * the root's color-scheme resolves to dark).
 * @param {{body: string, root: string, darkCanvas: boolean}} grounds
 * @returns {{luminance: number, painted: boolean}}
 */
export function pageGround({ body, root, darkCanvas }) {
  const canvas = darkCanvas ? { r: 18 / 255, g: 18 / 255, b: 18 / 255, a: 1 } : { r: 1, g: 1, b: 1, a: 1 };
  const rootColor = parseColor(root) ?? { r: 0, g: 0, b: 0, a: 0 };
  const bodyColor = parseColor(body) ?? { r: 0, g: 0, b: 0, a: 0 };
  const ground = composite(bodyColor, composite(rootColor, canvas));
  return { luminance: relativeLuminance(ground), painted: rootColor.a > 0 || bodyColor.a > 0 };
}

/**
 * Low-contrast dark mode: on a dark page, the share of body-text leaves on dark grounds whose contrast falls below
 * 7:1. When neither the root nor the body paints a ground (the colour sits on a wrapper), the page counts as dark
 * when most body-text leaves sit on grounds darker than 0.2. Text in code blocks and text over a gradient or image
 * (whose contrast cannot be read from colours) are left out. Text held at opacity 0 by a reveal, or caught by a
 * running opacity animation, is judged at full opacity: the shared page is read at rest, often mid-entrance.
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const texts = await ctx.cache.text();
  const page = await ctx.page.evaluate((sels) => {
    const scheme = getComputedStyle(document.documentElement).colorScheme || '';
    const darkCanvas = /\bdark\b/.test(scheme) && (!/\blight\b/.test(scheme) || matchMedia('(prefers-color-scheme: dark)').matches);
    /** @type {Set<Element>} */
    const fading = new Set();
    for (const a of document.getAnimations()) {
      const effect = a.effect;
      if (a.playState !== 'running' || !(effect instanceof KeyframeEffect) || !effect.target) continue;
      const transition = typeof CSSTransition !== 'undefined' && a instanceof CSSTransition ? a.transitionProperty : '';
      if (transition === 'opacity' || effect.getKeyframes().some((k) => 'opacity' in k)) fading.add(effect.target);
    }
    const info = sels.map((s) => {
      const el = document.querySelector(s);
      if (!el) return { code: false, fading: false };
      let animated = false;
      for (let n = /** @type {Element | null} */ (el); n && !animated; n = n.parentElement) animated = fading.has(n);
      return { code: el.closest('code, pre, kbd, samp') !== null, fading: animated };
    });
    return {
      grounds: { body: getComputedStyle(document.body).backgroundColor, root: getComputedStyle(document.documentElement).backgroundColor, darkCanvas },
      info,
    };
  }, texts.map((t) => t.sel));
  /** @type {Array<{t: TextInfo, ratio: number, groundLuminance: number}>} */
  const leaves = [];
  texts.forEach((t, i) => {
    if (!laidOutText(t) || t.source !== 'text' || page.info[i].code || t.bgImage) return;
    if (t.fontSize < BODY_SIZE[0] || t.fontSize > BODY_SIZE[1] || t.fontWeight >= BODY_WEIGHT_MAX) return;
    if (!/\p{L}.*\p{L}/su.test(t.text)) return;
    const fg = parseColor(t.color);
    const bg = parseColor(t.bg);
    if (!fg || !bg) return;
    // Text a reveal holds at opacity 0, or an opacity animation is moving, is judged at full opacity, as it settles.
    const opacity = t.opacity < 0.01 || page.info[i].fading ? 1 : Math.min(1, t.opacity);
    /** @type {Rgba} */
    const shown = { ...fg, a: fg.a * opacity };
    const ratio = contrastRatio(shown, bg);
    if (ratio === null) return;
    leaves.push({ t, ratio, groundLuminance: relativeLuminance(bg) });
  });
  const ground = pageGround(page.grounds);
  const onDark = leaves.filter((l) => l.groundLuminance < DARK_LUMINANCE);
  const dark = ground.painted ? ground.luminance < DARK_LUMINANCE : leaves.length > 0 && onDark.length > leaves.length / 2;
  if (!dark || onDark.length < MIN_LEAVES) return [];
  const below = onDark.filter((l) => l.ratio < RATIO_FLOOR).sort((a, b) => a.ratio - b.ratio);
  const share = below.length / onDark.length;
  if (share < SHARE_TRIGGER) return [];
  const round = (/** @type {number} */ x) => Math.round(x * 100) / 100;
  return [finding(ctx, below[0].t.sel, {
    share: round(share), below: below.length, leaves: onDark.length, groundLuminance: Math.round(ground.luminance * 1000) / 1000,
    worst: below.slice(0, 5).map((l) => ({ selector: l.t.sel, ratio: round(l.ratio), color: l.t.color, ground: l.t.bg, text: l.t.text.slice(0, 60) })),
  }, `${Math.round(share * 100)}% of ${onDark.length} body-text leaves on the dark ground sit below 7:1 (worst ${round(below[0].ratio)}:1)`)];
}
