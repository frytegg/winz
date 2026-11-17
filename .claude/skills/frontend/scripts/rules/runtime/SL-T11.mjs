// @ts-check
import { parseColor, toOklch } from '../../lib/color.mjs';
import { laidOut } from './SL-T01.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/color.mjs').Rgba} Rgba
 */

const RULE = 'SL-T11';

/** The theme tokens shadcn's scaffold writes on :root (and .dark), read as the page computes them. */
export const TOKENS = Object.freeze(['--radius', '--primary', '--background', '--foreground', '--card', '--border', '--ring', '--secondary', '--muted', '--accent']);
/** shadcn v4's default radius (FD10-F07: DEFAULT_RADIUS_VALUE "0.625rem"). */
export const DEFAULT_RADIUS_PX = 10;
/**
 * shadcn's base colours are greys: neutral is chroma 0, stone and zinc about 0.006, gray and slate up to about 0.042
 * (FD14-F05: "authored tokens left in the chroma-0 neutral family"). A brand primary sits far above.
 */
export const GREY_CHROMA_MAX = 0.045;
/** The kit's fading hover (FD10-F08): hover:bg-primary/90 (new-york-v4), /80 or cn-button-variant-default (nova). */
export const DEFAULT_HOVER = /(?:^|\s)hover:bg-primary\/(?:80|90)(?:\s|$)|(?:^|\s)cn-button-variant-default(?:\s|$)/;

/**
 * A theme token's colour: a CSS colour, or the bare `H S% L%` triplet of the HSL-era scaffold.
 * @param {string} value
 * @returns {Rgba | null}
 */
export function tokenColor(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  return parseColor(v) ?? (/^[\d.]+(?:deg)?\s+[\d.]+%\s+[\d.]+%$/.test(v) ? parseColor(`hsl(${v})`) : null);
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function greyToken(value) {
  const c = tokenColor(value);
  return c !== null && toOklch(c).c <= GREY_CHROMA_MAX;
}

/**
 * The token's length in px (rem at 16 px), or null.
 * @param {string} value
 * @returns {number | null}
 */
export function tokenPx(value) {
  const m = /^([\d.]+)(px|rem)$/.exec(String(value ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * (m[2] === 'rem' ? 16 : 1);
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
 * Untouched shadcn: rendered components carry `data-slot` (the kit is present), the computed primary and background
 * tokens are still greys from the kit's value set, and either the radius is the 10 px default or buttons keep the
 * kit's fading hover classes. Presence alone is not the tell (FD14-F05: XRPL re-themed it).
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  const slotted = elements.filter((e) => laidOut(e) && typeof e.attrs['data-slot'] === 'string');
  if (slotted.length === 0) return [];
  const tokens = await ctx.page.evaluate((names) => {
    const cs = getComputedStyle(document.documentElement);
    /** @type {Record<string, string>} */
    const values = {};
    for (const n of names) values[n] = cs.getPropertyValue(n).trim();
    return { values, dark: document.documentElement.classList.contains('dark') };
  }, [...TOKENS]);
  const primaryGrey = greyToken(tokens.values['--primary']);
  const backgroundGrey = greyToken(tokens.values['--background']);
  if (!primaryGrey || !backgroundGrey) return [];
  const radius = tokenPx(tokens.values['--radius']);
  const radiusDefault = radius !== null && Math.abs(radius - DEFAULT_RADIUS_PX) < 0.01;
  const fadingHover = elements.filter((e) => laidOut(e) && DEFAULT_HOVER.test(e.meta.class ?? '')).length;
  if (!radiusDefault && fadingHover === 0) return [];
  const slots = [...new Set(slotted.map((e) => e.attrs['data-slot']))];
  const greyTokens = TOKENS.filter((t) => t !== '--radius' && greyToken(tokens.values[t]));
  return [finding(ctx, slotted[0].sel, {
    slots: slots.slice(0, 20), components: slotted.length, tokens: tokens.values, dark: tokens.dark,
    greyTokens, radiusDefault, fadingHover,
  }, `shadcn components (${slots.slice(0, 5).join(', ')}) on default grey tokens (${greyTokens.length}/${TOKENS.length - 1} grey)${radiusDefault ? ', default 10px radius' : ''}${fadingHover ? `, ${fadingHover} default fading hovers` : ''}`)];
}
