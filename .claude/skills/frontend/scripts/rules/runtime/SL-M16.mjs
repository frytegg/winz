// @ts-check
/*
 * SL-M16: shape-assembled SVG illustrations and div-built fake screenshots (impeccable's shape-assembled-illustration;
 * taste-skill) [FD10-F28] [FD10 M16]. An illustration is a hero-sized inline SVG in the first two viewports built from
 * many primitives and carrying no text labels: labelled diagrams and charts are the documented false positive, and so
 * are icons and logos, which are small. A fake screenshot is a window drawn with three small red, amber and green dots
 * in a row and no real image, video, canvas or frame filling it.
 */
import { selectorFor } from '../../lib/dom.mjs';

/**
 * @typedef {import('../load.mjs').RuntimeContext} RuntimeContext
 * @typedef {import('../load.mjs').RuntimeFinding} RuntimeFinding
 * @typedef {import('../../lib/dom.mjs').Box} Box
 * @typedef {{kind: 'shape-illustration' | 'window-mockup', sel: string, box: Box, detail: string}} Hit
 */

export const RULE = 'SL-M16';
export const MAX_FINDINGS = 20;
export const MIN_PRIMITIVES = 12;
export const MIN_SVG_W = 240;
export const MIN_SVG_H = 160;

/**
 * @param {RuntimeContext} ctx
 * @returns {Promise<RuntimeFinding[]>}
 */
export async function detect(ctx) {
  const hits = /** @type {Hit[]} */ (
    await ctx.page.evaluate(`(${assembledVisuals.toString()})(${selectorFor.toString()}, ${JSON.stringify({ minPrimitives: MIN_PRIMITIVES, minW: MIN_SVG_W, minH: MIN_SVG_H })})`)
  );
  return hits.slice(0, MAX_FINDINGS).map((h) => ({
    rule: RULE,
    layer: /** @type {const} */ ('runtime'),
    route: ctx.route?.path ?? '',
    viewport: ctx.viewport?.name ?? '',
    selector: h.sel,
    box: h.box,
    value: { kind: h.kind, measured: h.detail, total: hits.length },
    detail: `${h.kind} (${h.detail}); show a real screenshot, a live demo or a labelled protocol diagram`,
  }));
}

/**
 * In-page: unlabelled primitive-built SVGs of hero size in the first two viewports, and traffic-light window mockups
 * without real media. Receives the selectorFor of lib/dom.mjs.
 * @param {(el: Element, counts?: Map<string, number>) => string} selectorOf
 * @param {{minPrimitives: number, minW: number, minH: number}} limits
 * @returns {Hit[]}
 */
export const assembledVisuals = function assembledVisuals(selectorOf, limits) {
  const counts = new Map();
  /** @type {Hit[]} */
  const out = [];
  /** @param {Element} el */
  const boxOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  };
  for (const svg of Array.from(document.querySelectorAll('svg'))) {
    if (svg.parentElement && svg.parentElement.closest('svg')) continue;
    const box = boxOf(svg);
    if (box.w < limits.minW || box.h < limits.minH || box.y > 2 * window.innerHeight) continue;
    if (svg.getClientRects().length === 0) continue;
    const primitives = svg.querySelectorAll('rect, circle, ellipse, line, polyline, polygon, path').length;
    const labels = Array.from(svg.querySelectorAll('text, foreignObject')).filter((t) => (t.textContent || '').trim().length > 0).length;
    if (primitives >= limits.minPrimitives && labels < 2) {
      out.push({ kind: 'shape-illustration', sel: selectorOf(svg, counts), box, detail: `${primitives} primitives, ${labels} text label(s)` });
    }
  }
  /** @param {string} css @returns {number | null} HSL hue of a saturated colour */
  const hue = (css) => {
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(css);
    if (!m) return null;
    const [r, g, b] = [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 0.25) return null;
    const d = max - min;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  /** @param {Element} el */
  const isDot = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.width > 18 || Math.abs(r.width - r.height) > 2) return false;
    const cs = getComputedStyle(el);
    const radius = cs.borderTopLeftRadius.endsWith('%') ? Number.parseFloat(cs.borderTopLeftRadius) / 100 * r.width : Number.parseFloat(cs.borderTopLeftRadius) || 0;
    return radius >= 0.4 * r.width && hue(cs.backgroundColor) !== null;
  };
  const used = new Set();
  for (const parent of Array.from(document.querySelectorAll('body *'))) {
    const dots = Array.from(parent.children).filter(isDot);
    if (dots.length < 3) continue;
    const hues = dots.slice(0, 3).map((d) => /** @type {number} */ (hue(getComputedStyle(d).backgroundColor)));
    const red = hues[0] <= 25 || hues[0] >= 335;
    const amber = hues[1] >= 30 && hues[1] <= 65;
    const green = hues[2] >= 85 && hues[2] <= 165;
    const tops = dots.slice(0, 3).map((d) => d.getBoundingClientRect().top);
    if (!red || !amber || !green || Math.max(...tops) - Math.min(...tops) > 3) continue;
    /** @type {Element | null} */
    let win = parent.parentElement;
    for (let hop = 0; hop < 3 && win; hop += 1) {
      const r = win.getBoundingClientRect();
      if (r.width >= 240 && r.height >= 160) break;
      win = win.parentElement;
    }
    if (!win || used.has(win)) continue;
    const w = win.getBoundingClientRect();
    const media = Array.from(win.querySelectorAll('img, video, canvas, iframe, picture')).some((m) => {
      const r = m.getBoundingClientRect();
      return r.width * r.height >= 0.4 * w.width * w.height;
    });
    if (media) continue;
    used.add(win);
    out.push({ kind: 'window-mockup', sel: selectorOf(win, counts), box: boxOf(win), detail: 'three traffic-light dots over a div-built window' });
  }
  return out;
};
