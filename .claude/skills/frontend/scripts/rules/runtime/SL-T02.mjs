// @ts-check
import { ACHROMATIC_CHROMA, parseColor, toHex, toOklch } from '../../lib/color.mjs';
import { chainOf, gradientStops, laidOut } from './SL-T01.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/color.mjs').Rgba} Rgba
 */

const RULE = 'SL-T02';

/** FD10 R02: the tell is strongest on display text, h1 or h2 of 32 px or more. */
export const DISPLAY_SIZE = 32;
/** Two stops a reader can tell apart: OKLab distance (about two just-noticeable differences) or alpha step. */
export const STOP_DISTANCE = 0.04;
export const ALPHA_STEP = 0.2;
/** FD11-F19: a sweep across hues, as opposed to Ethena's lightness gradient (all stops within 2 degrees). */
export const SWEEP_DEGREES = 30;
/** Text whose fill is this opaque or more hides the clipped gradient. */
export const FILL_ALPHA_MAX = 0.5;
export const MAX_FINDINGS = 20;

/**
 * OKLab coordinates of a colour.
 * @param {Rgba} c
 * @returns {[number, number, number]}
 */
function oklab(c) {
  const { l, c: chroma, h } = toOklch(c);
  const rad = (h * Math.PI) / 180;
  return [l, chroma * Math.cos(rad), chroma * Math.sin(rad)];
}

/**
 * Largest OKLab distance and alpha step between any two stops.
 * @param {Rgba[]} stops
 * @returns {{distance: number, alpha: number}}
 */
export function stopSpread(stops) {
  let distance = 0;
  let alpha = 0;
  for (let i = 0; i < stops.length; i += 1) {
    for (let j = i + 1; j < stops.length; j += 1) {
      const [a, b] = [oklab(stops[i]), oklab(stops[j])];
      distance = Math.max(distance, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      alpha = Math.max(alpha, Math.abs(stops[i].a - stops[j].a));
    }
  }
  return { distance, alpha };
}

/**
 * Widest hue difference, in degrees on the colour wheel, between two chromatic stops (0 when fewer than two stops
 * carry a hue).
 * @param {Rgba[]} stops
 * @returns {number}
 */
export function hueSpan(stops) {
  const hues = stops.filter((c) => c.a > 0 && toOklch(c).c >= ACHROMATIC_CHROMA).map((c) => toOklch(c).h);
  let span = 0;
  for (let i = 0; i < hues.length; i += 1) {
    for (let j = i + 1; j < hues.length; j += 1) {
      const d = Math.abs(hues[i] - hues[j]) % 360;
      span = Math.max(span, Math.min(d, 360 - d));
    }
  }
  return span;
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
 * Gradient text: a laid-out element with text, `background-clip: text` (or the -webkit- form), a gradient whose stops
 * differ visibly, and a fill transparent enough to show it. Every hit is reported; the value says whether it is
 * display text and whether the gradient sweeps across hues (FD11-F19) or only changes lightness.
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  const candidates = elements
    .map((e, index) => ({ e, index }))
    .filter(({ e }) => laidOut(e) && e.text !== '' &&
      (e.styles.backgroundClip === 'text' || e.styles.webkitBackgroundClip === 'text') &&
      (e.styles.backgroundImage ?? '').includes('gradient('));
  if (candidates.length === 0) return [];
  const fills = await ctx.page.evaluate((sels) => sels.map((s) => {
    const el = document.querySelector(s);
    return el ? getComputedStyle(el).getPropertyValue('-webkit-text-fill-color') : '';
  }), candidates.map(({ e }) => e.sel));
  /** @type {RuntimeFinding[]} */
  const out = [];
  candidates.forEach(({ e, index }, k) => {
    const color = parseColor(e.styles.color);
    const fill = parseColor(fills[k]);
    const paint = fill ?? color;
    if (paint && paint.a > FILL_ALPHA_MAX) return;
    const stops = gradientStops(e.styles.backgroundImage).flat();
    const spread = stopSpread(stops);
    if (spread.distance < STOP_DISTANCE && spread.alpha < ALPHA_STEP) return;
    const heading = [...chainOf(elements, index)].map((i) => elements[i]).find((a) => a.tag === 'h1' || a.tag === 'h2');
    const fontSize = Number.parseFloat(e.styles.fontSize) || 0;
    const display = fontSize >= DISPLAY_SIZE || heading !== undefined;
    const span = hueSpan(stops);
    const sweep = span >= SWEEP_DEGREES;
    out.push(finding(ctx, e.sel, {
      tag: e.tag, heading: heading?.tag ?? null, fontSize, display, sweep, hueSpan: Math.round(span), stops: stops.map(toHex),
    }, `gradient text on <${e.tag}> at ${fontSize}px${display ? ' (display text)' : ''}; ${sweep ? `sweeps ${Math.round(span)} degrees of hue` : 'lightness gradient within one hue'}`));
  });
  return out.slice(0, MAX_FINDINGS);
}
